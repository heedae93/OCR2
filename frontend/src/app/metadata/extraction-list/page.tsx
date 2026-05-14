'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Sidebar from '@/components/Sidebar'
import { API_BASE_URL } from '@/lib/api'
import {
  Search as SearchIcon,
  FileText,
  ExternalLink,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  RefreshCw as RefreshIcon,
  Database as DatabaseIcon,
  Info as InfoIcon,
  X,
  Plus,
  Trash2,
  Save,
  Edit3,
  Loader2,
} from 'lucide-react'

interface MetaDoc {
  job_id: string
  original_filename: string
  doc_type: string
  detected_language: string
  created_at: string
  extracted_fields: Array<{
    key: string | null
    value: string
    entity_type: string
    entity_type_ko: string
  }>
  summary?: string
  citations?: Array<{
    quote: string
    source: string
    web_links: string[]
  }>
  tags?: string[]
  notes?: string
}

// ─── Slide-over edit panel ───────────────────────────────────────────
interface EditPanelProps {
  doc: MetaDoc
  userId: string
  categories: string[]
  onClose: () => void
  onSaved: (updated: MetaDoc) => void
}

function EditPanel({ doc, userId, categories, onClose, onSaved }: EditPanelProps) {
  const [docType, setDocType] = useState(doc.doc_type || '')
  const [summary, setSummary] = useState(doc.summary || '')
  const [fields, setFields] = useState(
    doc.extracted_fields?.length
      ? doc.extracted_fields.map(f => ({
          ...f,
          entity_type_ko: f.entity_type_ko?.trim() 
            ? f.entity_type_ko 
            : (LABEL_MAP[f.entity_type || ''] || LABEL_MAP[f.key || ''] || f.key || f.entity_type || '')
        }))
      : []
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }

  const updateField = (idx: number, key: string, val: string) => {
    setFields(prev => prev.map((f, i) => i === idx ? { ...f, [key]: val } : f))
  }

  const addField = () => {
    setFields(prev => [...prev, { key: '', value: '', entity_type: '', entity_type_ko: '' }])
  }

  const removeField = (idx: number) => {
    setFields(prev => prev.filter((_, i) => i !== idx))
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/metadata-v3/documents/${doc.job_id}?user_id=${userId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            doc_type: docType || null,
            summary: summary || null,
            extracted_fields: fields.filter(f => f.value.trim()),
          }),
        }
      )
      if (!res.ok) throw new Error('저장 실패')
      const updated = await res.json()
      onSaved(updated)
      onClose()
    } catch {
      setError('저장 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      // Sidebar(좌측) 제외한 메인 영역의 중앙에 오도록 left-64/right-0로 오버레이를 제한
      className="fixed inset-y-0 left-64 right-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={handleBackdrop}
    >
      <div
        ref={panelRef}
        className="w-full max-w-3xl h-[90vh] bg-surface-light dark:bg-surface-dark shadow-2xl flex flex-col rounded-2xl overflow-hidden transform translate-x-6"
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-light dark:border-border-dark flex-shrink-0">
          <div className="flex items-center gap-2">
            <Edit3 size={18} className="text-primary" />
            <span className="font-black text-text-primary-light dark:text-text-primary-dark">메타데이터 편집</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-text-secondary-light transition-all">
            <X size={18} />
          </button>
        </div>

        {/* 파일명 */}
        <div className="px-6 py-3 bg-primary/5 border-b border-border-light dark:border-border-dark flex-shrink-0">
          <div className="flex items-center gap-2">
            <FileText size={14} className="text-primary shrink-0" />
            <span className="text-sm font-bold text-text-primary-light dark:text-text-primary-dark truncate">{doc.original_filename}</span>
          </div>
        </div>

        {/* 바디 */}
        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-6">
          {/* 문서 유형 */}
          <section>
            <label className="block text-[11px] font-black uppercase tracking-wider text-text-secondary-light mb-2">문서 유형</label>
            <select
              value={docType}
              onChange={e => setDocType(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-bg-light dark:bg-bg-dark border border-border-light dark:border-border-dark text-sm font-bold outline-none focus:border-primary/60 transition-all"
            >
              <option value="">미분류</option>
              {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
            </select>
          </section>

          {/* AI 요약 */}
          <section>
            <label className="block text-[11px] font-black uppercase tracking-wider text-text-secondary-light mb-2">AI 요약</label>
            <textarea
              value={summary}
              onChange={e => setSummary(e.target.value)}
              rows={5}
              placeholder="요약 내용을 입력하세요..."
              className="w-full px-3 py-2.5 rounded-xl bg-bg-light dark:bg-bg-dark border border-border-light dark:border-border-dark text-sm font-medium outline-none focus:border-primary/60 transition-all resize-none leading-relaxed"
            />
          </section>

          {/* 추출 필드 */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-[11px] font-black uppercase tracking-wider text-text-secondary-light">추출된 필드 ({fields.length})</label>
              <button onClick={addField} className="flex items-center gap-1 text-[11px] font-black text-primary hover:text-primary/70 transition-colors">
                <Plus size={13} /> 필드 추가
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {fields.length === 0 && (
                <p className="text-xs text-text-secondary-light italic text-center py-4 border border-dashed border-border-light dark:border-border-dark rounded-xl">
                  추출된 필드가 없습니다
                </p>
              )}
              {fields.map((field, idx) => (
                <div key={idx} className="flex items-center gap-2 p-2.5 rounded-xl bg-bg-light dark:bg-bg-dark border border-border-light dark:border-border-dark group">
                  <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                    <input
                      value={field.entity_type_ko || field.key || ''}
                      onChange={e => { updateField(idx, 'entity_type_ko', e.target.value); updateField(idx, 'key', e.target.value) }}
                      placeholder="항목명 (예: 금액)"
                      className="w-full text-[11px] font-black uppercase tracking-wide text-primary bg-transparent outline-none border-b border-border-light dark:border-border-dark pb-1 focus:border-primary/60 transition-all"
                    />
                    <input
                      value={field.value}
                      onChange={e => updateField(idx, 'value', e.target.value)}
                      placeholder="값"
                      className="w-full text-sm font-bold bg-transparent outline-none text-text-primary-light dark:text-text-primary-dark placeholder:text-text-secondary-light placeholder:font-normal"
                    />
                  </div>
                  <button
                    onClick={() => removeField(idx)}
                    className="p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-text-secondary-light hover:text-red-500 transition-all opacity-0 group-hover:opacity-100 shrink-0"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* 인용구 (읽기 전용) */}
          {doc.citations && doc.citations.length > 0 && (
            <section>
              <label className="block text-[11px] font-black uppercase tracking-wider text-text-secondary-light mb-2">인용구 및 출처 ({doc.citations.length})</label>
              <div className="flex flex-col gap-2">
                {doc.citations.map((cite, idx) => (
                  <div key={idx} className="p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/50">
                    <p className="text-xs font-bold text-text-primary-light dark:text-text-primary-dark italic mb-1">
                      "{cite.quote.length > 80 ? cite.quote.substring(0, 80) + '...' : cite.quote}"
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black text-blue-600 dark:text-blue-400">출처: {cite.source}</span>
                      {cite.web_links?.[0] && (
                        <a href={cite.web_links[0]} target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold text-blue-500 hover:underline flex items-center gap-0.5">
                          <ExternalLink size={9} /> 링크
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* 푸터 */}
        <div className="px-6 py-4 border-t border-border-light dark:border-border-dark flex-shrink-0 flex items-center gap-3">
          {error && <p className="text-xs font-bold text-red-500 flex-1">{error}</p>}
          <div className="flex items-center gap-2 ml-auto">
            <button onClick={onClose} className="px-4 py-2 rounded-xl border border-border-light dark:border-border-dark text-sm font-bold hover:bg-black/5 dark:hover:bg-white/5 transition-all">
              취소
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary/90 transition-all active:scale-95 disabled:opacity-60 flex items-center gap-2"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              저장
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const LABEL_MAP: Record<string, string> = {
  TITLE: '제목', DATE: '날짜', AMOUNT: '금액', VENDOR: '업체', ADDRESS: '주소',
  PERSON: '인명', KEYWORD: '키워드', PHONE: '전화', EMAIL: '이메일',
  NAME: '이름', NUMBER: '번호', ID: '식별번호', COMPANY: '기관명',
  title: '제목', date: '날짜', amount: '금액', vendor: '업체', address: '주소',
  person: '인명', keyword: '키워드', phone: '전화', email: '이메일',
  name: '이름', number: '번호', id: '식별번호', company: '기관명',
}

export default function ExtractionListPage() {
  const [userId, setUserId] = useState('')
  const [docs, setDocs] = useState<MetaDoc[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(15)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [categories, setCategories] = useState<string[]>([])
  const [editingDoc, setEditingDoc] = useState<MetaDoc | null>(null)

  useEffect(() => {
    const stored = localStorage.getItem('user')
    if (stored) setUserId(JSON.parse(stored).user_id || 'default')
  }, [])

  useEffect(() => {
    if (!userId) return
    fetch(`${API_BASE_URL}/api/metadata-v3/categories?user_id=${userId}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        const names = (data as { name: string }[]).map(c => c.name)
        setCategories(names.length ? names : ['공문서', '계약서', '보고서', '영수증', '기타'])
      })
      .catch(() => setCategories(['공문서', '계약서', '보고서', '영수증', '기타']))
  }, [userId])

  const handleSaved = (updated: MetaDoc) => {
    setDocs(prev => prev.map(d => d.job_id === updated.job_id ? { ...d, ...updated } : d))
  }

  const fetchDocs = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({
        user_id: userId,
        page: String(page),
        page_size: String(pageSize),
        search: search,
        sort_by: 'created_at',
        sort_dir: 'desc'
      })
      const res = await fetch(`${API_BASE_URL}/api/metadata-v3/documents?${params}`)
      if (res.ok) {
        const data = await res.json()
        setDocs(data.items)
        setTotal(data.total)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [userId, page, pageSize, search])

  useEffect(() => {
    fetchDocs()
  }, [fetchDocs])

  const totalPages = Math.ceil(total / pageSize)

  const HIDDEN_TYPES = new Set(['문서유형', '언어', 'DOC_TYPE', 'LANGUAGE'])

  const fieldLabel = (f: MetaDoc['extracted_fields'][0]) => {
    const ko = f.entity_type_ko?.trim()
    if (ko && !/^[a-zA-Z_]+$/.test(ko)) return ko
    return LABEL_MAP[f.entity_type || ''] || LABEL_MAP[f.key || ''] || ko || f.key || f.entity_type || ''
  }

  return (
    <div className="flex bg-slate-50 dark:bg-slate-50">
      <Sidebar />
      <main className="flex-1 ml-64 mt-14 flex flex-col h-[calc(100vh-3.5rem)] overflow-hidden">
        
        {/* Header */}
        <div className="px-8 py-6 border-b border-border-light dark:border-border-dark bg-surface-light/30 dark:bg-surface-dark/30 backdrop-blur-md flex-shrink-0">
          <div className="flex justify-between items-end">
            <div>
<h1 className="text-2xl font-black text-text-primary-light dark:text-text-primary-dark tracking-tight flex items-center gap-3">
                <DatabaseIcon className="text-primary" size={28} /> 메타데이터 추출 리스트
              </h1>
              <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark mt-2 font-medium">
                분석이 완료된 문서들로부터 추출된 비정형 메타데이터 현황을 한눈에 확인합니다.
              </p>
            </div>
            
            <div className="flex items-center gap-3">
              <button 
                onClick={fetchDocs}
                className="p-2.5 rounded-xl border border-border-light dark:border-border-dark hover:bg-black/5 dark:hover:bg-white/5 text-text-secondary-light transition-all active:scale-95"
                title="새로고침"
              >
                <RefreshIcon size={20} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>
        </div>

        {/* Filters/Search */}
        <div className="px-8 py-4 border-b border-border-light dark:border-border-dark flex items-center gap-4 bg-surface-light/10 dark:bg-surface-dark/10">
          <div className="flex-1 max-w-xl flex items-center gap-2">
            <div className="relative flex-1">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary-light" size={18} />
              <input 
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="파일명으로 검색..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#E8EDF4] border border-border-light outline-none focus:border-primary/50 text-sm font-medium transition-all"
              />
            </div>
            <button
              type="button"
              onClick={fetchDocs}
              disabled={loading}
              className="px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary/90 transition-all active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
              aria-label="검색"
            >
              검색
            </button>
          </div>
          <div className="ml-auto text-xs font-bold text-text-secondary-light">
             총 <span className="text-primary">{total}</span> 건의 데이터
          </div>
        </div>

        {/* Content Table Area */}
        <div className="flex-1 overflow-y-auto bg-bg-light dark:bg-bg-dark p-6">
           <div className="rounded-2xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark shadow-sm overflow-hidden">
              <table className="w-full text-left border-collapse table-fixed">
                <colgroup>
                  <col className="w-[26%]" />
                  <col className="w-[10%]" />
                  <col className="w-[32%]" />
                  <col className="w-[21%]" />
                  <col className="w-[11%]" />
                </colgroup>
                <thead>
                  <tr className="bg-primary/10 dark:bg-primary/10 text-[11px] font-black uppercase tracking-wider text-text-secondary-light dark:text-text-secondary-dark border-b border-primary/20 dark:border-primary/20">
                    <th className="px-6 py-3 text-center">문서 정보</th>
                    <th className="px-4 py-3 text-center">유형</th>
                    <th className="px-12 py-3 text-left text-emerald-600">추출 메타데이터</th>
                    <th className="px-4 py-3 text-center">AI 요약</th>
                    <th className="px-4 py-3 text-center">일시</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light dark:divide-border-dark">
                  {loading ? (
                    Array.from({length: 5}).map((_, i) => (
                      <tr key={i} className="animate-pulse">
                        <td className="px-4 py-4"><div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-4/5 mb-2" /><div className="h-3 bg-gray-100 dark:bg-gray-900 rounded w-1/2" /></td>
                        <td className="px-4 py-4"><div className="h-5 bg-gray-200 dark:bg-gray-800 rounded-full w-14" /></td>
                        <td className="px-4 py-4"><div className="flex gap-1.5"><div className="h-5 bg-gray-100 dark:bg-gray-900 rounded w-20" /><div className="h-5 bg-gray-100 dark:bg-gray-900 rounded w-16" /></div></td>
                        <td className="px-4 py-4"><div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-full" /></td>
                        <td className="px-4 py-4" />
                      </tr>
                    ))
                  ) : docs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-20 text-center">
                        <div className="flex flex-col items-center gap-3 text-text-secondary-light">
                          <InfoIcon size={48} className="opacity-20" />
                          <p className="font-bold">추출된 데이터가 없습니다.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    docs.map((doc) => {
                      const visibleFields = (doc.extracted_fields || []).filter(
                        f => f.value && !HIDDEN_TYPES.has(f.entity_type_ko || '') && !HIDDEN_TYPES.has(f.entity_type || '')
                      )
                      return (
                        <tr key={doc.job_id} className="hover:bg-primary/5 transition-colors group cursor-default">
                          {/* 문서 정보 */}
                          <td className="px-6 py-4 align-top">
                            <div className="flex items-start justify-start gap-3 min-w-0">
                              <div className="p-1.5 rounded-lg bg-primary/10 text-primary shrink-0">
                                <FileText size={16} />
                              </div>
                              <div className="flex flex-col min-w-0">
                                <button
                                  onClick={() => setEditingDoc(doc)}
                                  className="text-xs font-bold text-text-primary-light dark:text-text-primary-dark hover:text-primary transition-colors text-left line-clamp-3 leading-snug break-words"
                                >
                                  {doc.original_filename}
                                </button>
                              </div>
                            </div>
                          </td>
                          {/* 문서 유형 */}
                          <td className="px-3 py-4 text-center align-top">
                            <span className="px-2 py-1 rounded-full bg-blue-600 text-white text-[10px] font-black inline-block max-w-full whitespace-normal break-words text-center leading-tight">
                              {doc.doc_type || '미분류'}
                            </span>
                          </td>
                          {/* 추출 메타데이터 */}
                          <td className="px-4 py-4">
                            {visibleFields.length > 0 ? (
                              <div className="flex flex-col gap-1.5 items-start pl-8">
                                <div className="flex flex-col gap-1">
                                  {visibleFields.slice(0, 5).map((f, i) => (
                                    <div key={i} className="flex items-baseline gap-0 text-[11px]">
                                      <span className="font-black text-emerald-600 shrink-0 w-[2.1rem] text-left">{fieldLabel(f)}</span>
                                      <span className="text-text-secondary-light shrink-0">·</span>
                                      <span className="font-medium text-text-primary-light dark:text-text-primary-dark truncate max-w-[300px]">{f.value}</span>
                                    </div>
                                  ))}
                                </div>
                                {visibleFields.length > 5 && (
                                  <span className="text-[10px] font-bold text-text-secondary-light">+{visibleFields.length - 5}개 더</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-[11px] text-text-secondary-light italic block text-center">-</span>
                            )}
                          </td>
                          {/* AI 요약 */}
                          <td className="px-4 py-4">
                            {doc.summary ? (
                              <p className="text-[11px] font-medium text-text-secondary-light leading-relaxed line-clamp-3 text-center mx-auto max-w-xs">{doc.summary}</p>
                            ) : (
                              <span className="text-[11px] text-text-secondary-light italic block text-center">-</span>
                            )}
                          </td>
                          {/* 일시 */}
                          <td className="px-4 py-4 text-center">
                            <div className="flex flex-col items-center">
                              <span className="text-[11px] font-bold text-text-primary-light dark:text-text-primary-dark whitespace-nowrap">
                                {new Date(doc.created_at).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })}
                              </span>
                              <span className="text-[10px] text-text-secondary-light whitespace-nowrap">
                                {new Date(doc.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
           </div>

           {/* Pagination */}
           {!loading && total > 0 && (
             <div className="mt-10 flex flex-col items-center gap-4">
                <div className="flex items-center gap-2">
                   <button
                     disabled={page === 1}
                     onClick={() => setPage(prev => prev - 1)}
                     className="p-2.5 rounded-xl border border-border-light dark:border-border-dark disabled:opacity-30 hover:bg-white dark:hover:bg-white/5 transition-all active:scale-95 text-text-primary-light dark:text-text-primary-dark"
                   >
                     <ChevronLeftIcon size={18} />
                   </button>
                   <div className="flex items-center gap-1">
                      {Array.from({length: Math.min(5, totalPages)}).map((_, i) => {
                        const pageNum = i + 1
                        return (
                          <button 
                            key={pageNum}
                            onClick={() => setPage(pageNum)}
                            className={`w-10 h-10 rounded-xl text-xs font-black transition-all ${
                              page === pageNum 
                                ? 'bg-primary text-white shadow-lg shadow-primary/20 scale-110' 
                                : 'hover:bg-white dark:hover:bg-white/5 text-text-secondary-light'
                            }`}
                          >
                            {pageNum}
                          </button>
                        )
                      })}
                   </div>
                   <button
                     disabled={page === totalPages}
                     onClick={() => setPage(prev => prev + 1)}
                     className="p-2.5 rounded-xl border border-border-light dark:border-border-dark disabled:opacity-30 hover:bg-white dark:hover:bg-white/5 transition-all active:scale-95 text-text-primary-light dark:text-text-primary-dark"
                   >
                     <ChevronRightIcon size={18} />
                   </button>
                </div>
                <p className="text-[11px] font-bold text-text-secondary-light/60 uppercase tracking-tighter">
                  Showing {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, total)} of {total} items
                </p>
             </div>
           )}
        </div>
      </main>

      {editingDoc && (
        <EditPanel
          doc={editingDoc}
          userId={userId}
          categories={categories}
          onClose={() => setEditingDoc(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
