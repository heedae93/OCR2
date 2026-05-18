'use client'

import { useState, useEffect } from 'react'
import { X, Loader2, FileText, Code, FileJson, FileSpreadsheet, Archive, Download, Files, ShieldCheck, Printer } from 'lucide-react'
import { API_BASE_URL } from '@/lib/api'

interface ExportModalProps {
  isOpen: boolean
  onClose: () => void
  /** 에디터 URL 기준 현재 작업 (클라이언트 OCR PDF/JSON 내보내기에 사용) */
  jobId: string
  /** 사이드바에서 고른 작업 목록이 있으면 이들 전부를 아래 형식으로 내보냄 (파일별로 다른 형식은 지정 불가) */
  jobIds?: string[]
  onExport: (format: 'pdf' | 'json' | 'both') => Promise<void>
  isExporting?: boolean
}

type ExportFormat = 'pdf' | 'txt' | 'xml' | 'json' | 'excel' | 'masked_pdf'

const exportOptions: {
  value: ExportFormat
  title: string
  description: string
  icon: React.ReactNode
  color: string
  bgColor: string
}[] = [
  {
    value: 'pdf',
    title: 'PDF',
    description: '검색 가능한 PDF (Hidden Layer)',
    icon: <FileText className="w-6 h-6" />,
    color: 'text-red-500',
    bgColor: 'bg-red-500/10',
  },
  {
    value: 'txt',
    title: 'TXT',
    description: 'OCR 텍스트 추출',
    icon: <FileText className="w-6 h-6" />,
    color: 'text-gray-600 dark:text-gray-400',
    bgColor: 'bg-gray-500/10',
  },
  {
    value: 'xml',
    title: 'XML',
    description: '좌표, 신뢰도 포함',
    icon: <Code className="w-6 h-6" />,
    color: 'text-orange-500',
    bgColor: 'bg-orange-500/10',
  },
  {
    value: 'excel',
    title: 'Excel',
    description: '페이지별 인식률 통계',
    icon: <FileSpreadsheet className="w-6 h-6" />,
    color: 'text-green-600',
    bgColor: 'bg-green-500/10',
  },
  {
    value: 'json',
    title: 'JSON',
    description: 'OCR 전체 데이터',
    icon: <FileJson className="w-6 h-6" />,
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-500/10',
  },
  {
    value: 'masked_pdf',
    title: '마스킹 PDF',
    description: '개인정보 마스킹 처리된 PDF',
    icon: <ShieldCheck className="w-6 h-6" />,
    color: 'text-purple-600',
    bgColor: 'bg-purple-500/10',
  },
]

