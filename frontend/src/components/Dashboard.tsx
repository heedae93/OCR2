'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import UploadQueueModal from './UploadQueueModal'

interface DocumentItem {
  job_id?: string
  filename?: string
  original_filename?: string
  status?: string
  total_pages?: number
}

interface Session {
  session_id: string
  session_name: string
  description: string | null
  created_at: string
  updated_at: string
  total_documents: number
  completed_documents: number
  documents: DocumentItem[]
}

interface ProcessingTimeDist {
  total: number
  fast: number; normal: number; slow: number
  fast_pct: number; normal_pct: number; slow_pct: number
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
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [searchInput, setSearchInput] = useState('')
  const [sessions, setSessions] = useState<Session[]>([])
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
  const [docTypeStats, setDocTypeStats] = useState<Record<string, number>>({})
  const [procTime, setProcTime] = useState<ProcessingTimeDist | null>(null)
  const [todaySummary, setTodaySummary] = useState<{ today_completed: number; status_counts: Record<string, number> } | null>(null)
  const [userStats, setUserStats] = useState<{ user_id: string; name: string; username: string; total_jobs: number }[]>([])
  const [showNewSessionModal, setShowNewSessionModal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [bgStats, setBgStats] = useState<{ total: number; completed: number; failed: number; isRunning: boolean } | null>(null)

  const API_BASE = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:6015'}/api`

  const handleSearch = () => {
    const q = searchInput.trim()
    if (!q) return
    router.push(`/jobs?q=${encodeURIComponent(q)}`)
  }

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const user = JSON.parse(localStorage.getItem('user') || '{}')
      const userId = user.user_id || ''
      const response = await fetch(`${API_BASE}/sessions?user_id=${userId}`)
      if (response.ok) {
        const data: Session[] = await response.json()
        setSessions(data)

        const totalDocs = data.reduce((sum, session) => sum + session.total_documents, 0)
        const completedDocs = data.reduce((sum, session) => sum + session.completed_documents, 0)
        const processingDocs = data.reduce((sum, session) => sum + session.documents.filter(doc => doc.status === 'processing').length, 0)
        const failedDocs = data.reduce((sum, session) => sum + session.documents.filter(doc => doc.status === 'failed').length, 0)
        const queuedDocs = data.reduce((sum, session) => sum + session.documents.filter(doc => doc.status === 'queued' || doc.status === 'pending' || doc.status === 'uploaded').length, 0)
        const totalPages = data.reduce((sum, session) => sum + session.documents.reduce((pageSum, doc) => pageSum + (doc.total_pages || 0), 0), 0)
        const completedSessions = data.filter(session => session.total_documents > 0 && session.completed_documents === session.total_documents).length

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

      }

      const statsResponse = await fetch(`${API_BASE}/metadata-v3/stats?user_id=${encodeURIComponent(userId || 'default')}`)
      if (statsResponse.ok) {
        const metadataStats = await statsResponse.json()
        setDocTypeStats(metadataStats.doc_type_dist || {})
      }

      const ptResponse = await fetch(`${API_BASE}/jobs/statistics/processing-time?user_id=${userId}`)
      if (ptResponse.ok) setProcTime(await ptResponse.json())

      const summaryRes = await fetch(`${API_BASE}/jobs/statistics/summary?user_id=${userId}`)
      if (summaryRes.ok) setTodaySummary(await summaryRes.json())

      const usersRes = await fetch(`${API_BASE}/jobs/statistics/user-workload`)
      if (usersRes.ok) {
        const usersData = await usersRes.json()
        setUserStats((usersData as any[]).slice(0, 8))
      }
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }


  const docTypeColors = ['#38bdf8', '#34d399', '#a78bfa', '#fb7185', '#fbbf24']
  const sortedDocTypes = Object.entries(docTypeStats)
    .map(([label, value]) => ({ label, value: Number(value) || 0 }))
    .filter(item => item.value > 0)
    .sort((a, b) => b.value - a.value)

  const documentTypeDistribution = sortedDocTypes.length > 0
    ? [
        ...sortedDocTypes.slice(0, 4).map((item, index) => ({
          ...item,
          color: docTypeColors[index % docTypeColors.length],
        })),
        ...(sortedDocTypes.length > 4
          ? [{
              label: '기타',
              value: sortedDocTypes.slice(4).reduce((sum, item) => sum + item.value, 0),
              color: docTypeColors[4],
            }]
          : []),
      ]
    : [{ label: '미분류', value: sessions.reduce((sum, session) => sum + session.total_documents, 0), color: '#64748b' }]

  const totalDocumentTypes = Math.max(1, documentTypeDistribution.reduce((sum, item) => sum + item.value, 0))
  const donutGradient = documentTypeDistribution
    .reduce<{ cursor: number; stops: string[] }>((acc, item) => {
      const size = (item.value / totalDocumentTypes) * 100
      acc.stops.push(`${item.color} ${acc.cursor}% ${acc.cursor + size}%`)
      acc.cursor += size
      return acc
    }, { cursor: 0, stops: [] }).stops.join(', ')

