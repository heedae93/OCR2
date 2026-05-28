'use client'

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useDropzone } from 'react-dropzone'
import Link from 'next/link'
import Sidebar from '@/components/Sidebar'
import { useOcrActivity } from '@/contexts/OcrActivityContext'
import {
  AlertCircle,
  ChevronDown,
  Loader2,
  Trash2,
  X,
  FolderOpen,
  StopCircle,
  Zap,
  FileText,
} from 'lucide-react'

const API_BASE = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:6015'}/api`

const DEFAULT_DOC_TYPES = ['공문서', '계약서', '보고서', '학술논문', '법령문서', '회의록', '영수증', '신분증', '기타', '미분류']
const UNNAMED_SESSION_LABEL = '__UNNAMED_SESSION__'
const SESSION_KEY_SEP = '__#sid#__'

/** Windows에서 HWP MIME이 비어 있거나 표준과 달라도 드롭·선택이 되도록 확장자로만 판별 */
const OCR_WORK_FILE_RE =
  /\.(pdf|png|jpe?g|tiff?|webp|bmp|hwp|hwpx|txt|docx?|xlsx?|pptx?)$/i

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
  sessionKey?: string
  completedAt?: string
  failedStage?: number
  trackedOnly?: boolean
  /** Tika 텍스트 추적 안내 (OCR 오류와 별개) */
  tikaUserMessage?: string
  tikaTrackStatus?: string
  createdAt: number
}

function makeSessionKey(sessionName: string, sessionId: string): string {
  return `${sessionName}${SESSION_KEY_SEP}${sessionId}`
}

function getSessionIdFromKey(sessionKey: string): string | null {
  const idx = sessionKey.indexOf(SESSION_KEY_SEP)
  return idx >= 0 ? sessionKey.slice(idx + SESSION_KEY_SEP.length) || null : null
}

