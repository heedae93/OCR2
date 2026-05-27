'use client'

import React, { useState, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'
import { API_BASE_URL } from '@/lib/api'

interface Version {
  version_id: number
  job_id: string
  filename: string
  version_number: number
  version_label: string
  note: string | null
  file_size_bytes: number | null
  created_at: string
}

interface DownloadRecord {
  id: number
  job_id: string
  filename: string
  file_type: string
  version_id: number | null
  downloaded_at: string
  ip_address: string | null
}

interface MaskingItem {
  type: string
  value: string
  masked_value: string
  page?: number
}

interface MaskingRecord {
  job_id: string
  filename: string
  session_id: string | null
  session_name: string | null
  processed_at: string
  total_masked: number
  type_counts: Record<string, number>
  items: MaskingItem[]
}

type Tab = 'versions' | 'downloads' | 'masking'

const PII_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  NAME:              { label: '이름',       color: 'bg-violet-600 text-white' },
  ENGLISH_NAME:      { label: '영문이름',   color: 'bg-purple-600 text-white' },
  PHONE:             { label: '전화번호',   color: 'bg-blue-600 text-white' },
  EMAIL:             { label: '이메일',     color: 'bg-cyan-600 text-white' },
  RRN:               { label: '주민번호',   color: 'bg-red-600 text-white' },
  FOREIGNER_REG_NO:  { label: '외국인번호', color: 'bg-orange-500 text-white' },
  BUSINESS_REG_NO:   { label: '사업자번호', color: 'bg-amber-500 text-white' },
  ACCOUNT_NO:        { label: '계좌번호',   color: 'bg-emerald-600 text-white' },
  CREDIT_CARD:       { label: '신용카드',   color: 'bg-rose-600 text-white' },
  ADDRESS:           { label: '주소',       color: 'bg-teal-600 text-white' },
  ROAD_ADDRESS:      { label: '도로명주소', color: 'bg-teal-600 text-white' },
  HEALTH_INSURANCE_NO: { label: '건강보험번호', color: 'bg-indigo-600 text-white' },
  UNKNOWN:           { label: '기타',       color: 'bg-gray-500 text-white' },
}

function renderMaskedValue(masked: string) {
  return (
    <>
      {masked.split(/(\*+)/).map((part, i) =>
        /^\*+$/.test(part)
          ? <span key={i} className="text-rose-600 dark:text-rose-400">{part}</span>
          : <span key={i} className="text-text-primary-light dark:text-text-primary-dark">{part}</span>
      )}
    </>
  )
}


