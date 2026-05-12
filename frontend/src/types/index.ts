export interface Job {
  job_id: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  progress_percent: number
  current_page: number
  total_pages: number
  message?: string
  sub_stage?: string
  pdf_url?: string
  filename?: string
  raw_file_url?: string
}

export interface OCRWord {
  text: string
  bbox: number[]
  confidence?: number
}

export interface OCRLine {
  text: string
  bbox?: number[]
  confidence?: number
  char_confidences?: number[]
  column?: string
  layout_type?: string
  reading_order?: number
  words?: OCRWord[]
}

export interface OCRPage {
  page_number: number
  width: number
  height: number
  lines: OCRLine[]
  is_multi_column: boolean
  column_boundary?: number
}

export interface OCRResult {
  job_id: string
  has_bbox: boolean
  page_count: number
  total_bboxes: number
  pages: OCRPage[]
  layout_summary?: any
}

export type SmartToolType = 'text' | 'image' | 'signature' | 'draw' | 'shape' | 'sticker'

export interface SmartToolLayer {
  id: string
  type: SmartToolType
  page_number: number
  bbox: [number, number, number, number]
  data: Record<string, any>
}
