'use client'

import { useState, useEffect, useCallback } from 'react'
import Sidebar from '@/components/Sidebar'
import { API_BASE_URL } from '@/lib/api'
import {
  Plus, Pencil, Trash2, Search, ChevronRight, X, Save,
  FileText, Tag, Cpu, AlertCircle, CheckCircle2,
} from 'lucide-react'

// ─────────────────────────────────────────────
// 타입 정의
// ─────────────────────────────────────────────

interface DocumentType {
  type_id: string
  name: string
  category: string | null
  description: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  field_count: number
}

interface Field {
  field_id: string
  name: string
  key: string
  field_type: string
  is_pii: boolean
  is_required: boolean
  ai_model: string
  extraction_hint: string | null
  order: number
  created_at: string
}

const FIELD_TYPES = [
  { value: 'text',    label: '텍스트' },
  { value: 'number',  label: '숫자' },
  { value: 'date',    label: '날짜' },
  { value: 'phone',   label: '전화번호' },
  { value: 'rrn',     label: '주민등록번호' },
  { value: 'address', label: '주소' },
  { value: 'email',   label: '이메일' },
  { value: 'name',    label: '이름' },
]

const AI_MODELS = [
  { value: 'regex', label: '정규식 (Regex)', desc: '패턴 기반 고속 추출' },
  { value: 'ner',   label: 'NER',            desc: '개체명 인식 모델' },
  { value: 'llm',   label: 'LLM (ExaOne)',   desc: '대형 언어 모델 추출' },
]

const CATEGORIES = ['의료', '금융', '공문서', '계약서', '신분증', '기타']

const AI_BADGE: Record<string, string> = {
  regex: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  ner:   'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  llm:   'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
}

const TYPE_BADGE: Record<string, string> = {
  text:    'bg-gray-100 text-gray-600',
  number:  'bg-green-100 text-green-700',
  date:    'bg-sky-100 text-sky-700',
  phone:   'bg-violet-100 text-violet-700',
  rrn:     'bg-red-100 text-red-700',
  address: 'bg-orange-100 text-orange-700',
  email:   'bg-pink-100 text-pink-700',
  name:    'bg-teal-100 text-teal-700',
}

// ─────────────────────────────────────────────
// 필드 폼 모달
// ─────────────────────────────────────────────

