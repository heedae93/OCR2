'use client'

import { useState, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'
import { API_BASE_URL } from '@/lib/api'

interface Settings {
  extract_full_text: boolean
  extract_language: boolean
  extract_doc_type: boolean
  extract_keywords: boolean
  extract_dates: boolean
  extract_char_count: boolean
  extract_word_count: boolean
  extract_chunks: boolean
  extract_ner: boolean
  chunk_size: number
  chunk_overlap: number
  keywords_top_n: number
}

const FIELD_LABELS: { key: keyof Settings; label: string; desc: string; type: 'bool' | 'num' }[] = [
  { key: 'extract_full_text',  label: '전체 텍스트',   desc: 'OCR로 추출된 전체 텍스트를 저장합니다. RAG의 핵심 데이터입니다.',    type: 'bool' },
  { key: 'extract_language',   label: '언어 감지',     desc: '문서의 언어를 감지합니다 (한국어/영어/혼합).', type: 'bool' },
  { key: 'extract_doc_type',   label: '문서 유형',     desc: '문서를 자동으로 분류합니다 (공문서/계약서/보고서 등).', type: 'bool' },
  { key: 'extract_keywords',   label: '키워드 추출',   desc: 'TF-IDF 기반으로 핵심 키워드를 추출합니다.', type: 'bool' },
  { key: 'extract_dates',      label: '날짜 추출',     desc: '문서 내 날짜 패턴을 추출합니다.', type: 'bool' },
  { key: 'extract_char_count', label: '글자 수',       desc: '추출된 텍스트의 글자 수를 저장합니다.', type: 'bool' },
  { key: 'extract_word_count', label: '단어 수',       desc: '추출된 텍스트의 단어 수를 저장합니다.', type: 'bool' },
  { key: 'extract_chunks',     label: 'RAG 청크 분할', desc: '텍스트를 청크 단위로 분할하여 저장합니다. RAG 검색에 사용됩니다.', type: 'bool' },
  { key: 'extract_ner',        label: 'NER 추출 (Key-Value)', desc: '한국어 NER 모델로 "성명: 한대희" 같은 항목을 자동 분류합니다. 최초 실행 시 모델 다운로드가 필요합니다.', type: 'bool' },
]

const NUM_LABELS: { key: keyof Settings; label: string; desc: string; min: number; max: number; step: number }[] = [
  { key: 'keywords_top_n', label: '키워드 추출 개수', desc: '추출할 최대 키워드 수', min: 5, max: 50, step: 5 },
  { key: 'chunk_size',     label: '청크 크기 (글자)',  desc: '청크당 최대 글자 수', min: 100, max: 2000, step: 100 },
  { key: 'chunk_overlap',  label: '청크 겹침 (글자)',  desc: '청크 간 겹치는 글자 수', min: 0, max: 200, step: 10 },
]

export default function MetadataPage() {
  const [settings, setSettings] = useState<Settings>({
    extract_full_text: true,
    extract_language: true,
    extract_doc_type: true,
    extract_keywords: true,
    extract_dates: true,
    extract_char_count: true,
    extract_word_count: true,
    extract_chunks: true,
    extract_ner: false,
    chunk_size: 500,
    chunk_overlap: 50,
    keywords_top_n: 20,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const getUserId = () => {
    try { return JSON.parse(localStorage.getItem('user') || '{}').user_id || 'default' }
    catch { return 'default' }
  }

  useEffect(() => {
    const userId = getUserId()
    fetch(`${API_BASE_URL}/api/metadata-settings?user_id=${userId}`)
      .then(r => r.json())
      .then(data => { setSettings(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const handleToggle = (key: keyof Settings) => {
    setSettings(prev => ({ ...prev, [key]: !prev[key] }))
    setSaved(false)
  }

  const handleNum = (key: keyof Settings, value: number) => {
    setSettings(prev => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const userId = getUserId()
      await fetch(`${API_BASE_URL}/api/metadata-settings?user_id=${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-slate-50 dark:bg-slate-50 min-h-screen">
      <Sidebar />
      <div className="flex flex-col gap-6 p-8 ml-64">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-text-primary-light">메타데이터 관리</h1>
            <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">
              OCR 작업 완료 시 자동으로 추출할 메타데이터 항목을 선택하세요.
            </p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {saved && (
              <span className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
                <span className="material-symbols-outlined text-base">check_circle</span>
                저장됐습니다
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={saving || loading}
              className="px-6 py-2.5 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 disabled:opacity-60 transition-colors"
            >
              {saving ? '저장 중...' : '설정 저장'}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-text-secondary-light dark:text-text-secondary-dark">
            <span className="material-symbols-outlined animate-spin mr-2">progress_activity</span>불러오는 중...
          </div>
        ) : (
          <>
            {/* 추출 항목 */}
            <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark overflow-hidden">
              <div className="px-6 py-4 border-b border-border-light dark:border-border-dark">
                <h2 className="text-base font-semibold text-text-primary-light dark:text-text-primary-dark">추출 항목 선택</h2>
              </div>
              <ul className="divide-y divide-border-light dark:divide-border-dark">
                {FIELD_LABELS.map(({ key, label, desc }) => (
                  <li key={key} className="flex items-center justify-between px-6 py-4 gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">{label}</p>
                      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-0.5">{desc}</p>
                    </div>
                    <button
                      onClick={() => handleToggle(key)}
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                        settings[key] ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                          settings[key] ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {/* 세부 설정 */}
            <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark overflow-hidden">
              <div className="px-6 py-4 border-b border-border-light dark:border-border-dark">
                <h2 className="text-base font-semibold text-text-primary-light dark:text-text-primary-dark">세부 설정</h2>
              </div>
              <ul className="divide-y divide-border-light dark:divide-border-dark">
                {NUM_LABELS.map(({ key, label, desc, min, max, step }) => (
                  <li key={key} className="px-6 py-4">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">{label}</p>
                        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{desc}</p>
                      </div>
                      <span className="text-sm font-semibold text-primary w-12 text-right">{settings[key]}</span>
                    </div>
                    <input
                      type="range"
                      min={min} max={max} step={step}
                      value={settings[key] as number}
                      onChange={e => handleNum(key, Number(e.target.value))}
                      className="w-full accent-primary"
                    />
                    <div className="flex justify-between text-xs text-text-secondary-light dark:text-text-secondary-dark mt-1">
                      <span>{min}</span><span>{max}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

          </>
        )}
      </div>
    </div>
  )
}
