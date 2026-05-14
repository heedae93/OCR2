'use client'

import { useState, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'
import { getSettings, updateSettings, AppSettings } from '@/lib/api'

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const data = await getSettings()
      setSettings(data)
    } catch (error) {
      console.error('Failed to load settings:', error)
      setMessage({ type: 'error', text: '설정을 불러오는데 실패했습니다.' })
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!settings) return

    setSaving(true)
    setMessage(null)

    try {
      const result = await updateSettings(settings)
      setMessage({ type: 'success', text: result.message })
    } catch (error) {
      console.error('Failed to save settings:', error)
      setMessage({ type: 'error', text: '설정 저장에 실패했습니다.' })
    } finally {
      setSaving(false)
    }
  }

  const updateOCR = (key: keyof AppSettings['ocr'], value: boolean | number) => {
    if (!settings) return
    setSettings({
      ...settings,
      ocr: { ...settings.ocr, [key]: value }
    })
  }

  const updatePDF = (key: keyof AppSettings['pdf_processing'], value: boolean | number) => {
    if (!settings) return
    setSettings({
      ...settings,
      pdf_processing: { ...settings.pdf_processing, [key]: value }
    })
  }

  const updatePreprocessing = (key: keyof AppSettings['preprocessing'], value: boolean) => {
    if (!settings) return
    setSettings({
      ...settings,
      preprocessing: { ...settings.preprocessing, [key]: value }
    })
  }

  if (loading) {
    return (
      <div className="bg-slate-50 dark:bg-slate-50 min-h-screen">
        <Sidebar />
        <main className="flex-1 ml-64 mt-14 p-6 lg:p-10 flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </main>
      </div>
    )
  }

  return (
    <div className="bg-slate-50 dark:bg-slate-50 min-h-screen">
      <Sidebar />

      <main className="flex-1 ml-64 mt-14 p-6 lg:p-10">
        <div className="w-full max-w-4xl mx-auto">
          <div className="flex flex-wrap justify-between gap-4 mb-8">
            <div className="flex flex-col gap-2">
              <h1 className="text-text-primary-light dark:text-text-primary-dark text-3xl font-bold leading-tight tracking-tight">
                설정
              </h1>
              <p className="text-text-secondary-light dark:text-text-secondary-dark text-base font-normal leading-normal">
                OCR 처리 및 성능 설정을 관리하세요.
              </p>
            </div>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? '저장 중...' : '설정 저장'}
            </button>
          </div>

          {message && (
            <div className={`mb-6 p-4 rounded-lg ${message.type === 'success' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'}`}>
              {message.text}
            </div>
          )}

          <div className="space-y-6">
            {/* PDF 처리 설정 */}
            <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark shadow-sm p-6">
              <h2 className="text-text-primary-light dark:text-text-primary-dark text-xl font-bold mb-4">
                PDF 처리
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
                    DPI (해상도)
                  </label>
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min="150"
                      max="600"
                      step="50"
                      value={settings?.pdf_processing.dpi || 400}
                      onChange={(e) => updatePDF('dpi', parseInt(e.target.value))}
                      className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                    />
                    <span className="w-16 text-center font-mono text-text-primary-light dark:text-text-primary-dark">
                      {settings?.pdf_processing.dpi || 400}
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-1">
                    높을수록 품질 향상, 낮을수록 속도 향상 (권장: 300-400)
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-text-primary-light dark:text-text-primary-dark font-medium">빠른 모드</p>
                    <p className="text-text-secondary-light dark:text-text-secondary-dark text-sm">
                      최적화된 PDF 처리 활성화
                    </p>
                  </div>
                  <Toggle
                    checked={settings?.pdf_processing.fast_mode || false}
                    onChange={(checked) => updatePDF('fast_mode', checked)}
                  />
                </div>
              </div>
            </div>

            {/* OCR 설정 */}
            <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark shadow-sm p-6">
              <h2 className="text-text-primary-light dark:text-text-primary-dark text-xl font-bold mb-4">
                OCR 엔진
              </h2>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-text-primary-light dark:text-text-primary-dark font-medium">GPU 사용</p>
                    <p className="text-text-secondary-light dark:text-text-secondary-dark text-sm">
                      GPU를 사용하여 OCR 처리 속도 향상
                    </p>
                  </div>
                  <Toggle
                    checked={settings?.ocr.use_gpu || false}
                    onChange={(checked) => updateOCR('use_gpu', checked)}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
                    Detection 이미지 크기 제한
                  </label>
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min="800"
                      max="2000"
                      step="100"
                      value={settings?.ocr.detection_limit_side_len || 1200}
                      onChange={(e) => updateOCR('detection_limit_side_len', parseInt(e.target.value))}
                      className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                    />
                    <span className="w-16 text-center font-mono text-text-primary-light dark:text-text-primary-dark">
                      {settings?.ocr.detection_limit_side_len || 1200}
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-1">
                    낮을수록 빠르지만 작은 텍스트 인식률 저하 가능 (권장: 1200-1500)
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-text-primary-light dark:text-text-primary-dark font-medium">스마트 읽기 순서</p>
                    <p className="text-text-secondary-light dark:text-text-secondary-dark text-sm">
                      다단 문서의 읽기 순서 자동 정렬
                    </p>
                  </div>
                  <Toggle
                    checked={settings?.ocr.use_smart_reading_order || false}
                    onChange={(checked) => updateOCR('use_smart_reading_order', checked)}
                  />
                </div>
              </div>
            </div>

            {/* 전처리 설정 */}
            <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark shadow-sm p-6">
              <h2 className="text-text-primary-light dark:text-text-primary-dark text-xl font-bold mb-4">
                이미지 전처리
              </h2>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-text-primary-light dark:text-text-primary-dark font-medium">전처리 활성화</p>
                    <p className="text-text-secondary-light dark:text-text-secondary-dark text-sm">
                      이미지 품질 개선 (속도 저하 발생)
                    </p>
                  </div>
                  <Toggle
                    checked={settings?.preprocessing.enable || false}
                    onChange={(checked) => updatePreprocessing('enable', checked)}
                  />
                </div>

                {settings?.preprocessing.enable && (
                  <>
                    <div className="flex items-center justify-between pl-4 border-l-2 border-gray-200 dark:border-gray-700">
                      <div>
                        <p className="text-text-primary-light dark:text-text-primary-dark font-medium">노이즈 제거</p>
                        <p className="text-text-secondary-light dark:text-text-secondary-dark text-sm">
                          이미지 노이즈 감소
                        </p>
                      </div>
                      <Toggle
                        checked={settings?.preprocessing.denoise_enabled || false}
                        onChange={(checked) => updatePreprocessing('denoise_enabled', checked)}
                      />
                    </div>

                    <div className="flex items-center justify-between pl-4 border-l-2 border-gray-200 dark:border-gray-700">
                      <div>
                        <p className="text-text-primary-light dark:text-text-primary-dark font-medium">업스케일링</p>
                        <p className="text-text-secondary-light dark:text-text-secondary-dark text-sm">
                          저해상도 이미지 확대
                        </p>
                      </div>
                      <Toggle
                        checked={settings?.preprocessing.upscale_enabled || false}
                        onChange={(checked) => updatePreprocessing('upscale_enabled', checked)}
                      />
                    </div>

                    <div className="flex items-center justify-between pl-4 border-l-2 border-gray-200 dark:border-gray-700">
                      <div>
                        <p className="text-text-primary-light dark:text-text-primary-dark font-medium">대비 보정 (CLAHE)</p>
                        <p className="text-text-secondary-light dark:text-text-secondary-dark text-sm">
                          이미지 대비 자동 조절
                        </p>
                      </div>
                      <Toggle
                        checked={settings?.preprocessing.clahe_enabled || false}
                        onChange={(checked) => updatePreprocessing('clahe_enabled', checked)}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* 성능 정보 */}
            <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark shadow-sm p-6">
              <h2 className="text-text-primary-light dark:text-text-primary-dark text-xl font-bold mb-4">
                성능 팁
              </h2>
              <div className="text-sm text-text-secondary-light dark:text-text-secondary-dark space-y-2">
                <p><strong>빠른 처리:</strong> DPI 200-300, Detection 1000-1200, 전처리 OFF</p>
                <p><strong>고품질:</strong> DPI 400-600, Detection 1500-2000, 전처리 ON</p>
                <p><strong>균형:</strong> DPI 300-400, Detection 1200-1500, 전처리 OFF</p>
                <p className="text-yellow-600 dark:text-yellow-400 mt-4">
                  설정 변경 후 서버 재시작이 필요할 수 있습니다.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

// Toggle component
function Toggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="relative inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        className="sr-only peer"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/40 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
    </label>
  )
}
