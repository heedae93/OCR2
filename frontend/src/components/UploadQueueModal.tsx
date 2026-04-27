'use client'

import { useState, useRef, useEffect } from 'react'
import {
  X,
  FileText,
  CheckCircle,
  AlertCircle,
  Clock,
  Loader2,
  Trash2,
  Zap,
  Upload
} from 'lucide-react'

const API_BASE = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:6015'}/api`

type FileStatus = 'pending' | 'uploading' | 'processing' | 'completed' | 'failed'

interface QueueFile {
  id: string
  file: File
  status: FileStatus
  progress: number
  docType: string
  error?: string
  jobId?: string
}

const DEFAULT_DOC_TYPES = [
  '영수증',
  '계약서',
  '보고서',
  '공문서',
  '명세서',
  '신분증',
  '인사서류',
  '기타',
]

export interface ProcessingStats {
  total: number
  completed: number
  failed: number
  isRunning: boolean
}

interface Props {
  visible: boolean
  onClose: () => void
  onComplete: () => void
  onProcessingChange?: (stats: ProcessingStats) => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function UploadQueueModal({ visible, onClose, onComplete, onProcessingChange }: Props) {
  const [sessionName, setSessionName] = useState('')
  const [queue, setQueue] = useState<QueueFile[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [isDone, setIsDone] = useState(false)
  const [docTypeOptions, setDocTypeOptions] = useState<string[]>(DEFAULT_DOC_TYPES)
  const [bulkDocType, setBulkDocType] = useState('')
  const [hasFsApi, setHasFsApi] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setHasFsApi(typeof window !== 'undefined' && 'showOpenFilePicker' in window)
  }, [])

  useEffect(() => {
    const loadDocTypeOptions = async () => {
      try {
        const currentUser = JSON.parse(localStorage.getItem('user') || '{}')
        const userId = currentUser.user_id || ''
        if (!userId) {
          setDocTypeOptions(DEFAULT_DOC_TYPES)
          return
        }

        const res = await fetch(`${API_BASE}/metadata-v3/categories?user_id=${encodeURIComponent(userId)}`)
        if (!res.ok) {
          setDocTypeOptions(DEFAULT_DOC_TYPES)
          return
        }

        const customTypes = (await res.json())
          .map((item: { name?: string }) => (item.name || '').trim())
          .filter(Boolean)

        setDocTypeOptions(Array.from(new Set([...DEFAULT_DOC_TYPES, ...customTypes])))
      } catch {
        setDocTypeOptions(DEFAULT_DOC_TYPES)
      }
    }

    if (visible) {
      void loadDocTypeOptions()
    }
  }, [visible])

  useEffect(() => {
    if (!onProcessingChange) return
    onProcessingChange({
      total: queue.length,
      completed: queue.filter(f => f.status === 'completed').length,
      failed: queue.filter(f => f.status === 'failed').length,
      isRunning,
    })
  }, [queue, isRunning]) // eslint-disable-line react-hooks/exhaustive-deps

  const updateFile = (id: string, patch: Partial<QueueFile>) => {
    setQueue(prev => prev.map(f => (f.id === id ? { ...f, ...patch } : f)))
  }

  const fileToQueueItem = (file: File): QueueFile => ({
    id: `${Date.now()}-${Math.random()}`,
    file,
    status: 'pending',
    progress: 0,
    docType: bulkDocType,
  })

  const applyBulkDocType = (docType: string) => {
    setBulkDocType(docType)
    setQueue(prev => prev.map(file => (
      file.status === 'pending' ? { ...file, docType } : file
    )))
  }

  const updateFileDocType = (id: string, docType: string) => {
    setQueue(prev => prev.map(file => (
      file.id === id ? { ...file, docType } : file
    )))
  }

