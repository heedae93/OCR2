'use client'

import { useState, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'
import { API_BASE_URL } from '@/lib/api'

interface Summary {
  total_jobs: number
  status_counts: { [key: string]: number }
  total_pages_processed: number
  average_processing_time_seconds: number
  storage_used_mb: number
  today_completed: number
}

interface Trend {
  labels: string[]
  completed: number[]
  failed: number[]
}

interface AccuracyDist {
  total: number
  high: number; mid: number; low: number
  high_pct: number; mid_pct: number; low_pct: number
}

interface FileTypeDist {
  total: number
  counts: { [key: string]: number }
}

interface ProcessingTimeDist {
  total: number
  fast: number; normal: number; slow: number
  fast_pct: number; normal_pct: number; slow_pct: number
}

interface MonthlyPages {
  labels: string[]
  monthly: number[]
  cumulative: number[]
}

interface SessionStat {
  session_id: string
  session_name: string
  total: number
  completed: number
  failed: number
  completion_rate: number
  last_activity: string | null
}

type Period = 'daily' | 'weekly' | 'monthly'

export default function StatisticsPage() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [trend, setTrend] = useState<Trend | null>(null)
  const [period, setPeriod] = useState<Period>('daily')
  const [accuracy, setAccuracy] = useState<AccuracyDist | null>(null)
  const [fileTypes, setFileTypes] = useState<FileTypeDist | null>(null)
  const [procTime, setProcTime] = useState<ProcessingTimeDist | null>(null)
  const [monthlyPages, setMonthlyPages] = useState<MonthlyPages | null>(null)
  const [sessions, setSessions] = useState<SessionStat[]>([])
  const [loading, setLoading] = useState(true)
  const [sessionPage, setSessionPage] = useState(0)
  const [sessionPageSize, setSessionPageSize] = useState(10)

  const getUserId = () => {
    try { return JSON.parse(localStorage.getItem('user') || '{}').user_id || '' } catch { return '' }
  }

  useEffect(() => {
    const userId = getUserId()
    const base = `${API_BASE_URL}/api/jobs/statistics`
    Promise.all([
      fetch(`${base}/summary?user_id=${userId}`).then(r => r.json()),
      fetch(`${base}/accuracy?user_id=${userId}`).then(r => r.json()),
      fetch(`${base}/file-types?user_id=${userId}`).then(r => r.json()),
      fetch(`${base}/processing-time?user_id=${userId}`).then(r => r.json()),
      fetch(`${base}/monthly-pages?user_id=${userId}`).then(r => r.json()),
      fetch(`${base}/sessions?user_id=${userId}`).then(r => r.json()),
    ]).then(([s, acc, ft, pt, mp, sess]) => {
      setSummary(s)
      setAccuracy(acc)
      setFileTypes(ft)
      setProcTime(pt)
      setMonthlyPages(mp)
      setSessions(sess)
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    const userId = getUserId()
    fetch(`${API_BASE_URL}/api/jobs/statistics/trend?user_id=${userId}&period=${period}`)
      .then(r => r.json()).then(setTrend)
  }, [period])

  const formatDuration = (s: number) => {
    if (!s) return '-'
    if (s < 60) return `${s.toFixed(1)}초`
    return `${Math.floor(s / 60)}분 ${Math.floor(s % 60)}초`
  }

  const formatDate = (s: string | null) => {
    if (!s) return '-'
    return new Date(s).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
  }

  const maxVal = trend ? Math.max(...trend.completed, ...trend.failed, 1) : 1
  const BAR_HEIGHT = 160

  const summaryCards = summary ? [
    { label: '오늘 처리', value: summary.today_completed, icon: 'today', color: 'text-primary' },
    { label: '총 페이지', value: `${summary.total_pages_processed}p`, icon: 'description', color: 'text-purple-500' },
    { label: '평균 처리시간', value: formatDuration(summary.average_processing_time_seconds), icon: 'timer', color: 'text-orange-500' },
    { label: '사용 용량', value: `${summary.storage_used_mb} MB`, icon: 'storage', color: 'text-teal-500' },
  ] : []

  // File type colors
  const ftColors: Record<string, string> = {
    pdf: 'bg-red-400', png: 'bg-blue-400', jpg: 'bg-blue-400', jpeg: 'bg-blue-400',
    tiff: 'bg-purple-400', unknown: 'bg-gray-400'
  }
  const ftLabels: Record<string, string> = {
    pdf: 'PDF', png: 'PNG', jpg: 'JPG', jpeg: 'JPG', tiff: 'TIFF', unknown: '기타'
  }

  const maxMonthly = monthlyPages ? Math.max(...monthlyPages.monthly, 1) : 1
  const maxCumul = monthlyPages ? Math.max(...monthlyPages.cumulative, 1) : 1
  const LINE_H = 120

  return (
    <div className="bg-slate-50 dark:bg-slate-50 min-h-screen">
      <Sidebar />
      <main className="flex-1 ml-64 mt-14 p-6 lg:p-10">
        <div className="w-full max-w-6xl mx-auto flex flex-col gap-8">
          <h1 className="text-3xl font-bold text-text-primary-light">통계</h1>

          {/* Summary Cards */}
          {loading ? (
            <div className="flex items-center justify-center p-16">
              <span className="material-symbols-outlined animate-spin text-primary text-4xl">progress_activity</span>
            </div>
          ) : (
            <>
              {summary && (() => {
                const total = summary.total_jobs
                const completed = summary.status_counts['completed'] ?? 0
                const failed = summary.status_counts['failed'] ?? 0
                const other = Math.max(0, total - completed - failed)
                const r = 56, cx = 80, cy = 80
                const circ = 2 * Math.PI * r
                const segs = [
                  { value: completed, color: '#22c55e', label: '완료' },
                  { value: failed,    color: '#ef4444', label: '실패' },
                  { value: other,     color: '#94a3b8', label: '기타' },
                ].filter(s => s.value > 0)
                let acc = 0
                const arcs = segs.map(s => {
                  const dash = total > 0 ? (s.value / total) * circ : 0
                  const offset = circ - acc
                  acc += dash
                  return { ...s, dash, offset, pct: total > 0 ? Math.round(s.value / total * 100) : 0 }
                })
                return (
                  <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark p-6 flex flex-col sm:flex-row gap-6">
                    {/* 도넛 차트 */}
                    <div className="flex flex-col items-center gap-4 shrink-0 w-[260px]">
                      <div className="relative w-[160px] h-[160px]">
                        <svg width="160" height="160" className="-rotate-90">
                          {total === 0 ? (
                            <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e2e8f0" strokeWidth="18" />
                          ) : arcs.map((arc, i) => (
                            <circle key={i} cx={cx} cy={cy} r={r} fill="none"
                              stroke={arc.color} strokeWidth="18"
                              strokeDasharray={`${arc.dash} ${circ - arc.dash}`}
                              strokeDashoffset={arc.offset}
                            />
                          ))}
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-3xl font-bold text-text-primary-light">{total}</span>
                          <span className="text-xs text-text-secondary-light">전체</span>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5 w-full">
                        <div className="flex items-center justify-between text-xs pb-1.5 border-b border-border-light">
                          <div className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-full shrink-0 bg-slate-400" />
                            <span className="text-text-secondary-light">전체</span>
                          </div>
                          <span className="font-bold text-text-primary-light tabular-nums">{total}건</span>
                        </div>
                        {arcs.map((arc, i) => (
                          <div key={i} className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-1.5">
                              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: arc.color }} />
                              <span className="text-text-secondary-light">{arc.label}</span>
                            </div>
                            <span className="font-semibold text-text-primary-light tabular-nums">{arc.value}건 ({arc.pct}%)</span>
                          </div>
                        ))}
                        {total === 0 && <p className="text-xs text-center text-text-secondary-light">데이터 없음</p>}
                      </div>
                    </div>

                    {/* 구분선 */}
                    <div className="hidden sm:block w-px bg-border-light dark:bg-border-dark self-stretch" />

                    {/* 나머지 수치 카드들 */}
                    <div className="grid grid-cols-2 gap-3 content-center shrink-0 w-[340px]">
                      {summaryCards.map(({ label, value, icon, color }) => (
                        <div key={label} className="flex items-center gap-3 p-3 rounded-xl bg-white dark:bg-white border border-border-light dark:border-border-dark shadow-sm">
                          <span className={`material-symbols-outlined text-2xl ${color}`}>{icon}</span>
                          <div>
                            <div className="text-lg font-bold text-text-primary-light dark:text-text-primary-dark leading-tight">{value}</div>
                            <div className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{label}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}

              {/* Row: Accuracy + File Types + Processing Time */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                {/* OCR 정확도 분포 */}
                <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark p-6 flex flex-col gap-4">
                  <h2 className="text-base font-semibold text-text-primary-light">OCR 정확도 분포</h2>
                  {accuracy && accuracy.total > 0 ? (
                    <div className="flex flex-col gap-3">
                      {[
                        { label: '우수 (90%+)', pct: accuracy.high_pct, count: accuracy.high, color: 'bg-green-500' },
                        { label: '보통 (70~90%)', pct: accuracy.mid_pct, count: accuracy.mid, color: 'bg-yellow-400' },
                        { label: '미흡 (70% 미만)', pct: accuracy.low_pct, count: accuracy.low, color: 'bg-red-400' },
                      ].map(({ label, pct, count, color }) => (
                        <div key={label} className="flex flex-col gap-1">
                          <div className="flex justify-between text-xs text-text-secondary-light dark:text-text-secondary-dark">
                            <span>{label}</span>
                            <span>{count}건 ({pct}%)</span>
                          </div>
                          <div className="h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                            <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      ))}
                      <div className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-1">총 {accuracy.total}건</div>
                    </div>
                  ) : (
                    <div className="text-sm text-text-secondary-light dark:text-text-secondary-dark">데이터 없음</div>
                  )}
                </div>

                {/* 파일 유형별 현황 */}
                <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark p-6 flex flex-col gap-4">
                  <h2 className="text-base font-semibold text-text-primary-light">파일 유형별 현황</h2>
                  {fileTypes && fileTypes.total > 0 ? (
                    <div className="flex flex-col gap-3">
                      {Object.entries(fileTypes.counts).map(([ft, cnt]) => {
                        const pct = fileTypes.total > 0 ? Math.round(cnt / fileTypes.total * 100) : 0
                        const color = ftColors[ft] || 'bg-gray-400'
                        const label = ftLabels[ft] || ft.toUpperCase()
                        return (
                          <div key={ft} className="flex flex-col gap-1">
                            <div className="flex justify-between text-xs text-text-secondary-light dark:text-text-secondary-dark">
                              <span>{label}</span>
                              <span>{cnt}건 ({pct}%)</span>
                            </div>
                            <div className="h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                              <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        )
                      })}
                      <div className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-1">총 {fileTypes.total}건</div>
                    </div>
                  ) : (
                    <div className="text-sm text-text-secondary-light dark:text-text-secondary-dark">데이터 없음</div>
                  )}
                </div>

                {/* 처리 시간 분포 */}
                <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark p-6 flex flex-col gap-4">
                  <h2 className="text-base font-semibold text-text-primary-light">처리 시간 분포</h2>
                  {procTime && procTime.total > 0 ? (
                    <div className="flex flex-col gap-3">
                      {[
                        { label: '빠름 (30초 미만)', pct: procTime.fast_pct, count: procTime.fast, color: 'bg-green-500' },
                        { label: '보통 (30초~2분)', pct: procTime.normal_pct, count: procTime.normal, color: 'bg-blue-400' },
                        { label: '느림 (2분 이상)', pct: procTime.slow_pct, count: procTime.slow, color: 'bg-orange-400' },
                      ].map(({ label, pct, count, color }) => (
                        <div key={label} className="flex flex-col gap-1">
                          <div className="flex justify-between text-xs text-text-secondary-light dark:text-text-secondary-dark">
                            <span>{label}</span>
                            <span>{count}건 ({pct}%)</span>
                          </div>
                          <div className="h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                            <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      ))}
                      <div className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-1">총 {procTime.total}건</div>
                    </div>
                  ) : (
                    <div className="text-sm text-text-secondary-light dark:text-text-secondary-dark">데이터 없음</div>
                  )}
                </div>
              </div>

              {/* 월별 누적 처리량 */}
              <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-semibold text-text-primary-light">월별 누적 처리량</h2>
                  <div className="flex gap-4">
                    <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-primary/60" /><span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">월 처리량</span></div>
                    <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-primary" /><span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">누적</span></div>
                  </div>
                </div>
                {monthlyPages && monthlyPages.labels.length > 0 ? (
                  <div className="overflow-x-auto">
                    <div style={{ minWidth: monthlyPages.labels.length * 60 }}>
                      <div className="relative" style={{ height: LINE_H + 30 }}>
                        {/* Monthly bars */}
                        <div className="absolute bottom-6 left-0 right-0 flex items-end gap-2" style={{ height: LINE_H }}>
                          {monthlyPages.labels.map((label, i) => {
                            const bh = Math.round((monthlyPages.monthly[i] / maxMonthly) * LINE_H)
                            return (
                              <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
                                <div className="absolute bottom-full mb-1 hidden group-hover:flex flex-col items-center z-10">
                                  <div className="bg-gray-800 dark:bg-gray-700 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                                    {label}: {monthlyPages.monthly[i]}p (누적 {monthlyPages.cumulative[i]}p)
                                  </div>
                                  <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800 dark:border-t-gray-700" />
                                </div>
                                <div className="w-full" style={{ height: LINE_H }}>
                                  <div className="w-full bg-primary/50 hover:bg-primary/70 rounded-t transition-all duration-300 absolute bottom-0" style={{ height: bh || 1 }} />
                                </div>
                              </div>
                            )
                          })}
                        </div>

                        {/* Cumulative line (SVG overlay) */}
                        <svg className="absolute bottom-6 left-0 right-0 pointer-events-none" style={{ height: LINE_H, width: '100%' }}>
                          <polyline
                            fill="none"
                            stroke="var(--color-primary, #6366f1)"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            points={monthlyPages.cumulative.map((v, i) => {
                              const x = (i + 0.5) / monthlyPages.labels.length * 100
                              const y = (1 - v / maxCumul) * LINE_H
                              return `${x}%,${y}`
                            }).join(' ')}
                          />
                          {monthlyPages.cumulative.map((v, i) => {
                            const x = (i + 0.5) / monthlyPages.labels.length * 100
                            const y = (1 - v / maxCumul) * LINE_H
                            return <circle key={i} cx={`${x}%`} cy={y} r="3" fill="var(--color-primary, #6366f1)" />
                          })}
                        </svg>

                        {/* X labels */}
                        <div className="absolute bottom-0 left-0 right-0 flex gap-2" style={{ height: 20 }}>
                          {monthlyPages.labels.map((label, i) => (
                            <div key={i} className="flex-1 text-center" style={{ fontSize: 10 }}>
                              <span className="text-text-secondary-light dark:text-text-secondary-dark">{label}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-text-secondary-light dark:text-text-secondary-dark">데이터 없음</div>
                )}
              </div>

              {/* 세션별 작업 현황 */}
              <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark overflow-hidden">
                <div className="px-6 py-4 border-b border-border-light dark:border-border-dark flex items-center justify-between gap-4">
                  <h2 className="text-lg font-semibold text-text-primary-light">
                    세션별 작업 현황
                    <span className="ml-2 text-sm font-normal text-text-secondary-light dark:text-text-secondary-dark">
                      ({sessions.length}개)
                    </span>
                  </h2>
                  <select
                    value={sessionPageSize}
                    onChange={e => { setSessionPageSize(Number(e.target.value)); setSessionPage(0); }}
                    className="h-8 px-2 text-xs bg-background-light dark:bg-background-dark border border-border-light dark:border-border-dark rounded-lg text-text-secondary-light dark:text-text-secondary-dark outline-none"
                  >
                    {[10, 20, 50].map(n => <option key={n} value={n}>{n}개씩</option>)}
                  </select>
                </div>
                {sessions.length > 0 ? (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-background-light dark:bg-background-dark">
                          <tr>
                            {['세션명', '총 문서', '완료', '실패', '완료율', '마지막 작업'].map(h => (
                              <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border-light dark:divide-border-dark">
                          {sessions.slice(sessionPage * sessionPageSize, (sessionPage + 1) * sessionPageSize).map(s => (
                            <tr key={s.session_id} className="hover:bg-background-light dark:hover:bg-background-dark transition-colors">
                              <td className="px-5 py-3 text-sm font-medium text-text-primary-light dark:text-text-primary-dark">{s.session_name}</td>
                              <td className="px-5 py-3 text-sm text-text-secondary-light dark:text-text-secondary-dark">{s.total}</td>
                              <td className="px-5 py-3 text-sm text-green-600 dark:text-green-400 font-medium">{s.completed}</td>
                              <td className="px-5 py-3 text-sm text-red-500 dark:text-red-400 font-medium">{s.failed}</td>
                              <td className="px-5 py-3">
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden min-w-[60px]">
                                    <div className="h-full rounded-full bg-green-500 transition-all duration-500" style={{ width: `${s.completion_rate}%` }} />
                                  </div>
                                  <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark whitespace-nowrap">{s.completion_rate}%</span>
                                </div>
                              </td>
                              <td className="px-5 py-3 text-sm text-text-secondary-light dark:text-text-secondary-dark whitespace-nowrap">{formatDate(s.last_activity)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {Math.ceil(sessions.length / sessionPageSize) > 1 && (
                      <div className="flex items-center justify-between px-5 py-3 border-t border-border-light dark:border-border-dark">
                        <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                          {sessionPage * sessionPageSize + 1}–{Math.min((sessionPage + 1) * sessionPageSize, sessions.length)} / {sessions.length}개
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setSessionPage(p => Math.max(0, p - 1))}
                            disabled={sessionPage === 0}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border-light dark:border-border-dark text-text-secondary-light dark:text-text-secondary-dark hover:text-primary hover:border-primary/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          >
                            <span className="material-symbols-outlined text-base leading-none">chevron_left</span>
                          </button>
                          {Array.from({ length: Math.ceil(sessions.length / sessionPageSize) }, (_, i) => i)
                            .filter(i => Math.abs(i - sessionPage) <= 2)
                            .map(i => (
                              <button
                                key={i}
                                onClick={() => setSessionPage(i)}
                                className={`h-8 min-w-8 rounded-lg px-2.5 text-xs font-medium transition-colors ${i === sessionPage ? 'bg-primary text-white' : 'border border-border-light dark:border-border-dark text-text-secondary-light dark:text-text-secondary-dark hover:text-primary hover:border-primary/40'}`}
                              >
                                {i + 1}
                              </button>
                            ))}
                          <button
                            onClick={() => setSessionPage(p => Math.min(Math.ceil(sessions.length / sessionPageSize) - 1, p + 1))}
                            disabled={sessionPage >= Math.ceil(sessions.length / sessionPageSize) - 1}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border-light dark:border-border-dark text-text-secondary-light dark:text-text-secondary-dark hover:text-primary hover:border-primary/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          >
                            <span className="material-symbols-outlined text-base leading-none">chevron_right</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="p-16 text-center text-text-secondary-light dark:text-text-secondary-dark">세션 데이터 없음</div>
                )}
              </div>

              {/* Row: Trend chart */}
              <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-semibold text-text-primary-light">처리량 추이</h2>
                  <div className="flex gap-1 bg-background-light dark:bg-background-dark rounded-lg p-1">
                    {(['daily', 'weekly', 'monthly'] as Period[]).map(p => (
                      <button key={p} onClick={() => setPeriod(p)}
                        className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                          period === p ? 'bg-primary text-white font-semibold'
                            : 'text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark'
                        }`}>
                        {p === 'daily' ? '일별' : p === 'weekly' ? '주별' : '월별'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-4 mb-4">
                  <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-primary" /><span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">완료</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-red-400" /><span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">실패</span></div>
                </div>
                {trend ? (
                  <div className="overflow-x-auto">
                    <div style={{ minWidth: trend.labels.length * 52 }}>
                      <div className="relative" style={{ height: BAR_HEIGHT + 24 }}>
                        {[0, 0.25, 0.5, 0.75, 1].map(ratio => (
                          <div key={ratio} className="absolute left-0 right-0 border-t border-border-light dark:border-border-dark" style={{ bottom: ratio * BAR_HEIGHT + 24 }}>
                            <span className="absolute -top-2.5 -left-1 text-text-secondary-light dark:text-text-secondary-dark pr-1" style={{ fontSize: 10 }}>
                              {ratio === 0 ? '' : Math.round(maxVal * ratio)}
                            </span>
                          </div>
                        ))}
                        <div className="absolute bottom-6 left-6 right-0 flex items-end gap-1" style={{ height: BAR_HEIGHT }}>
                          {trend.labels.map((_label, i) => {
                            const ch = Math.round((trend.completed[i] / maxVal) * BAR_HEIGHT)
                            const fh = Math.round((trend.failed[i] / maxVal) * BAR_HEIGHT)
                            return (
                              <div key={i} className="flex-1 flex flex-col items-center gap-0.5 group relative">
                                <div className="absolute bottom-full mb-1 hidden group-hover:flex flex-col items-center z-10">
                                  <div className="bg-gray-800 dark:bg-gray-700 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                                    완료 {trend.completed[i]} / 실패 {trend.failed[i]}
                                  </div>
                                  <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800 dark:border-t-gray-700" />
                                </div>
                                <div className="w-full flex items-end gap-0.5" style={{ height: BAR_HEIGHT }}>
                                  <div className="flex-1 bg-primary/80 hover:bg-primary rounded-t transition-all duration-300" style={{ height: ch || 1 }} />
                                  <div className="flex-1 bg-red-400/80 hover:bg-red-400 rounded-t transition-all duration-300" style={{ height: fh || (trend.failed[i] > 0 ? 1 : 0) }} />
                                </div>
                              </div>
                            )
                          })}
                        </div>
                        <div className="absolute bottom-0 left-6 right-0 flex gap-1" style={{ height: 20 }}>
                          {trend.labels.map((label, i) => (
                            <div key={i} className="flex-1 text-center overflow-hidden" style={{ fontSize: 9 }}>
                              <span className="text-text-secondary-light dark:text-text-secondary-dark truncate block">{label}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center" style={{ height: BAR_HEIGHT }}>
                    <span className="material-symbols-outlined animate-spin text-primary text-3xl">progress_activity</span>
                  </div>
                )}
              </div>

            </>
          )}
        </div>
      </main>
    </div>
  )
}
