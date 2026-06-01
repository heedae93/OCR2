'use client'

import { useState, useEffect, useCallback } from 'react'
import Sidebar from '@/components/Sidebar'
import { API_BASE_URL } from '@/lib/api'
import {
  CheckCircle2, AlertCircle, RefreshCw, Plus, Trash2, Tag, X, FileText
} from 'lucide-react'

const DEFAULT_DOC_TYPES = ['공문서', '계약서', '보고서', '학술논문', '법령문서', '회의록', '영수증', '신분증', '기타']
const HIDDEN_DOC_TYPES = ['미분류']
const ACTIVE_FIELD_CARD_COLOR = 'border-primary/35 ring-2 ring-primary/10'

const DEFAULT_METADATA_FIELDS = [
  { key: 'title',   label: '문서 제목',   desc: '문서의 이름, 주제 또는 주요 타이틀', color: 'bg-metadata-title-bg text-metadata-title-text ring-1 ring-metadata-title-ring' },
  { key: 'date',    label: '발행 날짜',   desc: '거래일, 작성일, 유효 기간 등',    color: 'bg-metadata-date-bg text-metadata-date-text ring-1 ring-metadata-date-ring' },
  { key: 'amount',  label: '금액 / 수치',  desc: '합계, 공급가액, 수량 등 숫자 데이터',  color: 'bg-metadata-amount-bg text-metadata-amount-text ring-1 ring-metadata-amount-ring' },
  { key: 'vendor',  label: '업체 / 기관명', desc: '발행처, 상호, 거래처명 등',        color: 'bg-metadata-vendor-bg text-metadata-vendor-text ring-1 ring-metadata-vendor-ring' },
  { key: 'address', label: '주소 / 위치',   desc: '도로명 주소, 지번, 장소 정보',      color: 'bg-metadata-address-bg text-metadata-address-text ring-1 ring-metadata-address-ring' },
  { key: 'person',  label: '인명 / 담당자', desc: '작성자, 서명자, 고객 성함 등',      color: 'bg-metadata-person-bg text-metadata-person-text ring-1 ring-metadata-person-ring' },
]

