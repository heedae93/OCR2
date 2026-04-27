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

export type TrackedJobStatus = 'queued' | 'processing' | 'completed' | 'failed'
export type TrackedSourceType = 'file' | 'folder'

export interface TrackedJob {
  id: string
  jobId: string
  filename: string
  sessionName: string
  sourceType: TrackedSourceType
  status: TrackedJobStatus
  progressPercent: number
  createdAt: string
  completedAt?: string
  error?: string
}

interface AddTrackedJobInput {
  jobId: string
  filename: string
  sessionName: string
  sourceType: TrackedSourceType
}

interface OcrActivityContextValue {
  trackedJobs: TrackedJob[]
  activeJobs: TrackedJob[]
  addTrackedJobs: (jobs: AddTrackedJobInput[]) => void
  dismissFinishedJobs: () => void
  clearAllTrackedJobs: () => void
  cancelAllJobs: () => Promise<void>
}

const OcrActivityContext = createContext<OcrActivityContextValue | undefined>(undefined)

function isActiveStatus(status: TrackedJobStatus) {
  return status === 'queued' || status === 'processing'
}

export function OcrActivityProvider({ children }: { children: ReactNode }) {
  const [trackedJobs, setTrackedJobs] = useState<TrackedJob[]>([])
  const [isReady, setIsReady] = useState(false)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved) as TrackedJob[]
        if (Array.isArray(parsed)) {
          setTrackedJobs(parsed)
        }
      }
    } catch (error) {
      console.warn('Failed to restore OCR activity state:', error)
    } finally {
      setIsReady(true)
    }
  }, [])

  useEffect(() => {
    if (!isReady) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trackedJobs))
  }, [isReady, trackedJobs])

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
          sourceType: job.sourceType,
          status: 'queued' as const,
          progressPercent: 0,
          createdAt: new Date().toISOString(),
        }))

      return nextJobs.length > 0 ? [...nextJobs, ...prev] : prev
    })
  }, [])

  const dismissFinishedJobs = useCallback(() => {
    setTrackedJobs(prev => prev.filter(job => isActiveStatus(job.status)))
  }, [])

  const clearAllTrackedJobs = useCallback(() => {
    setTrackedJobs([])
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
                status: 'failed' as TrackedJobStatus,
                progressPercent: trackedJob.progressPercent,
                error: `서버 오류 (${response.status})`,
              }
            }
            const data = await response.json()
            return {
              jobId: trackedJob.jobId,
              status: data.status as TrackedJobStatus,
              progressPercent: Number(data.progress_percent ?? 0),
              error: data.message as string | undefined,
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

      setTrackedJobs(prev =>
        prev.map(job => {
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
            error: nextStatus === 'failed' ? result.value.error || 'OCR 작업 실패' : undefined,
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
      dismissFinishedJobs,
      clearAllTrackedJobs,
      cancelAllJobs,
    }),
    [activeJobs, addTrackedJobs, clearAllTrackedJobs, cancelAllJobs, dismissFinishedJobs, trackedJobs],
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
