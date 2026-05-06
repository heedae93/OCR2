'use client'

import { useState, useEffect } from 'react'
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

type Tab = 'versions' | 'downloads'

export default function HistoryPage() {
  const [tab, setTab] = useState<Tab>('versions')
  const [versions, setVersions] = useState<Version[]>([])
  const [downloads, setDownloads] = useState<DownloadRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingVersion, setEditingVersion] = useState<Version | null>(null)
  const [formJobId, setFormJobId] = useState('')
  const [formLabel, setFormLabel] = useState('')
  const [formNote, setFormNote] = useState('')
  const [jobs, setJobs] = useState<{job_id: string, filename: string}[]>([])

  const getUserId = () => {
    try { return JSON.parse(localStorage.getItem('user') || '{}').user_id || '' } catch { return '' }
  }

  useEffect(() => { loadData() }, [tab])

  const loadData = async () => {
    setLoading(true)
    const userId = getUserId()
    try {
      if (tab === 'versions') {
        const res = await fetch(`${API_BASE_URL}/api/history/versions?user_id=${userId}`)
        setVersions(res.ok ? await res.json() : [])
      } else {
        const res = await fetch(`${API_BASE_URL}/api/history/downloads?user_id=${userId}`)
        setDownloads(res.ok ? await res.json() : [])
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

  const handleDeleteVersion = async (id: number) => {
    if (!confirm('이 버전을 삭제하시겠습니까?')) return
    await fetch(`${API_BASE_URL}/api/history/versions/${id}`, { method: 'DELETE' })
    loadData()
  }

  const handleDeleteDownload = async (id: number) => {
    if (!confirm('이 이력을 삭제하시겠습니까?')) return
    await fetch(`${API_BASE_URL}/api/history/downloads/${id}`, { method: 'DELETE' })
    loadData()
  }

  const formatDate = (s: string) =>
    new Date(s).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

  const formatSize = (bytes: number | null) => {
    if (!bytes) return '-'
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  const filteredVersions = versions.filter(v =>
    !searchQuery || v.filename.toLowerCase().includes(searchQuery.toLowerCase()) ||
    v.version_label?.toLowerCase().includes(searchQuery.toLowerCase())
  )
  const filteredDownloads = downloads.filter(d =>
    !searchQuery || d.filename.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="bg-background-light dark:bg-background-dark min-h-screen">
      <Sidebar />
      <main className="ml-64 mt-14 p-6 lg:p-10">
        <div className="w-full max-w-6xl mx-auto flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold text-text-primary-light dark:text-text-primary-dark">이력관리</h1>
            {tab === 'versions' && (
              <button onClick={openCreateModal}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 text-sm font-medium">
                <span className="material-symbols-outlined text-base">add</span>버전 추가
              </button>
            )}
          </div>

          {/* 탭 */}
          <div className="flex gap-1 bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-xl p-1 w-fit">
            {([['versions', 'history', '파일 버전 관리'], ['downloads', 'download', '다운로드 이력']] as const).map(([id, icon, label]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  tab === id ? 'bg-primary text-white' : 'text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark'
                }`}>
                <span className="material-symbols-outlined text-base">{icon}</span>{label}
              </button>
            ))}
          </div>

          {/* 검색 */}
          <input type="text" placeholder="파일명 검색..." value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2 bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-lg text-sm text-text-primary-light dark:text-text-primary-dark" />

          {/* 테이블 */}
          <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center p-16">
                <span className="material-symbols-outlined animate-spin text-primary text-4xl">progress_activity</span>
              </div>
            ) : tab === 'versions' ? (
              filteredVersions.length === 0 ? (
                <div className="p-16 text-center text-text-secondary-light dark:text-text-secondary-dark">버전 이력이 없습니다</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-background-light dark:bg-background-dark">
                      <tr>{['파일명','버전','라벨','메모','파일 크기','생성일','작업'].map(h => (
                        <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody className="divide-y divide-border-light dark:divide-border-dark">
                      {filteredVersions.map(v => (
                        <tr key={v.version_id} className="hover:bg-background-light dark:hover:bg-background-dark transition-colors">
                          <td className="px-5 py-3 text-sm max-w-[200px]">
                            <button
                              onClick={() => window.open(`/editor/${v.job_id}`, '_blank')}
                              className="text-primary hover:text-primary/80 hover:underline truncate block text-left w-full"
                              title={v.filename}
                            >
                              {v.filename}
                            </button>
                          </td>
                          <td className="px-5 py-3"><span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary">v{v.version_number}</span></td>
                          <td className="px-5 py-3 text-sm text-text-primary-light dark:text-text-primary-dark">{v.version_label || '-'}</td>
                          <td className="px-5 py-3 text-sm text-text-secondary-light dark:text-text-secondary-dark max-w-[180px] truncate">{v.note || '-'}</td>
                          <td className="px-5 py-3 text-sm text-text-secondary-light dark:text-text-secondary-dark whitespace-nowrap">{formatSize(v.file_size_bytes)}</td>
                          <td className="px-5 py-3 text-sm text-text-secondary-light dark:text-text-secondary-dark whitespace-nowrap">{formatDate(v.created_at)}</td>
                          <td className="px-5 py-3 whitespace-nowrap flex gap-3">
                            <button onClick={() => openEditModal(v)} className="text-blue-500 hover:text-blue-700 text-sm">수정</button>
                            <button onClick={() => handleDeleteVersion(v.version_id)} className="text-red-500 hover:text-red-700 text-sm">삭제</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              filteredDownloads.length === 0 ? (
                <div className="p-16 text-center text-text-secondary-light dark:text-text-secondary-dark">다운로드 이력이 없습니다</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-background-light dark:bg-background-dark">
                      <tr>{['파일명','형식','다운로드 일시','IP','작업'].map(h => (
                        <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody className="divide-y divide-border-light dark:divide-border-dark">
                      {filteredDownloads.map(d => (
                        <tr key={d.id} className="hover:bg-background-light dark:hover:bg-background-dark transition-colors">
                          <td className="px-5 py-3 text-sm text-text-primary-light dark:text-text-primary-dark max-w-[250px] truncate">{d.filename}</td>
                          <td className="px-5 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                              d.file_type === 'pdf' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                              : d.file_type === 'excel' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                            }`}>{d.file_type?.toUpperCase() || '-'}</span>
                          </td>
                          <td className="px-5 py-3 text-sm text-text-secondary-light dark:text-text-secondary-dark whitespace-nowrap">{formatDate(d.downloaded_at)}</td>
                          <td className="px-5 py-3 text-sm text-text-secondary-light dark:text-text-secondary-dark">{d.ip_address || '-'}</td>
                          <td className="px-5 py-3">
                            <button onClick={() => handleDeleteDownload(d.id)} className="text-red-500 hover:text-red-700 text-sm">삭제</button>
                          </td>
                        </tr>
                      ))}
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
              <button onClick={() => setShowCreateModal(false)} className="text-text-secondary-light dark:text-text-secondary-dark">
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
                className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
