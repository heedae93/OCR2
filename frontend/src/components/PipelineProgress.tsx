'use client'

const PIPELINE_STAGES = [
  { key: 'redis',   label: '큐 대기',    icon: 'database' },
  { key: 'queue',   label: '워커 대기',  icon: 'schedule' },
  { key: 'convert', label: '페이지 추출', icon: 'picture_as_pdf' },
  { key: 'ocr',     label: 'OCR 처리',   icon: 'document_scanner' },
  { key: 'pdf',     label: 'PDF 생성',   icon: 'auto_stories' },
  { key: 'done',    label: '완료',       icon: 'task_alt' },
] as const

/** 업로드·작업 등록 전 — 파이프라인 단계 하이라이트 없음 */
const PIPELINE_IDLE = -1

export function getActivePipelineStage(status: string, progress: number, subStage?: string | null): number {
  if (status === 'completed') return PIPELINE_STAGES.length
  // 로컬 대기만 있고 서버 업로드/큐 등록 전 — 앞 단계를 완료로 치면 안 됨
  if (status === 'pending') return PIPELINE_IDLE
  // 업로드(XHR) 중에도 UI는 '대기열'과 동일 단계로만 표시(별도 업로드 단계·100% 채움 생략)
  if (status === 'queued' || status === 'uploading') return 1
  const sub = (subStage || '').toLowerCase()
  if (sub.includes('converting')) return 2
  if (sub.includes('ocr') || sub.includes('layout')) return 3
  if (sub.includes('generating') || sub.includes('merging')) return 4
  if (progress >= 80) return 4
  if (progress > 10) return 3
  if (progress >= 1) return 2
  return 1
}

interface PipelineProgressProps {
  status: string
  progress: number
  subStage?: string | null
  failedStage?: number
  /** 좁은 카드(작업 목록 세션 등)용 축소 레이아웃 */
  compact?: boolean
}

export default function PipelineProgress({ status, progress, subStage, failedStage, compact }: PipelineProgressProps) {
  const isFailed = status === 'failed'
  const isCompleted = status === 'completed'
  const activeStage = isFailed && failedStage !== undefined
    ? failedStage
    : getActivePipelineStage(status, progress, subStage)
  const displayProgress =
    isCompleted ? 100 : status === 'uploading' ? 0 : progress
  const isPulsing = !isFailed && (status === 'processing' || status === 'queued' || status === 'uploading')

  const dot = compact ? 'w-4 h-4' : 'w-5 h-5'
  const iconPx = compact ? 11 : 13
  const labelCls = compact ? 'text-[9px]' : 'text-[10.5px]'
  const lineMb = compact ? 'mb-[11px]' : 'mb-[14px]'

  return (
    <div className={`flex flex-col ${compact ? 'gap-1 mt-1' : 'gap-2 mt-1.5'}`}>
      <div className="flex w-full items-start">
        {PIPELINE_STAGES.map((stage, idx) => {
          const isDone = activeStage >= 0 && idx < activeStage
          const isActive = idx === activeStage
          return (
            <div key={stage.key} className="flex items-center" style={{ flex: idx < PIPELINE_STAGES.length - 1 ? '1 1 0' : '0 0 auto' }}>
              <div className="flex shrink-0 flex-col items-center gap-0.5">
                <div className={`${dot} flex items-center justify-center rounded-full transition-all duration-300 ${
                  isDone
                    ? 'bg-primary text-white'
                    : isActive
                    ? isFailed
                      ? 'bg-red-500 text-white ring-2 ring-red-500/25'
                      : `bg-primary text-white ring-2 ring-primary/25 ${isPulsing ? 'animate-pulse' : ''}`
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500'
                }`}>
                  <span className="material-symbols-outlined leading-none" style={{ fontSize: `${iconPx}px` }}>
                    {isDone ? 'check' : (isFailed && isActive) ? 'error' : stage.icon}
                  </span>
                </div>
                <span className={`${labelCls} mt-0.5 whitespace-nowrap leading-none ${
                  isFailed && isActive
                    ? 'text-red-500 font-semibold'
                    : isDone || isActive ? 'text-primary font-semibold' : 'text-gray-400 dark:text-gray-500'
                }`}>
                  {stage.label}
                </span>
              </div>
              {idx < PIPELINE_STAGES.length - 1 && (
                <div className={`h-px flex-1 mx-0.5 ${lineMb} transition-all duration-500 ${
                  idx < activeStage ? 'bg-primary' : 'bg-gray-200 dark:bg-gray-700'
                }`} />
              )}
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-1.5">
        <div className={`flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700 ${compact ? 'h-1' : 'h-1.5'}`}>
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              isFailed ? 'bg-red-500' : isCompleted ? 'bg-green-500' : 'bg-primary'
            }`}
            style={{ width: `${displayProgress}%` }}
          />
        </div>
        <span className={`font-semibold tabular-nums text-right ${compact ? 'w-7 text-[11px]' : 'w-8 text-xs'} ${
          isFailed ? 'text-red-500' : isCompleted ? 'text-green-500' : 'text-primary'
        }`}>
          {Math.round(displayProgress)}%
        </span>
      </div>
    </div>
  )
}