  const openFilePicker = async () => {
    if (isRunning) return
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handles: FileSystemFileHandle[] = await (window as any).showOpenFilePicker({
        multiple: true,
        types: [{
          description: 'OCR 지원 파일',
          accept: {
            'application/pdf': ['.pdf'],
            'image/png': ['.png'],
            'image/jpeg': ['.jpg', '.jpeg'],
          },
        }],
      })
      const items: QueueFile[] = []
      for (const h of handles) {
        const file = await h.getFile()
        items.push(fileToQueueItem(file))
      }
      if (items.length) setQueue(prev => [...prev, ...items])
    } catch { /* user cancelled */ }
  }

  // Fallback for browsers without File System Access API
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const items = Array.from(e.target.files || []).map(fileToQueueItem)
    setQueue(prev => [...prev, ...items])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeFile = (id: string) => setQueue(prev => prev.filter(f => f.id !== id))
  const clearAll = () => { if (!isRunning) setQueue([]) }

  const pollStatus = (jobId: string, fileId: string): Promise<void> =>
    new Promise((resolve, reject) => {
      const interval = setInterval(async () => {
        try {
          const res = await fetch(`${API_BASE}/status/${jobId}`)
          if (!res.ok) throw new Error('상태 조회 실패')
          const data = await res.json()
          const mapped = 50 + Math.round(((data.progress_percent ?? 0) / 100) * 50)
          updateFile(fileId, { progress: Math.min(mapped, 99) })
          if (data.status === 'completed') {
            clearInterval(interval)
            updateFile(fileId, { status: 'completed', progress: 100 })
            resolve()
          } else if (data.status === 'failed') {
            clearInterval(interval)
            updateFile(fileId, { status: 'failed', error: data.error_message || '처리 실패' })
            reject(new Error(data.error_message || '처리 실패'))
          }
        } catch (err) {
          clearInterval(interval)
          updateFile(fileId, { status: 'failed', error: String(err) })
          reject(err)
        }
      }, 2000)
    })

  const startProcessing = async () => {
    const pending = queue.filter(f => f.status === 'pending')
    if (!sessionName.trim() || pending.length === 0) {
      alert('세션 이름과 파일을 입력해주세요.')
      return
    }
    setIsRunning(true)

    let sessionId: string
    const currentUser = JSON.parse(localStorage.getItem('user') || '{}')
    const userId = currentUser.user_id || ''
    try {
      const res = await fetch(`${API_BASE}/sessions?user_id=${encodeURIComponent(userId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_name: sessionName, description: '' })
      })
      if (!res.ok) throw new Error()
      sessionId = (await res.json()).session_id
    } catch {
      alert('세션 생성에 실패했습니다.')
      setIsRunning(false)
      return
    }

    for (const qf of pending) {
      try {
        updateFile(qf.id, { status: 'uploading', progress: 0 })
        const jobId = await new Promise<string>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          const params = new URLSearchParams()
          if (userId) params.set('user_id', userId)
          if (qf.docType) params.set('doc_type', qf.docType)
          xhr.open('POST', `${API_BASE}/upload?${params.toString()}`)
          xhr.upload.onprogress = e => {
            if (e.lengthComputable)
              updateFile(qf.id, { progress: Math.round((e.loaded / e.total) * 50) })
          }
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try { resolve(JSON.parse(xhr.responseText).job_id) }
              catch { reject(new Error('응답 파싱 실패')) }
            } else {
              reject(new Error(`업로드 실패 (${xhr.status})`))
            }
          }
          xhr.onerror = () => reject(new Error('네트워크 오류'))
          const fd = new FormData()
          fd.append('file', qf.file)
          xhr.send(fd)
        })

        updateFile(qf.id, { status: 'processing', progress: 50, jobId })
        await fetch(`${API_BASE}/sessions/${sessionId}/documents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ job_id: jobId, doc_type: qf.docType || null })
        })
        await fetch(`${API_BASE}/process/${jobId}`, { method: 'POST' })
        await pollStatus(jobId, qf.id)
      } catch (err) {
        updateFile(qf.id, {
          status: 'failed',
          error: err instanceof Error ? err.message : '알 수 없는 오류'
        })
      }
    }

    setIsRunning(false)
    setIsDone(true)
    onComplete()
  }

  const pendingCount = queue.filter(f => f.status === 'pending').length
  const completedCount = queue.filter(f => f.status === 'completed').length
  const failedCount = queue.filter(f => f.status === 'failed').length
  const allDoneOrFailed = queue.length > 0 && queue.every(f => f.status === 'completed' || f.status === 'failed')
  return (
    <div className={`fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 ${visible ? '' : 'hidden'}`}>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-4xl flex flex-col overflow-hidden" style={{ height: '90vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-blue-500" />
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">새 OCR 작업</h2>
            {isRunning && (
              <span className="flex items-center gap-1 text-xs text-blue-500 ml-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                처리 중
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title={isRunning ? '닫아도 백그라운드에서 계속 처리됩니다' : '닫기'}
          >
            <X className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        {/* Session name */}
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700">
          <input
            type="text"
            value={sessionName}
            onChange={e => setSessionName(e.target.value)}
            placeholder="세션 이름 (예: 2024년 보고서 OCR)"
            disabled={isRunning}
            className={`w-full px-3 py-2 text-sm border rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 transition-colors ${
              !sessionName.trim() && pendingCount > 0
                ? 'border-orange-400 dark:border-orange-500 focus:ring-orange-400'
                : 'border-gray-300 dark:border-gray-600'
            }`}
          />
          {!sessionName.trim() && pendingCount > 0 && (
            <p className="mt-1.5 text-xs text-orange-500 flex items-center gap-1">
              <span>⚠</span> 세션 이름을 입력해야 시작하기 버튼이 활성화됩니다
            </p>
          )}
        </div>

        {/* File select button */}
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="mb-3 flex items-center gap-3">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
              일괄 카테고리
            </label>
            <select
              value={bulkDocType}
              onChange={e => applyBulkDocType(e.target.value)}
              disabled={isRunning || queue.length === 0}
              className="flex-1 px-3 py-2 text-sm border rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 disabled:opacity-60"
            >
              <option value="">카테고리 미지정</option>
              {docTypeOptions.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
          {hasFsApi ? (
            <button
              onClick={openFilePicker}
              disabled={isRunning}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500 rounded-lg text-sm text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Upload className="w-4 h-4" />
              파일 선택
              <span className="text-xs text-gray-400">(PDF · PNG · JPG · 다중 선택 가능)</span>
            </button>
          ) : (
            <label className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-blue-400 rounded-lg text-sm text-gray-500 hover:text-blue-600 cursor-pointer transition-colors">
              <Upload className="w-4 h-4" />
              파일 선택
              <span className="text-xs text-gray-400">(PDF · PNG · JPG · 다중 선택 가능)</span>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg"
                className="hidden"
                onChange={handleFileInput}
                disabled={isRunning}
              />
            </label>
          )}
        </div>

        {/* Queue list */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {queue.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-20 text-gray-400 dark:text-gray-500">
              <FileText className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm">파일을 선택하면 여기에 표시됩니다</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {queue.map(qf => (
                <li key={qf.id} className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    {/* Status icon */}
                    <div className="flex-shrink-0">
                      {qf.status === 'pending' && <Clock className="w-4 h-4 text-gray-400" />}
                      {qf.status === 'uploading' && <Upload className="w-4 h-4 text-blue-500 animate-pulse" />}
                      {qf.status === 'processing' && <Loader2 className="w-4 h-4 text-orange-500 animate-spin" />}
                      {qf.status === 'completed' && <CheckCircle className="w-4 h-4 text-green-500" />}
                      {qf.status === 'failed' && <AlertCircle className="w-4 h-4 text-red-500" />}
                    </div>

                    {/* File info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{qf.file.name}</p>
                        {qf.status === 'pending' && !isRunning && (
                          <button
                            onClick={() => removeFile(qf.id)}
                            className="flex-shrink-0 p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 transition-colors"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <div className="mt-2">
                        <select
                          value={qf.docType}
                          onChange={e => updateFileDocType(qf.id, e.target.value)}
                          disabled={isRunning || qf.status !== 'pending'}
                          className="w-full px-3 py-2 text-xs border rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 disabled:opacity-60"
                        >
                          <option value="">카테고리 미지정</option>
                          {docTypeOptions.map(option => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {formatBytes(qf.file.size)}
                        {qf.status === 'uploading' && ' · 업로드 중...'}
                        {qf.status === 'processing' && ' · OCR 처리 중...'}
                        {qf.status === 'completed' && ' · 완료'}
                      </p>
                      {(qf.status === 'uploading' || qf.status === 'processing') && (
                        <div className="mt-1.5 w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1">
                          <div
                            className={`h-1 rounded-full transition-all duration-300 ${qf.status === 'uploading' ? 'bg-blue-500' : 'bg-orange-500'}`}
                            style={{ width: `${qf.progress}%` }}
                          />
                        </div>
                      )}
                      {qf.status === 'completed' && (
                        <div className="mt-1.5 w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1">
                          <div className="h-1 rounded-full bg-green-500 w-full" />
                        </div>
                      )}
                      {qf.status === 'failed' && qf.error && (
                        <p className="text-xs text-red-500 mt-1">{qf.error}</p>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Summary + Footer */}
        {queue.length > 0 && (
          <div className="px-5 py-1.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 text-xs text-gray-400 dark:text-gray-500">
            전체 {queue.length} · 대기 {pendingCount} · 완료 {completedCount} · 실패 {failedCount}
          </div>
        )}

        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <button
            onClick={clearAll}
            disabled={isRunning || queue.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-500 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            전체 지우기
          </button>

          <div className="flex items-center gap-2">
            {isRunning && (
              <span className="text-xs text-gray-400">닫아도 계속 처리됩니다</span>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
            >
              {isDone || allDoneOrFailed ? '닫기' : isRunning ? '백그라운드로' : '취소'}
            </button>
            <button
              onClick={startProcessing}
              disabled={isRunning || pendingCount === 0 || !sessionName.trim()}
              className="flex items-center gap-2 px-5 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium"
            >
              {isRunning
                ? <><Loader2 className="w-4 h-4 animate-spin" />처리 중...</>
                : <><Zap className="w-4 h-4" />시작하기</>
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
