'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

const API_BASE = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:6015'}/api`
const STORAGE_KEY = 'ocr-activity-tracker'

export type TrackedJobStatus = 'pending' | 'uploaded' | 'queued' | 'processing' | 'completed' | 'failed'
export type TrackedSourceType = 'file' | 'folder'

export interface TrackedJob {
  id: string
  jobId: string
  filename: string
  sessionName: string
  sessionKey?: string
  sourceType: TrackedSourceType
  status: TrackedJobStatus
  progressPercent: number
  subStage?: string
  message?: string
  createdAt: string
  queuedAt?: string
  completedAt?: string
  error?: string
  userId?: string
}

const QUEUED_TIMEOUT_MS = 90_000  // 90초 이상 queued 상태면 워커 없음으로 판단

interface AddTrackedJobInput {
  jobId: string
  filename: string
  sessionName: string
  sessionKey?: string
  sourceType: TrackedSourceType
  userId?: string
}

interface OcrActivityContextValue {
  trackedJobs: TrackedJob[]
  activeJobs: TrackedJob[]
  addTrackedJobs: (jobs: AddTrackedJobInput[]) => void
  removeTrackedJobs: (jobIds: string[]) => void
  dismissFinishedJobs: () => void
  clearAllTrackedJobs: () => void
  cancelJob: (jobId: string) => Promise<void>
  cancelAllJobs: () => Promise<void>
}

const OcrActivityContext = createContext<OcrActivityContextValue | undefined>(undefined)

function isActiveStatus(status: TrackedJobStatus) {
  return status === 'pending' || status === 'uploaded' || status === 'queued' || status === 'processing'
}

