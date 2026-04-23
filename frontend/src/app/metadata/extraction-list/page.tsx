'use client'

import { useState, useEffect, useCallback } from 'react'
import Sidebar from '@/components/Sidebar'
import { API_BASE_URL } from '@/lib/api'
import {
  Search as SearchIcon, 
  Filter as FilterIcon, 
  FileText, 
  ExternalLink, 
  ChevronLeft as ChevronLeftIcon, 
  ChevronRight as ChevronRightIcon,
  RefreshCw as RefreshIcon,
  Database as DatabaseIcon,
  Tag as TagIcon,
  Calendar,
  Info as InfoIcon,
  MoreVertical
} from 'lucide-react'

interface Document {
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
}

export default function ExtractionListPage() {
  const [userId, setUserId] = useState('')
  const [docs, setDocs] = useState<Document[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(15)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [docTypeFilter, setDocTypeFilter] = useState('')

  useEffect(() => {
    const stored = localStorage.getItem('user')
    if (stored) {
      setUserId(JSON.parse(stored).user_id || 'default')
    }
  }, [])

  const fetchDocs = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({
        user_id: userId,
        page: String(page),
        page_size: String(pageSize),
        search: search,
        doc_type: docTypeFilter,
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
  }, [userId, page, pageSize, search, docTypeFilter])

  useEffect(() => {
    fetchDocs()
  }, [fetchDocs])

  const totalPages = Math.ceil(total / pageSize)

  return (
    <div className="flex h-screen bg-bg-light dark:bg-bg-dark">
      <Sidebar />
      <main className="flex-1 ml-64 flex flex-col h-screen overflow-hidden">
        
        {/* Header */}
        <div className="px-8 py-6 border-b border-border-light dark:border-border-dark bg-surface-light/30 dark:bg-surface-dark/30 backdrop-blur-md flex-shrink-0">
          <div className="flex justify-between items-end">
            <div>
              <nav className="flex items-center gap-2 text-xs font-bold text-text-secondary-light dark:text-text-secondary-dark mb-2 uppercase tracking-widest">
                <span>메타데이터 관리</span>
                <ChevronRightIcon size={12} />
                <span className="text-primary">추출 리스트</span>
              </nav>
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
          <div className="relative flex-1 max-w-md">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary-light" size={18} />
            <input 
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="파일명으로 검색..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark outline-none focus:border-primary/50 text-sm font-medium transition-all"
            />
          </div>
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark">
             <FilterIcon size={16} className="text-text-secondary-light" />
             <select 
               value={docTypeFilter} 
               onChange={e => setDocTypeFilter(e.target.value)}
               className="bg-transparent text-sm font-bold outline-none text-text-primary-light dark:text-text-primary-dark cursor-pointer"
             >
               <option value="">모든 카테고리</option>
               <option value="영수증">영수증</option>
               <option value="계약서">계약서</option>
               <option value="공문서">공문서</option>
               <option value="기타">기타</option>
             </select>
          </div>
          <div className="ml-auto text-xs font-bold text-text-secondary-light">
             총 <span className="text-primary">{total}</span> 건의 데이터
          </div>
        </div>

        {/* Content Table Area */}
        <div className="flex-1 overflow-auto bg-bg-light dark:bg-bg-dark p-8">
           <div className="rounded-2xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark shadow-sm overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-black/5 dark:bg-white/5 text-[11px] font-black uppercase tracking-wider text-text-secondary-light dark:text-text-secondary-dark border-b border-border-light dark:border-border-dark">
                    <th className="px-6 py-4 w-1/3">문서 정보</th>
                    <th className="px-6 py-4 w-48">문서 유형</th>
                    <th className="px-6 py-4">추출된 메타데이터</th>
                    <th className="px-6 py-4">AI 분석 (요약/출처)</th>
                    <th className="px-6 py-4 w-32">처리 일시</th>
                    <th className="px-6 py-4 w-16"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light dark:divide-border-dark">
                  {loading ? (
                    Array.from({length: 5}).map((_, i) => (
                      <tr key={i} className="animate-pulse">
                        <td className="px-6 py-6"><div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-4/5 mb-2"></div><div className="h-3 bg-gray-100 dark:bg-gray-900 rounded w-1/2"></div></td>
                        <td className="px-6 py-6"><div className="h-6 bg-gray-200 dark:bg-gray-800 rounded-full w-20"></div></td>
                        <td className="px-6 py-6"><div className="flex gap-2"><div className="h-6 bg-gray-100 dark:bg-gray-900 rounded-lg w-24"></div><div className="h-6 bg-gray-100 dark:bg-gray-900 rounded-lg w-32"></div></div></td>
                        <td className="px-6 py-6"><div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-full"></div></td>
                        <td className="px-6 py-6"></td>
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
                    docs.map((doc) => (
                      <tr key={doc.job_id} className="hover:bg-primary/5 transition-colors group cursor-default">
                        <td className="px-6 py-5">
                          <div className="flex items-start gap-4">
                             <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
                                <FileText size={20} />
                             </div>
                             <div className="flex flex-col min-w-0">
                                <span className="text-sm font-bold text-text-primary-light dark:text-text-primary-dark truncate group-hover:text-primary transition-colors">
                                  {doc.original_filename}
                                </span>
                                <a 
                                  href={`${API_BASE_URL}/api/ocr/stream-pdf/${doc.job_id}?user_id=${userId}`}
                                  target="_blank"
                                  className="text-[10px] font-bold text-text-secondary-light flex items-center gap-1 mt-1 hover:text-primary transition-colors"
                                >
                                  <ExternalLink size={10} /> 원본 문서 보기
                                </a>
                             </div>
                          </div>
                        </td>
                        <td className="px-6 py-5">
                           <span className="px-3 py-1 rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300 text-[11px] font-black uppercase tracking-tighter border border-blue-200 dark:border-blue-800">
                              {doc.doc_type || '미분류'}
                           </span>
                        </td>
                        <td className="px-6 py-5">
                           <div className="flex flex-wrap gap-2">
                              {doc.extracted_fields && doc.extracted_fields.length > 0 ? (
                                doc.extracted_fields.slice(0, 5).map((field, idx) => (
                                  <div key={idx} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark shadow-sm">
                                     <span className="text-[10px] font-black text-primary/70 uppercase">{field.key || field.entity_type_ko}</span>
                                     <span className="text-xs font-bold text-text-primary-light dark:text-text-primary-dark line-clamp-1">{field.value}</span>
                                  </div>
                                ))
                              ) : (
                                <span className="text-xs text-text-secondary-light italic font-medium">추출된 항목 없음</span>
                              )}
                              {doc.extracted_fields && doc.extracted_fields.length > 5 && (
                                <span className="text-[10px] font-bold text-text-secondary-light bg-black/5 dark:bg-white/5 px-2 py-1.5 rounded-lg">
                                  +{doc.extracted_fields.length - 5}
                                </span>
                              )}
                           </div>
                        </td>
                        <td className="px-6 py-5">
                           <div className="flex flex-col gap-3 max-w-md">
                              {doc.summary ? (
                                <div className="p-3 rounded-xl bg-primary/5 border border-primary/10">
                                  <div className="flex items-center gap-1.5 mb-1 text-[10px] font-black text-primary uppercase tracking-wider">
                                    <FileText size={12} /> 문서 요약
                                  </div>
                                  <p className="text-xs font-medium text-text-primary-light dark:text-text-primary-dark leading-relaxed line-clamp-3">
                                    {doc.summary}
                                  </p>
                                </div>
                              ) : (
                                <span className="text-xs text-text-secondary-light italic font-medium">요약 정보 없음</span>
                              )}

                              {doc.citations && doc.citations.length > 0 && (
                                <div className="flex flex-col gap-2">
                                  <div className="flex items-center gap-1.5 text-[10px] font-black text-blue-500 uppercase tracking-wider">
                                    <ExternalLink size={12} /> 인용구 및 외부 출처 ({doc.citations.length})
                                  </div>
                                  <div className="flex flex-col gap-2">
                                    {doc.citations.slice(0, 2).map((cite, idx) => (
                                      <div key={idx} className="p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/50">
                                        <p className="text-[11px] font-bold text-text-primary-light dark:text-text-primary-dark italic mb-1">
                                          "{cite.quote.length > 50 ? cite.quote.substring(0, 50) + '...' : cite.quote}"
                                        </p>
                                        <div className="flex items-center justify-between">
                                          <span className="text-[10px] font-black text-blue-600 dark:text-blue-400">
                                            출처: {cite.source}
                                          </span>
                                          {cite.web_links && cite.web_links.length > 0 && (
                                            <a 
                                              href={cite.web_links[0]} 
                                              target="_blank" 
                                              rel="noopener noreferrer"
                                              className="text-[9px] font-bold text-blue-500 hover:underline"
                                            >
                                              링크 보기
                                            </a>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                           </div>
                        </td>
                        <td className="px-6 py-5">
                           <div className="flex flex-col">
                              <span className="text-xs font-bold text-text-primary-light dark:text-text-primary-dark">
                                {new Date(doc.created_at).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })}
                              </span>
                              <span className="text-[10px] font-medium text-text-secondary-light">
                                {new Date(doc.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                           </div>
                        </td>
                        <td className="px-6 py-5 text-right">
                           <button className="p-1 px-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-text-secondary-light transition-all opacity-0 group-hover:opacity-100">
                             <MoreVertical size={16} />
                           </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
           </div>

           {/* Pagination */}
           {!loading && total > 0 && (
             <div className="mt-8 flex items-center justify-between">
                <p className="text-xs font-medium text-text-secondary-light">
                  {total}건 중 {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, total)}건 표시 중
                </p>
                <div className="flex items-center gap-2">
                   <button 
                     disabled={page === 1}
                     onClick={() => setPage(prev => prev - 1)}
                     className="p-2 rounded-xl border border-border-light dark:border-border-dark disabled:opacity-30 hover:bg-white dark:hover:bg-white/5 transition-all active:scale-95"
                   >
                     <ChevronLeftIcon size={18} />
                   </button>
                   <div className="flex items-center gap-1">
                      {Array.from({length: Math.min(5, totalPages)}).map((_, i) => {
                        const pageNum = i + 1 // Simple pagination for now
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
                     className="p-2 rounded-xl border border-border-light dark:border-border-dark disabled:opacity-30 hover:bg-white dark:hover:bg-white/5 transition-all active:scale-95"
                   >
                     <ChevronRightIcon size={18} />
                   </button>
                </div>
             </div>
           )}
        </div>
      </main>
    </div>
  )
}