function CustomCheckbox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onChange() }}
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors ${
        checked ? 'border-primary bg-primary text-white' : 'border-primary bg-surface-light'
      }`}
    >
      {checked && <span className="material-symbols-outlined text-[14px] leading-none">check</span>}
    </button>
  )
}

export default function HistoryPage() {
  const [tab, setTab] = useState<Tab>('versions')
  const [versions, setVersions] = useState<Version[]>([])
  const [downloads, setDownloads] = useState<DownloadRecord[]>([])
  const [masking, setMasking] = useState<MaskingRecord[]>([])
  const [loading, setLoading] = useState(true)

  // 버전 선택 + 페이징
  const [selectedVersionIds, setSelectedVersionIds] = useState<Set<number>>(new Set())
  const [deletingVersions, setDeletingVersions] = useState(false)
  const [versionPage, setVersionPage] = useState(1)
  const VERSION_PAGE_SIZE = 20

  // 다운로드 선택 + 페이징
  const [selectedDownloadIds, setSelectedDownloadIds] = useState<Set<number>>(new Set())
  const [deletingDownloads, setDeletingDownloads] = useState(false)
  const [downloadPage, setDownloadPage] = useState(1)
  const DOWNLOAD_PAGE_SIZE = 20

  // 모달
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingVersion, setEditingVersion] = useState<Version | null>(null)
  const [formJobId, setFormJobId] = useState('')
  const [formLabel, setFormLabel] = useState('')
  const [formNote, setFormNote] = useState('')
  const [jobs, setJobs] = useState<{job_id: string, filename: string}[]>([])
  const [viewingDownload, setViewingDownload] = useState<DownloadRecord | null>(null)
  const [selectedMaskingRecord, setSelectedMaskingRecord] = useState<MaskingRecord | null>(null)
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set())
  const [maskingSessions, setMaskingSessions] = useState<{session_id: string, session_name: string}[]>([])
  const [isAdmin, setIsAdmin] = useState(false)

  const getUserId = () => {
    try { return JSON.parse(localStorage.getItem('user') || '{}').user_id || '' } catch { return '' }
  }

  useEffect(() => {
    try {
      const u = JSON.parse(localStorage.getItem('user') || '{}')
      setIsAdmin(u.type === 'A')
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    setSelectedVersionIds(new Set())
    setSelectedDownloadIds(new Set())
    setVersionPage(1)
    setDownloadPage(1)
    loadData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])


  const loadData = async () => {
    setLoading(true)
    const userId = getUserId()
    const adminFlag = (() => { try { return JSON.parse(localStorage.getItem('user') || '{}').type === 'A' } catch { return false } })()
    try {
      if (tab === 'versions') {
        const res = await fetch(`${API_BASE_URL}/api/history/versions?user_id=${userId}`)
        setVersions(res.ok ? await res.json() : [])
      } else if (tab === 'downloads') {
        const res = await fetch(`${API_BASE_URL}/api/history/downloads?user_id=${userId}`)
        setDownloads(res.ok ? await res.json() : [])
      } else {
        const maskingUrl = adminFlag
          ? `${API_BASE_URL}/api/jobs/masking-history?all_users=true`
          : `${API_BASE_URL}/api/jobs/masking-history?user_id=${userId}`
        const sessionsUrl = `${API_BASE_URL}/api/jobs/statistics/sessions?user_id=${userId}&include_empty=false`
        const [maskingRes, sessionsRes] = await Promise.all([fetch(maskingUrl), fetch(sessionsUrl)])
        setMasking(maskingRes.ok ? await maskingRes.json() : [])
        setMaskingSessions(sessionsRes.ok ? await sessionsRes.json() : [])
      }
    } finally {
      setLoading(false)
    }
  }

  const loadJobs = async () => {
    const userId = getUserId()
    const res = await fetch(`${API_BASE_URL}/api/jobs?user_id=${userId}&limit=100`)
    if (res.ok) {
      const data = await res.json()
      setJobs(data.map((j: {job_id: string, filename: string}) => ({ job_id: j.job_id, filename: j.filename })))
    }
  }

  const openCreateModal = async () => {
    await loadJobs()
    setEditingVersion(null)
    setFormJobId(''); setFormLabel(''); setFormNote('')
    setShowCreateModal(true)
  }

  const openEditModal = (v: Version) => {
    setEditingVersion(v)
    setFormLabel(v.version_label)
    setFormNote(v.note || '')
    setShowCreateModal(true)
  }

  const handleSaveVersion = async () => {
    const userId = getUserId()
    if (editingVersion) {
      await fetch(`${API_BASE_URL}/api/history/versions/${editingVersion.version_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version_label: formLabel, note: formNote })
      })
    } else {
      await fetch(`${API_BASE_URL}/api/history/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: formJobId, user_id: userId, version_label: formLabel, note: formNote })
      })
    }
    setShowCreateModal(false)
    loadData()
  }

  const handleDeleteVersionsBulk = async () => {
    if (selectedVersionIds.size === 0) return
    if (!confirm(`선택한 버전 ${selectedVersionIds.size}개를 삭제하시겠습니까?`)) return
    setDeletingVersions(true)
    try {
      await Promise.all(
        Array.from(selectedVersionIds).map(id =>
          fetch(`${API_BASE_URL}/api/history/versions/${id}`, { method: 'DELETE' }).catch(() => null)
        )
      )
      setSelectedVersionIds(new Set())
      loadData()
    } finally {
      setDeletingVersions(false)
    }
  }

  const handleDeleteDownload = async (id: number) => {
    if (!confirm('이 이력을 삭제하시겠습니까?')) return
    await fetch(`${API_BASE_URL}/api/history/downloads/${id}`, { method: 'DELETE' })
    setSelectedDownloadIds(prev => { const n = new Set(prev); n.delete(id); return n })
    loadData()
  }

  const handleDeleteDownloadsBulk = async () => {
    if (selectedDownloadIds.size === 0) return
    if (!confirm(`선택한 이력 ${selectedDownloadIds.size}개를 삭제하시겠습니까?`)) return
    setDeletingDownloads(true)
    try {
      await Promise.all(
        Array.from(selectedDownloadIds).map(id =>
          fetch(`${API_BASE_URL}/api/history/downloads/${id}`, { method: 'DELETE' }).catch(() => null)
        )
      )
      setSelectedDownloadIds(new Set())
      loadData()
    } finally {
      setDeletingDownloads(false)
    }
  }

  const formatDate = (s: string) =>
    new Date(s).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

  const formatSize = (bytes: number | null) => {
    if (!bytes) return '-'
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  const filteredVersions = versions
  const filteredDownloads = downloads
  const filteredMasking = masking

  // 마스킹 레코드를 session_id 기준으로 묶기
  const _maskingBySessionId: Record<string, MaskingRecord[]> = {}
  for (const m of filteredMasking) {
    const key = m.session_id ?? '__none__'
    if (!_maskingBySessionId[key]) _maskingBySessionId[key] = []
    _maskingBySessionId[key].push(m)
  }
  // 세션 API 순서 기준으로 정렬 (작업내역과 동일한 순서)
  const knownSessionIds = new Set(maskingSessions.map(s => s.session_id))
  const maskingBySession: [string, string, MaskingRecord[]][] = []
  for (const sess of maskingSessions) {
    const records = _maskingBySessionId[sess.session_id]
    if (records?.length) maskingBySession.push([sess.session_id, sess.session_name, records])
  }
  // 세션 API에 없는 레코드 (session_id 미등록)
  for (const [sid, records] of Object.entries(_maskingBySessionId)) {
    if (!knownSessionIds.has(sid)) {
      const label = sid === '__none__' ? '세션 없음' : (records[0].session_name ?? sid)
      maskingBySession.push([sid, label, records])
    }
  }

  const toggleSession = (key: string) => {
    setExpandedSessions(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const versionTotalPages = Math.max(1, Math.ceil(filteredVersions.length / VERSION_PAGE_SIZE))
  const paginatedVersions = filteredVersions.slice((versionPage - 1) * VERSION_PAGE_SIZE, versionPage * VERSION_PAGE_SIZE)

  const downloadTotalPages = Math.max(1, Math.ceil(filteredDownloads.length / DOWNLOAD_PAGE_SIZE))
  const paginatedDownloads = filteredDownloads.slice((downloadPage - 1) * DOWNLOAD_PAGE_SIZE, downloadPage * DOWNLOAD_PAGE_SIZE)

  const allVersionsSelected = paginatedVersions.length > 0 && paginatedVersions.every(v => selectedVersionIds.has(v.version_id))
  const allDownloadsSelected = filteredDownloads.length > 0 && filteredDownloads.every(d => selectedDownloadIds.has(d.id))

  return (
    <div className="bg-slate-50 dark:bg-slate-50 min-h-screen">
      <Sidebar />
      <main className="ml-64 p-6 lg:p-10">
        <div className="w-full max-w-6xl mx-auto flex flex-col gap-6">

          {/* 헤더 */}
          <h1 className="text-3xl font-bold text-text-primary-light">이력관리</h1>

          {/* 탭 */}
          <div className="flex gap-1 bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-xl p-1 w-fit">
            {([
              ['versions', 'history', '파일 버전 관리'],
              ['downloads', 'download', '다운로드 이력'],
              ...(isAdmin ? [['masking', 'shield_lock', '마스킹 처리 이력']] : []),
            ] as const).map(([id, icon, label]) => (
              <button key={id} onClick={() => setTab(id as Tab)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  tab === id ? 'bg-primary text-white' : 'text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark'
                }`}>
                <span className="material-symbols-outlined text-base">{icon}</span>{label}
              </button>
            ))}
          </div>

          {/* 리스트 위 툴바 */}
          {tab !== 'masking' && (
            <div className="flex items-center justify-end gap-2">
              {tab === 'versions' && (
                <>
                  <button
                    onClick={handleDeleteVersionsBulk}
                    disabled={selectedVersionIds.size === 0 || deletingVersions}
                    className="inline-flex items-center gap-2 rounded-xl bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="material-symbols-outlined text-base">delete</span>
                    {deletingVersions ? '삭제 중...' : `선택 삭제 (${selectedVersionIds.size})`}
                  </button>
                  <button onClick={openCreateModal}
                    className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90">
                    <span className="material-symbols-outlined text-base">add</span>버전 추가
                  </button>
                </>
              )}
              {tab === 'downloads' && (
                <button
                  onClick={handleDeleteDownloadsBulk}
                  disabled={selectedDownloadIds.size === 0 || deletingDownloads}
                  className="inline-flex items-center gap-2 rounded-xl bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="material-symbols-outlined text-base">delete</span>
                  {deletingDownloads ? '삭제 중...' : `선택 삭제 (${selectedDownloadIds.size})`}
                </button>
              )}
            </div>
          )}

          {/* 콘텐츠 */}
          <div className="overflow-hidden rounded-2xl border border-border-light bg-white dark:bg-white">
            {loading ? (
              <div className="flex items-center justify-center p-16">
                <span className="material-symbols-outlined animate-spin text-primary text-4xl">progress_activity</span>
              </div>

            ) : tab === 'versions' ? (
              filteredVersions.length === 0 ? (
                <div className="p-16 text-center text-text-secondary-light dark:text-text-secondary-dark">버전 이력이 없습니다</div>
              ) : (
                <>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="border-b border-primary/20 dark:border-primary/20 bg-primary/10 dark:bg-primary/10">
                      <tr>
                        <th className="px-4 py-3 text-center w-10">
                          <CustomCheckbox
                            checked={allVersionsSelected}
                            onChange={() => {
                              if (allVersionsSelected) {
                                setSelectedVersionIds(new Set())
                              } else {
                                setSelectedVersionIds(new Set(paginatedVersions.map(v => v.version_id)))
                              }
                            }}
                          />
                        </th>
                        {['파일명','버전','라벨','메모','파일 크기','생성일','수정'].map(h => (
                          <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-light dark:divide-border-dark">
                      {paginatedVersions.map(v => {
                        const isSelected = selectedVersionIds.has(v.version_id)
                        return (
                          <tr
                            key={v.version_id}
                            onClick={() => openEditModal(v)}
                            className={`cursor-pointer transition-colors ${isSelected ? 'bg-primary/5' : 'hover:bg-background-light dark:hover:bg-background-dark'}`}
                          >
                            <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                              <CustomCheckbox
                                checked={isSelected}
                                onChange={() => setSelectedVersionIds(prev => {
                                  const n = new Set(prev)
                                  isSelected ? n.delete(v.version_id) : n.add(v.version_id)
                                  return n
                                })}
                              />
                            </td>
                            <td className="px-5 py-3 text-sm max-w-[200px]">
                              <button
                                onClick={e => { e.stopPropagation(); window.open(`/editor/${v.job_id}`, '_blank') }}
                                className="flex items-center gap-1.5 text-text-primary-light hover:text-primary hover:underline truncate text-left w-full"
                                title={v.filename}
                              >
                                <span className="material-symbols-outlined text-base shrink-0 text-primary">description</span>
                                <span className="truncate">{v.filename}</span>
                              </button>
                            </td>
                            <td className="px-5 py-3">
                              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary">v{v.version_number}</span>
                            </td>
                            <td className="px-5 py-3 text-sm text-text-primary-light dark:text-text-primary-dark">{v.version_label || '-'}</td>
                            <td className="px-5 py-3 text-sm text-text-primary-light dark:text-text-primary-dark max-w-[180px] truncate">{v.note || '-'}</td>
                            <td className="px-5 py-3 text-sm text-text-primary-light dark:text-text-primary-dark whitespace-nowrap">{formatSize(v.file_size_bytes)}</td>
                            <td className="px-5 py-3 text-sm text-text-primary-light dark:text-text-primary-dark whitespace-nowrap">{formatDate(v.created_at)}</td>
                            <td className="px-5 py-3 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                              <button
                                onClick={() => openEditModal(v)}
                                className="inline-flex items-center justify-center rounded-lg bg-primary/10 p-2 text-primary hover:bg-primary hover:text-white transition-colors"
                                title="수정"
                              >
                                <span className="material-symbols-outlined text-lg leading-none">edit</span>
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {versionTotalPages > 1 && (
                  <div className="flex items-center justify-between px-5 py-3 border-t border-border-light dark:border-border-dark">
                    <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
                      총 <span className="font-semibold text-text-primary-light">{filteredVersions.length}</span>건
                      &nbsp;·&nbsp; {versionPage} / {versionTotalPages} 페이지
                    </p>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setVersionPage(p => Math.max(1, p - 1))}
                        disabled={versionPage === 1}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border-light dark:border-border-dark text-text-secondary-light hover:text-primary hover:border-primary/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <span className="material-symbols-outlined text-base leading-none">chevron_left</span>
                      </button>
                      {Array.from({ length: Math.min(5, versionTotalPages) }, (_, i) => {
                        const start = Math.max(1, Math.min(versionPage - 2, versionTotalPages - 4))
                        const p = start + i
                        return (
                          <button
                            key={p}
                            onClick={() => setVersionPage(p)}
                            className={`h-8 min-w-8 rounded-lg px-2 text-sm font-medium transition-colors ${p === versionPage ? 'bg-primary text-white' : 'border border-border-light dark:border-border-dark text-text-secondary-light hover:text-primary hover:border-primary/40'}`}
                          >
                            {p}
                          </button>
                        )
                      })}
                      <button
                        onClick={() => setVersionPage(p => Math.min(versionTotalPages, p + 1))}
                        disabled={versionPage === versionTotalPages}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border-light dark:border-border-dark text-text-secondary-light hover:text-primary hover:border-primary/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <span className="material-symbols-outlined text-base leading-none">chevron_right</span>
                      </button>
                    </div>
                  </div>
                )}
                </>
              )

            ) : tab === 'downloads' ? (
              filteredDownloads.length === 0 ? (
                <div className="p-16 text-center text-text-secondary-light dark:text-text-secondary-dark">다운로드 이력이 없습니다</div>
              ) : (
                <>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="border-b border-primary/20 dark:border-primary/20 bg-primary/10 dark:bg-primary/10">
                      <tr>
                        <th className="px-4 py-3 text-center w-10">
                          <CustomCheckbox
                            checked={allDownloadsSelected}
                            onChange={() => {
                              if (allDownloadsSelected) {
                                setSelectedDownloadIds(new Set())
                              } else {
                                setSelectedDownloadIds(new Set(paginatedDownloads.map(d => d.id)))
                              }
                            }}
                          />
                        </th>
                        {['파일명','형식','다운로드 일시','IP'].map(h => (
                          <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-light dark:divide-border-dark">
                      {paginatedDownloads.map(d => {
                        const isSelected = selectedDownloadIds.has(d.id)
                        return (
                          <tr
                            key={d.id}
                            onClick={() => setViewingDownload(d)}
                            className={`cursor-pointer transition-colors ${isSelected ? 'bg-primary/5' : 'hover:bg-background-light dark:hover:bg-background-dark'}`}
                          >
                            <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                              <CustomCheckbox
                                checked={isSelected}
                                onChange={() => setSelectedDownloadIds(prev => {
                                  const n = new Set(prev)
                                  isSelected ? n.delete(d.id) : n.add(d.id)
                                  return n
                                })}
                              />
                            </td>
                            <td className="px-5 py-3 text-sm max-w-[250px]">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="material-symbols-outlined text-base shrink-0 text-primary">description</span>
                                <span className="truncate text-text-primary-light dark:text-text-primary-dark" title={d.filename}>{d.filename}</span>
                              </div>
                            </td>
                            <td className="px-5 py-3">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold text-white ${
                                d.file_type === 'pdf' ? 'bg-red-500'
                                : d.file_type === 'excel' ? 'bg-green-600'
                                : 'bg-gray-400'
                              }`}>{d.file_type?.toUpperCase() || '-'}</span>
                            </td>
                            <td className="px-5 py-3 text-sm text-text-primary-light dark:text-text-primary-dark whitespace-nowrap">{formatDate(d.downloaded_at)}</td>
                            <td className="px-5 py-3 text-sm text-text-primary-light dark:text-text-primary-dark">{d.ip_address || '-'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {downloadTotalPages > 1 && (
                  <div className="flex items-center justify-between px-5 py-3 border-t border-border-light dark:border-border-dark">
                    <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
                      총 <span className="font-semibold text-text-primary-light">{filteredDownloads.length}</span>건
                      &nbsp;·&nbsp; {downloadPage} / {downloadTotalPages} 페이지
                    </p>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setDownloadPage(p => Math.max(1, p - 1))}
                        disabled={downloadPage === 1}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border-light dark:border-border-dark text-text-secondary-light hover:text-primary hover:border-primary/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <span className="material-symbols-outlined text-base leading-none">chevron_left</span>
                      </button>
                      {Array.from({ length: Math.min(5, downloadTotalPages) }, (_, i) => {
                        const start = Math.max(1, Math.min(downloadPage - 2, downloadTotalPages - 4))
                        const p = start + i
                        return (
                          <button
                            key={p}
                            onClick={() => setDownloadPage(p)}
                            className={`h-8 min-w-8 rounded-lg px-2 text-sm font-medium transition-colors ${p === downloadPage ? 'bg-primary text-white' : 'border border-border-light dark:border-border-dark text-text-secondary-light hover:text-primary hover:border-primary/40'}`}
                          >
                            {p}
                          </button>
                        )
                      })}
                      <button
                        onClick={() => setDownloadPage(p => Math.min(downloadTotalPages, p + 1))}
                        disabled={downloadPage === downloadTotalPages}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border-light dark:border-border-dark text-text-secondary-light hover:text-primary hover:border-primary/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <span className="material-symbols-outlined text-base leading-none">chevron_right</span>
                      </button>
                    </div>
                  </div>
                )}
                </>
              )

            ) : (
              /* ── 마스킹 처리 이력 탭 ── */
              filteredMasking.length === 0 ? (
                <div className="p-16 text-center text-text-secondary-light dark:text-text-secondary-dark">마스킹 처리 이력이 없습니다</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="border-b border-primary/20 dark:border-primary/20 bg-primary/10 dark:bg-primary/10">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-secondary-light w-[40%]">작업명</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-secondary-light">문서</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-secondary-light">마스킹 건수</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-secondary-light">처리일시</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-light dark:divide-border-dark">
                      {maskingBySession.map(([sessionId, sessionName, records]) => {
                        const isOpen = expandedSessions.has(sessionId)
                        const totalMasked = records.reduce((s: number, r: MaskingRecord) => s + r.total_masked, 0)
                        const latestDate = records.reduce((latest: string, r: MaskingRecord) =>
                          r.processed_at > latest ? r.processed_at : latest, records[0].processed_at)
                        return (
                          <React.Fragment key={sessionId}>
                            {/* 작업(세션) 행 */}
                            <tr
                              onClick={() => toggleSession(sessionId)}
                              className="cursor-pointer transition-colors hover:bg-primary/5 dark:hover:bg-primary/10"
                            >
                              <td className="px-4 py-4">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className={`material-symbols-outlined text-base text-primary shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}>
                                    chevron_right
                                  </span>
                                  <span className="material-symbols-outlined text-base text-primary shrink-0">folder_open</span>
                                  <span className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark truncate">{sessionName}</span>
                                </div>
                              </td>
                              <td className="px-4 py-4 text-sm text-text-primary-light dark:text-text-primary-dark">
                                {records.length}개
                              </td>
                              <td className="px-4 py-4">
                                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-500 text-white whitespace-nowrap">
                                  총 {totalMasked}건
                                </span>
                              </td>
                              <td className="px-4 py-4 text-sm text-text-secondary-light dark:text-text-secondary-dark whitespace-nowrap">
                                {formatDate(latestDate)}
                              </td>
                            </tr>

                            {/* 문서 서브행 */}
                            {isOpen && records.map((record: MaskingRecord) => (
                              <tr
                                key={record.job_id}
                                onClick={(e) => { e.stopPropagation(); setSelectedMaskingRecord(record) }}
                                className="cursor-pointer transition-colors bg-white hover:bg-primary/5 dark:hover:bg-primary/10 border-t border-border-light dark:border-border-dark"
                              >
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-2 min-w-0 pl-10">
                                    <span className="material-symbols-outlined text-base shrink-0 text-primary">description</span>
                                    <span className="text-sm text-text-primary-light dark:text-text-primary-dark truncate" title={record.filename}>
                                      {record.filename.split('/').pop() || record.filename}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-sm text-text-secondary-light dark:text-text-secondary-dark">-</td>
                                <td className="px-4 py-3">
                                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-700 whitespace-nowrap">
                                    {record.total_masked}건
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-sm text-text-secondary-light dark:text-text-secondary-dark whitespace-nowrap">
                                  {formatDate(record.processed_at)}
                                </td>
                              </tr>
                            ))}
                          </React.Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>
        </div>
      </main>

      {/* 버전 생성/수정 모달 */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface-light dark:bg-surface-dark rounded-2xl border border-border-light dark:border-border-dark p-6 w-full max-w-md flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-text-primary-light dark:text-text-primary-dark">
                {editingVersion ? '버전 수정' : '버전 추가'}
              </h2>
              <button onClick={() => setShowCreateModal(false)} className="text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {!editingVersion && (
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">파일 선택</label>
                <select value={formJobId} onChange={e => setFormJobId(e.target.value)}
                  className="px-3 py-2 bg-background-light dark:bg-background-dark border border-border-light dark:border-border-dark rounded-lg text-sm text-text-primary-light dark:text-text-primary-dark">
                  <option value="">선택하세요</option>
                  {jobs.map(j => <option key={j.job_id} value={j.job_id}>{j.filename}</option>)}
                </select>
              </div>
            )}

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">버전 라벨</label>
              <input type="text" value={formLabel} onChange={e => setFormLabel(e.target.value)}
                placeholder="예: v2.0, 최종본"
                className="px-3 py-2 bg-background-light dark:bg-background-dark border border-border-light dark:border-border-dark rounded-lg text-sm text-text-primary-light dark:text-text-primary-dark" />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">메모</label>
              <textarea value={formNote} onChange={e => setFormNote(e.target.value)}
                placeholder="변경 내용 등 메모" rows={3}
                className="px-3 py-2 bg-background-light dark:bg-background-dark border border-border-light dark:border-border-dark rounded-lg text-sm text-text-primary-light dark:text-text-primary-dark resize-none" />
            </div>

            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 rounded-lg border border-border-light dark:border-border-dark text-sm text-text-secondary-light dark:text-text-secondary-dark hover:bg-black/5 dark:hover:bg-white/5">
                취소
              </button>
              <button onClick={handleSaveVersion} disabled={!editingVersion && !formJobId}
                className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 다운로드 상세보기 모달 */}
      {viewingDownload && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setViewingDownload(null)}>
          <div className="bg-surface-light dark:bg-surface-dark rounded-2xl border border-border-light dark:border-border-dark p-6 w-full max-w-md flex flex-col gap-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-text-primary-light dark:text-text-primary-dark flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-xl">download</span>
                다운로드 상세
              </h2>
              <button onClick={() => setViewingDownload(null)} className="text-text-secondary-light hover:text-text-primary-light transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="flex flex-col gap-3">
              <div className="rounded-xl bg-background-light dark:bg-background-dark p-4 flex flex-col gap-3">
                <DetailRow icon="description" label="파일명" value={viewingDownload.filename} />
                <DetailRow icon="folder" label="형식" value={
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                    viewingDownload.file_type === 'pdf' ? 'bg-red-100 text-red-700'
                    : viewingDownload.file_type === 'excel' ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-700'
                  }`}>{viewingDownload.file_type?.toUpperCase() || '-'}</span>
                } />
                <DetailRow icon="schedule" label="다운로드 일시" value={formatDate(viewingDownload.downloaded_at)} />
                <DetailRow icon="device_hub" label="IP 주소" value={viewingDownload.ip_address || '-'} />
                <DetailRow icon="tag" label="Job ID" value={
                  <span className="font-mono text-xs text-text-secondary-light break-all">{viewingDownload.job_id}</span>
                } />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { handleDeleteDownload(viewingDownload.id); setViewingDownload(null) }}
                className="inline-flex items-center gap-2 rounded-xl bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600"
              >
                <span className="material-symbols-outlined text-base">delete</span>삭제
              </button>
              <button onClick={() => setViewingDownload(null)}
                className="px-4 py-2 rounded-xl border border-border-light dark:border-border-dark text-sm text-text-secondary-light hover:bg-black/5">
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 마스킹 상세 모달 */}
      {selectedMaskingRecord && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSelectedMaskingRecord(null)}>
          <div className="bg-surface-light dark:bg-surface-dark rounded-2xl border border-border-light dark:border-border-dark p-6 w-full max-w-3xl max-h-[80vh] flex flex-col gap-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-2 min-w-0">
                <h2 className="text-base font-semibold text-text-primary-light dark:text-text-primary-dark break-all leading-snug">
                  {selectedMaskingRecord.filename}
                </h2>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                    {formatDate(selectedMaskingRecord.processed_at)}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-500 text-white">
                    총 {selectedMaskingRecord.total_masked}건 마스킹
                  </span>
                </div>
              </div>
              <button onClick={() => setSelectedMaskingRecord(null)} className="text-text-secondary-light dark:text-text-secondary-dark shrink-0 hover:text-text-primary-light dark:hover:text-text-primary-dark">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="overflow-y-auto flex-1 rounded-lg border border-border-light dark:border-border-dark">
              <table className="w-full text-xs">
                <thead className="border-b border-primary/20 bg-[#E9EFFD] sticky top-0 z-10">
                  <tr>
                    {['유형', '원본값', '마스킹값'].map(h => (
                      <th key={h} className="px-4 py-2 text-left font-semibold text-text-secondary-light dark:text-text-secondary-dark">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light dark:divide-border-dark">
                  {(() => {
                    const sortedItems = [...selectedMaskingRecord.items].sort((a, b) => (a.page ?? 0) - (b.page ?? 0))
                    const hasPages = sortedItems.some(it => it.page !== undefined)
                    const multiPage = hasPages && new Set(sortedItems.map(it => it.page)).size > 1
                    let lastPage: number | undefined = undefined
                    return sortedItems.flatMap((item, i) => {
                      const rows = []
                      if (multiPage && item.page !== undefined && item.page !== lastPage) {
                        lastPage = item.page
                        rows.push(
                          <tr key={`page-${item.page}`} className="bg-primary/5 dark:bg-primary/10">
                            <td colSpan={3} className="px-4 py-1.5">
                              <span className="text-xs font-semibold text-primary">
                                {item.page}페이지
                              </span>
                            </td>
                          </tr>
                        )
                      }
                      rows.push(
                        <tr key={i} className="hover:bg-background-light dark:hover:bg-background-dark">
                          <td className="px-4 py-2 whitespace-nowrap text-xs text-text-secondary-light dark:text-text-secondary-dark">{PII_TYPE_LABELS[item.type]?.label ?? item.type}</td>
                          <td className="px-4 py-2 font-mono text-text-primary-light dark:text-text-primary-dark">{item.value}</td>
                          <td className="px-4 py-2 font-mono">{renderMaskedValue(item.masked_value)}</td>
                        </tr>
                      )
                      return rows
                    })
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DetailRow({ icon, label, value }: { icon: string; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="material-symbols-outlined text-base text-text-secondary-light shrink-0 mt-0.5">{icon}</span>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-xs font-medium text-text-secondary-light uppercase tracking-wide">{label}</span>
        <span className="text-sm text-text-primary-light dark:text-text-primary-dark break-all">{value}</span>
      </div>
    </div>
  )
}
