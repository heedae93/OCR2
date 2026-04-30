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
const UNNAMED_SESSION_LABEL = '__UNNAMED_SESSION__'

/** Windows에서 HWP MIME이 비어 있거나 표준과 달라도 드롭·선택이 되도록 확장자로만 판별 */
const OCR_WORK_FILE_RE = /\.(pdf|png|jpe?g|hwp|hwpx)$/i

type FileStatus = 'pending' | 'uploading' | 'queued' | 'processing' | 'completed' | 'failed'
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
  trackedOnly?: boolean
  createdAt: number
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

import PipelineProgress from '@/components/PipelineProgress'


export default function OcrWorkPage() {
  const { addTrackedJobs, trackedJobs, removeTrackedJobs, clearAllTrackedJobs } = useOcrActivity()
  const [sessionName, setSessionName] = useState('')
  const [defaultDocType, setDefaultDocType] = useState('미분류')
  const [categories, setCategories] = useState<{ id: number; name: string }[]>([])
  const [queue, setQueue] = useState<QueueFile[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitMessage, setSubmitMessage] = useState('')
  const [queueWarning, setQueueWarning] = useState('')
  const [openBulkTypeMenu, setOpenBulkTypeMenu] = useState<string | null>(null)
  const [expandedSessions, setExpandedSessions] = useState<Record<string, boolean>>({})
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({})
  const [sessionPage, setSessionPage] = useState(1)
  const SESSIONS_PER_PAGE = 6

  const jobIdsKey = useMemo(() => {
    const ids = queue.map(q => q.jobId).filter((id): id is string => Boolean(id))
    const uniq = Array.from(new Set(ids))
    uniq.sort()
    return uniq.join(',')
  }, [queue])

  // 백엔드(작업내역)와 UI 상태 불일치 방지를 위해, 표시 중인 jobId들을 직접 동기화한다.
  useEffect(() => {
    if (!jobIdsKey) return

    let cancelled = false

    const syncStatuses = async () => {
      const ids = jobIdsKey.split(',').filter(Boolean)
      if (ids.length === 0) return

      const results = await Promise.allSettled(
        ids.map(async jobId => {
          const res = await fetch(`${API_BASE}/status/${jobId}`)
          if (!res.ok) throw new Error(`status ${res.status}`)
          return { jobId, data: await res.json() }
        }),
      )

      if (cancelled) return

      const byJobId = new Map<string, any>()
      for (const r of results) {
        if (r.status === 'fulfilled') byJobId.set(r.value.jobId, r.value.data)
      }

      setQueue(prev =>
        prev.map(item => {
          if (!item.jobId) return item
          const data = byJobId.get(item.jobId)
          if (!data) return item

          const rawStatus = String(data?.status || item.status)
          const mappedStatus: FileStatus =
            rawStatus === 'failed'
              ? 'failed'
              : rawStatus === 'completed'
                ? 'completed'
                : rawStatus === 'processing'
                  ? 'processing'
                  : rawStatus === 'uploaded'
                    ? 'queued'
                    : rawStatus === 'pending'
                      ? 'pending'
                      : 'queued'

          const progress = Number(data?.progress_percent ?? item.progress ?? 0)
          return {
            ...item,
            status: mappedStatus,
            progress: mappedStatus === 'completed' ? 100 : Math.round(progress),
            error: mappedStatus === 'failed' ? (data?.message || item.error) : item.error,
          }
        }),
      )
    }

    void syncStatuses()
    const timer = window.setInterval(() => {
      void syncStatuses()
    }, 3000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [jobIdsKey])

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

    // Queue contains File objects and cannot be safely restored after refresh.
    // Clear stale queue cache to prevent "파일 객체가 없습니다" errors.
    localStorage.removeItem(`ocr_work_queue_${userId}`)
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

  useEffect(() => {
    if (sessionName.trim() || queue.length === 0) {
      setQueueWarning('')
    }
  }, [sessionName, queue.length])

  useEffect(() => {
    setQueue(prev => {
      const existingJobIds = new Set(
        prev
          .map(item => item.jobId)
          .filter((jobId): jobId is string => Boolean(jobId)),
      )

      // 이미 queue에 있는 tracked item은 덮어쓰지 말고(동기화된 file.status를 유지)
      // 백엔드 동기화가 status를 올바르게 세팅한 뒤 UI가 보여주도록 한다.
      const trackedAddedItems = trackedJobs
        .filter(job => ['pending', 'uploaded', 'queued', 'processing', 'completed', 'failed'].includes(job.status))
        .filter(job => !existingJobIds.has(job.jobId))
        .map<QueueFile>(job => ({
          id: `tracked-${job.jobId}`,
          displayName: job.filename,
          docType: defaultDocType,
          createdAt: Date.parse(job.createdAt || '') || Date.now(),
          status:
            job.status === 'failed'
              ? 'failed'
              : job.status === 'completed'
                ? 'completed'
                : job.status === 'processing'
                  ? 'processing'
                  : job.status === 'uploaded'
                    ? 'queued'
                    : job.status === 'pending'
                      ? 'pending'
                      : 'queued',
          progress: job.progressPercent ?? 0,
          fileSize: 0,
          jobId: job.jobId,
          sourceType: job.sourceType,
          sessionName: job.sessionName || UNNAMED_SESSION_LABEL,
          trackedOnly: true,
          error: job.message,
        }))

      return [...prev, ...trackedAddedItems]
    })
  }, [trackedJobs, defaultDocType])

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target?.closest('[data-bulk-type-menu]')) {
        setOpenBulkTypeMenu(null)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [])

  useEffect(() => {
    const savedUser = localStorage.getItem('user')
    const user = savedUser ? JSON.parse(savedUser) : {}
    const userId = user?.user_id || 'default'

    if (sessionName) {
      localStorage.setItem(`ocr_work_session_name_${userId}`, sessionName)
    } else {
      localStorage.removeItem(`ocr_work_session_name_${userId}`)
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
        .filter(file => OCR_WORK_FILE_RE.test(file.name))
        .map(file => ({
          id: `${Date.now()}-${Math.random()}`,
          file,
          displayName: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
          docType: defaultDocType,
          status: 'pending' as const,
          progress: 0,
          fileSize: file.size,
          sourceType,
          sessionName: sessionName.trim() || UNNAMED_SESSION_LABEL,
          createdAt: Date.now(),
        })),
    [defaultDocType, sessionName],
  )

  const addFiles = useCallback(
    (files: File[], sourceType: SourceType) => {
      if (isSubmitting) return
      if (!sessionName.trim()) {
        setQueueWarning('작업 이름을 입력해 주세요.')
      } else {
        setQueueWarning('')
      }
      const items = createQueueItems(files, sourceType)
      if (items.length === 0) return
      setSubmitMessage('')
      setQueue(prev => [...prev, ...items])
      
      // 파일 추가 시 해당 작업은 자동으로 펼침
      if (items.length > 0) {
        const sName = items[0].sessionName
        setExpandedSessions(prev => ({ ...prev, [sName]: true }))
      }
    },
    [createQueueItems, isSubmitting, sessionName],
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: acceptedFiles => addFiles(acceptedFiles, 'file'),
    noClick: true,
    /* MIME 기반 accept는 Windows 한글(.hwp)에서 type 이 "" 이거나 비표준이면 전부 거절됨 → 확장자만 검사 */
    validator: file =>
      OCR_WORK_FILE_RE.test(file.name)
        ? null
        : {
            code: 'file-invalid-type',
            message: 'PDF, PNG, JPG, HWP, HWPX만 추가할 수 있습니다.',
          },
  })

  const removeFile = useCallback((id: string) => {
    setQueue(prev => prev.filter(file => file.id !== id))
  }, [])

  const clearAll = useCallback(() => {
    if (isSubmitting) return
    setQueue([])
    setSubmitMessage('')
    setQueueWarning('')
    setSessionName('')
    setExpandedSessions({})
    setVisibleCounts({})
    clearAllTrackedJobs()
  }, [isSubmitting, clearAllTrackedJobs])

  const updateSessionDocType = useCallback((sName: string, docType: string) => {
    setQueue(prev => prev.map(file => {
      const fileSession =
        file.status === 'pending' && !file.jobId && !file.trackedOnly
          ? (sessionName.trim() || UNNAMED_SESSION_LABEL)
          : (file.sessionName || UNNAMED_SESSION_LABEL)
      return fileSession === sName ? { ...file, docType } : file
    }))
  }, [sessionName])

  const removeSession = useCallback((sName: string) => {
    if (isSubmitting) return
    const currentSessionLabel = sessionName.trim() || UNNAMED_SESSION_LABEL

    // 삭제한 작업이 현재 입력값이라면 작업명 입력도 같이 비우고 localStorage도 제거
    if (sName === currentSessionLabel) {
      try {
        const savedUser = localStorage.getItem('user')
        const user = savedUser ? JSON.parse(savedUser) : {}
        const userId = user?.user_id || 'default'
        localStorage.removeItem(`ocr_work_session_name_${userId}`)
      } catch {
        // ignore
      }
      setSessionName('')
    }

    const jobIdsToRemove = queue
      .filter(file => {
        const fileSession =
          file.status === 'pending' && !file.jobId && !file.trackedOnly
            ? (sessionName.trim() || UNNAMED_SESSION_LABEL)
            : (file.sessionName || UNNAMED_SESSION_LABEL)
        return fileSession === sName && Boolean(file.jobId)
      })
      .map(file => file.jobId as string)

    // trackedJobs(localStorage)에 남아있으면 새로고침 후 다시 복원됩니다.
    removeTrackedJobs(jobIdsToRemove)
    setQueue(prev => {
      const next = prev.filter(file => {
        const fileSession =
          file.status === 'pending' && !file.jobId && !file.trackedOnly
            ? (sessionName.trim() || UNNAMED_SESSION_LABEL)
            : (file.sessionName || UNNAMED_SESSION_LABEL)
        return fileSession !== sName
      })
      return next
    })
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
  }, [isSubmitting, sessionName, queue, removeTrackedJobs])

  const handleFileSelect = useCallback(
    (event: ChangeEvent<HTMLInputElement>, sourceType: SourceType) => {
      addFiles(Array.from(event.target.files || []), sourceType)
      event.target.value = ''
    },
    [addFiles],
  )

  const startProcessing = useCallback(async () => {
    const pendingFiles = queue.filter(file => file.status === 'pending' && !file.trackedOnly && Boolean(file.file))
    if (pendingFiles.length === 0) {
      alert('업로드할 파일이 없습니다.')
      return
    }

    // 사용자가 눌렀다는 즉시 피드백(버튼 로딩/비활성화)이 보이도록
    setIsSubmitting(true)
    setSubmitMessage('')
    setQueueWarning('')

    // Redis 상태 확인
    try {
      const redisRes = await fetch(`${API_BASE}/redis/health`)
      if (redisRes.ok) {
        const redisData = await redisRes.json()
        if (!redisData.available) {
          alert('Redis 서버에 연결할 수 없습니다.\n작업 큐에 등록할 수 없으므로 작업을 시작할 수 없습니다.\n관리자에게 문의해 주세요.')
          setIsSubmitting(false)
          return
        }
      }
    } catch {
      // 백엔드 자체가 다운된 경우 — 이후 단계에서 실패 처리됨
    }

    // 워커 상태 확인 (Windows + solo pool 환경에서는 ping 실패가 자주 발생할 수 있음)
    try {
      const workerRes = await fetch(`${API_BASE}/worker/health`)
      if (workerRes.ok) {
        const workerData = await workerRes.json()
        if (!workerData.available) {
          setQueueWarning('워커 상태 확인이 불안정합니다. 작업은 계속 시도합니다.')
        }
      }
    } catch {
      // 백엔드/워커 헬스 조회 실패 시에도 등록은 시도
      setQueueWarning('워커 상태를 확인하지 못했습니다. 작업 등록을 계속 시도합니다.')
    }

    const user = JSON.parse(localStorage.getItem('user') || '{}')
    const userId = user.user_id || 'default'

    const queuedJobs: Array<{
      jobId: string
      filename: string
      sessionName: string
      sourceType: SourceType
      userId?: string
    }> = []

    // 제출 시점의 sessionName state를 우선 사용 (파일 추가 후 작업명 변경 시에도 반영)
    const currentSession = sessionName.trim() || UNNAMED_SESSION_LABEL
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

        if (!sessionResponse.ok) {
          const errorPayload = await sessionResponse.json().catch(() => ({}))
          throw new Error(errorPayload?.detail || `작업 생성 실패 (${sessionResponse.status})`)
        }
        sessionId = (await sessionResponse.json()).session_id
      } catch (error) {
        const message = sName === UNNAMED_SESSION_LABEL ? '(작업명 미입력)' : sName
        const detail = error instanceof Error ? error.message : '알 수 없는 오류'
        alert(`작업 '${message}' 생성에 실패했습니다.\n${detail}`)
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
            throw new Error('작업 문서 등록 실패')
          }

          const processResponse = await fetch(`${API_BASE}/process/${jobId}`, { method: 'POST' })
          if (!processResponse.ok) {
            throw new Error('Redis 큐 서버가 비정상입니다. 작업을 등록할 수 없습니다.')
          }

          updateFile(queueFile.id, {
            status: 'queued',
            progress: 100,
            jobId: jobId!,
            // 실제로 생성한 작업명(sName)을 queue item에도 반영
            sessionName: sName,
          })
          queuedJobs.push({
            jobId: jobId!,
            filename: queueFile.displayName,
            sessionName: sName,
            sourceType: queueFile.sourceType,
            userId,
          })
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : '알 수 없는 오류'
          updateFile(queueFile.id, {
            status: 'failed',
            error: errMsg,
            failedStage: 0,
            // 실패해도 사용자 입력 작업명을 유지
            sessionName: sName,
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

    setDefaultDocType('미분류')

    setIsSubmitting(false)
    setSubmitMessage('작업내역에서 확인')
  }, [addTrackedJobs, queue, updateFile, sessionName, defaultDocType])

  // 표시용 카운트(작업 카드와 동일하게 file.status 기준)
  const pendingCount = useMemo(
    () => queue.filter(file => file.status === 'pending').length,
    [queue],
  )

  // "문서 작업 시작하기" 버튼 활성화용(업로드 전 대기 + 실제 file 객체가 있는 것만)
  const pendingUploadCount = useMemo(
    () => queue.filter(file => file.status === 'pending' && !file.jobId && !file.trackedOnly).length,
    [queue],
  )

  const workingCount = useMemo(
    () => queue.filter(file => file.status === 'uploading' || file.status === 'queued' || file.status === 'processing').length,
    [queue],
  )

  const completedCount = useMemo(
    () => queue.filter(file => file.status === 'completed').length,
    [queue],
  )

  const failedCount = useMemo(
    () => queue.filter(file => file.status === 'failed').length,
    [queue],
  )

  const allDocTypes = useMemo(() => {
    const dbTypeNames = categories.map(c => c.name)
    return [
      ...DEFAULT_DOC_TYPES,
      ...dbTypeNames.filter(name => !DEFAULT_DOC_TYPES.includes(name))
    ]
  }, [categories])

  const resolveQueueSessionName = useCallback(
    (file: QueueFile) => {
      // 업로드 전(파일 객체 보유) 대기 항목만 현재 입력값을 따라가고,
      // 이미 등록된 작업(jobId/trackedOnly)은 원래 작업명을 유지한다.
      if (file.status === 'pending' && !file.jobId && !file.trackedOnly) {
        return sessionName.trim() || UNNAMED_SESSION_LABEL
      }
      return file.sessionName || UNNAMED_SESSION_LABEL
    },
    [sessionName],
  )

  const groupedQueueArray = useMemo(() => {
    const groups: Record<string, QueueFile[]> = {}
    queue.forEach(file => {
      const sName = resolveQueueSessionName(file)
      if (!groups[sName]) groups[sName] = []
      groups[sName].push(file)
    })
    const getSessionTimestamp = (files: QueueFile[]) => {
      const nonTracked = files.filter(f => !f.trackedOnly)
      const candidates = (nonTracked.length ? nonTracked : files)
        .map(f => f.createdAt)
        .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
      if (candidates.length === 0) return 0
      return Math.max(...candidates)
    }

    return Object.entries(groups)
      .sort((a, b) => getSessionTimestamp(b[1]) - getSessionTimestamp(a[1]))
  }, [queue, resolveQueueSessionName])

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

          <div className="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)] gap-6 items-start">
            <aside className="space-y-4 xl:sticky xl:top-6 xl:col-start-1">
              <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark p-4">
                <label className="block text-xs font-bold text-text-secondary-light dark:text-text-secondary-dark mb-2 uppercase tracking-wider">
                  작업 이름
                </label>
                <input
                  type="text"
                  value={sessionName}
                  onChange={event => setSessionName(event.target.value)}
                  placeholder="작업 이름을 입력하세요"
                  disabled={isSubmitting}
                  className={`w-full px-3 py-2 text-sm border rounded-lg bg-background-light dark:bg-background-dark text-text-primary-light dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all ${
                    !sessionName.trim() && pendingUploadCount > 0
                      ? 'border-orange-400 dark:border-orange-500 ring-2 ring-orange-500/10'
                      : 'border-border-light dark:border-border-dark'
                  }`}
                />
                <p className="mt-2 text-[11px] text-text-secondary-light dark:text-text-secondary-dark">
                  선택/업로드한 파일은 현재 작업명으로 작업 내역에 묶여 등록됩니다.
                </p>

              </div>

              <div
                {...getRootProps()}
                className={`group relative flex flex-col items-center justify-center gap-2 p-5 rounded-xl border-2 border-dashed transition-all cursor-pointer overflow-hidden ${
                  isDragActive
                    ? 'border-primary bg-primary/5 ring-4 ring-primary/10'
                    : 'border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark hover:border-primary/50 hover:bg-primary/5'
                }`}
              >
                <input {...getInputProps()} />
                <div className="relative z-10 flex flex-col items-center gap-2 w-full">
                  <div className="p-3 rounded-full bg-primary/10 text-primary group-hover:scale-110 transition-transform">
                    <CloudUpload className="w-6 h-6" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-text-primary-light dark:text-text-primary-dark">
                      {isDragActive ? '여기에 놓으세요' : '파일 추가'}
                    </p>
                    <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark mt-1">
                      PDF, PNG, JPG, 한글(HWP/HWPX) 지원
                    </p>
                  </div>
                  <div className="flex flex-col w-full gap-1.5 mt-2">
                    <label className="flex items-center justify-center gap-2 px-6 py-2.5 text-xs font-bold bg-primary text-white rounded-lg hover:bg-primary/90 cursor-pointer transition-all active:scale-[0.98] shadow-sm">
                      <Upload className="w-4 h-4" />
                      파일 선택
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept=".pdf,.png,.jpg,.jpeg,.hwp,.hwpx,.HWP,.HWPX,application/pdf,image/png,image/jpeg,application/vnd.hancom.hwp,application/vnd.hancom.hwpx,application/x-hwp"
                        className="hidden"
                        disabled={isSubmitting}
                        onChange={event => handleFileSelect(event, 'file')}
                      />
                    </label>
                    <label className="flex items-center justify-center gap-2 px-6 py-2.5 text-xs font-bold bg-primary/10 text-primary rounded-lg hover:bg-primary/20 cursor-pointer transition-all active:scale-[0.98]">
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
                <span className="material-symbols-outlined absolute -bottom-4 -right-4 text-8xl opacity-[0.03] dark:opacity-[0.05] pointer-events-none">
                  upload_file
                </span>
              </div>

              <button
                onClick={() => void startProcessing()}
                disabled={isSubmitting || pendingUploadCount === 0 || !sessionName.trim()}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 text-sm bg-primary hover:bg-primary/90 text-white rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition-all font-bold shadow-md shadow-primary/20 active:scale-[0.98]"
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

            </aside>

            <div className="xl:col-start-2 xl:row-span-2 min-h-[620px]">
              <section className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark flex-1 h-[620px] flex flex-col overflow-hidden">
                {/* Queue Header with Bulk Controls */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-border-light dark:border-border-dark bg-gray-50/50 dark:bg-gray-800/30">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <FileText className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex items-center gap-3">
                      <div>
                        <h3 className="text-sm font-bold text-text-primary-light dark:text-text-primary-dark">작업 목록</h3>
                        <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">총 {queue.length}개의 파일이 준비되었습니다</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={clearAll}
                      disabled={isSubmitting || queue.length === 0}
                      className="px-3 py-1.5 text-xs font-semibold text-red-500 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      전체 목록 비우기
                    </button>
                    <button 
                      onClick={() => {
                        const allNames = groupedQueueArray.map(([n]) => n)
                        const allExpanded = allNames.every(n => expandedSessions[n])
                        const next: Record<string, boolean> = {}
                        allNames.forEach(n => next[n] = !allExpanded)
                        setExpandedSessions(next)
                      }}
                      className="px-3 py-1.5 text-xs font-semibold text-primary bg-primary/5 hover:bg-primary/10 rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                      disabled={queue.length === 0}
                    >
                      <span className="material-symbols-outlined !text-sm">
                        {Object.values(expandedSessions).some(v => v) ? 'unfold_less' : 'unfold_more'}
                      </span>
                      {Object.values(expandedSessions).some(v => v) ? '모두 접기' : '모두 펼치기'}
                    </button>
                  </div>
                </div>
                <div className="px-4 py-3 border-b border-border-light dark:border-border-dark bg-background-light/40 dark:bg-background-dark/30">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {[
                      { label: '대기', value: pendingCount, color: 'text-primary' },
                      { label: '진행', value: workingCount, color: 'text-blue-500' },
                      { label: '완료', value: completedCount, color: 'text-green-500' },
                      { label: '실패', value: failedCount, color: 'text-red-500' },
                    ].map(item => (
                      <div key={item.label} className="rounded-lg border border-border-light dark:border-border-dark px-3 py-2 bg-white/80 dark:bg-gray-900/60">
                        <p className="text-[10px] font-semibold text-text-secondary-light dark:text-text-secondary-dark">{item.label}</p>
                        <p className={`text-base font-black ${item.color}`}>{item.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
                {queueWarning && (
                  <div className="px-5 py-2 border-b border-border-light dark:border-border-dark bg-amber-50 dark:bg-amber-900/20">
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                      {queueWarning}
                    </p>
                  </div>
                )}

                {queue.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full py-20 text-text-secondary-light dark:text-text-secondary-dark">
                    <FileText className="w-12 h-12 mb-3 opacity-20" />
                    <p className="text-sm">선택한 파일 목록이 여기에 표시됩니다</p>
                  </div>
                ) : (
                  <div className="flex flex-col h-full min-h-0 overflow-hidden">

                  {/* Grouped Session List */}
                  <div className="flex-1 min-h-0 overflow-y-auto [scrollbar-gutter:stable] p-4 space-y-4">
                    {paginatedGroups.map(([sName, files]) => {
                      const isExpanded = expandedSessions[sName] ?? true
                      const isUnnamedSession = sName === UNNAMED_SESSION_LABEL
                      // status는 백엔드 동기화(syncStatuses)의 결과인 file.status를 기준으로 표시
                      const pendingInSession = files.filter(f => f.status === 'pending').length
                      const workingInSession = files.filter(f => f.status === 'uploading' || f.status === 'queued' || f.status === 'processing').length
                      const doneInSession = files.filter(f => f.status === 'completed').length
                      const failedInSession = files.filter(f => f.status === 'failed').length
                      
                      const visibleLimit = visibleCounts[sName] || 20
                      const visibleFiles = files.slice(0, visibleLimit)
                      const hasMore = files.length > visibleLimit
                      const pendingDocTypes = Array.from(new Set(files.filter(f => f.status === 'pending').map(f => f.docType)))
                      const selectedBulkTypeLabel =
                        pendingInSession === 0 ? '변경 불가' : pendingDocTypes.length === 1 ? pendingDocTypes[0] : '선택...'

                      return (
                        <div
                          key={sName}
                          className={`flex flex-col rounded-2xl border border-border-light dark:border-border-dark bg-white dark:bg-gray-900 shadow-sm hover:shadow-md transition-shadow ${isExpanded ? 'overflow-hidden' : 'overflow-visible'}`}
                        >
                          {/* Session Header (Accordion Toggle) */}
                          <div className={`flex flex-col sm:flex-row sm:items-center justify-between px-5 py-4 bg-gray-50/30 dark:bg-gray-800/20 ${isExpanded ? 'border-b border-border-light dark:border-border-dark' : ''}`}>
                            <button 
                              onClick={() => setExpandedSessions(prev => ({ ...prev, [sName]: !isExpanded }))}
                              className="flex items-center gap-3 min-w-0 flex-1 text-left group"
                            >
                              <span className={`material-symbols-outlined !text-xl transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''} text-text-secondary-light dark:text-text-secondary-dark`}>
                                expand_more
                              </span>
                              <div className="flex items-center gap-2 min-w-0">
                                <FolderOpen className="w-4 h-4 text-primary shrink-0" />
                                <span className="text-sm font-bold text-text-primary-light dark:text-text-primary-dark truncate">
                                  {isUnnamedSession ? '' : sName}
                                </span>
                                {isUnnamedSession && (
                                  <div className="inline-flex items-center gap-2">
                                    <span
                                      aria-label="작업명 입력 필요"
                                      title="작업명 입력 필요"
                                      className="inline-block h-5 w-20 rounded-md border border-amber-300/80 bg-amber-200/70 dark:border-amber-700 dark:bg-amber-800/40 animate-pulse"
                                    >
                                      {' '}
                                    </span>
                                    <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300">
                                      작업명을 입력해 주세요
                                    </span>
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 ml-2 shrink-0">
                                {pendingInSession > 0 && <span className="px-2 py-0.5 rounded-md bg-orange-100 dark:bg-orange-900/30 text-[10px] font-bold text-orange-600 dark:text-orange-400">대기 {pendingInSession}건</span>}
                                {workingInSession > 0 && <span className="px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-900/30 text-[10px] font-bold text-blue-600 dark:text-blue-400">작업중 {workingInSession}건</span>}
                                {doneInSession > 0 && <span className="px-2 py-0.5 rounded-md bg-green-100 dark:bg-green-900/30 text-[10px] font-bold text-green-600 dark:text-green-400">완료 {doneInSession}건</span>}
                                {failedInSession > 0 && <span className="px-2 py-0.5 rounded-md bg-red-100 dark:bg-red-900/30 text-[10px] font-bold text-red-600 dark:text-red-400">실패 {failedInSession}건</span>}
                              </div>
                            </button>

                            <div className="flex items-center gap-3 mt-3 sm:mt-0 ml-8 sm:ml-0">
                              <div
                                data-bulk-type-menu
                                className="relative flex items-center gap-2 bg-background-light dark:bg-background-dark border border-border-light dark:border-border-dark px-2 py-1.5 rounded-lg min-h-8"
                              >
                                <span className="text-[11px] font-semibold text-text-secondary-light dark:text-text-secondary-dark leading-none whitespace-nowrap">
                                  문서 유형 일괄 선택
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setOpenBulkTypeMenu(prev => (prev === sName ? null : sName))}
                                  disabled={isSubmitting || pendingInSession === 0}
                                  className="inline-flex items-center gap-1.5 bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-md pl-2 pr-2.5 py-1 text-[11px] font-medium text-text-primary-light dark:text-text-primary-dark hover:border-primary/40 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  <span>{selectedBulkTypeLabel}</span>
                                  <span className="material-symbols-outlined !text-xs text-text-secondary-light dark:text-text-secondary-dark">
                                    {openBulkTypeMenu === sName ? 'expand_less' : 'expand_more'}
                                  </span>
                                </button>
                                {openBulkTypeMenu === sName && (
                                  <div className="absolute right-0 top-full z-20 mt-2 w-44 overflow-hidden rounded-lg border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark shadow-lg">
                                    <div className="max-h-56 overflow-y-auto py-1">
                                      {allDocTypes.map(type => (
                                        <button
                                          key={type}
                                          type="button"
                                          onClick={() => {
                                            updateSessionDocType(sName, type)
                                            setOpenBulkTypeMenu(null)
                                          }}
                                          className="w-full px-3 py-2 text-left text-xs text-text-primary-light dark:text-text-primary-dark hover:bg-primary/10"
                                        >
                                          {type}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                              <button
                                onClick={() => removeSession(sName)}
                                disabled={isSubmitting}
                                className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-text-secondary-light hover:text-red-500 transition-all disabled:opacity-30"
                                title="작업 전체 삭제"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                          
                          {/* File List for Session */}
                          {isExpanded && (
                            <div className="bg-white dark:bg-gray-900 p-2">
                              <ul className="divide-y divide-border-light dark:divide-border-dark max-h-[400px] overflow-y-auto [scrollbar-gutter:stable] scrollbar-thin">
                                {visibleFiles.map(file => {
                                  const tracked = trackedJobs.find(tj => tj.jobId === file.jobId)
                                  // UI 표시 상태는 backend sync 결과인 file.status를 우선 사용
                                  const effectiveStatus = file.status
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

                                        <div className="flex-1 min-w-0 flex items-center justify-between gap-3">
                                          <div className="min-w-0 flex-1">
                                            <div className="min-w-0">
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

                                            <div className="flex items-center gap-3 mt-1">
                                              <p className="text-[11px] text-text-secondary-light dark:text-text-secondary-dark font-medium">
                                                {file.trackedOnly ? '진행중 작업' : formatBytes(file.fileSize)} · {file.sourceType === 'folder' ? '폴더' : '파일'}
                                              </p>
                                              <div className="h-2 w-px bg-border-light dark:bg-border-dark" />
                                              <div className="flex-1">
                                                {effectiveStatus === 'pending' && <span className="text-[11px] font-medium text-gray-400 italic">작업 시작 대기 중</span>}
                                                {(effectiveStatus === 'uploading' || effectiveStatus === 'queued' || effectiveStatus === 'processing' || effectiveStatus === 'completed') && (
                                                  <PipelineProgress
                                                    status={effectiveStatus}
                                                    progress={file.progress || 0}
                                                    subStage={tracked?.subStage}
                                                  />
                                                )}
                                                {effectiveStatus === 'failed' && (
                                                  <div className="flex flex-col gap-1">
                                                    <PipelineProgress
                                                      status="failed"
                                                      progress={file.progress || 0}
                                                      subStage={tracked?.subStage}
                                                      failedStage={file.failedStage ?? undefined}
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

                                          <div className="flex items-center gap-3 flex-shrink-0 self-center">
                                              <div className="flex items-center gap-2 bg-background-light dark:bg-background-dark border border-border-light dark:border-border-dark px-2 py-1.5 rounded-lg min-h-8">
                                                <span className="text-[11px] font-semibold text-text-secondary-light dark:text-text-secondary-dark leading-none whitespace-nowrap">
                                                  문서 유형 선택
                                                </span>
                                                <div className="relative flex items-center">
                                                  <select
                                                    value={file.docType}
                                                    disabled={isSubmitting || file.status !== 'pending'}
                                                    onChange={event => updateFile(file.id, { docType: event.target.value })}
                                                    className="appearance-none bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-md pl-2 pr-6 py-1 text-[11px] font-medium text-text-primary-light dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50 leading-none"
                                                  >
                                                    {allDocTypes.map(type => (
                                                      <option key={type} value={type}>{type}</option>
                                                    ))}
                                                  </select>
                                                  <span className="material-symbols-outlined pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 !text-xs text-text-secondary-light dark:text-text-secondary-dark">
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
                    <div className="px-4 py-2 border-t border-border-light dark:border-border-dark bg-gray-50/50 dark:bg-gray-800/30 flex items-center justify-center gap-3">
                      <button
                        onClick={() => setSessionPage(prev => Math.max(1, prev - 1))}
                        disabled={sessionPage === 1}
                        className="p-1.5 rounded-lg hover:bg-white dark:hover:bg-gray-800 border border-border-light dark:border-border-dark disabled:opacity-30 transition-all"
                      >
                        <span className="material-symbols-outlined !text-sm">chevron_left</span>
                      </button>
                      
                      <div className="flex items-center gap-1.5">
                        {Array.from({ length: totalSessionPages }, (_, i) => i + 1).map(page => (
                          <button
                            key={page}
                            onClick={() => setSessionPage(page)}
                            className={`h-7 min-w-7 px-2 rounded-lg text-xs font-bold transition-all ${
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
                        className="p-1.5 rounded-lg hover:bg-white dark:hover:bg-gray-800 border border-border-light dark:border-border-dark disabled:opacity-30 transition-all"
                      >
                        <span className="material-symbols-outlined !text-sm">chevron_right</span>
                      </button>
                    </div>
                  )}
                  </div>
                )}
              </section>
            </div>

          </div>
        </div>
      </main>
    </div>
  )
}