export function OcrActivityProvider({ children }: { children: ReactNode }) {
  const [trackedJobs, setTrackedJobs] = useState<TrackedJob[]>([])
  const [isReady, setIsReady] = useState(false)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [currentUserId, setCurrentUserId] = useState('default')

  const getCurrentUserId = useCallback(() => {
    try {
      const raw = localStorage.getItem('user')
      const user = raw ? JSON.parse(raw) : {}
      return user?.user_id || 'default'
    } catch {
      return 'default'
    }
  }, [])

  useEffect(() => {
    try {
      const userId = getCurrentUserId()
      setCurrentUserId(userId)
      // Legacy shared key cleanup (old builds stored all users together)
      localStorage.removeItem(STORAGE_KEY)
      const saved = localStorage.getItem(`${STORAGE_KEY}:${userId}`)
      if (saved) {
        const parsed = JSON.parse(saved) as TrackedJob[]
        if (Array.isArray(parsed)) {
          setTrackedJobs(parsed.map(job => ({ ...job, userId: job.userId || userId })))
        }
      }
    } catch (error) {
      console.warn('Failed to restore OCR activity state:', error)
    } finally {
      setIsReady(true)
    }
  }, [getCurrentUserId])

  useEffect(() => {
    if (!isReady) return
    localStorage.setItem(`${STORAGE_KEY}:${currentUserId}`, JSON.stringify(trackedJobs))
  }, [isReady, trackedJobs, currentUserId])

  const addTrackedJobs = useCallback((jobs: AddTrackedJobInput[]) => {
    if (jobs.length === 0) return

    setTrackedJobs(prev => {
      const existingJobIds = new Set(prev.map(job => job.jobId))
      const nextJobs = jobs
        .filter(job => !existingJobIds.has(job.jobId))
        .map(job => ({
          id: `${job.jobId}-${Date.now()}`,
          jobId: job.jobId,
          filename: job.filename,
          sessionName: job.sessionName,
          sessionKey: job.sessionKey,
          sourceType: job.sourceType,
          userId: job.userId || currentUserId,
          status: 'queued' as const,
          progressPercent: 0,
          createdAt: new Date().toISOString(),
          queuedAt: new Date().toISOString(),
        }))

      return nextJobs.length > 0 ? [...nextJobs, ...prev] : prev
    })
  }, [currentUserId])

  const dismissFinishedJobs = useCallback(() => {
    setTrackedJobs(prev => prev.filter(job => isActiveStatus(job.status)))
  }, [])

  const removeTrackedJobs = useCallback((jobIds: string[]) => {
    if (!jobIds.length) return
    const jobIdSet = new Set(jobIds)
    setTrackedJobs(prev => prev.filter(job => !jobIdSet.has(job.jobId)))
  }, [])

  const clearAllTrackedJobs = useCallback(() => {
    setTrackedJobs([])
  }, [])

  const cancelJob = useCallback(async (jobId: string) => {
    try {
      await fetch(`${API_BASE}/cancel/${jobId}`, { method: 'POST' })
      setTrackedJobs(prev =>
        prev.map(job =>
          job.jobId === jobId
            ? {
                ...job,
                status: 'failed' as const,
                message: '사용자에 의해 중지됨',
                completedAt: new Date().toISOString(),
              }
            : job,
        ),
      )
    } catch (error) {
      console.error(`Failed to cancel job ${jobId}:`, error)
    }
  }, [])

  const cancelAllJobs = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/cancel-all`, { method: 'POST' })
      clearAllTrackedJobs()
    } catch (error) {
      console.error('Failed to cancel all jobs:', error)
    }
  }, [clearAllTrackedJobs])

  useEffect(() => {
    if (!isReady) return

    const pollStatuses = async () => {
      const activeJobsSnapshot = trackedJobs.filter(job => isActiveStatus(job.status))
      if (activeJobsSnapshot.length === 0) return

      const results = await Promise.allSettled(
        activeJobsSnapshot.map(async trackedJob => {
          try {
            const response = await fetch(`${API_BASE}/status/${trackedJob.jobId}`)
            if (!response.ok) {
              return {
                jobId: trackedJob.jobId,
                status: trackedJob.status,
                progressPercent: trackedJob.progressPercent,
                message: `상태 확인 중 (${response.status})`,
              }
            }
            const data = await response.json()
            return {
              jobId: trackedJob.jobId,
              status: data.status as TrackedJobStatus,
              progressPercent: Number(data.progress_percent ?? 0),
              subStage: data.sub_stage as string | undefined,
              message: data.message as string | undefined,
            }
          } catch (error) {
            return {
              jobId: trackedJob.jobId,
              status: trackedJob.status, // Keep current status on network error
              progressPercent: trackedJob.progressPercent,
              error: '연결 오류',
            }
          }
        }),
      )

      const now = Date.now()
      const hasWorkerProgress = activeJobsSnapshot.some(
        j => j.status === 'processing' || j.status === 'uploaded',
      )

      setTrackedJobs(prev =>
        prev.map(job => {
          // queued 타임아웃 체크 — 워커가 없으면 90초 후 실패 처리
          if (!hasWorkerProgress && job.status === 'queued' && job.queuedAt) {
            const waitedMs = now - new Date(job.queuedAt).getTime()
            if (waitedMs > QUEUED_TIMEOUT_MS) {
              return {
                ...job,
                status: 'failed' as const,
                error: '워커가 응답하지 않습니다. 워커가 실행 중인지 확인해 주세요.',
                completedAt: new Date().toISOString(),
              }
            }
          }

          const result = results.find(
            item => item.status === 'fulfilled' && item.value.jobId === job.jobId,
          )

          if (!result || result.status !== 'fulfilled') {
            return job
          }

          const nextStatus = result.value.status
          const nextProgress = nextStatus === 'completed' ? 100 : result.value.progressPercent

          return {
            ...job,
            status: nextStatus,
            progressPercent: nextProgress,
            subStage: result.value.subStage,
            message: result.value.message,
            error: nextStatus === 'failed' ? result.value.message || 'OCR 작업 실패' : undefined,
            completedAt:
              nextStatus === 'completed' || nextStatus === 'failed'
                ? job.completedAt || new Date().toISOString()
                : undefined,
          }
        }),
      )
    }

    void pollStatuses()

    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
    }

    if (trackedJobs.some(job => isActiveStatus(job.status))) {
      pollTimerRef.current = setInterval(() => {
        void pollStatuses()
      }, 3000)
    }

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  }, [isReady, trackedJobs])

  const activeJobs = useMemo(
    () => trackedJobs.filter(job => isActiveStatus(job.status)),
    [trackedJobs],
  )

  const value = useMemo(
    () => ({
      trackedJobs,
      activeJobs,
      addTrackedJobs,
      removeTrackedJobs,
      dismissFinishedJobs,
      clearAllTrackedJobs,
      cancelJob,
      cancelAllJobs,
    }),
    [
      activeJobs,
      addTrackedJobs,
      removeTrackedJobs,
      clearAllTrackedJobs,
      cancelJob,
      cancelAllJobs,
      dismissFinishedJobs,
      trackedJobs,
    ],
  )

  return <OcrActivityContext.Provider value={value}>{children}</OcrActivityContext.Provider>
}

export function useOcrActivity() {
  const context = useContext(OcrActivityContext)
  if (!context) {
    throw new Error('useOcrActivity must be used within an OcrActivityProvider')
  }
  return context
}