/** 동일 형식 세트를 한 job에 적용 (복수 선택 시 순차 처리) */
async function exportOneJob(
  jid: string,
  formats: ExportFormat[],
  asZip: boolean,
  userId: string,
  onExportSinglePdfJson: (format: 'pdf' | 'json') => Promise<void>,
  useClientPdfJson: boolean
): Promise<void> {
  if (formats.length === 0) return

  // masked_pdf 는 별도 엔드포인트로 처리
  if (formats.includes('masked_pdf')) {
    const res = await fetch(`${API_BASE_URL}/api/masking/${jid}/download`)
    if (!res.ok) {
      if (res.status === 404) {
        throw new Error('마스킹 PDF를 찾을 수 없습니다. 에디터에서 먼저 개인정보 감지를 실행해 주세요.')
      }
      throw new Error('마스킹 PDF 다운로드에 실패했습니다.')
    }
    const blob = await res.blob()
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${jid}_masked.pdf`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)

    const remaining = formats.filter((f) => f !== 'masked_pdf')
    if (remaining.length === 0) return
    await exportOneJob(jid, remaining, asZip, userId, onExportSinglePdfJson, useClientPdfJson)
    return
  }

  if (formats.length === 1 && formats[0] === 'pdf') {
    if (useClientPdfJson) {
      await onExportSinglePdfJson('pdf')
      return
    }
    const res = await fetch(`${API_BASE_URL}/api/sessions/job/${jid}`)
    if (res.ok) {
      const data = await res.json()
      if (data.pdf_url) {
        const link = document.createElement('a')
        link.href = `${API_BASE_URL}${data.pdf_url}`
        link.download = ''
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      }
    }
    return
  }

  if (formats.length === 1 && formats[0] === 'json') {
    if (useClientPdfJson) {
      await onExportSinglePdfJson('json')
      return
    }
    const link = document.createElement('a')
    link.href = `${API_BASE_URL}/api/export/${jid}/json?user_id=${userId}`
    link.download = ''
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    return
  }

  if (formats.length === 1) {
    const format = formats[0]
    const endpoints: Record<string, string> = {
      txt: `/api/export/${jid}/txt?user_id=${userId}`,
      xml: `/api/export/${jid}/xml?user_id=${userId}`,
      excel: `/api/export/${jid}/excel?user_id=${userId}`,
    }
    const link = document.createElement('a')
    link.href = `${API_BASE_URL}${endpoints[format]}`
    link.download = ''
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    return
  }

  const url = `${API_BASE_URL}/api/export/${jid}/multi?user_id=${userId}`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ formats, as_zip: asZip }),
  })
  if (!response.ok) throw new Error('Export failed')
  const blob = await response.blob()
  const downloadUrl = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = downloadUrl
  link.download = asZip ? `${jid}_export.zip` : ''
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(downloadUrl)
}

export default function ExportModal({
  isOpen,
  onClose,
  jobId,
  jobIds,
  onExport,
  isExporting = false,
}: ExportModalProps) {
  const targetJobIds = jobIds && jobIds.length > 0 ? jobIds : [jobId]
  const isMultiTarget = targetJobIds.length > 1
  const headerJobId = targetJobIds[0] ?? jobId
  const [selectedFormats, setSelectedFormats] = useState<Set<ExportFormat>>(new Set(['pdf']))
  const [asZip, setAsZip] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [printImages, setPrintImages] = useState<{ jobId: string; images: string[] } | null>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setIsVisible(true)
    } else {
      const timer = setTimeout(() => setIsVisible(false), 200)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    setSelectedFormats(new Set(['pdf']))
    setAsZip(true)
    setError(null)
  }, [isOpen, jobId, jobIds?.join('\u0001')])

  const toggleFormat = (format: ExportFormat) => {
    setSelectedFormats((prev) => {
      const next = new Set(prev)
      if (next.has(format)) {
        if (next.size > 1) next.delete(format)
      } else {
        next.add(format)
      }
      return next
    })
  }

  const needsPackaging = selectedFormats.size > 1

  const handleExport = async () => {
    if (selectedFormats.size === 0) return

    try {
      setError(null)
      setDownloading(true)

      const formats = Array.from(selectedFormats)
      const userId = (() => {
        try {
          return JSON.parse(localStorage.getItem('user') || '{}').user_id || ''
        } catch {
          return ''
        }
      })()

      for (const jid of targetJobIds) {
        const useClient = jid === jobId
        await exportOneJob(jid, formats, asZip, userId, onExport, useClient)
        if (targetJobIds.length > 1) {
          await new Promise((r) => setTimeout(r, 150))
        }
      }

      onClose()
    } catch (err) {
      console.error('Export failed', err)
      setError('내보내기에 실패했습니다. 다시 시도해 주세요.')
    } finally {
      setDownloading(false)
    }
  }

  const handlePrint = async () => {
    setPrinting(true)
    setError(null)
    try {
      let images: string[]

      if (printImages?.jobId === jobId) {
        images = printImages.images
      } else {
        const res = await fetch(`${API_BASE_URL}/api/masking/${jobId}/download?inline=true`)
        if (!res.ok) throw new Error('PDF 다운로드 실패')
        const arrayBuffer = await res.arrayBuffer()

        const pdfjsLib = await import('pdfjs-dist')
        pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`

        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
        images = []

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i)
          const viewport = page.getViewport({ scale: 1.5 })
          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          const ctx = canvas.getContext('2d')!
          await page.render({ canvasContext: ctx, viewport }).promise
          images.push(canvas.toDataURL('image/png'))
        }

        setPrintImages({ jobId, images })
      }

      const win = window.open('', '_blank')
      if (!win) {
        setError('팝업이 차단되었습니다. 브라우저 팝업 차단을 해제해 주세요.')
        return
      }

      const imgTags = images
        .map((src, i) => `<img src="${src}" alt="Page ${i + 1}" />`)
        .join('\n')

      win.document.write(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>인쇄</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #fff; }
  img { display: block; width: 100%; height: auto; }
  @media print {
    @page { size: A4 portrait; margin: 0; }
    img { display: block; width: 100% !important; height: auto !important; page-break-after: always; page-break-inside: avoid; }
    img:last-child { page-break-after: auto; }
  }
</style></head>
<body>${imgTags}
<script>window.onload = function() { window.print(); }</script>
</body></html>`)
      win.document.close()
    } catch (e) {
      setError('인쇄 준비 중 오류가 발생했습니다.')
      console.error(e)
    } finally {
      setPrinting(false)
    }
  }

  if (!isVisible && !isOpen) return null

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-200 ${
        isOpen ? 'bg-black/50 backdrop-blur-sm' : 'bg-transparent pointer-events-none'
      }`}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={`w-full max-w-lg rounded-2xl bg-surface-light dark:bg-surface-dark shadow-2xl flex flex-col overflow-hidden border border-border-light dark:border-border-dark max-h-[85vh] transition-all duration-200 ${
          isOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
        }`}
      >
        <div className="flex items-center justify-between p-5 border-b border-border-light dark:border-border-dark">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Download className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                {isMultiTarget ? `${targetJobIds.length}개 파일 내보내기` : '문서 내보내기'}
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {isMultiTarget
                  ? '아래에서 고른 형식을 선택된 모든 파일에 동일하게 적용합니다.'
                  : (
                      <>
                        작업 ID: <span className="font-mono">{headerJobId.substring(0, 12)}...</span>
                      </>
                    )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={downloading || isExporting}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="mb-5">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <Files className="w-4 h-4 text-primary" />
              내보내기 형식 선택 (복수 선택 가능)
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {exportOptions.map((option) => {
                const isSelected = selectedFormats.has(option.value)
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => toggleFormat(option.value)}
                    disabled={downloading || isExporting}
                    className={`relative flex flex-col items-center p-4 rounded-xl border-2 transition-all duration-200 group ${
                      isSelected
                        ? 'border-primary bg-primary/5 dark:bg-primary/10 shadow-md'
                        : 'border-gray-200 dark:border-gray-700 hover:border-primary/50 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    {isSelected && (
                      <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                        <svg
                          className="w-3 h-3 text-white"
                          fill="none"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path d="M5 13l4 4L19 7"></path>
                        </svg>
                      </div>
                    )}

                    <div
                      className={`w-12 h-12 rounded-xl ${option.bgColor} flex items-center justify-center mb-2 transition-transform duration-200 group-hover:scale-110`}
                    >
                      <span className={option.color}>{option.icon}</span>
                    </div>
                    <p
                      className={`font-semibold text-sm ${
                        isSelected ? 'text-primary' : 'text-gray-900 dark:text-white'
                      }`}
                    >
                      {option.title}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 text-center mt-1">
                      {option.description}
                    </p>
                  </button>
                )
              })}
            </div>
          </div>

          {needsPackaging && (
            <div className="mb-5">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                <Archive className="w-4 h-4 text-primary" />
                패키징 옵션
              </h3>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setAsZip(true)}
                  disabled={downloading || isExporting}
                  className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all ${
                    asZip
                      ? 'border-primary bg-primary/5 dark:bg-primary/10'
                      : 'border-gray-200 dark:border-gray-700 hover:border-primary/50'
                  }`}
                >
                  <Archive className={`w-5 h-5 ${asZip ? 'text-primary' : 'text-gray-500'}`} />
                  <div className="text-left">
                    <p className={`font-medium text-sm ${asZip ? 'text-primary' : 'text-gray-900 dark:text-white'}`}>
                      ZIP 파일
                    </p>
                    <p className="text-xs text-gray-500">하나의 압축 파일로</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setAsZip(false)}
                  disabled={downloading || isExporting}
                  className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all ${
                    !asZip
                      ? 'border-primary bg-primary/5 dark:bg-primary/10'
                      : 'border-gray-200 dark:border-gray-700 hover:border-primary/50'
                  }`}
                >
                  <Files className={`w-5 h-5 ${!asZip ? 'text-primary' : 'text-gray-500'}`} />
                  <div className="text-left">
                    <p
                      className={`font-medium text-sm ${!asZip ? 'text-primary' : 'text-gray-900 dark:text-white'}`}
                    >
                      개별 파일
                    </p>
                    <p className="text-xs text-gray-500">각각 다운로드</p>
                  </div>
                </button>
              </div>
            </div>
          )}

          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4">
            <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-2">내보내기 요약</h4>
            <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
              <li>
                • 대상:{' '}
                {isMultiTarget ? `선택된 파일 ${targetJobIds.length}개 (동일 형식)` : '현재 문서 1개'}
              </li>
              <li>• 형식: {Array.from(selectedFormats).map((f) => f === 'masked_pdf' ? '마스킹 PDF' : f.toUpperCase()).join(', ')}</li>
              {needsPackaging && <li>• 패키징: {asZip ? 'ZIP 압축 파일 (파일당)' : '개별 파일 다운로드 (파일당)'}</li>}
            </ul>
          </div>

          {error && (
            <div className="mt-4 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 flex items-center gap-3">
              <X className="w-5 h-5 text-red-500" />
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 p-5 border-t border-border-light dark:border-border-dark bg-gray-50 dark:bg-gray-800/50">
          <button
            type="button"
            onClick={onClose}
            disabled={downloading || isExporting}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            취소
          </button>
          {selectedFormats.has('masked_pdf') && !isMultiTarget && (
            <button
              type="button"
              onClick={handlePrint}
              disabled={printing || downloading || isExporting}
              className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {printing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  준비 중...
                </>
              ) : (
                <>
                  <Printer className="w-4 h-4" />
                  인쇄하기
                </>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={handleExport}
            disabled={downloading || isExporting || selectedFormats.size === 0}
            className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {downloading || isExporting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                내보내는 중...
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                내보내기
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
