import axios from 'axios'
import { Job, OCRResult, SmartToolLayer } from '@/types'

const getApiUrl = () => {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL
  if (typeof window !== 'undefined') {
    const { hostname } = window.location
    return `http://${hostname}:6015`
  }
  return 'http://localhost:6015'
}

export const API_BASE_URL = getApiUrl()
const API_URL = API_BASE_URL

const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: {
    'Content-Type': 'application/json',
  },
})

export interface UploadProgressCallback {
  (progress: number): void
}

export const uploadFile = async (
  file: File,
  onProgress?: UploadProgressCallback
): Promise<{ job_id: string }> => {
  const formData = new FormData()
  formData.append('file', file)

  const response = await api.post('/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
    onUploadProgress: (progressEvent) => {
      if (progressEvent.total && onProgress) {
        const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total)
        onProgress(percent)
      }
    },
  })

  return response.data
}

export const processJob = async (jobId: string): Promise<void> => {
  await api.post(`/process/${jobId}`)
}

export const getJobStatus = async (jobId: string): Promise<Job> => {
  const response = await api.get(`/status/${jobId}`)
  return response.data
}

export const getOCRResults = async (jobId: string): Promise<OCRResult> => {
  const response = await api.get(`/ocr-results/${jobId}`)
  return response.data
}

export const listJobs = async (): Promise<Job[]> => {
  const response = await api.get('/jobs')
  return response.data
}

export const deleteJob = async (jobId: string): Promise<void> => {
  await api.delete(`/jobs/${jobId}`)
}

export const getProcessedFileUrl = (jobId: string): string => {
  // No timestamp here - let the component handle cache busting if needed
  return `${API_URL}/api/files/processed/${jobId}.pdf`
}

export const getMaskedFileUrl = (jobId: string): string => {
  return `${API_URL}/api/files/processed/${jobId}_masked.pdf`
}

export const getRawFileUrl = (jobId: string, filename: string): string => {
  return `${API_URL}/api/files/raw/${jobId}/${filename}`
}

export const getJSONDownloadUrl = (jobId: string): string => {
  return `${API_URL}/api/download-json/${jobId}`
}

export interface ExportPayload {
  ocr_results: OCRResult
  smart_layers: SmartToolLayer[]
}

export interface ExportResponse {
  pdf_url: string
  json_url?: string
  smart_layers_url?: string
}

export const exportDocument = async (jobId: string, payload: ExportPayload): Promise<ExportResponse> => {
  let userId = ''
  try { userId = JSON.parse(localStorage.getItem('user') || '{}').user_id || '' } catch {}
  const response = await api.post(`/export/${jobId}?user_id=${userId}`, payload)
  return response.data
}

// Drive API
export interface DriveItem {
  name: string
  path: string
  type: 'file' | 'folder'
  size: number
  modified: string
  is_ocr_processed: boolean
}

export const listDriveFiles = async (path: string = ''): Promise<{ path: string; items: DriveItem[] }> => {
  const response = await api.get('/drive/list', { params: { path } })
  return response.data
}

export const createFolder = async (name: string, parentPath: string = ''): Promise<DriveItem> => {
  const response = await api.post('/drive/folder', {
    name,
    parent_path: parentPath,
  })
  return response.data.folder
}

export const uploadDriveFiles = async (files: File[], path: string = ''): Promise<DriveItem[]> => {
  const formData = new FormData()
  files.forEach(file => {
    formData.append('files', file)
  })

  const response = await api.post(`/drive/upload?path=${encodeURIComponent(path)}`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  })

  return response.data.files
}

export const moveFiles = async (sourcePaths: string[], destinationPath: string): Promise<void> => {
  await api.post('/drive/move', {
    source_paths: sourcePaths,
    destination_path: destinationPath,
  })
}

export const copyFiles = async (sourcePaths: string[], destinationPath: string): Promise<void> => {
  await api.post('/drive/copy', {
    source_paths: sourcePaths,
    destination_path: destinationPath,
  })
}

export const deleteFiles = async (paths: string[]): Promise<void> => {
  await api.post('/drive/delete', {
    paths,
  })
}

export const mergePDFs = async (filePaths: string[], outputName: string): Promise<DriveItem> => {
  const response = await api.post('/drive/merge-pdfs', {
    file_paths: filePaths,
    output_name: outputName,
  })
  return response.data.file
}

export const downloadDriveFile = async (path: string): Promise<File> => {
  const response = await api.get(`/drive/download`, {
    params: { path },
    responseType: 'blob',
  })
  const filename = path.split('/').pop() || 'file'
  return new File([response.data], filename, { type: response.data.type })
}

export const splitPDF = async (filePath: string, pageRanges: [number, number][]): Promise<DriveItem[]> => {
  const response = await api.post('/drive/split-pdf', {
    file_path: filePath,
    page_ranges: pageRanges,
  })
  return response.data.files
}

// Settings API
export interface OCRSettings {
  use_gpu: boolean
  rec_batch_num: number
  detection_limit_side_len: number
  use_smart_reading_order: boolean
}

export interface PDFSettings {
  dpi: number
  fast_mode: boolean
}

export interface PreprocessingSettings {
  enable: boolean
  denoise_enabled: boolean
  upscale_enabled: boolean
  clahe_enabled: boolean
}

export interface PerformanceSettings {
  gc_interval_pages: number
  enable_memory_cleanup: boolean
}

export interface AppSettings {
  ocr: OCRSettings
  pdf_processing: PDFSettings
  preprocessing: PreprocessingSettings
  performance: PerformanceSettings
}

export const getSettings = async (): Promise<AppSettings> => {
  const response = await api.get('/settings')
  return response.data
}

export const updateSettings = async (settings: Partial<AppSettings>): Promise<{ status: string; message: string }> => {
  const response = await api.put('/settings', settings)
  return response.data
}

// Auto-save OCR edits
export interface SaveEditsPayload {
  edits: Array<{
    page_number: number
    line_index: number
    original_text: string
    new_text: string
  }>
  ocr_results?: OCRResult
}

export interface SaveEditsResponse {
  status: string
  message: string
  saved_at: string
}

export const saveOCREdits = async (jobId: string, payload: SaveEditsPayload): Promise<SaveEditsResponse> => {
  const response = await api.post(`/save-edits/${jobId}`, payload)
  return response.data
}