function FieldModal({
  field,
  onSave,
  onClose,
}: {
  field: Partial<Field> | null
  onSave: (data: Partial<Field>) => void
  onClose: () => void
}) {
  const [form, setForm] = useState<Partial<Field>>(
    field ?? { field_type: 'text', ai_model: 'regex', is_pii: false, is_required: false, order: 0 }
  )

  const set = (k: keyof Field, v: unknown) => setForm(prev => ({ ...prev, [k]: v }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-gray-900 dark:text-white text-lg">
            {field?.field_id ? '필드 수정' : '필드 추가'}
          </h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-500" /></button>
        </div>

        <div className="space-y-4">
          {/* 이름 / 키 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">필드 이름 *</label>
              <input
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                placeholder="예: 환자명"
                value={form.name ?? ''}
                onChange={e => set('name', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">키 (영문) *</label>
              <input
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                placeholder="예: patient_name"
                value={form.key ?? ''}
                onChange={e => set('key', e.target.value.replace(/\s/g, '_').toLowerCase())}
              />
            </div>
          </div>

          {/* 필드 유형 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">필드 유형</label>
            <div className="grid grid-cols-4 gap-2">
              {FIELD_TYPES.map(t => (
                <button
                  key={t.value}
                  onClick={() => set('field_type', t.value)}
                  className={`py-1.5 text-xs rounded-lg border transition-colors ${
                    form.field_type === t.value
                      ? 'border-primary bg-primary text-white'
                      : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-primary'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* AI 모델 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">AI 추출 방식</label>
            <div className="space-y-2">
              {AI_MODELS.map(m => (
                <label
                  key={m.value}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    form.ai_model === m.value
                      ? 'border-primary bg-primary/5'
                      : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="ai_model"
                    value={m.value}
                    checked={form.ai_model === m.value}
                    onChange={() => set('ai_model', m.value)}
                    className="accent-primary"
                  />
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-white">{m.label}</div>
                    <div className="text-xs text-gray-500">{m.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* LLM 힌트 (llm 선택 시) */}
          {form.ai_model === 'llm' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                LLM 추출 힌트 (프롬프트에 추가될 설명)
              </label>
              <textarea
                rows={2}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none"
                placeholder="예: 문서에서 환자의 이름을 찾아 추출하라"
                value={form.extraction_hint ?? ''}
                onChange={e => set('extraction_hint', e.target.value)}
              />
            </div>
          )}

          {/* NER 레이블 (ner 선택 시) */}
          {form.ai_model === 'ner' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                NER 레이블
              </label>
              <input
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                placeholder="예: PERSON, ORG, DATE"
                value={form.extraction_hint ?? ''}
                onChange={e => set('extraction_hint', e.target.value)}
              />
            </div>
          )}

          {/* 토글: 개인정보 / 필수 */}
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <button
                type="button"
                onClick={() => set('is_pii', !form.is_pii)}
                className={`w-10 h-5 rounded-full transition-colors ${form.is_pii ? 'bg-red-500' : 'bg-gray-300'}`}
              >
                <span className={`block w-4 h-4 m-0.5 rounded-full bg-white shadow transition-transform ${form.is_pii ? 'translate-x-5' : ''}`} />
              </button>
              <span className="text-sm text-gray-700 dark:text-gray-300">개인정보 (마스킹 대상)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <button
                type="button"
                onClick={() => set('is_required', !form.is_required)}
                className={`w-10 h-5 rounded-full transition-colors ${form.is_required ? 'bg-primary' : 'bg-gray-300'}`}
              >
                <span className={`block w-4 h-4 m-0.5 rounded-full bg-white shadow transition-transform ${form.is_required ? 'translate-x-5' : ''}`} />
              </button>
              <span className="text-sm text-gray-700 dark:text-gray-300">필수 필드</span>
            </label>
          </div>

          {/* 순서 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">표시 순서</label>
            <input
              type="number"
              min={0}
              className="w-24 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              value={form.order ?? 0}
              onChange={e => set('order', Number(e.target.value))}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg"
          >
            취소
          </button>
          <button
            onClick={() => onSave(form)}
            disabled={!form.name || !form.key}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-primary hover:bg-primary/90 text-white rounded-lg disabled:opacity-40"
          >
            <Save className="w-4 h-4" />
            저장
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// 문서 유형 폼 모달
// ─────────────────────────────────────────────

function DocTypeModal({
  docType,
  onSave,
  onClose,
}: {
  docType: Partial<DocumentType> | null
  onSave: (data: { name: string; category: string; description: string }) => void
  onClose: () => void
}) {
  const [name, setName] = useState(docType?.name ?? '')
  const [category, setCategory] = useState(docType?.category ?? '')
  const [description, setDescription] = useState(docType?.description ?? '')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-gray-900 dark:text-white text-lg">
            {docType?.type_id ? '문서 유형 수정' : '문서 유형 추가'}
          </h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-500" /></button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">문서 유형명 *</label>
            <input
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              placeholder="예: 진단서, 금융거래확인서"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">카테고리</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {CATEGORIES.map(c => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                    category === c
                      ? 'border-primary bg-primary text-white'
                      : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-primary'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
            <input
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              placeholder="직접 입력"
              value={category}
              onChange={e => setCategory(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">설명</label>
            <textarea
              rows={2}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none"
              placeholder="이 문서 유형에 대한 간단한 설명"
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg"
          >
            취소
          </button>
          <button
            onClick={() => onSave({ name, category, description })}
            disabled={!name.trim()}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-primary hover:bg-primary/90 text-white rounded-lg disabled:opacity-40"
          >
            <Save className="w-4 h-4" />
            저장
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// 메인 페이지
// ─────────────────────────────────────────────

export default function MetadataV2Page() {
  const [userId] = useState<string>(() => {
    if (typeof window === 'undefined') return 'default'
    try {
      const u = JSON.parse(localStorage.getItem('user') || '{}')
      return u.user_id || 'default'
    } catch { return 'default' }
  })

  // 문서 유형 상태
  const [docTypes, setDocTypes] = useState<DocumentType[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQ, setSearchQ] = useState('')
  const [filterCat, setFilterCat] = useState('')
  const [selectedType, setSelectedType] = useState<DocumentType | null>(null)

  // 필드 상태
  const [fields, setFields] = useState<Field[]>([])
  const [fieldsLoading, setFieldsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'fields' | 'ai'>('fields')

  // 모달 상태
  const [docModal, setDocModal] = useState<{ open: boolean; data: Partial<DocumentType> | null }>({ open: false, data: null })
  const [fieldModal, setFieldModal] = useState<{ open: boolean; data: Partial<Field> | null }>({ open: false, data: null })

  // 알림
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 2500)
  }

  // userId는 useState 초기화에서 localStorage로 직접 읽음 (race condition 방지)

  // ── 문서 유형 목록 로드 ──────────────────────
  const loadDocTypes = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ user_id: userId })
      if (searchQ) params.set('q', searchQ)
      if (filterCat) params.set('category', filterCat)
      const res = await fetch(`${API_BASE_URL}/api/metadata-v2/document-types?${params}`)
      if (res.ok) setDocTypes(await res.json())
    } finally {
      setLoading(false)
    }
  }, [userId, searchQ, filterCat])

  useEffect(() => { loadDocTypes() }, [loadDocTypes])

  // ── 필드 목록 로드 ───────────────────────────
  const loadFields = useCallback(async (typeId: string) => {
    setFieldsLoading(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/metadata-v2/document-types/${typeId}/fields`)
      if (res.ok) setFields(await res.json())
    } finally {
      setFieldsLoading(false)
    }
  }, [])

  const selectType = (dt: DocumentType) => {
    setSelectedType(dt)
    setActiveTab('fields')
    loadFields(dt.type_id)
  }

  // ── 문서 유형 CRUD ───────────────────────────
  const saveDocType = async (data: { name: string; category: string; description: string }) => {
    const isEdit = !!docModal.data?.type_id
    const url = isEdit
      ? `${API_BASE_URL}/api/metadata-v2/document-types/${docModal.data!.type_id}`
      : `${API_BASE_URL}/api/metadata-v2/document-types?user_id=${userId}`
    const res = await fetch(url, {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (res.ok) {
      setDocModal({ open: false, data: null })
      await loadDocTypes()
      showToast(isEdit ? '문서 유형을 수정했습니다' : '문서 유형을 추가했습니다')
    } else {
      showToast('저장 실패', false)
    }
  }

  const deleteDocType = async (dt: DocumentType) => {
    if (!confirm(`'${dt.name}'을(를) 삭제하시겠습니까? 하위 필드도 모두 삭제됩니다.`)) return
    const res = await fetch(`${API_BASE_URL}/api/metadata-v2/document-types/${dt.type_id}`, { method: 'DELETE' })
    if (res.ok) {
      if (selectedType?.type_id === dt.type_id) setSelectedType(null)
      await loadDocTypes()
      showToast('삭제했습니다')
    } else {
      showToast('삭제 실패', false)
    }
  }

  // ── 필드 CRUD ────────────────────────────────
  const saveField = async (data: Partial<Field>) => {
    if (!selectedType) return
    const isEdit = !!data.field_id
    const url = isEdit
      ? `${API_BASE_URL}/api/metadata-v2/document-types/${selectedType.type_id}/fields/${data.field_id}`
      : `${API_BASE_URL}/api/metadata-v2/document-types/${selectedType.type_id}/fields`
    const res = await fetch(url, {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (res.ok) {
      setFieldModal({ open: false, data: null })
      await loadFields(selectedType.type_id)
      // field_count 동기화
      setDocTypes(prev => prev.map(d =>
        d.type_id === selectedType.type_id
          ? { ...d, field_count: isEdit ? d.field_count : d.field_count + 1 }
          : d
      ))
      showToast(isEdit ? '필드를 수정했습니다' : '필드를 추가했습니다')
    } else {
      showToast('저장 실패', false)
    }
  }

  const deleteField = async (field: Field) => {
    if (!selectedType) return
    if (!confirm(`'${field.name}' 필드를 삭제하시겠습니까?`)) return
    const res = await fetch(
      `${API_BASE_URL}/api/metadata-v2/document-types/${selectedType.type_id}/fields/${field.field_id}`,
      { method: 'DELETE' }
    )
    if (res.ok) {
      await loadFields(selectedType.type_id)
      setDocTypes(prev => prev.map(d =>
        d.type_id === selectedType.type_id ? { ...d, field_count: Math.max(0, d.field_count - 1) } : d
      ))
      showToast('필드를 삭제했습니다')
    } else {
      showToast('삭제 실패', false)
    }
  }

  // ─────────────────────────────────────────────
  // 렌더
  // ─────────────────────────────────────────────

  return (
    <div className="flex bg-slate-50 dark:bg-slate-50">
      <Sidebar />

      <main className="flex-1 ml-64 mt-14 flex flex-col min-w-0 h-[calc(100vh-3.5rem)] overflow-hidden">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">메타데이터 관리</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            문서 유형별 추출 필드와 AI 모델을 정의합니다
          </p>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* ── 왼쪽: 문서 유형 목록 ── */}
          <div className="w-80 border-r border-border-light dark:border-border-dark flex flex-col bg-surface-light dark:bg-surface-dark">
            {/* 검색 + 추가 */}
            <div className="p-3 space-y-2 border-b border-border-light dark:border-border-dark">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <input
                    className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                    placeholder="이름 검색..."
                    value={searchQ}
                    onChange={e => setSearchQ(e.target.value)}
                  />
                </div>
                <button
                  onClick={() => setDocModal({ open: true, data: null })}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm bg-primary hover:bg-primary/90 text-white rounded-lg"
                >
                  <Plus className="w-3.5 h-3.5" />
                  추가
                </button>
              </div>
              {/* 카테고리 필터 */}
              <div className="flex flex-wrap gap-1">
                <button
                  onClick={() => setFilterCat('')}
                  className={`px-2 py-0.5 text-xs rounded-full border ${!filterCat ? 'bg-primary text-white border-primary' : 'border-gray-200 dark:border-gray-600 text-gray-500'}`}
                >
                  전체
                </button>
                {CATEGORIES.map(c => (
                  <button
                    key={c}
                    onClick={() => setFilterCat(filterCat === c ? '' : c)}
                    className={`px-2 py-0.5 text-xs rounded-full border ${filterCat === c ? 'bg-primary text-white border-primary' : 'border-gray-200 dark:border-gray-600 text-gray-500 hover:border-gray-400'}`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {/* 목록 */}
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="p-4 text-center text-sm text-gray-400">불러오는 중...</div>
              ) : docTypes.length === 0 ? (
                <div className="p-6 text-center">
                  <FileText className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">문서 유형이 없습니다</p>
                  <p className="text-xs text-gray-400 mt-1">+ 추가 버튼으로 생성하세요</p>
                </div>
              ) : (
                docTypes.map(dt => (
                  <div
                    key={dt.type_id}
                    onClick={() => selectType(dt)}
                    className={`flex items-center gap-3 px-4 py-3 border-b border-border-light dark:border-border-dark cursor-pointer group transition-colors ${
                      selectedType?.type_id === dt.type_id
                        ? 'bg-primary/10 border-l-2 border-l-primary'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{dt.name}</span>
                        {!dt.is_active && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-400">비활성</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {dt.category && (
                          <span className="text-xs text-gray-400">{dt.category}</span>
                        )}
                        <span className="text-xs text-gray-400">필드 {dt.field_count}개</span>
                      </div>
                    </div>
                    {/* 수정/삭제 버튼 */}
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={e => { e.stopPropagation(); setDocModal({ open: true, data: dt }) }}
                        className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                      >
                        <Pencil className="w-3.5 h-3.5 text-gray-400" />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); deleteDocType(dt) }}
                        className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/30"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      </button>
                    </div>
                    <ChevronRight className={`w-4 h-4 text-gray-300 shrink-0 transition-transform ${selectedType?.type_id === dt.type_id ? 'rotate-90' : ''}`} />
                  </div>
                ))
              )}
            </div>
          </div>

          {/* ── 오른쪽: 필드 정의 / AI 설정 ── */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {!selectedType ? (
              <div className="flex-1 flex items-center justify-center text-gray-400">
                <div className="text-center">
                  <FileText className="w-14 h-14 text-gray-200 dark:text-gray-700 mx-auto mb-3" />
                  <p className="text-sm">왼쪽에서 문서 유형을 선택하세요</p>
                </div>
              </div>
            ) : (
              <>
                {/* 선택된 문서 유형 헤더 */}
                <div className="px-6 py-4 border-b border-border-light dark:border-border-dark bg-white dark:bg-gray-900">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-base font-semibold text-gray-900 dark:text-white">{selectedType.name}</h2>
                        {selectedType.category && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">{selectedType.category}</span>
                        )}
                      </div>
                      {selectedType.description && (
                        <p className="text-xs text-gray-500 mt-0.5">{selectedType.description}</p>
                      )}
                    </div>
                  </div>

                  {/* 탭 */}
                  <div className="flex gap-4 mt-3">
                    <button
                      onClick={() => setActiveTab('fields')}
                      className={`flex items-center gap-1.5 pb-2 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === 'fields'
                          ? 'border-primary text-primary'
                          : 'border-transparent text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      <Tag className="w-4 h-4" />
                      필드 정의
                      <span className="ml-1 text-xs bg-gray-100 dark:bg-gray-800 text-gray-500 rounded-full px-1.5 py-0.5">
                        {fields.length}
                      </span>
                    </button>
                    <button
                      onClick={() => setActiveTab('ai')}
                      className={`flex items-center gap-1.5 pb-2 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === 'ai'
                          ? 'border-primary text-primary'
                          : 'border-transparent text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      <Cpu className="w-4 h-4" />
                      AI 모델 설정
                    </button>
                  </div>
                </div>

                {/* 탭 콘텐츠 */}
                <div className="flex-1 overflow-y-auto p-6">

                  {/* ── 필드 정의 탭 ── */}
                  {activeTab === 'fields' && (
                    <div>
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                          추출 필드 목록
                        </h3>
                        <button
                          onClick={() => setFieldModal({ open: true, data: null })}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary hover:bg-primary/90 text-white rounded-lg"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          필드 추가
                        </button>
                      </div>

                      {fieldsLoading ? (
                        <div className="text-center py-8 text-sm text-gray-400">불러오는 중...</div>
                      ) : fields.length === 0 ? (
                        <div className="text-center py-12 text-gray-400">
                          <Tag className="w-10 h-10 text-gray-200 dark:text-gray-700 mx-auto mb-2" />
                          <p className="text-sm">정의된 필드가 없습니다</p>
                          <p className="text-xs mt-1">+ 필드 추가 버튼으로 추출 항목을 설정하세요</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {fields.map(field => (
                            <div
                              key={field.field_id}
                              className="flex items-center gap-4 p-4 bg-white dark:bg-gray-800 border border-border-light dark:border-border-dark rounded-xl group hover:shadow-sm transition-shadow"
                            >
                              {/* 순서 */}
                              <span className="text-xs text-gray-300 w-5 text-center">{field.order}</span>

                              {/* 이름 + 키 */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-medium text-gray-900 dark:text-white">{field.name}</span>
                                  <span className="text-xs text-gray-400 font-mono">{field.key}</span>
                                  {field.is_pii && (
                                    <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 font-medium">PII</span>
                                  )}
                                  {field.is_required && (
                                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500">필수</span>
                                  )}
                                </div>
                                {field.extraction_hint && (
                                  <p className="text-xs text-gray-400 mt-0.5 truncate">{field.extraction_hint}</p>
                                )}
                              </div>

                              {/* 배지들 */}
                              <div className="flex items-center gap-2 shrink-0">
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_BADGE[field.field_type] ?? 'bg-gray-100 text-gray-600'}`}>
                                  {FIELD_TYPES.find(t => t.value === field.field_type)?.label ?? field.field_type}
                                </span>
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${AI_BADGE[field.ai_model] ?? ''}`}>
                                  {field.ai_model.toUpperCase()}
                                </span>
                              </div>

                              {/* 수정/삭제 */}
                              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => setFieldModal({ open: true, data: field })}
                                  className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                                >
                                  <Pencil className="w-3.5 h-3.5 text-gray-400" />
                                </button>
                                <button
                                  onClick={() => deleteField(field)}
                                  className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/30"
                                >
                                  <Trash2 className="w-3.5 h-3.5 text-red-400" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── AI 모델 설정 탭 ── */}
                  {activeTab === 'ai' && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
                        필드별 AI 추출 방식 요약
                      </h3>

                      {fields.length === 0 ? (
                        <div className="text-center py-12 text-gray-400">
                          <Cpu className="w-10 h-10 text-gray-200 dark:text-gray-700 mx-auto mb-2" />
                          <p className="text-sm">먼저 필드 정의 탭에서 필드를 추가하세요</p>
                        </div>
                      ) : (
                        <>
                          {/* 모델별 통계 */}
                          <div className="grid grid-cols-3 gap-4 mb-6">
                            {AI_MODELS.map(m => {
                              const count = fields.filter(f => f.ai_model === m.value).length
                              return (
                                <div key={m.value} className="bg-white dark:bg-gray-800 border border-border-light dark:border-border-dark rounded-xl p-4">
                                  <div className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full mb-2 ${AI_BADGE[m.value]}`}>
                                    {m.label}
                                  </div>
                                  <div className="text-2xl font-bold text-gray-900 dark:text-white">{count}</div>
                                  <div className="text-xs text-gray-400">개 필드</div>
                                  <div className="text-xs text-gray-400 mt-1">{m.desc}</div>
                                </div>
                              )
                            })}
                          </div>

                          {/* 필드별 상세 */}
                          <div className="space-y-2">
                            {fields.map(field => (
                              <div
                                key={field.field_id}
                                className="flex items-center gap-4 p-4 bg-white dark:bg-gray-800 border border-border-light dark:border-border-dark rounded-xl"
                              >
                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-gray-900 dark:text-white">{field.name}</span>
                                    {field.is_pii && (
                                      <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">PII</span>
                                    )}
                                  </div>
                                  {field.extraction_hint && (
                                    <p className="text-xs text-gray-400 mt-0.5">
                                      {field.ai_model === 'llm' ? '프롬프트: ' : field.ai_model === 'ner' ? '레이블: ' : ''}
                                      {field.extraction_hint}
                                    </p>
                                  )}
                                </div>
                                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${AI_BADGE[field.ai_model] ?? ''}`}>
                                  {AI_MODELS.find(m => m.value === field.ai_model)?.label ?? field.ai_model}
                                </span>
                                <button
                                  onClick={() => setFieldModal({ open: true, data: field })}
                                  className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                                  title="AI 모델 변경"
                                >
                                  <Pencil className="w-3.5 h-3.5 text-gray-400" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </main>

      {/* 모달들 */}
      {docModal.open && (
        <DocTypeModal
          docType={docModal.data}
          onSave={saveDocType}
          onClose={() => setDocModal({ open: false, data: null })}
        />
      )}
      {fieldModal.open && (
        <FieldModal
          field={fieldModal.data}
          onSave={saveField}
          onClose={() => setFieldModal({ open: false, data: null })}
        />
      )}

      {/* 토스트 알림 */}
      {toast && (
        <div className={`fixed bottom-6 right-6 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm text-white z-50 ${toast.ok ? 'bg-green-500' : 'bg-red-500'}`}>
          {toast.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}
    </div>
  )
}
