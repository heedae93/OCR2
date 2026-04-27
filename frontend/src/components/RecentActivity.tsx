'use client'

import { useEffect, useState } from 'react'
import { Job } from '@/types'
import { listJobs, deleteJob, getProcessedFileUrl } from '@/lib/api'
import Link from 'next/link'

export default function RecentActivity() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)

  const fetchJobs = async () => {
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}')
      const userId = user.user_id || ''
      if (!userId) return

      const data = await listJobs(userId)
      setJobs(data.slice(0, 10)) // Show only recent 10
    } catch (error) {
      console.error('Failed to fetch jobs:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchJobs()

    // Poll for updates
    const interval = setInterval(fetchJobs, 3000)
    return () => clearInterval(interval)
  }, [])

  const handleDelete = async (jobId: string) => {
    if (!confirm('이 작업을 삭제하시겠습니까?')) return

    try {
      await deleteJob(jobId)
      await fetchJobs()
    } catch (error) {
      console.error('Failed to delete job:', error)
      alert('삭제에 실패했습니다.')
    }
  }

  const handleDownload = (jobId: string) => {
    const url = getProcessedFileUrl(jobId)
    const link = document.createElement('a')
    link.href = url
    link.download = `${jobId}.pdf`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <span className="material-symbols-outlined text-green-500">task_alt</span>
      case 'processing':
      case 'queued':
        return <span className="material-symbols-outlined text-primary">description</span>
      case 'failed':
        return <span className="material-symbols-outlined text-red-500">error</span>
      default:
        return <span className="material-symbols-outlined text-text-secondary-light dark:text-text-secondary-dark">description</span>
    }
  }

  const getStatusText = (job: Job) => {
    switch (job.status) {
      case 'completed':
        return '완료됨'
      case 'processing':
        return `처리 중... (${Math.round(job.progress_percent)}%)`
      case 'queued':
        return '대기 중...'
      case 'failed':
        return '실패'
      default:
        return job.status
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="flex flex-col items-center gap-2">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
          <p className="text-text-secondary-light dark:text-text-secondary-dark text-sm">로딩 중...</p>
        </div>
      </div>
    )
  }

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-text-secondary-light dark:text-text-secondary-dark">
        <span className="material-symbols-outlined text-5xl mb-2">folder_open</span>
        <p>최근 활동이 없습니다</p>
      </div>
    )
  }

  return (
    <div className="mt-10">
      <h2 className="text-text-primary-light dark:text-text-primary-dark text-xl font-bold leading-tight tracking-tight px-1 pb-4">
        최근 활동
      </h2>
      <div className="flex flex-col bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark shadow-sm divide-y divide-border-light dark:divide-border-dark">
        {jobs.map((job) => (
          <div key={job.job_id} className="flex items-center gap-4 px-4 min-h-[72px] py-3 justify-between">
            <div className="flex items-center gap-4">
              <div className={`flex items-center justify-center rounded-lg shrink-0 size-12 ${
                job.status === 'completed' ? 'text-green-500 bg-green-500/10' :
                job.status === 'failed' ? 'text-red-500 bg-red-500/10' :
                'text-primary bg-primary/10'
              }`}>
                {getStatusIcon(job.status)}
              </div>
              <div className="flex flex-col justify-center">
                <p className="text-text-primary-light dark:text-text-primary-dark text-base font-medium leading-normal line-clamp-1">
                  {job.job_id.substring(0, 12)}...
                </p>
                <p className={`text-sm font-normal leading-normal line-clamp-2 ${
                  job.status === 'failed' ? 'text-red-500' : 'text-text-secondary-light dark:text-text-secondary-dark'
                }`}>
                  {getStatusText(job)}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              {job.status === 'processing' && (
                <div className="hidden sm:flex items-center gap-3">
                  <div className="w-24 overflow-hidden rounded-full bg-border-light dark:bg-border-dark">
                    <div className="h-1.5 rounded-full bg-primary transition-all" style={{ width: `${job.progress_percent}%` }} />
                  </div>
                  <p className="text-text-primary-light dark:text-text-primary-dark text-sm font-medium leading-normal w-8 text-right">
                    {Math.round(job.progress_percent)}%
                  </p>
                </div>
              )}

              <div className="flex items-center gap-2">
                {job.status === 'completed' && (
                  <>
                    <button
                      onClick={() => handleDownload(job.job_id)}
                      aria-label="다운로드"
                      className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 group"
                    >
                      <span className="material-symbols-outlined text-text-secondary-light dark:text-text-secondary-dark group-hover:text-text-primary-light dark:group-hover:text-text-primary-dark">
                        download
                      </span>
                    </button>
                    <Link
                      href={`/editor/${job.job_id}`}
                      aria-label="편집"
                      className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 group"
                    >
                      <span className="material-symbols-outlined text-text-secondary-light dark:text-text-secondary-dark group-hover:text-text-primary-light dark:group-hover:text-text-primary-dark">
                        edit
                      </span>
                    </Link>
                  </>
                )}
                {job.status === 'failed' && (
                  <button
                    onClick={() => alert('재시도 기능은 준비 중입니다')}
                    className="flex items-center gap-2 h-9 px-4 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 text-sm font-semibold"
                  >
                    재시도
                  </button>
                )}
                <button
                  onClick={() => handleDelete(job.job_id)}
                  aria-label="삭제"
                  className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 group"
                >
                  <span className="material-symbols-outlined text-text-secondary-light dark:text-text-secondary-dark group-hover:text-red-500">
                    delete
                  </span>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
