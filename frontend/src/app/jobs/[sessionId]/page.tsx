'use client'

import { useState, useEffect, useRef } from 'react'
import Sidebar from '@/components/Sidebar'
import PipelineProgress from '@/components/PipelineProgress'
import { useRouter, useParams } from 'next/navigation'
import { API_BASE_URL } from '@/lib/api'
import Link from 'next/link'

interface Job {
  job_id: string
  original_filename: string
  status: string
  progress_percent: number
  sub_stage?: string | null
  total_pages: number
  current_page: number
  order: number
  is_selected: boolean
  pdf_url?: string | null
  message?: string | null
  added_at: string
}

interface SessionDetail {
  session_id: string
  session_name: string
  description?: string
  created_at: string
  updated_at: string
  total_documents: number
  completed_documents: number
  documents: Job[]
}

export default function SessionDetailPage() {
  const router = useRouter()
  const params = useParams()
  const sessionId = params.sessionId as string

  const [session, setSession] = useState<SessionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [reprocessingJobs, setReprocessingJobs] = useState<Set<string>>(new Set())

  const sessionRef = useRef<SessionDetail | null>(null)

  useEffect(() => {
    loadSession()
  }, [sessionId])

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  // 자동 갱신 (처리 중인 작업이 있을 때)
  useEffect(() => {
    const timer = setInterval(() => {
      const hasActive = sessionRef.current?.documents.some(j => 
        ['processing', 'queued', 'pending', 'uploaded'].includes(j.status)
      )
      if (hasActive) {
        loadSession(false)
      }
    }, 3000)
    return () => clearInterval(timer)
  }, [])

  const loadSession = async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true)
      const response = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}`)
      if (response.ok) {
        const data = await response.json()
        setSession(data)
      } else {
        router.push('/jobs')
      }
    } catch (error) {
      console.error('Failed to load session:', error)
    } finally {
      if (showLoading) setLoading(false)
    }
  }

  const handleReprocess = async (jobId: string) => {
    if (!confirm('OCR을 다시 처리하시겠습니까?')) return
    setReprocessingJobs(prev => new Set(prev).add(jobId))
    try {
      const response = await fetch(`${API_BASE_URL}/api/process/${jobId}`, { method: 'POST' })
      if (response.ok) loadSession(false)
    } finally {
      setReprocessingJobs(prev => { const s = new Set(prev); s.delete(jobId); return s })
    }
  }

  const handleStartOCR = async (jobId: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/process/${jobId}`, { method: 'POST' })
      if (res.ok) loadSession(false)
    } catch (e) {}
  }

  const handleDeleteJob = async (jobId: string) => {
    if (!confirm('정말 이 파일을 삭제하시겠습니까?')) return
    try {
      const response = await fetch(`${API_BASE_URL}/api/jobs/${jobId}`, { method: 'DELETE' })
      if (response.ok) loadSession(false)
    } catch (e) {}
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
      case 'processing': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
      case 'failed': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
      default: return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-400'
    }
  }

  const filteredJobs = session?.documents.filter(j => 
    j.original_filename.toLowerCase().includes(searchQuery.toLowerCase())
  ) || []

  if (loading && !session) {
    return (
      <div className="bg-background-light dark:bg-background-dark min-h-screen flex items-center justify-center">
        <span className="material-symbols-outlined animate-spin text-primary text-4xl">progress_activity</span>
      </div>
    )
  }

  return (
    <div className="bg-background-light dark:bg-background-dark min-h-screen text-text-primary-light dark:text-text-primary-dark">
      <Sidebar />
      <main className="ml-64 p-8 lg:p-12 transition-all duration-300">
        <div className="max-w-6xl mx-auto">
          {/* Breadcrumbs */}
          <nav className="flex items-center gap-2 text-sm font-bold text-text-secondary-light mb-8">
            <Link href="/jobs" className="hover:text-primary flex items-center gap-1 transition-colors">
              <span className="material-symbols-outlined text-base">history</span>
              작업 내역
            </Link>
            <span className="material-symbols-outlined text-base opacity-30">chevron_right</span>
            <span className="text-text-primary-light dark:text-text-primary-dark">{session?.session_name}</span>
          </nav>

          {/* Session Header */}
          <div className="flex items-end justify-between mb-8">
            <div>
              <h1 className="text-3xl font-black mb-2">{session?.session_name}</h1>
              <p className="text-sm text-text-secondary-light font-medium">
                총 {session?.total_documents}개의 파일 (완료: {session?.completed_documents}개)
              </p>
            </div>
            
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary-light text-lg">search</span>
              <input
                type="text"
                placeholder="파일명 검색..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2 bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-xl focus:ring-2 focus:ring-primary/20 outline-none w-64 text-sm"
              />
            </div>
          </div>

          {/* Jobs Table */}
          <div className="bg-surface-light dark:bg-surface-dark rounded-2xl border border-border-light dark:border-border-dark shadow-sm overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-background-light dark:bg-background-dark/50 border-b border-border-light dark:border-border-dark">
                  <th className="px-6 py-4 text-xs font-bold text-text-secondary-light uppercase tracking-wider">파일명</th>
                  <th className="px-6 py-4 text-xs font-bold text-text-secondary-light uppercase tracking-wider text-center">상태</th>
                  <th className="px-6 py-4 text-xs font-bold text-text-secondary-light uppercase tracking-wider text-center">페이지</th>
                  <th className="px-6 py-4 text-xs font-bold text-text-secondary-light uppercase tracking-wider text-right">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light dark:divide-border-dark">
                {filteredJobs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center text-text-secondary-light font-medium">
                      파일이 없습니다.
                    </td>
                  </tr>
                ) : (
                  filteredJobs.map(job => (
                    <tr key={job.job_id} className="hover:bg-primary/5 transition-colors">
                      <td className="px-6 py-5">
                        <div className="flex flex-col">
                          <button 
                            onClick={() => job.status !== 'uploaded' && router.push(`/editor/${job.job_id}`)}
                            className={`text-sm font-bold text-left ${job.status === 'uploaded' ? 'cursor-default' : 'hover:text-primary hover:underline'}`}
                          >
                            {job.original_filename}
                          </button>
                          {job.message && <span className="text-[10px] text-red-500 font-bold mt-1">{job.message}</span>}
                        </div>
                      </td>
                      <td className="px-6 py-5">
                        <div className="flex flex-col items-center gap-2">
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter ${getStatusBadge(job.status)}`}>
                            {job.status === 'completed' ? '완료' : job.status === 'failed' ? '실패' : job.status === 'processing' ? '처리중' : '대기중'}
                          </span>
                          {job.status === 'processing' && (
                            <div className="w-16 h-1 bg-background-light dark:bg-background-dark rounded-full overflow-hidden">
                              <div className="h-full bg-primary animate-pulse" style={{ width: `${job.progress_percent}%` }}></div>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-5 text-center font-bold text-sm">
                        {job.total_pages > 0 ? `${job.total_pages}p` : '-'}
                      </td>
                      <td className="px-6 py-5">
                        <div className="flex items-center justify-end gap-2">
                          {job.status === 'uploaded' ? (
                            <button 
                              onClick={() => handleStartOCR(job.job_id)}
                              className="px-3 py-1.5 bg-green-500/10 text-green-600 rounded-lg text-xs font-black hover:bg-green-500 hover:text-white transition-all"
                            >
                              OCR 시작
                            </button>
                          ) : (
                            <>
                              {job.status === 'completed' && job.pdf_url && (
                                <a 
                                  href={`${API_BASE_URL}${job.pdf_url}`} 
                                  download
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-blue-500/10 text-blue-600 rounded-lg text-xs font-bold hover:bg-blue-500 hover:text-white transition-all"
                                >
                                  <span className="material-symbols-outlined text-lg">download</span>
                                  다운로드
                                </a>
                              )}
                              {(job.status === 'completed' || job.status === 'failed') && (
                                <button 
                                  onClick={() => handleReprocess(job.job_id)}
                                  disabled={reprocessingJobs.has(job.job_id)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-orange-500/10 text-orange-600 rounded-lg text-xs font-bold hover:bg-orange-500 hover:text-white transition-all disabled:opacity-50"
                                >
                                  <span className="material-symbols-outlined text-lg">refresh</span>
                                  재실행
                                </button>
                              )}
                            </>
                          )}
                          <button 
                            onClick={() => handleDeleteJob(job.job_id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-red-500/10 text-red-600 rounded-lg text-xs font-bold hover:bg-red-500 hover:text-white transition-all"
                          >
                            <span className="material-symbols-outlined text-lg">delete</span>
                            삭제
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  )
}
