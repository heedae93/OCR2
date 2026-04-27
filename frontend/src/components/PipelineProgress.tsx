'use client'

const PIPELINE_STAGES = [
  { key: 'queue',   label: '큐 대기',    icon: 'schedule' },
  { key: 'convert', label: '페이지 추출', icon: 'picture_as_pdf' },
  { key: 'ocr',     label: 'OCR 처리',   icon: 'document_scanner' },
  { key: 'pdf',     label: 'PDF 생성',   icon: 'auto_stories' },
  { key: 'done',    label: '완료',       icon: 'task_alt' },
] as const

export function getActivePipelineStage(status: string, progress: number, subStage?: string | null): number {
  if (status === 'completed') return PIPELINE_STAGES.length
  if (status === 'queued') return 0
  const sub = (subStage || '').toLowerCase()
  if (sub.includes('converting')) return 1
  if (sub.includes('ocr') || sub.includes('layout')) return 2
  if (sub.includes('generating') || sub.includes('merging')) return 3
  if (progress >= 80) return 3
  if (progress > 10) return 2
  if (progress >= 1) return 1
  return 0
}

interface PipelineProgressProps {
  status: string
  progress: number
  subStage?: string | null
}

export default function PipelineProgress({ status, progress, subStage }: PipelineProgressProps) {
  const activeStage = getActivePipelineStage(status, progress, subStage)
  const isCompleted = status === 'completed'
  const displayProgress = isCompleted ? 100 : progress

  return (
    <div className="flex flex-col gap-2 mt-1.5">
      <div className="flex items-start w-full">
        {PIPELINE_STAGES.map((stage, idx) => {
          const isDone = idx < activeStage
          const isActive = idx === activeStage
          return (
            <div key={stage.key} className="flex items-center" style={{ flex: idx < PIPELINE_STAGES.length - 1 ? '1 1 0' : '0 0 auto' }}>
              <div className="flex flex-col items-center gap-0.5 shrink-0">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center transition-all duration-300 ${
                  isDone
                    ? 'bg-primary text-white'
                    : isActive
                    ? `bg-primary text-white ring-2 ring-primary/25 ${status === 'processing' ? 'animate-pulse' : ''}`
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500'
                }`}>
                  <span className="material-symbols-outlined leading-none" style={{ fontSize: '11px' }}>
                    {isDone ? 'check' : stage.icon}
                  </span>
                </div>
                <span className={`text-[8.5px] whitespace-nowrap leading-none mt-0.5 ${
                  isDone || isActive ? 'text-primary font-semibold' : 'text-gray-400 dark:text-gray-500'
                }`}>
                  {stage.label}
                </span>
              </div>
              {idx < PIPELINE_STAGES.length - 1 && (
                <div className={`h-px flex-1 mx-0.5 mb-[14px] transition-all duration-500 ${
                  idx < activeStage ? 'bg-primary' : 'bg-gray-200 dark:bg-gray-700'
                }`} />
              )}
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${isCompleted ? 'bg-green-500' : 'bg-primary'}`}
            style={{ width: `${displayProgress}%` }}
          />
        </div>
        <span className={`text-[10px] font-semibold tabular-nums w-7 text-right ${isCompleted ? 'text-green-500' : 'text-primary'}`}>
          {Math.round(displayProgress)}%
        </span>
      </div>
    </div>
  )
}