export default function MetadataV3Page() {
  const [userId, setUserId] = useState('')
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const [categories, setCategories] = useState<{id: number, name: string}[]>([])
  const [customFields, setCustomFields] = useState<{id: number, field_key: string, label: string, pattern: string, description: string}[]>([])
  const [rules, setRules] = useState<Record<string, string[]>>({})
  
  const [selectedDocType, setSelectedDocType] = useState(DEFAULT_DOC_TYPES[0])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [newCatName, setNewCatName] = useState('')
  const [isAddingCat, setIsAddingCat] = useState(false)

  const [isAddingField, setIsAddingField] = useState(false)
  const [newField, setNewField] = useState({ label: '', pattern: '', description: '' })

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 2500)
  }

  useEffect(() => {
    const stored = localStorage.getItem('user')
    if (stored) {
      const parsed = JSON.parse(stored)
      setUserId(parsed.user_id || '')
    }
  }, [])

  const loadData = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    try {
      const [catsRes, fieldsRes, rulesRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/metadata-v3/categories?user_id=${userId}`),
        fetch(`${API_BASE_URL}/api/metadata-v3/custom-fields?user_id=${userId}`),
        fetch(`${API_BASE_URL}/api/metadata-v3/masking-rules?user_id=${userId}`),
      ])

      const cats: { id: number; name: string }[] = catsRes.ok ? await catsRes.json() : []
      const custom: { id: number; field_key: string; label: string; pattern: string; description: string }[] =
        fieldsRes.ok ? await fieldsRes.json() : []
      const rawRules: Record<string, string[]> = rulesRes.ok ? await rulesRes.json() : {}

      setCategories(cats)
      setCustomFields(custom)

      const visibleCategories = cats.filter(c => !HIDDEN_DOC_TYPES.includes(c.name))
      const docTypesList = [
        ...DEFAULT_DOC_TYPES,
        ...visibleCategories.map(c => c.name).filter(name => !DEFAULT_DOC_TYPES.includes(name)),
      ]
      const allFieldKeys = [
        ...DEFAULT_METADATA_FIELDS.map(f => f.key),
        ...custom.map(f => f.field_key),
      ]
      const merged: Record<string, string[]> = { ...rawRules }
      for (const dt of docTypesList) {
        const cur = merged[dt]
        if (!cur || cur.length === 0) {
          merged[dt] = [...allFieldKeys]
        }
      }
      setRules(merged)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    loadData()
  }, [loadData])

  const addCategory = async () => {
    if (!newCatName.trim()) return
    try {
      const res = await fetch(`${API_BASE_URL}/api/metadata-v3/categories?user_id=${userId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newCatName.trim() })
      })
      if (res.ok) {
        setNewCatName('')
        setIsAddingCat(false)
        loadData()
        setSelectedDocType(newCatName.trim())
      }
    } catch (e) {}
  }

  const deleteCategory = async (id: number) => {
    try {
      await fetch(`${API_BASE_URL}/api/metadata-v3/categories/${id}?user_id=${userId}`, { method: 'DELETE' })
      loadData()
    } catch (e) {}
  }

  const addCustomField = async () => {
    if (!newField.label.trim()) return
    try {
      const res = await fetch(`${API_BASE_URL}/api/metadata-v3/custom-fields?user_id=${userId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
           label: newField.label,
           pattern: newField.pattern || null,
           description: newField.description || null
        })
      })
      if (res.ok) {
        setNewField({ label: '', pattern: '', description: '' })
        setIsAddingField(false)
        loadData()
      }
    } catch (e) {}
  }

  const deleteCustomField = async (id: number, _fieldKey: string) => {
    try {
      await fetch(`${API_BASE_URL}/api/metadata-v3/custom-fields/${id}?user_id=${userId}`, { method: 'DELETE' })
      loadData()
    } catch (e) {}
  }

  const visibleCategories = categories.filter(c => !HIDDEN_DOC_TYPES.includes(c.name))
  const allDocTypes = [
    ...DEFAULT_DOC_TYPES,
    ...visibleCategories.map(c => c.name).filter(name => !DEFAULT_DOC_TYPES.includes(name)),
  ]
  const currentPiiTypes = rules[selectedDocType] ?? []

  const saveRulesFor = async (docType: string, piiTypes: string[], showSuccess = false) => {
    setSaving(true)
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/metadata-v3/masking-rules?user_id=${userId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ doc_type: docType, pii_types: piiTypes }),
        }
      )
      if (!res.ok) throw new Error('Failed to save extraction rules')
      if (showSuccess) showToast('저장되었습니다')
    } catch (e) {
      showToast('자동 저장에 실패했습니다', false)
    } finally {
      setSaving(false)
    }
  }

  const togglePii = (piiKey: string) => {
    const updated = currentPiiTypes.includes(piiKey)
      ? currentPiiTypes.filter(k => k !== piiKey)
      : [...currentPiiTypes, piiKey]
    setRules(prev => ({ ...prev, [selectedDocType]: updated }))
    void saveRulesFor(selectedDocType, updated)
  }

  // Combine default fields with custom fields
  const allFields = [
    ...DEFAULT_METADATA_FIELDS.map(i => ({ ...i, isCustom: false, id: null, pattern: null })),
    ...customFields.map(f => ({
      key: f.field_key,
      label: f.label,
      desc: f.description || '특정한 패턴이 일치하면 메타데이터 추출',
      color: 'bg-metadata-custom-bg text-metadata-custom-text ring-1 ring-metadata-custom-ring',
      isCustom: true,
      id: f.id,
      pattern: f.pattern
    }))
  ]

  return (
    <div className="flex bg-slate-50 dark:bg-slate-50">
      <Sidebar />
      <main className="flex-1 ml-64 flex flex-col h-[calc(100vh)] overflow-hidden">

        <div className="px-6 py-6 border-b border-border-light bg-surface-light flex-shrink-0">
          <h1 className="text-xl font-bold text-text-primary-light tracking-tight">문서 유형별 추출 메타데이터 관리</h1>
          <p className="text-sm text-text-secondary-light mt-1">
            문서 카테고리를 선택하고, 해당 문서에서 자동으로 추출할 중요 데이터 필드를 설정합니다.
          </p>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* 분류 리스트 */}
          <div className="w-64 flex-shrink-0 border-r border-border-light flex flex-col bg-white">
            <div className="px-4 py-3 border-b border-border-light flex justify-between items-center bg-white">
              <span className="text-xs font-bold text-text-secondary-light tracking-wider">
                문서 카테고리
              </span>
            </div>
            
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {allDocTypes.map(docType => {
                const count = (rules[docType] ?? []).length
                const isSelected = selectedDocType === docType
                const customCat = categories.find(c => c.name === docType)

                return (
                  <div key={docType} className={`group flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-primary/10 text-primary font-bold shadow-sm'
                      : 'hover:bg-primary/5 text-text-primary-light font-medium'
                  }`} onClick={() => setSelectedDocType(docType)}>
                    <div className="flex items-center gap-2">
                       <Tag size={14} className={isSelected ? 'text-primary' : 'text-text-secondary-light'}/>
                       <span className="text-sm">{docType}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {count > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-bold tracking-tighter">
                          {count}
                        </span>
                      )}
                      {customCat && (
                         <button onClick={(e) => { e.stopPropagation(); deleteCategory(customCat.id) }} 
                           className="opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-500" title="카테고리 삭제">
                           <Trash2 size={13} />
                         </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="p-3 border-t border-border-light dark:border-border-dark">
              {isAddingCat ? (
                <div className="flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2">
                  <input autoFocus value={newCatName} onChange={e => setNewCatName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCategory()}
                    placeholder="카테고리명" className="flex-1 px-2 py-1.5 text-xs font-bold rounded-lg bg-background-light border outline-none border-primary/50 text-text-primary-light" />
                  <button onClick={addCategory} className="px-2 py-1.5 bg-primary text-white rounded-lg text-xs font-bold shadow hover:scale-105 active:scale-95 transition-transform">추가</button>
                  <button onClick={() => setIsAddingCat(false)} className="text-text-secondary-light hover:text-text-primary-light px-1"><AlertCircle size={14} className="hidden" /> 취소</button>
                </div>
              ) : (
                <button onClick={() => setIsAddingCat(true)} className="w-full flex justify-center items-center gap-2 py-2 text-sm text-text-secondary-light hover:text-primary font-bold transition-colors border border-dashed border-border-light hover:border-primary/50 hover:bg-primary/5 rounded-xl">
                  <Plus size={16} /> 새 카테고리
                </button>
              )}
            </div>
          </div>

          {/* 메타데이터 추출 설정 영역 */}
          <div className="flex-1 flex flex-col bg-white">
            <div className="px-10 py-6 border-b border-border-light bg-white flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold flex items-center gap-3 text-text-primary-light tracking-tight">
                   <FileText size={24} className="text-primary" /> {selectedDocType}
                   {currentPiiTypes.length > 0 && <span className="text-xs font-bold px-2 py-1 rounded-full bg-primary/10 text-primary">설정 {currentPiiTypes.length}건</span>}
                </h2>
                <p className="text-sm text-text-secondary-light mt-2 font-medium">이 카테고리로 분류된 문서를 분석할 때, 활성화된 데이터 항목을 자동으로 추출하여 색인화합니다.</p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-10">
              {loading ? (
                <div className="flex h-40 items-center justify-center">
                  <RefreshCw className="animate-spin text-primary" size={32} />
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-base font-bold text-text-primary-light dark:text-text-primary-dark tracking-widest uppercase">
                      추출 필드 설정
                    </h3>
                    <button onClick={() => setIsAddingField(true)} className="flex h-10 items-center text-[15px] font-bold text-white bg-primary hover:bg-primary/90 px-6 rounded-full transition-colors shadow-sm">
                      추출 필드 추가
                    </button>
                  </div>

                  <div className="grid grid-cols-2 xl:grid-cols-3 gap-5">
                    {allFields.map(item => {
                      const enabled = currentPiiTypes.includes(item.key)
                      
                      return (
                        <div key={item.key} className={`group relative flex flex-col text-left p-5 rounded-2xl border transition-all duration-200 ease-out ${enabled ? `bg-primary/[0.03] ${ACTIVE_FIELD_CARD_COLOR} shadow-md` : 'bg-slate-50/60 border-border-light hover:border-slate-300 opacity-80 hover:opacity-100 hover:shadow-sm'}`}>
                          
                          {/* 삭제 버튼 - 커스텀 필드일때만 등장 */}
                          {item.isCustom && item.id && (
                            <button onClick={(e) => { e.stopPropagation(); deleteCustomField(item.id!, item.key) }} className="absolute -top-3 -right-3 w-8 h-8 bg-red-100 text-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 shadow transform scale-75 group-hover:scale-100 transition-all hover:bg-red-500 hover:text-white z-10" title="필드 완전 삭제">
                              <Trash2 size={14} />
                            </button>
                          )}

                          <div className="flex items-start justify-between w-full mb-3 cursor-pointer" onClick={() => togglePii(item.key)}>
                            <div className="flex flex-col gap-2 max-w-[70%]">
                              <span className={`text-xs px-3 py-1.5 rounded-full font-bold self-start ${item.color}`}>{item.label}</span>
                              {item.pattern && <span className="text-[10px] font-mono tracking-tighter text-text-secondary-light break-all leading-tight bg-black/5 px-2 py-1 rounded">{item.pattern}</span>}
                            </div>
                            <div className={`w-12 h-6 rounded-full flex items-center transition-colors px-1 shrink-0 ${enabled ? (item.isCustom ? 'bg-sky-500' : 'bg-primary') : 'bg-gray-300'}`}>
                              <div className={`w-4 h-4 rounded-full bg-white shadow-sm transform transition-transform ${enabled ? 'translate-x-[22px]' : 'translate-x-0'}`} />
                            </div>
                          </div>
                          <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark font-medium leading-relaxed">{item.desc}</p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 커스텀 필드 생성 모달 */}
        {isAddingField && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-surface-light dark:bg-surface-dark w-11/12 max-w-md p-8 rounded-3xl shadow-2xl flex flex-col gap-5 animate-in zoom-in-95 duration-200">
              <div className="flex justify-between items-center mb-1">
                <h3 className="text-xl font-bold text-text-primary-light dark:text-text-primary-dark">새 추출 필드 정의</h3>
                <button onClick={() => setIsAddingField(false)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-text-secondary-light transition-colors">
                  <X size={20} />
                </button>
              </div>

              <div>
                <label className="text-xs font-bold text-sky-600 mb-1.5 block uppercase tracking-wide">필드명 (UI 표시용)</label>
                <input autoFocus placeholder="예: 차량번호, 계좌번호" className="w-full text-base font-bold bg-transparent border-b-2 border-border-light dark:border-border-dark outline-none py-2 focus:border-sky-500 text-text-primary-light dark:text-text-primary-dark transition-colors" value={newField.label} onChange={e => setNewField({...newField, label: e.target.value})} />
              </div>

              <div>
                <label className="text-xs font-bold text-sky-600 mb-1.5 block uppercase tracking-wide">정규표현식 패턴 (선택)</label>
                <input placeholder="예: [0-9]{2,3}[가-힣]{1}[0-9]{4}" className="w-full font-mono text-sm tracking-tight bg-transparent border-b-2 border-border-light dark:border-border-dark outline-none py-2 focus:border-sky-500 text-text-primary-light dark:text-text-primary-dark transition-colors" value={newField.pattern} onChange={e => setNewField({...newField, pattern: e.target.value})} />
              </div>

              <div>
                <label className="text-xs font-bold text-sky-600 mb-1.5 block uppercase tracking-wide">필드 설명 (선택)</label>
                <input placeholder="추출하고자 하는 데이터 의미를 작성" className="w-full text-sm bg-transparent border-b-2 border-border-light dark:border-border-dark outline-none py-2 focus:border-sky-500 text-text-primary-light dark:text-text-primary-dark transition-colors" value={newField.description} onChange={e => setNewField({...newField, description: e.target.value})} />
              </div>
              
              <div className="flex justify-end gap-3 mt-4">
                 <button onClick={() => setIsAddingField(false)} className="text-sm font-bold px-5 py-2.5 text-text-secondary-light hover:text-text-primary-light rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors">취소</button>
                 <button onClick={addCustomField} className="text-sm font-bold px-6 py-2.5 bg-sky-500 text-white rounded-xl shadow-md hover:bg-sky-600 focus:scale-95 transition-all disabled:opacity-50" disabled={!newField.label.trim()}>정의 완료</button>
              </div>
            </div>
          </div>
        )}

        {toast && (
           <div className={`fixed bottom-8 right-8 flex items-center gap-3 px-6 py-4 rounded-2xl shadow-2xl text-sm font-bold text-white z-[60] animate-in slide-in-from-bottom-5 fade-in duration-300 ${toast.ok ? 'bg-green-500' : 'bg-red-500'}`}>
            {toast.ok ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
            {toast.msg}
          </div>
        )}
      </main>
    </div>
  )
}