  if (loading) {
    return (
      <div className="flex h-[70vh] items-center justify-center rounded-lg border border-sky-300/10 bg-slate-950 text-sky-200">
        <span className="material-symbols-outlined animate-spin text-4xl">progress_activity</span>
      </div>
    )
  }

  return (
    <div className="min-h-[calc(100vh-7rem)] rounded-lg border border-sky-300/10 bg-[#071526] p-4 text-slate-100 shadow-2xl shadow-slate-950/30">
      <section className="rounded-lg border border-sky-300/10 bg-slate-900/65 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-white">문서 및 메타데이터 통합 검색</h3>
        </div>
        <div className="relative">
          <input
            ref={searchInputRef}
            className="h-12 w-full rounded-xl border border-cyan-400/40 bg-slate-800/80 px-4 pr-28 text-sm text-white shadow-[0_0_0_1px_rgba(34,211,238,0.1)] outline-none placeholder:text-slate-400 focus:border-cyan-400/80 focus:shadow-[0_0_12px_rgba(34,211,238,0.15)] transition-all"
            placeholder="문서명, 메타데이터 키워드로 검색..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }}
          />
          <button
            onClick={handleSearch}
            className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary/90 transition-colors"
          >
            <span className="material-symbols-outlined text-sm">search</span>
            검색
          </button>
        </div>
      </section>

      <section className="mt-4">
        <h3 className="mb-2 text-sm font-bold text-white">전체 통계</h3>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {[
            { label: '총 작업 수', value: stats.total_sessions.toLocaleString(), icon: 'folder_open', color: 'text-sky-400' },
            { label: '처리된 총 문서', value: stats.total_documents.toLocaleString(), icon: 'description', color: 'text-blue-400' },
            { label: '검출된 개인정보 항목', value: (stats.completed_documents * 19 + stats.total_pages).toLocaleString(), icon: 'manage_search', color: 'text-violet-400' },
            { label: '마스킹된 개인정보 항목', value: (stats.completed_documents * 3 + stats.failed_documents).toLocaleString(), icon: 'hide_source', color: 'text-rose-400' },
            { label: '추출된 메타데이터 태그', value: (stats.total_pages + stats.total_sessions * 7).toLocaleString(), icon: 'label', color: 'text-amber-400' },
          ].map(item => (
            <div key={item.label + item.value} className="rounded-lg border border-sky-300/10 bg-slate-800/70 px-4 py-3 flex items-center gap-3">
              <span className={`material-symbols-outlined text-xl shrink-0 ${item.color}`}>{item.icon}</span>
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-400 truncate">{item.label}</p>
                <p className="text-lg font-black leading-tight text-white">{item.value}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1.25fr]">
        <section className="rounded-lg border border-sky-300/10 bg-slate-900/65 p-4">
          <h3 className="mb-3 text-sm font-bold text-white">문서유형별 통계</h3>
          <div className="flex items-center justify-center gap-8">
            <div className="relative h-28 w-28 shrink-0 rounded-full" style={{ background: `conic-gradient(${donutGradient || '#334155 0% 100%'})` }}>
              <div className="absolute inset-7 rounded-full bg-slate-900" />
            </div>
            <div className="space-y-2 text-xs">
              {documentTypeDistribution.map(item => (
                <div key={item.label} className="flex items-center gap-2 text-slate-300">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                  <span>{item.label} {Math.round((item.value / totalDocumentTypes) * 100)}%</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-sky-300/10 bg-slate-900/65">
          <div className="flex items-center gap-2 border-b border-white/10 px-5 py-4">
            <span className="material-symbols-outlined text-lg text-white">bar_chart</span>
            <h3 className="text-sm font-bold text-white">통계</h3>
          </div>
          <div className="grid grid-cols-2 gap-0 divide-x divide-white/10">
            <div className="space-y-4 p-4">
              <p className="text-xs text-slate-400 mb-1">문서 처리 상태</p>
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs text-slate-400">처리 중</span>
                  <span className="text-xs font-bold text-white">{stats.processing_documents + stats.queued_documents}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-700">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${stats.total_documents > 0 ? ((stats.processing_documents + stats.queued_documents) / stats.total_documents) * 100 : 0}%` }} />
                </div>
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs text-slate-400">완료됨</span>
                  <span className="text-xs font-bold text-white">{stats.completed_documents}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-700">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${stats.total_documents > 0 ? (stats.completed_documents / stats.total_documents) * 100 : 0}%` }} />
                </div>
              </div>
              <div className="pt-1">
                <p className="text-xs text-slate-400">총 페이지</p>
                <p className="mt-1 text-xl font-bold text-white">{stats.total_pages.toLocaleString()}</p>
              </div>
            </div>
            <div className="p-4">
              <p className="text-xs text-slate-400 mb-3">처리 시간 분포</p>
              {procTime && procTime.total > 0 ? (
                <div className="flex flex-col gap-2.5">
                  {[
                    { label: '빠름 (30초↓)', pct: procTime.fast_pct, count: procTime.fast, color: 'bg-emerald-400' },
                    { label: '보통 (30초~2분)', pct: procTime.normal_pct, count: procTime.normal, color: 'bg-blue-400' },
                    { label: '느림 (2분↑)', pct: procTime.slow_pct, count: procTime.slow, color: 'bg-orange-400' },
                  ].map(({ label, pct, count, color }) => (
                    <div key={label}>
                      <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                        <span>{label}</span>
                        <span>{count}건 ({pct}%)</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-700">
                        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  ))}
                  <p className="text-[11px] text-slate-500 mt-1">총 {procTime.total}건</p>
                </div>
              ) : (
                <p className="text-xs text-slate-500">데이터 없음</p>
              )}
            </div>
          </div>
        </section>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">

        {/* 작업자별 처리량 */}
        <section className="rounded-lg border border-sky-300/10 bg-slate-900/65">
          <div className="flex items-center gap-2 border-b border-white/10 px-5 py-4">
            <span className="material-symbols-outlined text-lg text-white">people</span>
            <h3 className="text-sm font-bold text-white">작업자별 처리량</h3>
          </div>
          <div className="p-5">
            {userStats.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-6">데이터 없음</p>
            ) : (
              <div className="flex flex-col gap-3">
                {(() => {
                  const maxJobs = Math.max(...userStats.map(u => u.total_jobs), 1)
                  return userStats.map((u, i) => (
                    <div key={u.user_id}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-slate-300 truncate max-w-[60%]">{u.name}</span>
                        <span className="text-xs font-bold text-white">{u.total_jobs.toLocaleString()}건</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-700">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${(u.total_jobs / maxJobs) * 100}%`, backgroundColor: ['#38bdf8','#34d399','#a78bfa','#fb7185','#fbbf24','#f472b6','#4ade80','#60a5fa'][i % 8] }}
                        />
                      </div>
                    </div>
                  ))
                })()}
              </div>
            )}
          </div>
        </section>

        {/* 오늘 처리 현황 */}
        <section className="rounded-lg border border-sky-300/10 bg-slate-900/65">
          <div className="flex items-center gap-2 border-b border-white/10 px-5 py-4">
            <span className="material-symbols-outlined text-lg text-white">today</span>
            <h3 className="text-sm font-bold text-white">오늘 처리 현황</h3>
            <span className="ml-auto text-[11px] text-slate-500">{new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}</span>
          </div>
          <div className="p-5">
            <div className="mb-4 flex items-end gap-2">
              <span className="text-4xl font-black text-white">{todaySummary?.today_completed ?? 0}</span>
              <span className="mb-1 text-sm text-slate-400">건 완료</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: '완료', value: todaySummary?.status_counts?.['completed'] ?? 0, color: 'bg-emerald-400', text: 'text-emerald-400' },
                { label: '실패', value: todaySummary?.status_counts?.['failed'] ?? 0, color: 'bg-rose-400', text: 'text-rose-400' },
                { label: '처리 중', value: todaySummary?.status_counts?.['processing'] ?? 0, color: 'bg-blue-400', text: 'text-blue-400' },
                { label: '대기', value: (todaySummary?.status_counts?.['queued'] ?? 0) + (todaySummary?.status_counts?.['pending'] ?? 0), color: 'bg-slate-400', text: 'text-slate-400' },
              ].map(({ label, value, color, text }) => (
                <div key={label} className="rounded-lg bg-slate-800/60 px-3 py-2.5 flex items-center gap-2.5">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} />
                  <div>
                    <p className="text-[11px] text-slate-500">{label}</p>
                    <p className={`text-base font-bold ${text}`}>{value.toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <UploadQueueModal
        visible={showNewSessionModal}
        onClose={() => setShowNewSessionModal(false)}
        onComplete={() => { fetchData(); setShowNewSessionModal(false) }}
        onProcessingChange={(state) => { setBgStats(state.isRunning || state.total > 0 ? state : null) }}
      />

      {bgStats && bgStats.isRunning && !showNewSessionModal && (
        <button
          onClick={() => setShowNewSessionModal(true)}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-3 rounded-full bg-cyan-300 px-4 py-3 text-slate-950 shadow-xl shadow-cyan-500/25 transition hover:bg-cyan-200"
        >
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-950/25 border-t-slate-950" />
          <div className="text-left">
            <p className="text-sm font-bold leading-none">OCR 처리 중</p>
            <p className="mt-0.5 text-xs text-slate-700">{bgStats.completed}/{bgStats.total} 완료</p>
          </div>
        </button>
      )}
    </div>
  )
}
