'use client'

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useDropzone } from 'react-dropzone'
import Sidebar from '@/components/Sidebar'
import ThemeToggle from '@/components/ThemeToggle'
import { useOcrActivity } from '@/contexts/OcrActivityContext'
import {
  AlertCircle,
  CheckCircle,
  Clock,
  FileText,
  FolderOpen,
  Loader2,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react'

const API_BASE = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5015'}/api`

const DEFAULT_DOC_TYPES = ['공문서', '계약서', '보고서', '학술논문', '법령문서', '회의록', '영수증', '신분증', '기타', '미분류']

type FileStatus = 'pending' | 'uploading' | 'queued' | 'failed'
type SourceType = 'file' | 'folder'

interface QueueFile {
  id: string
  file: File
  displayName: string
  docType: string
  status: FileStatus
  progress: number
  error?: string
  jobId?: string
  sourceType: SourceType
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function OcrWorkPage() {
  const { addTrackedJobs } = useOcrActivity()
  const [sessionName, setSessionName] = useState('')
  const [defaultDocType, setDefaultDocType] = useState('미분류')
  const [categories, setCategories] = useState<{ id: number; name: string }[]>([])
  const [queue, setQueue] = useState<QueueFile[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitMessage, setSubmitMessage] = useState('')

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const stored = typeof window !== 'undefined' ? localStorage.getItem('user') : null
        const user = stored ? JSON.parse(stored) : {}
        const userId = user?.user_id || 'default'
        const res = await fetch(`${API_BASE}/metadata-v3/categories?user_id=${encodeURIComponent(userId)}`)
        if (res.ok) {
          const data = await res.json()
          const defaultSet = new Set(DEFAULT_DOC_TYPES)
          const uniqueKoreanCats = (Array.isArray(data) ? data : []).filter(
            (cat: { id: number; name: string }) => cat?.name && !defaultSet.has(cat.name),
          )
          setCategories(uniqueKoreanCats)
        }
      } catch (e) {
        console.error('Failed to fetch categories', e)
      }
    }
    fetchCategories()
  }, [])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  const updateFile = useCallback((id: string, patch: Partial<QueueFile>) => {
    setQueue(prev => prev.map(file => (file.id === id ? { ...file, ...patch } : file)))
  }, [])

  const createQueueItems = useCallback(
    (files: File[], sourceType: SourceType) =>
      files
        .filter(file => /\.(pdf|png|jpe?g)$/i.test(file.name))
        .map(file => ({
          id: `${Date.now()}-${Math.random()}`,
          file,
          displayName: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
          docType: defaultDocType,
          status: 'pending' as const,
          progress: 0,
          sourceType,
        })),
    [defaultDocType],
  )

  const addFiles = useCallback(
    (files: File[], sourceType: SourceType) => {
      if (isSubmitting) return
      const items = createQueueItems(files, sourceType)
      if (items.length === 0) return
      setSubmitMessage('')
      setQueue(prev => [...prev, ...items])
    },
    [createQueueItems, isSubmitting],
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: acceptedFiles => addFiles(acceptedFiles, 'file'),
    noClick: true,
    accept: {
      'application/pdf': ['.pdf'],
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg'],
    },
  })

  const removeFile = useCallback((id: string) => {
    setQueue(prev => prev.filter(file => file.id !== id))
  }, [])

  const clearAll = useCallback(() => {
    if (isSubmitting) return
    setQueue([])
    setSubmitMessage('')
  }, [isSubmitting])

  const handleFileSelect = useCallback(
    (event: ChangeEvent<HTMLInputElement>, sourceType: SourceType) => {
      addFiles(Array.from(event.target.files || []), sourceType)
      event.target.value = ''
    },
    [addFiles],
  )

  const startProcessing = useCallback(async () => {
    const pendingFiles = queue.filter(file => file.status === 'pending')
    if (!sessionName.trim() || pendingFiles.length === 0) {
      alert('세션 이름과 파일을 입력해주세요.')
      return
    }

    setIsSubmitting(true)
    setSubmitMessage('')

    const user = JSON.parse(localStorage.getItem('user') || '{}')
    const userId = user.user_id || ''

    let sessionId = ''
    try {
      const sessionResponse = await fetch(`${API_BASE}/sessions?user_id=${encodeURIComponent(userId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_name: sessionName, description: '' }),
      })

      if (!sessionResponse.ok) {
        throw new Error('session create failed')
      }

      sessionId = (await sessionResponse.json()).session_id
    } catch {
      alert('세션 생성에 실패했습니다.')
      setIsSubmitting(false)
      return
    }

    const queuedJobs: Array<{
      jobId: string
      filename: string
      sessionName: string
      sourceType: SourceType
    }> = []

    for (const queueFile of pendingFiles) {
      try {
        updateFile(queueFile.id, { status: 'uploading', progress: 0 })

        const jobId = await new Promise<string>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          const params = new URLSearchParams()
          if (userId) params.set('user_id', userId)
          const normalizedDocType = queueFile.docType.trim()
          if (normalizedDocType) {
            params.set('doc_type', normalizedDocType)
          }
          xhr.open('POST', `${API_BASE}/upload?${params.toString()}`)

          xhr.upload.onprogress = event => {
            if (event.lengthComputable) {
              updateFile(queueFile.id, {
                progress: Math.round((event.loaded / event.total) * 100),
              })
            }
          }

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                resolve(JSON.parse(xhr.responseText).job_id)
              } catch {
                reject(new Error('응답 파싱 실패'))
              }
            } else {
              reject(new Error(`업로드 실패 (${xhr.status})`))
            }
          }

          xhr.onerror = () => reject(new Error('네트워크 오류'))

          const formData = new FormData()
          formData.append('file', queueFile.file)
          xhr.send(formData)
        })

        const documentResponse = await fetch(`${API_BASE}/sessions/${sessionId}/documents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ job_id: jobId, doc_type: queueFile.docType }),
        })

        if (!documentResponse.ok) {
          throw new Error('세션 문서 등록 실패')
        }

        const processResponse = await fetch(`${API_BASE}/process/${jobId}`, { method: 'POST' })
        if (!processResponse.ok) {
          throw new Error('OCR 작업 요청 실패')
        }

        updateFile(queueFile.id, { status: 'queued', progress: 100, jobId })
        queuedJobs.push({
          jobId,
          filename: queueFile.displayName,
          sessionName,
          sourceType: queueFile.sourceType,
        })
      } catch (error) {
        updateFile(queueFile.id, {
          status: 'failed',
          error: error instanceof Error ? error.message : '알 수 없는 오류',
        })
      }
    }

    if (queuedJobs.length > 0) {
      addTrackedJobs(queuedJobs)
    }

    setIsSubmitting(false)
    setSubmitMessage(
      queuedJobs.length > 0
        ? '작업 요청이 Redis 큐에 등록되었습니다. 다른 페이지로 이동해도 워커가 계속 처리됩니다.'
        : '큐 등록에 성공한 파일이 없습니다. 실패 항목을 확인해주세요.',
    )
  }, [addTrackedJobs, queue, sessionName, updateFile])

  const pendingCount = useMemo(() => queue.filter(file => file.status === 'pending').length, [queue])
  const queuedCount = useMemo(() => queue.filter(file => file.status === 'queued').length, [queue])
  const failedCount = useMemo(() => queue.filter(file => file.status === 'failed').length, [queue])

  const allDocTypes = useMemo(() => {
    const dbTypeNames = categories.map(c => c.name)
    return [
      ...DEFAULT_DOC_TYPES,
      ...dbTypeNames.filter(name => !DEFAULT_DOC_TYPES.includes(name))
    ]
  }, [categories])

  return (
    <div className="bg-background-light dark:bg-background-dark min-h-screen">
      <Sidebar />
      <main className="flex-1 ml-64 flex flex-col p-6 lg:p-10 min-w-0">
        <div className="w-full max-w-7xl mx-auto flex flex-col gap-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-text-primary-light dark:text-text-primary-dark text-3xl font-bold leading-tight tracking-tight">
                OCR 작업하기
              </h1>
              <p className="text-text-secondary-light dark:text-text-secondary-dark text-base mt-1">
                파일 또는 폴더를 선택하고 OCR 작업을 Redis 큐에 등록합니다.
              </p>
            </div>
            <ThemeToggle />
          </div>

          <div className="flex flex-col lg:flex-row gap-6">
            <div className="flex flex-col gap-4 lg:w-80 flex-shrink-0">
              <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark p-4">
                <label className="block text-sm font-semibold text-text-primary-light dark:text-text-primary-dark mb-2">
                  세션 이름
                </label>
                <input
                  type="text"
                  value={sessionName}
                  onChange={event => setSessionName(event.target.value)}
                  placeholder="예: 2026년 OCR 배치 작업"
                  disabled={isSubmitting}
                  className={`w-full px-3 py-2 text-sm border rounded-lg bg-background-light dark:bg-background-dark text-text-primary-light dark:text-text-primary-dark placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60 transition-colors ${
                    !sessionName.trim() && pendingCount > 0
                      ? 'border-orange-400 dark:border-orange-500'
                      : 'border-border-light dark:border-border-dark'
                  }`}
                />
              </div>
              <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark p-4">
                <label className="block text-sm font-semibold text-text-primary-light dark:text-text-primary-dark mb-2">
                  문서 유형 일괄 선택
                </label>
                <div className="relative">
                  <select
                    value={defaultDocType}
                    onChange={event => {
                      const nextDocType = event.target.value
                      setDefaultDocType(nextDocType)
                      // 일괄 선택 변경 시 현재 리스트의 모든 파일에 즉시 반영
                      setQueue(prev =>
                        prev.map(file => ({ ...file, docType: nextDocType })),
                      )
                    }}
                    disabled={isSubmitting}
                    className="w-full appearance-none px-3 pr-10 py-2 text-sm border border-border-light dark:border-border-dark rounded-lg bg-background-light dark:bg-background-dark text-text-primary-light dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60 transition-colors"
                  >
                    {allDocTypes.map(type => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                  <span className="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-lg text-text-secondary-light dark:text-text-secondary-dark">
                    expand_more
                  </span>
                </div>
              </div>

              <div
                {...getRootProps()}
                className={`flex flex-col items-center justify-center gap-3 p-8 rounded-xl border-2 border-dashed transition-colors cursor-default ${
                  isDragActive
                    ? 'border-primary bg-primary/5'
                    : 'border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark hover:border-primary/50'
                }`}
              >
                <input {...getInputProps()} />
                <span className="material-symbols-outlined text-5xl text-text-secondary-light dark:text-text-secondary-dark">
                  {isDragActive ? 'download' : 'cloud_upload'}
                </span>
                <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark text-center whitespace-pre-line">
                  {isDragActive ? '여기에 놓으세요' : '파일을 드래그해서 추가하거나 아래 버튼을 사용하세요'}
                </p>
                <div className="flex flex-col w-full gap-2">
                  <label className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold bg-primary text-white rounded-lg hover:bg-primary/90 cursor-pointer transition-colors">
                    <Upload className="w-4 h-4" />
                    파일로 업로드
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept=".pdf,.png,.jpg,.jpeg"
                      className="hidden"
                      disabled={isSubmitting}
                      onChange={event => handleFileSelect(event, 'file')}
                    />
                  </label>

                  <label className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold bg-primary/10 text-primary rounded-lg hover:bg-primary/20 cursor-pointer transition-colors">
                    <FolderOpen className="w-4 h-4" />
                    폴더로 업로드
                    <input
                      ref={folderInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      disabled={isSubmitting}
                      // @ts-expect-error webkitdirectory is supported by Chromium-based browsers
                      webkitdirectory=""
                      onChange={event => handleFileSelect(event, 'folder')}
                    />
                  </label>
                </div>
                <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                  PDF, PNG, JPG 지원
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: '대기', value: pendingCount, color: 'text-gray-500' },
                  { label: '큐 등록', value: queuedCount, color: 'text-blue-600' },
                  { label: '실패', value: failedCount, color: 'text-red-500' },
                ].map(item => (
                  <div
                    key={item.label}
                    className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark p-3 text-center"
                  >
                    <p className={`text-lg font-bold ${item.color}`}>{item.value}</p>
                    <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                      {item.label}
                    </p>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-2">
                <button
                  onClick={() => void startProcessing()}
                  disabled={isSubmitting || pendingCount === 0 || !sessionName.trim()}
                  className="flex items-center justify-center gap-2 px-5 py-3 text-sm bg-primary hover:bg-primary/90 text-white rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-semibold"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      작업 등록 중...
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4" />
                      OCR 시작하기
                    </>
                  )}
                </button>
                <button
                  onClick={clearAll}
                  disabled={isSubmitting || queue.length === 0}
                  className="flex items-center justify-center gap-2 px-4 py-2 text-sm text-text-secondary-light dark:text-text-secondary-dark hover:text-red-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  전체 지우기
                </button>
              </div>

              {submitMessage && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-sm text-green-700 dark:text-green-400">
                  <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div className="flex flex-col gap-1">
                    <span>{submitMessage}</span>
                    <a href="/jobs" className="font-medium underline underline-offset-2 hover:opacity-80">
                      진행 현황은 작업내역에서 확인하기
                    </a>
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1 bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark min-h-[520px]">
              {queue.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full py-20 text-text-secondary-light dark:text-text-secondary-dark">
                  <FileText className="w-12 h-12 mb-3 opacity-20" />
                  <p className="text-sm">선택한 파일 목록이 여기에 표시됩니다</p>
                </div>
              ) : (
                <ul className="divide-y divide-border-light dark:divide-border-dark overflow-y-auto max-h-[70vh]">
                  {queue.map(file => (
                    <li key={file.id} className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex-shrink-0">
                          {file.status === 'pending' && <Clock className="w-4 h-4 text-gray-400" />}
                          {file.status === 'uploading' && <Upload className="w-4 h-4 text-blue-500 animate-pulse" />}
                          {file.status === 'queued' && <CheckCircle className="w-4 h-4 text-blue-600" />}
                          {file.status === 'failed' && <AlertCircle className="w-4 h-4 text-red-500" />}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark truncate">
                                {file.displayName}
                              </p>
                              <div className="mt-1 flex items-center gap-2">
                                <label className="text-[11px] text-text-secondary-light dark:text-text-secondary-dark">
                                  문서유형
                                </label>
                                <div className="relative w-[170px]">
                                  <select
                                    value={file.docType}
                                    disabled={isSubmitting}
                                    onChange={event => updateFile(file.id, { docType: event.target.value })}
                                    className="w-full appearance-none px-2 py-1 pr-7 text-xs border border-border-light dark:border-border-dark rounded-md bg-background-light dark:bg-background-dark text-text-primary-light dark:text-text-primary-dark focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60 transition-colors"
                                  >
                                    {allDocTypes.map(type => (
                                      <option key={type} value={type}>
                                        {type}
                                      </option>
                                    ))}
                                  </select>
                                  <span className="material-symbols-outlined pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-sm text-text-secondary-light dark:text-text-secondary-dark">
                                    expand_more
                                  </span>
                                </div>
                              </div>
                              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-0.5">
                                {formatBytes(file.file.size)} · {file.sourceType === 'folder' ? '폴더 업로드' : '파일 업로드'}
                              </p>
                            </div>

                            {file.status === 'pending' && !isSubmitting && (
                              <button
                                onClick={() => removeFile(file.id)}
                                className="flex-shrink-0 p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 transition-colors"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>

                          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-1">
                            {file.status === 'pending' && '대기 중'}
                            {file.status === 'uploading' && '업로드 중...'}
                            {file.status === 'queued' && 'Redis 큐 등록 완료 · 워커 처리 대기/진행 중'}
                            {file.status === 'failed' && '등록 실패'}
                          </p>

                          {file.status === 'uploading' && (
                            <div className="mt-1.5 w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                              <div
                                className="h-1.5 rounded-full transition-all duration-300 bg-blue-500"
                                style={{ width: `${file.progress}%` }}
                              />
                            </div>
                          )}

                          {file.status === 'queued' && (
                            <div className="mt-1.5 w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                              <div className="h-1.5 rounded-full bg-blue-600 transition-all duration-500 animate-pulse" style={{ width: '12%' }} />
                            </div>
                          )}

                          {file.status === 'failed' && file.error && (
                            <p className="text-xs text-red-500 mt-1">{file.error}</p>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