function displaySessionName(sessionKeyOrName: string): string {
  const idx = sessionKeyOrName.indexOf(SESSION_KEY_SEP)
  return idx >= 0 ? sessionKeyOrName.slice(0, idx) : sessionKeyOrName
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatCompletedAt(value?: string): string {
  if (!value) return ''

  const normalized = value.includes('T') ? value : value.replace(' ', 'T')
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return value

  return date.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getCompletedTimeValue(value?: string): number {
  if (!value) return 0
  const normalized = value.includes('T') ? value : value.replace(' ', 'T')
  const time = new Date(normalized).getTime()
  return Number.isNaN(time) ? 0 : time
}

function queueStatusLabel(status: FileStatus): string {
  switch (status) {
    case 'pending':
      return '대기'
    case 'uploading':
      return '대기열'
    case 'queued':
      return '대기열'
    case 'processing':
      return '처리중'
    case 'completed':
      return '완료'
    case 'failed':
      return '실패'
    default:
      return status
  }
}

import PipelineProgress from '@/components/PipelineProgress'


export default function OcrWorkPage() {
  const { isReady: isOcrActivityReady, addTrackedJobs, trackedJobs, removeTrackedJobs, clearAllTrackedJobs } = useOcrActivity()
  const [sessionName, setSessionName] = useState('')
  const [defaultDocType, setDefaultDocType] = useState('')
  const [categories, setCategories] = useState<{ id: number; name: string }[]>([])
  const [queue, setQueue] = useState<QueueFile[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitMessage, setSubmitMessage] = useState('')
  /** 문서 작업 시작하기 이후 일괄 문서 유형 변경 금지 */
  const [bulkDocTypeLocked, setBulkDocTypeLocked] = useState(false)
  const [draftSessionNonce, setDraftSessionNonce] = useState(() => `${Date.now()}-${Math.random()}`)
  const [expandedSessions, setExpandedSessions] = useState<Record<string, boolean>>({})
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({})
  const [restartingSessionKeys, setRestartingSessionKeys] = useState<Set<string>>(new Set())
  const [queueStatusTab, setQueueStatusTab] = useState<'active' | 'completed'>('active')
  const [sessionPage, setSessionPage] = useState(1)
  const SESSIONS_PER_PAGE = 8

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
              : rawStatus === 'cancelled'
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
          const completedAt = data?.completed_at ?? data?.completedAt
          return {
            ...item,
            status: mappedStatus,
            progress: mappedStatus === 'completed' ? 100 : Math.round(progress),
            completedAt:
              mappedStatus === 'completed'
                ? completedAt || item.completedAt || new Date().toISOString()
                : undefined,
            error:
              mappedStatus === 'failed'
                ? (data?.message || (rawStatus === 'cancelled' ? '사용자가 중지했습니다.' : item.error))
                : item.error,
            tikaUserMessage: (data?.tika_user_message as string | undefined) ?? item.tikaUserMessage,
            tikaTrackStatus: (data?.tika_track_status as string | undefined) ?? item.tikaTrackStatus,
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
    if (queue.length === 0) {
      setBulkDocTypeLocked(false)
    }
  }, [queue.length])

  const mapTrackedJobToQueueFile = useCallback((job: (typeof trackedJobs)[number]): QueueFile => ({
    id: `tracked-${job.jobId}`,
    displayName: job.filename,
    docType: defaultDocType,
    createdAt: Date.parse(job.createdAt || '') || Date.now(),
    status:
      job.status === 'failed'
        ? 'failed'
        : job.status === 'cancelled'
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
    sessionKey: job.sessionKey,
    completedAt: job.completedAt,
    trackedOnly: true,
    error: job.message,
    tikaUserMessage: job.tikaUserMessage,
    tikaTrackStatus: job.tikaTrackStatus,
  }), [defaultDocType])

  useEffect(() => {
    if (!isOcrActivityReady) return

    const trackedByJobId = new Map(trackedJobs.map(job => [job.jobId, job]))

    setQueue(prev => {
      const next = prev
        .filter(item => !item.trackedOnly || (item.jobId && trackedByJobId.has(item.jobId)))
        .map(item => {
          if (!item.trackedOnly || !item.jobId) return item
          const tracked = trackedByJobId.get(item.jobId)
          return tracked ? mapTrackedJobToQueueFile(tracked) : item
        })

      const existingJobIds = new Set(next.map(item => item.jobId).filter((jobId): jobId is string => Boolean(jobId)))
      const trackedAddedItems = trackedJobs
        .filter(job => !existingJobIds.has(job.jobId))
        .map(mapTrackedJobToQueueFile)

      return [...next, ...trackedAddedItems]
    })
  }, [isOcrActivityReady, mapTrackedJobToQueueFile, trackedJobs])

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

  // 작업명 변경 시 드래프트 파일들의 sessionKey를 최신 작업명으로 갱신
  useEffect(() => {
    setQueue(prev => prev.map(file => {
      if (file.status !== 'pending' || file.jobId || file.trackedOnly) return file
      const fileNonce = file.sessionKey?.slice(
        (file.sessionKey.indexOf(SESSION_KEY_SEP) ?? -1) + SESSION_KEY_SEP.length
      )
      if (fileNonce !== draftSessionNonce) return file
      const newLabel = sessionName.trim() || UNNAMED_SESSION_LABEL
      return {
        ...file,
        sessionName: newLabel,
        sessionKey: makeSessionKey(newLabel, draftSessionNonce),
      }
    }))
  }, [sessionName, draftSessionNonce])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const sessionNameInputRef = useRef<HTMLInputElement>(null)

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
          sessionKey: makeSessionKey(sessionName.trim() || UNNAMED_SESSION_LABEL, draftSessionNonce),
          createdAt: Date.now(),
        })),
    [defaultDocType, sessionName, draftSessionNonce],
  )

  const addFiles = useCallback(
    (files: File[], sourceType: SourceType) => {
      if (isSubmitting) return
      const items = createQueueItems(files, sourceType)
      if (items.length === 0) return
      setSubmitMessage('')
      setQueue(prev => [...prev, ...items])

      if (!sessionName.trim()) {
        // 목록 위 경고 대신 입력란 근처 안내 + 포커스(다음 틱에 큐 반영 후 스크롤)
        setTimeout(() => {
          sessionNameInputRef.current?.focus({ preventScroll: false })
          sessionNameInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        }, 0)
      }

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
            message: 'PDF, 이미지, TXT, HWP, Office(DOC/XLS/PPT)만 추가할 수 있습니다.',
          },
  })

  const removeFile = useCallback((id: string) => {
    setQueue(prev => prev.filter(file => file.id !== id))
  }, [])

  const clearAll = useCallback(() => {
    if (isSubmitting) return
    setQueue([])
    setSubmitMessage('')
    setSessionName('')
    setExpandedSessions({})
    setVisibleCounts({})
    setDefaultDocType('')
    setBulkDocTypeLocked(false)
    setDraftSessionNonce(`${Date.now()}-${Math.random()}`)
    clearAllTrackedJobs()
  }, [isSubmitting, clearAllTrackedJobs])

  const updateSessionDocType = useCallback((sName: string, docType: string) => {
    if (bulkDocTypeLocked) return
    setQueue(prev => prev.map(file => {
      // 제출 전 대기 파일은 현재 드래프트 파일이므로 전체 일괄 업데이트
      if (file.status === 'pending' && !file.jobId && !file.trackedOnly) {
        return { ...file, docType }
      }
      const fileSession = file.sessionKey || file.sessionName || UNNAMED_SESSION_LABEL
      return displaySessionName(fileSession) === sName ? { ...file, docType } : file
    }))
  }, [bulkDocTypeLocked])

  const removeSession = useCallback((sName: string) => {
    if (isSubmitting) return
    const currentSessionLabel = sessionName.trim() || UNNAMED_SESSION_LABEL

    // 삭제한 작업이 현재 입력값이라면 작업명 입력도 같이 비우고 localStorage도 제거
    if (displaySessionName(sName) === currentSessionLabel) {
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
            ? (file.sessionKey || (sessionName.trim() || UNNAMED_SESSION_LABEL))
            : (file.sessionKey || file.sessionName || UNNAMED_SESSION_LABEL)
        return fileSession === sName && Boolean(file.jobId)
      })
      .map(file => file.jobId as string)

    // trackedJobs(localStorage)에 남아있으면 새로고침 후 다시 복원됩니다.
    removeTrackedJobs(jobIdsToRemove)
    setQueue(prev => {
      const next = prev.filter(file => {
        const fileSession =
          file.status === 'pending' && !file.jobId && !file.trackedOnly
            ? (file.sessionKey || (sessionName.trim() || UNNAMED_SESSION_LABEL))
            : (file.sessionKey || file.sessionName || UNNAMED_SESSION_LABEL)
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

    // Redis 상태 확인
    try {
      const redisRes = await fetch(`${API_BASE}/redis/health`)
      if (redisRes.ok) {
        const redisData = await redisRes.json()
        if (!redisData.available) {
          alert('Redis 서버에 연결할 수 없습니다.\n작업 큐에 등록할 수 없으므로 작업을 시작할 수 없습니다.\n관리자에게 문의해 주세요.')
          setIsSubmitting(false)
          setBulkDocTypeLocked(false)
          return
        }
      }
    } catch {
      // 백엔드 자체가 다운된 경우 — 이후 단계에서 실패 처리됨
    }

    setBulkDocTypeLocked(true)

    const user = JSON.parse(localStorage.getItem('user') || '{}')
    const userId = user.user_id || 'default'

    const queuedJobs: Array<{
      jobId: string
      filename: string
      sessionName: string
      sessionKey?: string
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
        const resolvedSessionKey = makeSessionKey(sName, sessionId)

        // 같은 시작 배치의 파일들이 처리 중간에 카드가 분리되지 않도록
        // 세션 키를 먼저 일괄 통일한다.
        const targetFileIds = new Set(files.map(f => f.id))
        setQueue(prev =>
          prev.map(item =>
            targetFileIds.has(item.id)
              ? {
                  ...item,
                  sessionName: sName,
                  sessionKey: resolvedSessionKey,
                }
              : item,
          ),
        )
      } catch (error) {
        const message = sName === UNNAMED_SESSION_LABEL ? '(작업명 미입력)' : sName
        const detail = error instanceof Error ? error.message : '알 수 없는 오류'
        alert(`작업 '${message}' 생성에 실패했습니다.\n${detail}`)
        continue
      }

      const UPLOAD_CONCURRENCY = 4

      const processOne = async (queueFile: QueueFile) => {
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
            sessionKey: makeSessionKey(sName, sessionId),
          })

          return {
            ok: true as const,
            queuedJob: {
              jobId: jobId!,
              filename: queueFile.displayName,
              sessionName: sName,
              sessionKey: makeSessionKey(sName, sessionId),
              sourceType: queueFile.sourceType,
              userId,
            },
          }
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
                  error_message: errMsg,
                }),
              })
            } catch (e) {
              console.error('Failed to notify backend of job failure', e)
            }
          }
          return { ok: false as const }
        }
      }

      const pendingQueue = [...files]
      const results: Array<{ ok: true; queuedJob: (typeof queuedJobs)[number] } | { ok: false }> = []

      const workers = Array.from({ length: Math.min(UPLOAD_CONCURRENCY, pendingQueue.length) }, async () => {
        while (pendingQueue.length > 0) {
          const next = pendingQueue.shift()
          if (!next) return
          const r = await processOne(next)
          results.push(r)
        }
      })

      await Promise.all(workers)

      for (const r of results) {
        if (r.ok) queuedJobs.push(r.queuedJob)
      }
    }

    if (queuedJobs.length > 0) {
      addTrackedJobs(queuedJobs)
    }

    setDefaultDocType('')
    try {
      localStorage.removeItem(`ocr_work_session_name_${userId}`)
    } catch {
      // ignore
    }
    setSessionName('')
    setBulkDocTypeLocked(false)
    setDraftSessionNonce(`${Date.now()}-${Math.random()}`)

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

  const needsSessionName = !sessionName.trim() && pendingUploadCount > 0

  useEffect(() => {
    if (pendingUploadCount === 0) {
      setDefaultDocType('')
    }
  }, [pendingUploadCount])

  /** 현재 작업명으로 묶인 대기(업로드 전) 파일들의 문서 유형 — 왼쪽 일괄 셀렉트용 */
  const pendingDocTypesForSidebar = useMemo(() => {
    const pending = queue.filter(file => file.status === 'pending' && !file.jobId && !file.trackedOnly)
    return Array.from(new Set(pending.map(f => f.docType)))
  }, [queue])

  const bulkSidebarSelectValue =
    pendingUploadCount === 0
      ? ''
      : pendingDocTypesForSidebar.length === 1
        ? pendingDocTypesForSidebar[0]
        : ''

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
        return file.sessionKey || (sessionName.trim() || UNNAMED_SESSION_LABEL)
      }
      if (file.sessionKey) return file.sessionKey
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

    return Object.entries(groups)
  }, [queue, resolveQueueSessionName])

  const getSessionTimestamp = useCallback((files: QueueFile[]) => {
      const nonTracked = files.filter(f => !f.trackedOnly)
      const candidates = (nonTracked.length ? nonTracked : files)
        .map(f => f.createdAt)
        .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
      if (candidates.length === 0) return 0
      return Math.max(...candidates)
  }, [])

  const getActiveGroupPriority = useCallback((files: QueueFile[]) => {
    if (files.some(file => file.status === 'processing' || file.status === 'uploading')) return 0
    if (files.some(file => file.status === 'queued')) return 1
    if (files.some(file => file.status === 'failed')) return 2
    return 3
  }, [])

  const groupedQueueByStatus = useMemo(() => {
    const isCompletedGroup = ([, files]: [string, QueueFile[]]) =>
      files.length > 0 && files.every(file => file.status === 'completed')

    const sortActiveGroups = (groups: [string, QueueFile[]][]) =>
      [...groups].sort((a, b) => {
        const priorityDiff = getActiveGroupPriority(a[1]) - getActiveGroupPriority(b[1])
        if (priorityDiff !== 0) return priorityDiff
        return getSessionTimestamp(b[1]) - getSessionTimestamp(a[1])
      })

    return {
      active: sortActiveGroups(groupedQueueArray.filter(group => !isCompletedGroup(group))),
      completed: groupedQueueArray
        .filter(isCompletedGroup)
        .sort((a, b) => getSessionTimestamp(b[1]) - getSessionTimestamp(a[1])),
    }
  }, [getActiveGroupPriority, getSessionTimestamp, groupedQueueArray])

  const selectedQueueGroups = groupedQueueByStatus[queueStatusTab]

  const paginatedGroups = useMemo(() => {
    const start = (sessionPage - 1) * SESSIONS_PER_PAGE
    return selectedQueueGroups.slice(start, start + SESSIONS_PER_PAGE)
  }, [selectedQueueGroups, sessionPage])

  const totalSessionPages = Math.ceil(selectedQueueGroups.length / SESSIONS_PER_PAGE)

  const currentActiveSummary = useMemo(() => {
    const statusPriority: FileStatus[] = ['processing', 'uploading']

    for (const status of statusPriority) {
      for (const [sessionKey, files] of groupedQueueByStatus.active) {
        const file = files.find(item => item.status === status)
        if (!file) continue

        const tracked = file.jobId ? trackedJobs.find(job => job.jobId === file.jobId) : undefined
        return {
          sessionKey,
          sessionName: displaySessionName(sessionKey),
          file,
          status: file.status,
          progress: tracked?.progressPercent ?? file.progress ?? 0,
          subStage: tracked?.subStage,
          failedStage: file.failedStage,
        }
      }
    }

    return null
  }, [groupedQueueByStatus.active, trackedJobs])

  useEffect(() => {
    setSessionPage(1)
  }, [queueStatusTab])

  useEffect(() => {
    if (sessionPage > 1 && sessionPage > totalSessionPages) {
      setSessionPage(Math.max(1, totalSessionPages))
    }
  }, [totalSessionPages, sessionPage])

  return (
    <div className="bg-slate-50 dark:bg-slate-50 min-h-screen">
      <Sidebar />
      <main className="flex-1 ml-64 flex flex-col p-6 lg:p-10 min-w-0">
        <div className="w-full max-w-7xl mx-auto flex flex-col gap-6">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0 pr-4">
              <h1 className="text-text-primary-light dark:text-text-primary-dark text-3xl font-bold leading-tight tracking-tight">
                문서 작업하기
              </h1>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[360px_minmax(0,1fr)] xl:items-stretch">
            <aside className="flex min-h-0 flex-col gap-3 xl:col-start-1 xl:h-[calc(100vh-9rem)] xl:sticky xl:top-6">
              <div className="flex min-h-[620px] flex-1 flex-col gap-3 rounded-xl border border-border-light bg-surface-light p-4 dark:border-border-dark dark:bg-surface-dark xl:h-full xl:min-h-0 xl:p-3.5 [@media(max-height:760px)]:gap-2 [@media(max-height:760px)]:p-2.5">

                {/* 작업명 */}
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/20 [@media(max-height:760px)]:p-3">
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-text-secondary-light dark:text-text-secondary-dark [@media(max-height:760px)]:mb-1">
                    작업명
                  </label>
                  <input
                    ref={sessionNameInputRef}
                    autoFocus
                    type="text"
                    value={sessionName}
                    onChange={event => setSessionName(event.target.value)}
                    placeholder="작업명을 입력하세요"
                    disabled={isSubmitting}
                    aria-invalid={needsSessionName}
                    aria-describedby={needsSessionName ? 'ocr-work-session-name-hint' : undefined}
                    className={`h-10 w-full rounded-lg border bg-white px-3 text-sm text-text-primary-light transition-all focus:outline-none focus:ring-2 focus:ring-primary/50 dark:bg-background-dark dark:text-text-primary-dark [@media(max-height:760px)]:h-9 ${
                      needsSessionName
                        ? 'border-amber-500/90 ring-2 ring-amber-500/20 dark:border-amber-500 dark:ring-amber-500/25'
                        : 'border-border-light dark:border-border-dark'
                    }`}
                  />
                  <p className="mt-2 text-[11px] leading-snug text-text-secondary-light dark:text-text-secondary-dark [@media(max-height:760px)]:mt-1 [@media(max-height:760px)]:text-[10px]">
                    입력한 작업명으로 파일들이 하나의 작업에 묶입니다.
                  </p>
                  {needsSessionName && (
                    <div
                      id="ocr-work-session-name-hint"
                      role="alert"
                      className="mt-2 flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 shadow-sm [@media(max-height:760px)]:mt-1 [@media(max-height:760px)]:px-2 [@media(max-height:760px)]:py-1.5"
                    >
                      <AlertCircle
                        className="h-4 w-4 shrink-0 text-orange-600"
                        aria-hidden
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-orange-800">
                          작업명을 입력해 주세요
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* 문서 유형 일괄 선택 */}
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/20 [@media(max-height:760px)]:p-3">
                  <label
                    htmlFor="ocr-work-bulk-doc-type"
                    className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-text-secondary-light dark:text-text-secondary-dark [@media(max-height:760px)]:mb-1"
                  >
                    문서 유형 일괄 선택
                  </label>
                  {pendingUploadCount === 0 ? (
                    <div className="relative">
                      <select
                        id="ocr-work-bulk-doc-type"
                        disabled
                        value=""
                        className="h-10 w-full cursor-not-allowed appearance-none rounded-lg border border-border-light bg-white pl-3 pr-9 text-sm text-text-secondary-light opacity-60 dark:border-border-dark dark:bg-background-dark dark:text-text-secondary-dark [@media(max-height:760px)]:h-9"
                      >
                        <option value="">파일을 추가하면 선택할 수 있습니다</option>
                      </select>
                      <ChevronDown
                        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary-light opacity-50 dark:text-text-secondary-dark"
                        aria-hidden
                      />
                    </div>
                  ) : (
                    <div className="relative" title={bulkDocTypeLocked ? '작업 등록을 시작한 뒤에는 문서 유형 일괄을 변경할 수 없습니다.' : undefined}>
                      <select
                        id="ocr-work-bulk-doc-type"
                        value={bulkSidebarSelectValue}
                        disabled={isSubmitting || bulkDocTypeLocked}
                        onChange={event => {
                          const v = event.target.value
                          if (v) {
                            updateSessionDocType(sessionName.trim() || UNNAMED_SESSION_LABEL, v)
                            setDefaultDocType(v)
                          }
                        }}
                        className="h-10 w-full cursor-pointer appearance-none rounded-lg border border-border-light bg-white pl-3 pr-9 text-sm text-text-primary-light focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-border-dark dark:bg-background-dark dark:text-text-primary-dark [@media(max-height:760px)]:h-9"
                      >
                        <option value="">문서유형선택</option>
                        {allDocTypes.map(type => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        className={`pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-slate-400 ${isSubmitting || bulkDocTypeLocked ? 'opacity-50' : ''}`}
                        aria-hidden
                      />
                    </div>
                  )}
                  <p className="mt-2 text-[11px] leading-snug text-text-secondary-light dark:text-text-secondary-dark [@media(max-height:760px)]:mt-1 [@media(max-height:760px)]:text-[10px]">
                    문서 유형별 메타데이터 추출 기준이 적용됩니다.
                  </p>
                </div>

                {/* 파일 추가 */}
              <div className="flex min-h-0 flex-1 flex-col gap-3 [@media(max-height:760px)]:gap-2">
              <div className="flex min-h-0 flex-1 flex-col">
                <input {...getInputProps()} />
                <div className="flex min-h-[190px] flex-1 flex-col justify-center rounded-xl border border-slate-200 bg-slate-50/70 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/20 [@media(max-height:760px)]:min-h-[150px] [@media(max-height:760px)]:p-3">
                  <div className="mb-4 text-center [@media(max-height:760px)]:mb-2">
                    <p className="text-sm font-bold text-text-primary-light dark:text-text-primary-dark">
                      파일 또는 폴더 추가
                    </p>
                    <p className="mt-1 text-[11px] leading-snug text-text-secondary-light dark:text-text-secondary-dark [@media(max-height:760px)]:text-[10px]">
                      선택한 항목은 오른쪽 작업 목록에 추가됩니다.
                    </p>
                    <p className="mt-1 text-[10px] leading-snug text-slate-400">
                      지원 형식: PDF, 이미지, HWP/HWPX, TXT, DOC/XLS/PPT
                    </p>
                  </div>
                  <div className="grid w-full grid-cols-1 gap-2 [@media(max-height:760px)]:gap-1.5">
                  <label className="flex h-11 cursor-pointer items-center justify-center rounded-xl bg-slate-700 px-3 text-sm font-bold text-white shadow-sm transition-all active:scale-[0.98] [@media(max-height:760px)]:h-9">
                      파일 선택
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.webp,.bmp,.hwp,.hwpx,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.HWP,.HWPX,application/pdf,image/png,image/jpeg,image/tiff,image/webp,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.hancom.hwp,application/vnd.hancom.hwpx,application/x-hwp"
                        className="hidden"
                        disabled={isSubmitting}
                        onChange={event => handleFileSelect(event, 'file')}
                      />
                    </label>
                  <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 shadow-sm transition-all active:scale-[0.98] dark:border-slate-300 dark:bg-white [@media(max-height:760px)]:h-9">
                      <FolderOpen className="h-4 w-4" />
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
              </div>

              <button
                type="button"
                onClick={() => void startProcessing()}
                disabled={isSubmitting || pendingUploadCount === 0 || !sessionName.trim()}
                className="flex h-16 w-full shrink-0 items-center justify-center gap-2.5 rounded-xl bg-primary px-6 text-[15px] font-bold leading-tight text-white shadow-md shadow-primary/20 transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 [@media(max-height:760px)]:h-12"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-6 w-6 shrink-0 animate-spin" />
                    작업 등록 중...
                  </>
                ) : (
                  <>
                    <Zap className="h-6 w-6 shrink-0 fill-current" />
                    문서 작업 시작하기
                  </>
                )}
              </button>
              </div>{/* 파일추가 래퍼 끝 */}
              </div>{/* 통합 박스 끝 */}

            </aside>

            <div className="flex min-h-[620px] flex-col xl:col-start-2 xl:h-[calc(100vh-9rem)] xl:min-h-[calc(100vh-9rem)]">
              <section
                {...getRootProps({ onClick: e => e.stopPropagation() })}
                className={`flex h-full min-h-[620px] flex-1 flex-col overflow-hidden rounded-xl border bg-surface-light dark:bg-surface-light xl:min-h-0 transition-all ${
                  isDragActive
                    ? 'border-primary ring-2 ring-primary/30 bg-primary/5'
                    : 'border-border-light dark:border-border-light'
                }`}
              >
                {/* Queue Header with Bulk Controls */}
                <div className="flex items-start justify-between gap-2 border-b border-border-light bg-gradient-to-r from-gray-50/90 to-surface-light/80 px-3 py-2.5 dark:border-border-light dark:from-gray-50/90 dark:to-surface-light/80 sm:items-center sm:px-4">
                  <div className="flex min-w-0 flex-1 items-start gap-2 sm:items-center">
                    <div className="mt-0.5 shrink-0 rounded-lg bg-primary/15 p-2 ring-1 ring-primary/10 shadow-sm sm:mt-0">
                      <FileText className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-extrabold tracking-tight text-text-primary-light dark:text-text-primary-dark">작업 목록</h3>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[10px] font-medium tabular-nums leading-relaxed text-text-secondary-light dark:text-text-secondary-dark">
                        <span>
                          파일 <span className="font-bold text-text-primary-light dark:text-text-primary-dark">{queue.length}</span>
                        </span>
                        <span className="text-text-secondary-light/40 dark:text-text-secondary-dark/40" aria-hidden>
                          ·
                        </span>
                        <span>
                          세션 <span className="font-bold text-text-primary-light dark:text-text-primary-dark">{groupedQueueArray.length}</span>
                        </span>
                        {queue.length > 0 && (
                          <>
                            <span className="text-text-secondary-light/40 dark:text-text-secondary-dark/40" aria-hidden>
                              ·
                            </span>
                            <span>
                              대기 <span className="font-black text-primary">{pendingCount}</span>
                            </span>
                            <span className="text-text-secondary-light/40 dark:text-text-secondary-dark/40" aria-hidden>
                              ·
                            </span>
                            <span>
                              진행 <span className="font-black text-blue-600 dark:text-blue-400">{workingCount}</span>
                            </span>
                            <span className="text-text-secondary-light/40 dark:text-text-secondary-dark/40" aria-hidden>
                              ·
                            </span>
                            <span>
                              완료 <span className="font-black text-emerald-600 dark:text-emerald-400">{completedCount}</span>
                            </span>
                            <span className="text-text-secondary-light/40 dark:text-text-secondary-dark/40" aria-hidden>
                              ·
                            </span>
                            <span>
                              실패 <span className="font-black text-red-500">{failedCount}</span>
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 pt-0.5 sm:pt-0">
                    <button
                      onClick={clearAll}
                      disabled={isSubmitting || queue.length === 0}
                      className="rounded-md bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-500 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-red-900/20 dark:hover:bg-red-900/30"
                    >
                      전체 비우기
                    </button>
                    <button 
                      onClick={() => {
                        const allNames = groupedQueueArray.map(([n]) => n)
                        const allExpanded = allNames.every(n => expandedSessions[n])
                        const next: Record<string, boolean> = {}
                        allNames.forEach(n => next[n] = !allExpanded)
                        setExpandedSessions(next)
                      }}
                      className="flex items-center gap-1 rounded-md bg-primary/5 px-2 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={queue.length === 0}
                    >
                      <span className="material-symbols-outlined !text-sm">
                        {Object.values(expandedSessions).some(v => v) ? 'unfold_less' : 'unfold_more'}
                      </span>
                      {Object.values(expandedSessions).some(v => v) ? '접기' : '펼치기'}
                    </button>
                  </div>
                </div>
                {queue.length === 0 ? (
                  <div className="flex h-full items-stretch p-2 sm:p-3">
                    <div
                      className={`flex min-h-[360px] w-full flex-col items-center justify-center rounded-3xl border-2 border-dashed px-6 py-12 text-center transition-all duration-200 ${
                        isDragActive
                          ? 'border-primary bg-primary/10 shadow-lg shadow-primary/10 ring-4 ring-primary/10'
                          : 'border-slate-300 bg-white/70 shadow-sm shadow-slate-900/5 dark:border-slate-300 dark:bg-white/70'
                      }`}
                    >
                      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15">
                        <FileText className="h-8 w-8" />
                      </div>
                      <p className="text-base font-bold text-slate-700">
                        선택한 파일 목록이 여기에 표시됩니다
                      </p>
                      <p className="mt-2 text-sm font-medium text-primary">
                        이 영역으로 파일을 드래그해서 업로드할 수 있습니다
                      </p>
                      <p className="mt-3 text-xs text-text-secondary-light dark:text-text-secondary-dark">
                        PDF, 이미지, HWP, Office 문서를 끌어다 놓아 작업 목록에 추가하세요.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col h-full min-h-0 overflow-hidden">
                  <div className="border-b border-border-light bg-white/80 px-3 py-2 dark:border-border-light dark:bg-white/80">
                    <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1 ring-1 ring-slate-200/80">
                      {[
                        {
                          key: 'active' as const,
                          label: '진행 중인 작업',
                          count: groupedQueueByStatus.active.length,
                        },
                        {
                          key: 'completed' as const,
                          label: '완료된 작업',
                          count: groupedQueueByStatus.completed.length,
                        },
                      ].map(tab => {
                        const active = queueStatusTab === tab.key
                        return (
                          <button
                            key={tab.key}
                            type="button"
                            onClick={() => setQueueStatusTab(tab.key)}
                            className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-extrabold transition-all ${
                              active
                                ? 'bg-white text-primary shadow-sm ring-1 ring-primary/15'
                                : 'text-slate-500 hover:text-slate-700'
                            }`}
                          >
                            {tab.label}
                            <span
                              className={`rounded-full px-1.5 py-0.5 text-[10px] font-black ${
                                active ? 'bg-primary/10 text-primary' : 'bg-white/80 text-slate-500'
                              }`}
                            >
                              {tab.count}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {queueStatusTab === 'active' && currentActiveSummary && (
                    <div className="border-b border-border-light bg-white/90 px-3 py-2.5 dark:border-border-light dark:bg-white/90">
                      <div className="rounded-xl border border-primary/15 bg-primary/[0.03] p-3 shadow-sm">
                        <div className="mb-2 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <p className="text-[10px] font-black uppercase tracking-wide text-primary">
                              현재 작업
                            </p>
                            <p className="mt-0.5 truncate text-sm font-extrabold text-slate-700">
                              {currentActiveSummary.sessionName}
                            </p>
                            <p className="mt-0.5 truncate text-[11px] font-semibold text-text-secondary-light dark:text-text-secondary-dark">
                              {currentActiveSummary.file.displayName}
                            </p>
                          </div>
                          <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-primary ring-1 ring-primary/20">
                            {queueStatusLabel(currentActiveSummary.status)}
                          </span>
                        </div>
                        <PipelineProgress
                          compact
                          status={currentActiveSummary.status}
                          progress={currentActiveSummary.progress}
                          subStage={currentActiveSummary.subStage}
                          failedStage={currentActiveSummary.failedStage}
                        />
                      </div>
                    </div>
                  )}

                  {/* Grouped Session List — 패널(흰색)과 카드 구분용 캔버스 */}
                  <div className="flex-1 min-h-0 overflow-y-auto [scrollbar-gutter:stable] space-y-3 bg-surface-alt-light p-2.5 dark:bg-surface-alt-light sm:p-3">
                    {paginatedGroups.length === 0 ? (
                      <div
                        className={`flex h-full min-h-[360px] flex-1 flex-col items-center justify-center rounded-3xl px-6 py-10 text-center transition-all ${
                          queueStatusTab === 'active'
                            ? isDragActive
                              ? 'border-2 border-dashed border-primary bg-primary/10 shadow-lg shadow-primary/10 ring-4 ring-primary/10'
                              : 'border-2 border-dashed border-primary/35 bg-white shadow-sm shadow-slate-900/5 ring-1 ring-primary/10'
                            : 'border border-dashed border-slate-300 bg-white/70'
                        }`}
                      >
                        <div
                          className={`mb-4 flex h-16 w-16 items-center justify-center rounded-2xl ${
                            queueStatusTab === 'active'
                              ? 'bg-primary/10 text-primary ring-1 ring-primary/15'
                              : 'bg-slate-100 text-slate-300'
                          }`}
                        >
                          <FileText className="h-8 w-8" />
                        </div>
                        <p className="text-sm font-bold text-slate-600">
                          {queueStatusTab === 'active' ? '진행 중인 작업이 없습니다' : '완료된 작업이 없습니다'}
                        </p>
                        {queueStatusTab === 'active' && (
                          <p className="mt-2 text-sm font-bold text-primary">
                            이 영역으로 파일을 드래그해서 업로드할 수 있습니다
                          </p>
                        )}
                        <p className="mt-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
                          {queueStatusTab === 'active'
                            ? '파일을 드래그해서 업로드하거나 새 작업을 시작하면 이 탭에 표시됩니다.'
                            : 'OCR 처리가 완료된 작업은 이 탭에 모입니다.'}
                        </p>
                      </div>
                    ) : (
                    paginatedGroups.map(([sName, files]) => {
                      const isCompletedTab = queueStatusTab === 'completed'
                      const isExpanded = expandedSessions[sName] ?? !isCompletedTab
                      const renderedSessionName = displaySessionName(sName)
                      const isUnnamedSession = renderedSessionName === UNNAMED_SESSION_LABEL
                      const sessionIdForLink = getSessionIdFromKey(sName)
                      // status는 백엔드 동기화(syncStatuses)의 결과인 file.status를 기준으로 표시
                      const pendingInSession = files.filter(f => f.status === 'pending').length
                      const workingInSession = files.filter(f => f.status === 'uploading' || f.status === 'queued' || f.status === 'processing').length
                      const doneInSession = files.filter(f => f.status === 'completed').length
                      const failedInSession = files.filter(f => f.status === 'failed').length
                      const sessionCompletedAt =
                        isCompletedTab
                          ? files.reduce<string | undefined>((latest, file) => {
                              const tracked = file.jobId ? trackedJobs.find(tj => tj.jobId === file.jobId) : undefined
                              const candidate = tracked?.completedAt || file.completedAt
                              return getCompletedTimeValue(candidate) > getCompletedTimeValue(latest) ? candidate : latest
                            }, undefined)
                          : undefined
                      const sessionCompletedAtText = formatCompletedAt(sessionCompletedAt)
                      
                      const visibleLimit = visibleCounts[sName] || 20
                      const visibleFiles = files.slice(0, visibleLimit)
                      const hasMore = files.length > visibleLimit

                      return (
                        <div
                          key={sName}
                          className="flex flex-col overflow-hidden rounded-xl border border-slate-300 bg-white shadow-md shadow-slate-900/5 ring-1 ring-slate-900/[0.12] transition-shadow hover:shadow-lg dark:border-slate-300 dark:bg-white dark:shadow-slate-900/5 dark:ring-slate-900/[0.12]"
                        >
                          {/* Session header */}
                          <div
                            className={`bg-gradient-to-br from-gray-50/90 to-white px-3 py-2.5 dark:from-gray-50/90 dark:to-white sm:px-4 ${isExpanded ? 'border-b border-border-light dark:border-border-light' : ''}`}
                          >
                            <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                              <button
                                type="button"
                                onClick={() => setExpandedSessions(prev => ({ ...prev, [sName]: !isExpanded }))}
                                className="-m-0.5 flex min-w-0 flex-1 items-start gap-1.5 rounded-lg p-0.5 text-left transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03] sm:gap-2"
                              >
                                <span
                                  className={`material-symbols-outlined !text-lg shrink-0 text-text-secondary-light transition-transform duration-300 dark:text-text-secondary-dark ${isExpanded ? 'mt-0.5 rotate-180' : 'mt-0.5'}`}
                                >
                                  expand_more
                                </span>
                                <div className="min-w-0 flex-1 space-y-1.5">
                                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                                      <FolderOpen className="h-3.5 w-3.5" />
                                    </span>
                                    {!isUnnamedSession ? (
                                      isCompletedTab && sessionIdForLink ? (
                                        <Link
                                          href={`/jobs/${sessionIdForLink}`}
                                          onClick={event => event.stopPropagation()}
                                          className="truncate rounded-md bg-black/[0.03] px-1.5 py-0.5 text-sm font-bold tracking-tight text-slate-600 underline-offset-2 hover:underline dark:bg-white/[0.06] dark:text-slate-600"
                                        >
                                          {renderedSessionName}
                                        </Link>
                                      ) : (
                                        <span className="truncate rounded-md bg-black/[0.03] px-1.5 py-0.5 text-sm font-bold tracking-tight text-slate-600 dark:bg-white/[0.06] dark:text-slate-600">
                                          {renderedSessionName}
                                        </span>
                                      )
                                    ) : (
                                      <span className="sr-only">
                                        작업 이름이 비어 있습니다. 왼쪽 패널에서 작업 이름을 입력하세요.
                                      </span>
                                    )}
                                    {!isCompletedTab && (
                                      <div className="flex flex-wrap items-center gap-1">
                                      {pendingInSession > 0 && (
                                        <span className="inline-flex items-center rounded-full bg-orange-500 px-1.5 py-px text-[9px] font-bold text-white">
                                          대기 {pendingInSession}
                                        </span>
                                      )}
                                      {workingInSession > 0 && (
                                        <span className="inline-flex items-center rounded-full bg-blue-500 px-1.5 py-px text-[9px] font-bold text-white">
                                          진행 {workingInSession}
                                        </span>
                                      )}
                                      {doneInSession > 0 && (
                                        <span className="inline-flex items-center rounded-full bg-emerald-500 px-1.5 py-px text-[9px] font-bold text-white">
                                          완료 {doneInSession}
                                        </span>
                                      )}
                                      {failedInSession > 0 && (
                                        <span className="inline-flex items-center rounded-full bg-red-500 px-1.5 py-px text-[9px] font-bold text-white">
                                          실패 {failedInSession}
                                        </span>
                                      )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </button>

                              <div className="flex shrink-0 items-center justify-end gap-1 lg:pt-0.5">
                                {failedInSession > 0 && (
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      const failedTargets = files.filter(f => f.status === 'failed' && f.jobId)
                                      if (failedTargets.length === 0) return

                                      setRestartingSessionKeys(prev => new Set(prev).add(sName))
                                      const restartResults = await Promise.allSettled(
                                        failedTargets.map(async target => {
                                          const response = await fetch(`${API_BASE}/process/${target.jobId}`, { method: 'POST' })
                                          if (!response.ok) {
                                            const payload = await response.json().catch(() => ({}))
                                            throw new Error(payload?.detail || '재시작에 실패했습니다.')
                                          }
                                          return target.id
                                        }),
                                      )

                                      const successIds = new Set<string>()
                                      const failedById = new Map<string, string>()
                                      restartResults.forEach((result, idx) => {
                                        const target = failedTargets[idx]
                                        if (!target) return
                                        if (result.status === 'fulfilled') {
                                          successIds.add(result.value)
                                        } else {
                                          failedById.set(target.id, result.reason instanceof Error ? result.reason.message : '재시작에 실패했습니다.')
                                        }
                                      })

                                      setQueue(prev =>
                                        prev.map(item => {
                                          if (successIds.has(item.id)) {
                                            return {
                                              ...item,
                                              status: 'queued',
                                              progress: 0,
                                              error: undefined,
                                              failedStage: undefined,
                                            }
                                          }
                                          if (failedById.has(item.id)) {
                                            return {
                                              ...item,
                                              status: 'failed',
                                              error: failedById.get(item.id),
                                            }
                                          }
                                          return item
                                        }),
                                      )

                                      setRestartingSessionKeys(prev => {
                                        const next = new Set(prev)
                                        next.delete(sName)
                                        return next
                                      })
                                    }}
                                    disabled={restartingSessionKeys.has(sName)}
                                    className="mr-1 inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700 transition-all hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-blue-800/70 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/45"
                                    title="실패 항목 전체 재시작"
                                  >
                                    {restartingSessionKeys.has(sName) ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <span className="material-symbols-outlined !text-[12px] leading-none">refresh</span>
                                    )}
                                    실패 항목 전체 재시작
                                  </button>
                                )}
                                {sessionCompletedAtText && (
                                  <span className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 text-[10px] font-bold text-slate-500">
                                    <span className="material-symbols-outlined !text-[12px] text-slate-400">
                                      event_available
                                    </span>
                                    {sessionCompletedAtText}
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => removeSession(sName)}
                                  disabled={isSubmitting}
                                  className="rounded-lg border border-transparent p-2 text-text-secondary-light transition-all hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 dark:hover:border-red-900/50 dark:hover:bg-red-500/10"
                                  title="세션 삭제"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                          
                          {/* File List for Session */}
                          {isExpanded && (
                            <div className="bg-gradient-to-b from-gray-50/50 to-white p-1 dark:from-gray-50/50 dark:to-white sm:p-1.5">
                              <p className="mt-1.5 mb-1 px-0.5 text-[10px] font-bold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
                                파일 목록
                              </p>
                              <ul className="space-y-1">
                                {visibleFiles.map(file => {
                                  const tracked = trackedJobs.find(tj => tj.jobId === file.jobId)
                                  const effectiveStatus = file.status
                                  const errorMessage = tracked?.message || file.error
                                  const tikaHint = tracked?.tikaUserMessage || file.tikaUserMessage
                                  const isCurrentWork =
                                    currentActiveSummary?.sessionKey === sName &&
                                    currentActiveSummary.file.id === file.id
                                  const statusLabelBg =
                                    effectiveStatus === 'completed' ? 'bg-emerald-500 text-white' :
                                    effectiveStatus === 'failed' ? 'bg-red-500 text-white' :
                                    effectiveStatus === 'processing' ? 'bg-orange-500 text-white' :
                                    (effectiveStatus === 'uploading' || effectiveStatus === 'queued') ? 'bg-blue-500 text-white' :
                                    'bg-gray-400 text-white'

                                  return (
                                    <li
                                      key={file.id}
                                      className={`group/item flex flex-col gap-2 rounded-md border bg-white/95 px-2 py-1.5 shadow-sm transition-all hover:shadow dark:bg-white/95 sm:flex-row sm:items-center sm:gap-2 ${
                                        isCurrentWork
                                          ? 'border-primary/50 ring-1 ring-primary/25 hover:border-primary/60 dark:border-primary/50 dark:hover:border-primary/60'
                                          : 'border-border-light/80 hover:border-primary/25 dark:border-border-light/80 dark:hover:border-primary/25'
                                      }`}
                                    >
                                      {/* 1. 문서유형선택 */}
                                      <div className="w-full shrink-0 sm:mr-2 sm:w-[7rem]">
                                        {file.status === 'pending' && !isSubmitting ? (
                                          <div className="relative">
                                            <select
                                              id={`ocr-work-doctype-${file.id}`}
                                              value={file.docType}
                                              onChange={event => updateFile(file.id, { docType: event.target.value })}
                                              className="w-full min-w-0 cursor-pointer appearance-none rounded-md border border-slate-200/95 bg-white py-1 pl-1.5 pr-7 text-xs font-semibold leading-snug text-slate-600 shadow-sm transition-all hover:border-primary/45 hover:bg-slate-50/90 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/25 [&>option]:text-slate-600"
                                            >
                                              <option value="">문서유형선택</option>
                                              {allDocTypes.map(type => (
                                                <option key={type} value={type}>
                                                  {type}
                                                </option>
                                              ))}
                                            </select>
                                            <ChevronDown
                                              className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-slate-500"
                                              aria-hidden
                                            />
                                          </div>
                                        ) : (
                                          <div
                                            className="flex h-[1.875rem] w-full min-w-0 items-center rounded-md border border-slate-200/70 bg-slate-50/95 px-1.5 py-0.5"
                                            title={
                                              file.status !== 'pending'
                                                ? '진행·완료된 파일은 문서 유형을 바꿀 수 없습니다'
                                                : '작업 등록 중에는 변경할 수 없습니다'
                                            }
                                          >
                                            <span className="truncate text-xs font-semibold leading-snug text-slate-600">
                                              {file.docType || '미분류'}
                                            </span>
                                          </div>
                                        )}
                                      </div>

                                      {/* 2. 파일명 */}
                                      <div className="min-w-0 flex-1 space-y-0.5">
                                        {effectiveStatus === 'completed' ? (
                                          <Link
                                            href="/jobs"
                                            className="block truncate text-[13px] font-bold leading-snug text-slate-600 hover:underline underline-offset-2"
                                          >
                                            {file.displayName}
                                          </Link>
                                        ) : (
                                          <p className="truncate text-[13px] font-bold leading-snug text-slate-600">
                                            {file.displayName}
                                          </p>
                                        )}
                                        {tikaHint && (
                                          <p
                                            className="truncate text-[10px] font-medium leading-snug text-amber-800/95 dark:text-amber-200/90"
                                            title="Tika 텍스트 추적 (검색 레이어 보조)"
                                          >
                                            Tika: {tikaHint}
                                          </p>
                                        )}
                                        {effectiveStatus === 'failed' && (
                                          <div className="flex min-w-0 items-start gap-0.5">
                                            <span className="material-symbols-outlined shrink-0 !text-[11px] text-red-500">error_outline</span>
                                            <span className="break-words text-[10px] font-bold leading-snug text-red-500">
                                              {errorMessage || '실패'}
                                            </span>
                                          </div>
                                        )}
                                      </div>

                                      {/* 3. 상태/액션 */}
                                      <div className="flex w-full shrink-0 items-center justify-end gap-1.5 sm:w-auto">
                                        <span className="mr-auto text-[11px] font-medium text-text-secondary-light dark:text-text-secondary-dark sm:mr-1">
                                          {file.trackedOnly ? '작업 중' : formatBytes(file.fileSize)}
                                        </span>
                                        <span className={`inline-flex min-w-[2.5rem] items-center justify-center rounded px-1.5 py-0.5 text-[9px] font-extrabold leading-tight tracking-wide ${statusLabelBg}`}>
                                          {queueStatusLabel(effectiveStatus)}
                                        </span>
                                        {effectiveStatus === 'failed' && file.jobId && (
                                          <button
                                            type="button"
                                            onClick={async () => {
                                              try {
                                                const response = await fetch(`${API_BASE}/process/${file.jobId}`, { method: 'POST' })
                                                if (!response.ok) {
                                                  const payload = await response.json().catch(() => ({}))
                                                  throw new Error(payload?.detail || '재시작에 실패했습니다.')
                                                }
                                                updateFile(file.id, {
                                                  status: 'queued',
                                                  progress: 0,
                                                  error: undefined,
                                                  failedStage: undefined,
                                                  tikaUserMessage: undefined,
                                                  tikaTrackStatus: undefined,
                                                })
                                              } catch (error) {
                                                updateFile(file.id, {
                                                  status: 'failed',
                                                  error: error instanceof Error ? error.message : '재시작에 실패했습니다.',
                                                })
                                              }
                                            }}
                                            className="inline-flex h-7 items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 text-[10px] font-bold text-blue-700 transition-all hover:bg-blue-100"
                                            title="재시작"
                                          >
                                            <span className="material-symbols-outlined !text-[12px] leading-none">refresh</span>
                                            재시작
                                          </button>
                                        )}
                                        {(effectiveStatus === 'queued' || effectiveStatus === 'processing') && (
                                          <button
                                            type="button"
                                            onClick={async () => {
                                              if (!confirm('이 작업을 중지하면 같은 작업의 남은 파일도 모두 실패 처리됩니다.\n계속하시겠습니까?')) {
                                                return
                                              }

                                              const cancellableFiles = files.filter(f =>
                                                ['pending', 'uploading', 'queued', 'processing'].includes(f.status),
                                              )
                                              const cancellableIds = new Set(cancellableFiles.map(f => f.id))
                                              const jobIds = cancellableFiles
                                                .map(f => f.jobId)
                                                .filter((id): id is string => Boolean(id))

                                              if (jobIds.length > 0) {
                                                await Promise.allSettled(
                                                  jobIds.map(async jobId => {
                                                    await fetch(`${API_BASE}/cancel/${jobId}`, { method: 'POST' })
                                                    await fetch(`${API_BASE}/status/${jobId}`, {
                                                      method: 'PATCH',
                                                      headers: { 'Content-Type': 'application/json' },
                                                      body: JSON.stringify({
                                                        status: 'failed',
                                                        error_message: '사용자가 작업을 중지했습니다.',
                                                      }),
                                                    })
                                                  }),
                                                )
                                              }

                                              setQueue(prev =>
                                                prev.map(item =>
                                                  cancellableIds.has(item.id)
                                                    ? {
                                                        ...item,
                                                        status: 'failed',
                                                        progress: 0,
                                                        error: '사용자가 작업을 중지했습니다.',
                                                      }
                                                    : item,
                                                ),
                                              )
                                            }}
                                            className="inline-flex h-7 items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 text-[10px] font-bold text-red-700 transition-all hover:bg-red-100"
                                            title="중지"
                                          >
                                            <StopCircle className="h-3 w-3" />
                                            중지
                                          </button>
                                        )}
                                        {!isCompletedTab && (file.status === 'pending' || effectiveStatus === 'failed' || effectiveStatus === 'completed') && !isSubmitting ? (
                                          <button
                                            type="button"
                                            onClick={() => removeFile(file.id)}
                                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border-light bg-surface-light text-text-secondary-light shadow-sm transition-all hover:border-red-300 hover:bg-red-50 hover:text-red-500 dark:border-border-dark dark:bg-surface-dark dark:hover:border-red-800 dark:hover:bg-red-500/10"
                                            title="삭제"
                                          >
                                            <X className="h-3 w-3" />
                                          </button>
                                        ) : null}
                                      </div>
                                    </li>
                                  )
                                })}
                              </ul>
                              {hasMore && (
                                <button
                                  type="button"
                                  onClick={() => setVisibleCounts(prev => ({ ...prev, [sName]: (prev[sName] || 20) + 50 }))}
                                  className="mt-1 w-full rounded-md border border-dashed border-primary/30 py-1.5 text-[11px] font-bold text-primary transition-colors hover:bg-primary/5 dark:border-primary/40"
                                >
                                  +{files.length - visibleLimit}개 더 보기
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    }))}
                  </div>

                  {/* Session Pagination Controls */}
                  {totalSessionPages > 0 && (
                    <div className="px-4 py-2 border-t border-border-light dark:border-border-light bg-surface-alt-light dark:bg-surface-alt-light flex items-center justify-center gap-3">
                      <button
                        onClick={() => setSessionPage(prev => Math.max(1, prev - 1))}
                        disabled={sessionPage === 1}
                        className="p-1.5 rounded-lg hover:bg-white dark:hover:bg-white border border-border-light dark:border-border-light disabled:opacity-30 transition-all text-text-primary-light"
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
                                : 'hover:bg-white dark:hover:bg-white text-text-secondary-light'
                            }`}
                          >
                            {page}
                          </button>
                        ))}
                      </div>

                      <button
                        onClick={() => setSessionPage(prev => Math.min(totalSessionPages, prev + 1))}
                        disabled={sessionPage === totalSessionPages}
                        className="p-1.5 rounded-lg hover:bg-white dark:hover:bg-white border border-border-light dark:border-border-light disabled:opacity-30 transition-all text-text-primary-light"
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
