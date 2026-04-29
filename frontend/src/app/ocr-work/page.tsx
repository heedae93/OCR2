'use client'

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useDropzone } from 'react-dropzone'
import Link from 'next/link'
import Sidebar from '@/components/Sidebar'
import ThemeToggle from '@/components/ThemeToggle'
import { useOcrActivity } from '@/contexts/OcrActivityContext'
import {
  AlertCircle,
  CheckCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  Loader2,
  Trash2,
  Upload,
  X,
  Plus,
  FolderOpen,
  StopCircle,
  Zap,
  FileText,
  CloudUpload,
} from 'lucide-react'

const API_BASE = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:6015'}/api`

const DEFAULT_DOC_TYPES = ['공문서', '계약서', '보고서', '학술논문', '법령문서', '회의록', '영수증', '신분증', '기타', '미분류']

type FileStatus = 'pending' | 'uploading' | 'queued' | 'failed'
type SourceType = 'file' | 'folder'

interface QueueFile {
  id: string
  file?: File
  displayName: string
  docType: string
  status: FileStatus
  progress: number
  fileSize: number
  error?: string
  jobId?: string
  sourceType: SourceType
  sessionName: string
  failedStage?: number
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

import PipelineProgress from '@/components/PipelineProgress'


export default function OcrWorkPage() {
  const { addTrackedJobs, trackedJobs } = useOcrActivity()
  const [sessionName, setSessionName] = useState('')
  const [defaultDocType, setDefaultDocType] = useState('미분류')
  const [categories, setCategories] = useState<{ id: number; name: string }[]>([])
  const [queue, setQueue] = useState<QueueFile[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitMessage, setSubmitMessage] = useState('')
  const [expandedSessions, setExpandedSessions] = useState<Record<string, boolean>>({})
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({})
  const [sessionPage, setSessionPage] = useState(1)
  const SESSIONS_PER_PAGE = 6

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

    const savedUser = localStorage.getItem('user')
    const user = savedUser ? JSON.parse(savedUser) : {}
    const userId = user?.user_id || 'default'

    // Restore state from user-specific localStorage
    const savedQueue = localStorage.getItem(`ocr_work_queue_${userId}`)
    if (savedQueue) {
      try {
        setQueue(JSON.parse(savedQueue))
      } catch (e) {
        console.error('Failed to restore queue', e)
      }
    }
    const savedSessionName = localStorage.getItem(`ocr_work_session_name_${userId}`)
    if (savedSessionName) {
      setSessionName(savedSessionName)
    }

    // [Cleanup] Remove old generic keys if they exist
    localStorage.removeItem('ocr_work_queue')
    localStorage.removeItem('ocr_work_session_name')
  }, [])

  // Auto-hide submit message
  useEffect(() => {
    if (submitMessage) {
      const timer = setTimeout(() => {
        setSubmitMessage('')
      }, 5000)
      return () => clearTimeout(timer)
    }
  }, [submitMessage])

  // Persist state to localStorage
  useEffect(() => {
    const savedUser = localStorage.getItem('user')
    const user = savedUser ? JSON.parse(savedUser) : {}
    const userId = user?.user_id || 'default'

    if (queue.length > 0) {
      const serializableQueue = queue.map(item => ({
        ...item,
        file: undefined
      }))
      localStorage.setItem(`ocr_work_queue_${userId}`, JSON.stringify(serializableQueue))
    } else {
      localStorage.removeItem(`ocr_work_queue_${userId}`)
    }
  }, [queue])

  useEffect(() => {
    const savedUser = localStorage.getItem('user')
    const user = savedUser ? JSON.parse(savedUser) : {}
    const userId = user?.user_id || 'default'

    if (sessionName) {
      localStorage.setItem(`ocr_work_session_name_${userId}`, sessionName)
    }
  }, [sessionName])
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
          fileSize: file.size,
          sourceType,
          sessionName: sessionName.trim() || '미지정 세션',
        })),
    [defaultDocType, sessionName],
  )

  const addFiles = useCallback(
    (files: File[], sourceType: SourceType) => {
      if (isSubmitting) return
      const items = createQueueItems(files, sourceType)
      if (items.length === 0) return
      setSubmitMessage('')
      setQueue(prev => [...prev, ...items])
      
      // 파일 추가 시 해당 세션은 자동으로 펼침
      if (items.length > 0) {
        const sName = items[0].sessionName
        setExpandedSessions(prev => ({ ...prev, [sName]: true }))
      }
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
    setExpandedSessions({})
    setVisibleCounts({})
  }, [isSubmitting])

  const updateSessionDocType = useCallback((sName: string, docType: string) => {
    setQueue(prev => prev.map(file => {
      const fileSession = file.status === 'pending'
        ? (sessionName.trim() || '미지정 세션')
        : (file.sessionName || '미지정 세션')
      return fileSession === sName ? { ...file, docType } : file
    }))
  }, [sessionName])

  const removeSession = useCallback((sName: string) => {
    if (isSubmitting) return
    setQueue(prev => prev.filter(file => {
      const fileSession = file.status === 'pending'
        ? (sessionName.trim() || '미지정 세션')
        : (file.sessionName || '미지정 세션')
      return fileSession !== sName
    }))
    setExpandedSessions(prev => {
      const next = { ...prev }
      delete next[sName]
      return next
    })
    setVisibleCounts(prev => {
      const next = { ...prev }
      delete next[sName]
      return next
    })
  }, [isSubmitting, sessionName])

  const handleFileSelect = useCallback(
    (event: ChangeEvent<HTMLInputElement>, sourceType: SourceType) => {
      addFiles(Array.from(event.target.files || []), sourceType)
      event.target.value = ''
    },
    [addFiles],
  )

  const startProcessing = useCallback(async () => {
    const pendingFiles = queue.filter(file => file.status === 'pending')
    if (pendingFiles.length === 0) {
      alert('업로드할 파일이 없습니다.')
      return
    }

    // Redis 상태 확인
    try {
      const redisRes = await fetch(`${API_BASE}/redis/health`)
      if (redisRes.ok) {
        const redisData = await redisRes.json()
        if (!redisData.available) {
          alert('Redis 서버에 연결할 수 없습니다.\n작업 큐에 등록할 수 없으므로 작업을 시작할 수 없습니다.\n관리자에게 문의해 주세요.')
          return
        }
      }
    } catch {
      // 백엔드 자체가 다운된 경우 — 이후 단계에서 실패 처리됨
    }

    // 워커 상태 확인
    try {
      const workerRes = await fetch(`${API_BASE}/worker/health`)
      if (workerRes.ok) {
        const workerData = await workerRes.json()
        if (!workerData.available) {
          alert('OCR 워커가 실행 중이지 않습니다.\n관리자에게 문의하거나 서버를 재시작해 주세요.')
          return
        }
      }
    } catch {
      // 백엔드 자체가 다운된 경우 — 이후 단계에서 실패 처리됨
    }

    setIsSubmitting(true)
    setSubmitMessage('')

    const user = JSON.parse(localStorage.getItem('user') || '{}')
    const userId = user.user_id || ''

    const queuedJobs: Array<{
      jobId: string
      filename: string
      sessionName: string
      sourceType: SourceType
    }> = []

    // 제출 시점의 sessionName state를 우선 사용 (파일 추가 후 세션명 변경 시에도 반영)
    const currentSession = sessionName.trim() || '미지정 세션'
    const pendingBySession = pendingFiles.reduce((acc, file) => {
      const name = currentSession
      if (!acc[name]) acc[name] = []
      acc[name].push(file)
      return acc
    }, {} as Record<string, QueueFile[]>)

    for (const [sName, files] of Object.entries(pendingBySession)) {
      let sessionId = ''
      try {
        const sessionResponse = await fetch(`${API_BASE}/sessions?user_id=${encodeURIComponent(userId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_name: sName, description: '' }),
        })

        if (!sessionResponse.ok) throw new Error('session create failed')
        sessionId = (await sessionResponse.json()).session_id
      } catch {
        alert(`세션 '${sName}' 생성에 실패했습니다.`)
        continue
      }

      for (const queueFile of files) {
        let jobId: string | undefined
        try {
          updateFile(queueFile.id, { status: 'uploading', progress: 0 })

          jobId = await new Promise<string>((resolve, reject) => {
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

            if (!queueFile.file) {
              reject(new Error('파일 객체가 없습니다.'))
              return
            }
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
            throw new Error('Redis 큐 서버가 비정상입니다. 작업을 등록할 수 없습니다.')
          }

          updateFile(queueFile.id, { status: 'queued', progress: 100, jobId: jobId! })
          queuedJobs.push({
            jobId: jobId!,
            filename: queueFile.displayName,
            sessionName: queueFile.sessionName,
            sourceType: queueFile.sourceType,
          })
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : '알 수 없는 오류'
          updateFile(queueFile.id, {
            status: 'failed',
            error: errMsg,
            failedStage: 0,
          })
          
          // If jobId exists, try to notify backend that it failed
          if (queueFile.jobId || jobId) {
            const finalJobId = queueFile.jobId || jobId
            try {
              console.log(`Notifying backend of failure for job ${finalJobId}`)
              await fetch(`${API_BASE}/status/${finalJobId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                  status: 'failed', 
                  error_message: errMsg 
                })
              })
            } catch (e) {
              console.error('Failed to notify backend of job failure', e)
            }
          }
        }
      }
    }

    if (queuedJobs.length > 0) {
      addTrackedJobs(queuedJobs)
    }

    setSessionName('')
    setDefaultDocType('미분류')

    setIsSubmitting(false)
    setSubmitMessage('작업내역에서 확인')
  }, [addTrackedJobs, queue, updateFile, sessionName, defaultDocType])

  const pendingCount = useMemo(() => queue.filter(file => {
    const tracked = trackedJobs.find(tj => tj.jobId === file.jobId)
    const effectiveStatus = tracked ? tracked.status : file.status
    return effectiveStatus === 'pending'
  }).length, [queue, trackedJobs])

  const queuedCount = useMemo(() => queue.filter(file => {
    const tracked = trackedJobs.find(tj => tj.jobId === file.jobId)
    const effectiveStatus = tracked ? tracked.status : file.status
    return effectiveStatus === 'queued' || effectiveStatus === 'processing'
  }).length, [queue, trackedJobs])

  const failedCount = useMemo(() => queue.filter(file => {
    const tracked = trackedJobs.find(tj => tj.jobId === file.jobId)
    const effectiveStatus = tracked ? tracked.status : file.status
    return effectiveStatus === 'failed'
  }).length, [queue, trackedJobs])

  const allDocTypes = useMemo(() => {
    const dbTypeNames = categories.map(c => c.name)
    return [
      ...DEFAULT_DOC_TYPES,
      ...dbTypeNames.filter(name => !DEFAULT_DOC_TYPES.includes(name))
    ]
  }, [categories])

  const groupedQueueArray = useMemo(() => {
    const groups: Record<string, QueueFile[]> = {}
    queue.forEach(file => {
      const sName = file.status === 'pending'
        ? (sessionName.trim() || '미지정 세션')
        : (file.sessionName || '미지정 세션')
      if (!groups[sName]) groups[sName] = []
      groups[sName].push(file)
    })
    return Object.entries(groups).reverse()
  }, [queue, sessionName])

  const paginatedGroups = useMemo(() => {
    const start = (sessionPage - 1) * SESSIONS_PER_PAGE
    return groupedQueueArray.slice(start, start + SESSIONS_PER_PAGE)
  }, [groupedQueueArray, sessionPage])

  const totalSessionPages = Math.ceil(groupedQueueArray.length / SESSIONS_PER_PAGE)

  useEffect(() => {
    if (sessionPage > 1 && sessionPage > totalSessionPages) {
      setSessionPage(Math.max(1, totalSessionPages))
    }
  }, [totalSessionPages, sessionPage])

  return (
    <div className="bg-background-light dark:bg-background-dark min-h-screen">
      <Sidebar />
      <main className="flex-1 ml-64 flex flex-col p-6 lg:p-10 min-w-0">
        <div className="w-full max-w-7xl mx-auto flex flex-col gap-6">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0 pr-4">
              <h1 className="text-text-primary-light dark:text-text-primary-dark text-3xl font-bold leading-tight tracking-tight">
                문서 작업하기
              </h1>
              <p className="text-text-secondary-light dark:text-text-secondary-dark text-base mt-1 truncate">
                파일 또는 폴더를 선택하고 문서 작업을 Redis 큐에 등록합니다.
              </p>
            </div>
            
            <div className="flex items-center gap-3">
              {submitMessage && (
                <Link 
                  href="/jobs"
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30 transition-all animate-in fade-in slide-in-from-right-2 duration-300 group"
                >
                  <CheckCircle className="w-4 h-4" />
                  <span className="text-xs font-bold">{submitMessage}</span>
                  <span className="material-symbols-outlined !text-xs group-hover:translate-x-0.5 transition-transform">arrow_forward</span>
                </Link>
              )}
              <ThemeToggle />
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
              {/* Dropzone Column (Expanded to 2 spans) */}
              <div
                {...getRootProps()}
                className={`lg:col-span-2 group relative flex flex-col items-center justify-center gap-2 p-6 rounded-xl border-2 border-dashed transition-all cursor-pointer overflow-hidden ${
                  isDragActive
                    ? 'border-primary bg-primary/5 ring-4 ring-primary/10'
                    : 'border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark hover:border-primary/50 hover:bg-primary/5'
                }`}
              >
                <input {...getInputProps()} />
                <div className="relative z-10 flex flex-col items-center gap-2">
                  <div className="p-3 rounded-full bg-primary/10 text-primary group-hover:scale-110 transition-transform">
                    <CloudUpload className="w-6 h-6" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-text-primary-light dark:text-text-primary-dark">
                      {isDragActive ? '여기에 놓으세요' : '파일 추가'}
                    </p>
                    <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark mt-1">
                      PDF, PNG, JPG 지원
                    </p>
                  </div>
                  <div className="flex flex-col w-full gap-1.5 mt-2">
                    <label className="flex items-center justify-center gap-2 px-8 py-2.5 text-xs font-bold bg-primary text-white rounded-lg hover:bg-primary/90 cursor-pointer transition-all active:scale-[0.98] shadow-sm">
                      <Upload className="w-4 h-4" />
                      파일 선택
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
                    <label className="flex items-center justify-center gap-2 px-8 py-2.5 text-xs font-bold bg-primary/10 text-primary rounded-lg hover:bg-primary/20 cursor-pointer transition-all active:scale-[0.98]">
                      <FolderOpen className="w-4 h-4" />
                      폴더 선택
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
                </div>
                {/* Decorative Background Icon */}
                <span className="material-symbols-outlined absolute -bottom-4 -right-4 text-8xl opacity-[0.03] dark:opacity-[0.05] pointer-events-none">
                  upload_file
                </span>
              </div>

              {/* Session Name & Doc Type Column (1 span) */}
              <div className="lg:col-span-1 flex flex-col gap-3">
                <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark p-4 flex-1 flex flex-col justify-center">
                  <label className="block text-xs font-bold text-text-secondary-light dark:text-text-secondary-dark mb-1.5 uppercase tracking-wider">
                    세션 이름
                  </label>
                  <input
                    type="text"
                    value={sessionName}
                    onChange={event => setSessionName(event.target.value)}
                    placeholder="세션 이름을 입력하세요"
                    disabled={isSubmitting}
                    className={`w-full px-3 py-2 text-sm border rounded-lg bg-background-light dark:bg-background-dark text-text-primary-light dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all ${
                      !sessionName.trim() && pendingCount > 0
                        ? 'border-orange-400 dark:border-orange-500 ring-2 ring-orange-500/10'
                        : 'border-border-light dark:border-border-dark'
                    }`}
                  />
                </div>
                <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark p-4 flex-1 flex flex-col justify-center">
                  <label className="block text-xs font-bold text-text-secondary-light dark:text-text-secondary-dark mb-1.5 uppercase tracking-wider">
                    문서 유형 일괄 선택
                  </label>
                  <div className="relative">
                    <select
                      value={defaultDocType}
                      onChange={event => {
                        const nextDocType = event.target.value
                        setDefaultDocType(nextDocType)
                        setQueue(prev =>
                          prev.map(file => ({ ...file, docType: nextDocType })),
                        )
                      }}
                      disabled={isSubmitting}
                      className="w-full appearance-none px-3 pr-10 py-2 text-sm border border-border-light dark:border-border-dark rounded-lg bg-background-light dark:bg-background-dark text-text-primary-light dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
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
              </div>

              {/* Stats & Actions Column (Combined) */}
              <div className="lg:col-span-2 flex flex-col gap-3">
                {/* Stats Row - Height matched to Session Name card */}
                <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark px-3 flex-1 flex flex-col justify-center">
                  <div className="flex items-center justify-around gap-2">
                    {[
                      { label: '대기', value: pendingCount, color: 'text-primary' },
                      { label: '완료', value: queue.filter(f => trackedJobs.find(tj => tj.jobId === f.jobId)?.status === 'completed').length, color: 'text-green-500' },
                      { label: '실패', value: queue.filter(f => f.status === 'failed').length, color: 'text-red-500' },
                      { label: '전체', value: queue.length, color: 'text-text-primary-light dark:text-text-primary-dark' }
                    ].map((item, idx) => (
                      <div key={idx} className="flex flex-col items-center px-4 border-r last:border-r-0 border-border-light/30 dark:border-border-dark/30">
                        <p className="text-[10px] font-bold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-widest mb-0.5">{item.label}</p>
                        <p className={`text-lg font-black ${item.color}`}>{item.value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Start Button - Wrapped in a container to match Doc Type card height */}
                <div className="flex-1 flex flex-col">
                  <button
                    onClick={() => void startProcessing()}
                    disabled={isSubmitting || pendingCount === 0 || !sessionName.trim()}
                    className="w-full h-full flex items-center justify-center gap-2 px-6 py-2.5 text-sm bg-primary hover:bg-primary/90 text-white rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition-all font-bold shadow-md shadow-primary/20 active:scale-[0.98]"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        작업 등록 중...
                      </>
                    ) : (
                      <>
                        <Zap className="w-4 h-4 fill-current" />
                        문서 작업 시작하기
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex-1 bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark min-h-[520px] flex flex-col overflow-hidden">
              {queue.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full py-20 text-text-secondary-light dark:text-text-secondary-dark">
                  <FileText className="w-12 h-12 mb-3 opacity-20" />
                  <p className="text-sm">선택한 파일 목록이 여기에 표시됩니다</p>
                </div>
              ) : (
                <div className="flex flex-col h-full overflow-hidden">
                  {/* Queue Header with Bulk Controls */}
                  <div className="flex items-center justify-between px-5 py-4 border-b border-border-light dark:border-border-dark bg-gray-50/50 dark:bg-gray-800/30">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-primary/10">
                        <FileText className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-text-primary-light dark:text-text-primary-dark">업로드 대기열</h3>
                        <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">총 {queue.length}개의 파일이 준비되었습니다</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => {
                        const allNames = groupedQueueArray.map(([n]) => n)
                        const allExpanded = allNames.every(n => expandedSessions[n])
                        const next: Record<string, boolean> = {}
                        allNames.forEach(n => next[n] = !allExpanded)
                        setExpandedSessions(next)
                      }}
                      className="px-3 py-1.5 text-xs font-semibold text-primary bg-primary/5 hover:bg-primary/10 rounded-lg transition-colors flex items-center gap-1.5"
                    >
                      <span className="material-symbols-outlined !text-sm">
                        {Object.values(expandedSessions).some(v => v) ? 'unfold_less' : 'unfold_more'}
                      </span>
                      {Object.values(expandedSessions).some(v => v) ? '모두 접기' : '모두 펼치기'}
                    </button>
                  </div>

                  {/* Grouped Session List */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {paginatedGroups.map(([sName, files]) => {
                      const isExpanded = expandedSessions[sName] ?? true
                      const pendingInSession = files.filter(f => f.status === 'pending').length
                      const doneInSession = files.filter(f => trackedJobs.find(tj => tj.jobId === f.jobId)?.status === 'completed').length
                      const failedInSession = files.filter(f => f.status === 'failed').length
                      
                      const visibleLimit = visibleCounts[sName] || 20
                      const visibleFiles = files.slice(0, visibleLimit)
                      const hasMore = files.length > visibleLimit

                      return (
                        <div key={sName} className="flex flex-col rounded-2xl border border-border-light dark:border-border-dark bg-white dark:bg-gray-900 overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                          {/* Session Header (Accordion Toggle) */}
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between px-5 py-4 bg-gray-50/30 dark:bg-gray-800/20 border-b border-border-light dark:border-border-dark">
                            <button 
                              onClick={() => setExpandedSessions(prev => ({ ...prev, [sName]: !isExpanded }))}
                              className="flex items-center gap-3 min-w-0 flex-1 text-left group"
                            >
                              <span className={`material-symbols-outlined !text-xl transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''} text-text-secondary-light dark:text-text-secondary-dark`}>
                                expand_more
                              </span>
                              <div className="flex items-center gap-2 min-w-0">
                                <FolderOpen className="w-4 h-4 text-primary shrink-0" />
                                <span className="text-sm font-bold text-text-primary-light dark:text-text-primary-dark truncate">{sName}</span>
                              </div>
                              <div className="flex items-center gap-1.5 ml-2 shrink-0">
                                <span className="px-2 py-0.5 rounded-md bg-gray-200 dark:bg-gray-700 text-[10px] font-bold text-gray-600 dark:text-gray-400">{files.length}</span>
                                {pendingInSession > 0 && <span className="px-2 py-0.5 rounded-md bg-orange-100 dark:bg-orange-900/30 text-[10px] font-bold text-orange-600 dark:text-orange-400">대기 {pendingInSession}</span>}
                                {doneInSession > 0 && <span className="px-2 py-0.5 rounded-md bg-green-100 dark:bg-green-900/30 text-[10px] font-bold text-green-600 dark:text-green-400">완료 {doneInSession}</span>}
                                {failedInSession > 0 && <span className="px-2 py-0.5 rounded-md bg-red-100 dark:bg-red-900/30 text-[10px] font-bold text-red-600 dark:text-red-400">실패 {failedInSession}</span>}
                              </div>
                            </button>

                            <div className="flex items-center gap-3 mt-3 sm:mt-0 ml-8 sm:ml-0">
                              <div className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-border-light dark:border-border-dark px-2 py-1 rounded-lg h-7">
                                <span className="text-[11px] font-bold text-text-secondary-light leading-none">일괄 유형</span>
                                <div className="relative flex items-center">
                                  <select
                                    onChange={e => updateSessionDocType(sName, e.target.value)}
                                    disabled={isSubmitting || pendingInSession === 0}
                                    className="appearance-none bg-transparent pl-1 pr-5 text-[11px] font-bold text-text-primary-light dark:text-text-primary-dark focus:outline-none disabled:opacity-50 h-full leading-none"
                                    defaultValue=""
                                  >
                                    <option value="" disabled>선택...</option>
                                    {allDocTypes.map(type => (
                                      <option key={type} value={type}>{type}</option>
                                    ))}
                                  </select>
                                  <span className="material-symbols-outlined pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 !text-xs text-text-secondary-light">
                                    expand_more
                                  </span>
                                </div>
                              </div>
                              <button
                                onClick={() => removeSession(sName)}
                                disabled={isSubmitting}
                                className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-text-secondary-light hover:text-red-500 transition-all disabled:opacity-30"
                                title="세션 전체 삭제"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                          
                          {/* File List for Session */}
                          {isExpanded && (
                            <div className="bg-white dark:bg-gray-900">
                              <ul className="divide-y divide-border-light dark:divide-border-dark max-h-[400px] overflow-y-auto scrollbar-thin">
                                {visibleFiles.map(file => {
                                  const tracked = trackedJobs.find(tj => tj.jobId === file.jobId)
                                  const effectiveStatus = tracked ? tracked.status : file.status
                                  const errorMessage = tracked?.message || file.error
                                  
                                  return (
                                    <li key={file.id} className="group/item px-5 py-3 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors">
                                      <div className="flex items-center gap-4">
                                        <div className="flex-shrink-0 size-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                                          {effectiveStatus === 'pending' && <Clock className="w-4 h-4 text-gray-400" />}
                                          {effectiveStatus === 'uploading' && <Loader2 className="w-4 h-4 text-primary animate-spin" />}
                                          {effectiveStatus === 'processing' && <Loader2 className="w-4 h-4 text-orange-500 animate-spin" />}
                                          {effectiveStatus === 'queued' && <Clock className="w-4 h-4 text-blue-600 animate-pulse" />}
                                          {effectiveStatus === 'completed' && <CheckCircle className="w-4 h-4 text-green-500" />}
                                          {effectiveStatus === 'failed' && <AlertCircle className="w-4 h-4 text-red-500" />}
                                        </div>

                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center justify-between gap-3">
                                            <div className="min-w-0 flex-1">
                                              {effectiveStatus === 'completed' ? (
                                                <Link href="/jobs" className="text-sm font-semibold text-primary hover:underline underline-offset-2 truncate block">
                                                  {file.displayName}
                                                </Link>
                                              ) : (
                                                <p className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark truncate">
                                                  {file.displayName}
                                                </p>
                                              )}
                                            </div>

                                            <div className="flex items-center gap-3 flex-shrink-0">
                                              <div className="flex items-center gap-2 bg-gray-100/50 dark:bg-gray-800/50 px-2 py-1 rounded-md h-6">
                                                <span className="text-[11px] font-bold text-text-secondary-light dark:text-text-secondary-dark leading-none">유형</span>
                                                <div className="relative flex items-center">
                                                  <select
                                                    value={file.docType}
                                                    disabled={isSubmitting || file.status !== 'pending'}
                                                    onChange={event => updateFile(file.id, { docType: event.target.value })}
                                                    className="appearance-none bg-transparent pl-1 pr-5 text-[11px] font-bold text-text-primary-light dark:text-text-primary-dark focus:outline-none disabled:opacity-50 h-full leading-none"
                                                  >
                                                    {allDocTypes.map(type => (
                                                      <option key={type} value={type}>{type}</option>
                                                    ))}
                                                  </select>
                                                  <span className="material-symbols-outlined pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 !text-xs text-text-secondary-light dark:text-text-secondary-dark">
                                                    expand_more
                                                  </span>
                                                </div>
                                              </div>

                                              {(file.status === 'pending' || effectiveStatus === 'failed' || effectiveStatus === 'completed') && !isSubmitting && (
                                                <button
                                                  onClick={() => removeFile(file.id)}
                                                  className="p-1 rounded-md hover:bg-red-50 dark:hover:bg-red-500/10 text-text-secondary-light hover:text-red-500 transition-all opacity-0 group-hover/item:opacity-100"
                                                  title="삭제"
                                                >
                                                  <X className="w-3.5 h-3.5" />
                                                </button>
                                              )}
                                              
                                              {(effectiveStatus === 'queued' || effectiveStatus === 'processing') && (
                                                <button
                                                  onClick={async () => {
                                                    if (file.jobId && confirm('이 작업을 중지하시겠습니까?')) {
                                                      await fetch(`${API_BASE}/cancel/${file.jobId}`, { method: 'POST' })
                                                      updateFile(file.id, { status: 'failed', error: '사용자가 중지했습니다.' })
                                                    }
                                                  }}
                                                  className="p-1 rounded-md hover:bg-red-50 dark:hover:bg-red-500/10 text-red-500 transition-all opacity-0 group-hover/item:opacity-100"
                                                  title="중지"
                                                >
                                                  <StopCircle className="w-3.5 h-3.5" />
                                                </button>
                                              )}
                                            </div>
                                          </div>

                                          <div className="flex items-center gap-3 mt-1">
                                            <p className="text-[11px] text-text-secondary-light dark:text-text-secondary-dark font-medium">
                                              {formatBytes(file.fileSize)} · {file.sourceType === 'folder' ? '폴더' : '파일'}
                                            </p>
                                            <div className="h-2 w-px bg-border-light dark:bg-border-dark" />
                                            <div className="flex-1">
                                              {effectiveStatus === 'pending' && <span className="text-[11px] font-medium text-gray-400 italic">작업 시작 대기 중</span>}
                                              {(effectiveStatus === 'uploading' || effectiveStatus === 'queued' || effectiveStatus === 'processing' || effectiveStatus === 'completed') && (
                                                <PipelineProgress
                                                  status={effectiveStatus}
                                                  progress={tracked?.progressPercent || 0}
                                                  subStage={tracked?.subStage}
                                                />
                                              )}
                                              {effectiveStatus === 'failed' && (
                                                <div className="flex flex-col gap-1">
                                                  <PipelineProgress
                                                    status="failed"
                                                    progress={tracked?.progressPercent || 0}
                                                    subStage={tracked?.subStage}
                                                    failedStage={!tracked ? (file.failedStage ?? 0) : undefined}
                                                  />
                                                  {errorMessage && (
                                                    <div className="flex items-center gap-1 mt-0.5">
                                                      <span className="material-symbols-outlined !text-xs text-red-500">error_outline</span>
                                                      <span className="text-[10px] text-red-500 font-bold truncate">{errorMessage}</span>
                                                    </div>
                                                  )}
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </li>
                                  )
                                })}
                              </ul>
                              {hasMore && (
                                <button 
                                  onClick={() => setVisibleCounts(prev => ({ ...prev, [sName]: (prev[sName] || 20) + 50 }))}
                                  className="w-full py-3 text-xs font-bold text-primary hover:bg-primary/5 border-t border-border-light transition-colors"
                                >
                                  파일 {files.length - visibleLimit}개 더 보기...
                                </button>
                              )}
                              <div className="px-5 py-2 text-center bg-gray-50/50 dark:bg-gray-800/30 border-t border-border-light dark:border-border-dark">
                                <p className="text-[10px] text-text-secondary-light font-bold italic">
                                  {files.length > visibleLimit ? `현재 ${visibleLimit}개 표시 중 / ` : ''}
                                  총 {files.length}개의 파일
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* Session Pagination Controls */}
                  {totalSessionPages > 0 && (
                    <div className="px-5 py-4 border-t border-border-light dark:border-border-dark bg-gray-50/50 dark:bg-gray-800/30 flex items-center justify-center gap-4">
                      <button
                        onClick={() => setSessionPage(prev => Math.max(1, prev - 1))}
                        disabled={sessionPage === 1}
                        className="p-2 rounded-lg hover:bg-white dark:hover:bg-gray-800 border border-border-light dark:border-border-dark disabled:opacity-30 transition-all"
                      >
                        <span className="material-symbols-outlined !text-sm">chevron_left</span>
                      </button>
                      
                      <div className="flex items-center gap-1.5">
                        {Array.from({ length: totalSessionPages }, (_, i) => i + 1).map(page => (
                          <button
                            key={page}
                            onClick={() => setSessionPage(page)}
                            className={`size-8 rounded-lg text-xs font-bold transition-all ${
                              sessionPage === page
                                ? 'bg-primary text-white shadow-lg shadow-primary/20'
                                : 'hover:bg-white dark:hover:bg-gray-800 text-text-secondary-light'
                            }`}
                          >
                            {page}
                          </button>
                        ))}
                      </div>

                      <button
                        onClick={() => setSessionPage(prev => Math.min(totalSessionPages, prev + 1))}
                        disabled={sessionPage === totalSessionPages}
                        className="p-2 rounded-lg hover:bg-white dark:hover:bg-gray-800 border border-border-light dark:border-border-dark disabled:opacity-30 transition-all"
                      >
                        <span className="material-symbols-outlined !text-sm">chevron_right</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
