'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import UploadQueueModal from './UploadQueueModal'

interface Session {
  session_id: string
  session_name: string
  description: string | null
  created_at: string
  updated_at: string
  total_documents: number
  completed_documents: number
  documents: any[]
}

interface Stats {
  total_sessions: number
  completed_sessions: number
  total_documents: number
  completed_documents: number
  processing_documents: number
  failed_documents: number
  queued_documents: number
  total_pages: number
  session_rate: number
  doc_rate: number
}

export default function Dashboard() {
  const router = useRouter()
  const [, setSessions] = useState<Session[]>([])
  const [stats, setStats] = useState<Stats>({
    total_sessions: 0,
    completed_sessions: 0,
    total_documents: 0,
    completed_documents: 0,
    processing_documents: 0,
    failed_documents: 0,
    queued_documents: 0,
    total_pages: 0,
    session_rate: 0,
    doc_rate: 0,
  })
  const [recentSessions, setRecentSessions] = useState<Session[]>([])
  const [showNewSessionModal, setShowNewSessionModal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [bgStats, setBgStats] = useState<{ total: number; completed: number; failed: number; isRunning: boolean } | null>(null)

  const API_BASE = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:6015'}/api`

  useEffect(() => { fetchData() }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const user = JSON.parse(localStorage.getItem('user') || '{}')
      const response = await fetch(`${API_BASE}/sessions?user_id=${user.user_id || ''}`)
      if (response.ok) {
        const data: Session[] = await response.json()
        setSessions(data)

        const totalDocs        = data.reduce((s, g) => s + g.total_documents, 0)
        const completedDocs    = data.reduce((s, g) => s + g.completed_documents, 0)
        const processingDocs   = data.reduce((s, g) => s + g.documents.filter(d => d.status === 'processing').length, 0)
        const failedDocs       = data.reduce((s, g) => s + g.documents.filter(d => d.status === 'failed').length, 0)
        const queuedDocs       = data.reduce((s, g) => s + g.documents.filter(d => d.status === 'queued').length, 0)
        const totalPages       = data.reduce((s, g) => s + g.documents.reduce((p, d) => p + (d.total_pages || 0), 0), 0)
        const completedSessions = data.filter(g => g.total_documents > 0 && g.completed_documents === g.total_documents).length

        setStats({
          total_sessions: data.length,
          completed_sessions: completedSessions,
          total_documents: totalDocs,
          completed_documents: completedDocs,
          processing_documents: processingDocs,
          failed_documents: failedDocs,
          queued_documents: queuedDocs,
          total_pages: totalPages,
          session_rate: data.length > 0 ? (completedSessions / data.length) * 100 : 0,
          doc_rate: totalDocs > 0 ? (completedDocs / totalDocs) * 100 : 0,
        })

        const sorted = [...data].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        setRecentSessions(sorted.slice(0, 5))
      }
    } catch (error) {
      console.error('Failed to fetch data:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)
    if (diffMins < 1) return '방금 전'
    if (diffMins < 60) return `${diffMins}분 전`
    if (diffHours < 24) return `${diffHours}시간 전`
    if (diffDays < 7) return `${diffDays}일 전`
    return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <span className="material-symbols-outlined animate-spin text-primary text-4xl">progress_activity</span>
      </div>
    )
  }

  return (
    <div className="space-y-5">

      {/* 상단 통계 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: '총 작업', value: stats.total_sessions, icon: 'folder_open', color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-950/40' },
          { label: '총 문서', value: stats.total_documents, icon: 'description', color: 'text-violet-500', bg: 'bg-violet-50 dark:bg-violet-950/40' },
          { label: '완료 문서', value: stats.completed_documents, icon: 'check_circle', color: 'text-green-500', bg: 'bg-green-50 dark:bg-green-950/40' },
        ].map(({ label, value, icon, color, bg }) => (
          <div key={label} className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark p-4 flex items-center gap-3">
            <div className={`shrink-0 rounded-lg p-2 ${bg}`}>
              <span className={`material-symbols-outlined text-xl ${color}`}>{icon}</span>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{label}</p>
              <p className="text-xl font-bold text-text-primary-light dark:text-text-primary-dark">{value}</p>
            </div>
          </div>
        ))}

        {/* 완료율 카드 — 작업/문서 두 줄 */}
        <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark p-4 flex items-center gap-3">
          <div className="shrink-0 rounded-lg p-2 bg-amber-50 dark:bg-amber-950/40">
            <span className="material-symbols-outlined text-xl text-amber-500">trending_up</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mb-1.5">처리 완료율</p>
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-text-secondary-light dark:text-text-secondary-dark">작업</span>
                <span className="text-sm font-bold text-amber-500">{stats.session_rate.toFixed(0)}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-text-secondary-light dark:text-text-secondary-dark">문서</span>
                <span className="text-sm font-bold text-amber-500">{stats.doc_rate.toFixed(0)}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 작업 목록 + 상태별 통계 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* 최근 작업 목록 */}
        <div className="lg:col-span-2 bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark overflow-hidden">
          <div className="px-5 py-3 border-b border-border-light dark:border-border-dark flex items-center gap-2">
            <span className="material-symbols-outlined text-lg text-text-secondary-light dark:text-text-secondary-dark">schedule</span>
            <h3 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">최근 작업</h3>
            <button
              onClick={() => router.push('/ocr-work')}
              className="ml-auto flex items-center gap-1 px-2.5 py-1 bg-primary/10 hover:bg-primary/20 text-primary text-xs font-semibold rounded-lg transition-colors"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              작업 시작
            </button>
          </div>
          <div className="divide-y divide-border-light dark:divide-border-dark max-h-72 overflow-y-auto">
            {recentSessions.length === 0 ? (
              <div className="p-10 text-center text-sm text-text-secondary-light dark:text-text-secondary-dark">
                작업이 없습니다. 새 작업을 시작하세요!
              </div>
            ) : (
              recentSessions.map((session) => {
                const completed  = session.completed_documents
                const processing = session.documents.filter(d => d.status === 'processing').length
                const failed     = session.documents.filter(d => d.status === 'failed').length
                const queued     = session.documents.filter(d => d.status === 'queued').length
                const total      = session.total_documents
                const pct        = total > 0 ? Math.round((completed / total) * 100) : 0

                return (
                  <div
                    key={session.session_id}
                    className="px-5 py-3.5 hover:bg-background-light dark:hover:bg-background-dark cursor-pointer transition-colors"
                    onClick={() => {
                      if (session.documents.length > 0) router.push(`/editor/${session.documents[0].job_id}`)
                    }}
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="material-symbols-outlined text-base text-primary shrink-0">folder_open</span>
                        <span className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark truncate">{session.session_name}</span>
                      </div>
                      <span className="shrink-0 text-xs text-text-secondary-light dark:text-text-secondary-dark">{formatDate(session.updated_at)}</span>
                    </div>

                    {/* 문서 총 갯수 + 상태별 배지 */}
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">총 {total}개</span>
                      {completed  > 0 && <span className="px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400">완료 {completed}</span>}
                      {processing > 0 && <span className="px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">처리 중 {processing}</span>}
                      {failed     > 0 && <span className="px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400">실패 {failed}</span>}
                      {queued     > 0 && <span className="px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">대기 {queued}</span>}
                    </div>

                    {/* 진행률 바 */}
                    {total > 0 && (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-black/5 dark:bg-white/10 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-green-500 transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-[11px] text-text-secondary-light dark:text-text-secondary-dark shrink-0">{pct}%</span>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* 상태별 통계 */}
        <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark overflow-hidden">
          <div className="px-5 py-3 border-b border-border-light dark:border-border-dark flex items-center gap-2">
            <span className="material-symbols-outlined text-lg text-text-secondary-light dark:text-text-secondary-dark">bar_chart</span>
            <h3 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">상태별 현황</h3>
          </div>
          <div className="p-5 space-y-4">
            {[
              { label: '완료', count: stats.completed_documents,  color: 'bg-green-500', textColor: 'text-green-600 dark:text-green-400' },
              { label: '처리 중', count: stats.processing_documents, color: 'bg-blue-500',  textColor: 'text-blue-600 dark:text-blue-400' },
              { label: '실패', count: stats.failed_documents,     color: 'bg-red-500',   textColor: 'text-red-600 dark:text-red-400' },
              { label: '대기 중', count: stats.queued_documents,    color: 'bg-gray-400',  textColor: 'text-gray-500 dark:text-gray-400' },
            ].map(({ label, count, color, textColor }) => {
              const pct = stats.total_documents > 0 ? (count / stats.total_documents) * 100 : 0
              return (
                <div key={label}>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{label}</span>
                    <span className={`text-xs font-semibold ${textColor}`}>{count}개</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-black/5 dark:bg-white/10 overflow-hidden">
                    <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}

            <div className="pt-3 border-t border-border-light dark:border-border-dark flex justify-between items-center">
              <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">총 처리 페이지</span>
              <span className="text-base font-bold text-text-primary-light dark:text-text-primary-dark">{stats.total_pages.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>

      <UploadQueueModal
        visible={showNewSessionModal}
        onClose={() => setShowNewSessionModal(false)}
        onComplete={() => { fetchData(); setShowNewSessionModal(false) }}
        onProcessingChange={(s) => { setBgStats(s.isRunning || s.total > 0 ? s : null) }}
      />

      {bgStats && bgStats.isRunning && !showNewSessionModal && (
        <button
          onClick={() => setShowNewSessionModal(true)}
          className="fixed bottom-6 right-6 flex items-center gap-3 px-4 py-3 bg-primary hover:bg-primary/90 text-white rounded-full shadow-xl z-40 transition-colors"
        >
          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          <div className="text-left">
            <p className="text-sm font-semibold leading-none">OCR 처리 중</p>
            <p className="text-xs text-white/70 mt-0.5">{bgStats.completed}/{bgStats.total} 완료</p>
          </div>
        </button>
      )}
    </div>
  )
}
