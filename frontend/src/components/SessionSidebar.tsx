'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { FolderOpen, ChevronDown, ChevronRight, FileText, Download, Merge, Plus, Trash2, PlayCircle, Loader2, RefreshCw, CheckCircle, Clock, AlertCircle, ListTodo, StopCircle, X, FolderPlus, File } from 'lucide-react'
import SessionExportModal from './SessionExportModal'

interface Document {
  job_id: string
  original_filename: string
  status: string
  progress_percent: number
  current_page: number
  total_pages: number
  order: number
  is_selected: boolean
  pdf_url: string | null
  added_at: string
}

interface Session {
  session_id: string
  session_name: string
  description: string | null
  created_at: string
  updated_at: string
  total_documents: number
  completed_documents: number
  documents: Document[]
}

interface SessionSidebarProps {
  onDocumentSelect?: (jobId: string) => void
  currentJobId?: string
}

interface QueueItem {
  jobId: string
  filename: string
  status: 'waiting' | 'processing' | 'completed' | 'failed' | 'cancelled'
  progress: number
}

type FilterType = 'all' | 'completed' | 'pending'

export default function SessionSidebar({ onDocumentSelect, currentJobId }: SessionSidebarProps) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('bb-expanded-sessions')
        if (stored) {
          const parsed = JSON.parse(stored)
          if (Array.isArray(parsed) && parsed.length) {
            return new Set(parsed)
          }
        }
      } catch (error) {
        console.warn('Failed to restore expanded sessions:', error)
      }
    }
    return new Set(['default'])
  })
  const [loading, setLoading] = useState(true)
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set())
  const [showNewSessionModal, setShowNewSessionModal] = useState(false)
  const [newSessionName, setNewSessionName] = useState('')
  const [uploadingSessions, setUploadingSessions] = useState<Set<string>>(new Set())
  const [uploadProgress, setUploadProgress] = useState<{[sessionId: string]: {current: number, total: number, filename: string}}>({})
  const [filter, setFilter] = useState<FilterType>('all')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [navigatingJobId, setNavigatingJobId] = useState<string | null>(null)

  // Queue state
  const [processingQueue, setProcessingQueue] = useState<QueueItem[]>([])
  const [showQueue, setShowQueue] = useState(false)

  // Export state
  const [exportProgress, setExportProgress] = useState<{
    exporting: boolean
    exportId: string | null
    progress: number
    currentFile: number
    totalFiles: number
    currentPage: number
    totalPages: number
    message: string
  }>({
    exporting: false,
    exportId: null,
    progress: 0,
    currentFile: 0,
    totalFiles: 0,
    currentPage: 0,
    totalPages: 0,
    message: ''
  })

  // Export modal state
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportSessionInfo, setExportSessionInfo] = useState<{sessionId: string, sessionName: string} | null>(null)

  const API_BASE = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:6015'}/api`
  const router = useRouter()

  // Initial fetch
  useEffect(() => {
    fetchSessions()
  }, [])

  // Sync processing jobs from backend to local queue (for multi-browser support)
  // This runs whenever sessions change to detect jobs started from other browsers
  useEffect(() => {
    if (sessions.length === 0) return

    // Build maps for quick lookup
    const allDocs = new Map<string, { status: string; progress: number; filename: string }>()
    sessions.forEach(session => {
      session.documents.forEach(doc => {
        allDocs.set(doc.job_id, {
          status: doc.status,
          progress: doc.progress_percent || 0,
          filename: doc.original_filename
        })
      })
    })

    // Get currently processing docs
    const processingDocs = Array.from(allDocs.entries())
      .filter(([_, doc]) => doc.status === 'processing')
      .map(([jobId, doc]) => ({ jobId, ...doc }))

    // Update queue with processing jobs
    setProcessingQueue(prev => {
      const existingJobIds = new Set(prev.map(q => q.jobId))
      const newProcessingJobs = processingDocs.filter(doc => !existingJobIds.has(doc.jobId))

      // Update existing items based on server status
      let updated = prev.map(item => {
        const serverDoc = allDocs.get(item.jobId)
        if (!serverDoc) return item

        if (serverDoc.status === 'completed') {
          return { ...item, status: 'completed' as const, progress: 100 }
        } else if (serverDoc.status === 'failed') {
          return { ...item, status: 'failed' as const, progress: item.progress }
        } else if (serverDoc.status === 'processing') {
          return { ...item, status: 'processing' as const, progress: serverDoc.progress }
        }
        return item
      })

      // Remove completed/failed items after delay (keep for 2 seconds)
      const completedOrFailed = updated.filter(q => q.status === 'completed' || q.status === 'failed')
      if (completedOrFailed.length > 0) {
        setTimeout(() => {
          setProcessingQueue(current =>
            current.filter(q => q.status !== 'completed' && q.status !== 'failed')
          )
        }, 2000)
      }

      // Add new processing jobs from other browsers
      if (newProcessingJobs.length > 0) {
        setShowQueue(true)
        return [
          ...updated,
          ...newProcessingJobs.map(doc => ({
            jobId: doc.jobId,
            filename: doc.filename,
            status: 'processing' as const,
            progress: doc.progress
          }))
        ]
      }

      return updated
    })
  }, [sessions])

  // Persist expanded sessions
  useEffect(() => {
    try {
      localStorage.setItem('bb-expanded-sessions', JSON.stringify(Array.from(expandedSessions)))
    } catch (error) {
      console.warn('Failed to persist expanded sessions:', error)
    }
  }, [expandedSessions])

  // Auto-poll for processing jobs (1 second interval for responsive updates)
  useEffect(() => {
    const hasProcessingJobs = sessions.some(session =>
      session.documents.some(doc => doc.status === 'processing')
    ) || processingQueue.some(q => q.status === 'processing' || q.status === 'waiting')

    if (!hasProcessingJobs) return

    const interval = setInterval(async () => {
      await fetchSessions()
    }, 1000)

    return () => clearInterval(interval)
  }, [sessions, processingQueue])

  useEffect(() => {
    setNavigatingJobId(null)
  }, [currentJobId])

  const fetchSessions = async (showRefreshAnimation = false) => {
    try {
      if (showRefreshAnimation) {
        setIsRefreshing(true)
      } else if (sessions.length === 0) {
        setLoading(true)
      }
      const user = JSON.parse(localStorage.getItem('user') || '{}')
      const response = await fetch(`${API_BASE}/sessions?user_id=${user.user_id || ''}`)
      if (response.ok) {
        const data = await response.json()
        setSessions(data)

        const selected = new Set<string>()
        data.forEach((session: Session) => {
          session.documents.forEach((doc: Document) => {
            if (doc.is_selected) {
              selected.add(doc.job_id)
            }
          })
        })
        setSelectedDocs(selected)
      }
    } catch (error) {
      console.error('Failed to fetch sessions:', error)
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }

  const getFilteredDocuments = useCallback((documents: Document[]) => {
    switch (filter) {
      case 'completed':
        return documents.filter(doc => doc.status === 'completed')
      case 'pending':
        return documents.filter(doc => doc.status !== 'completed')
      default:
        return documents
    }
  }, [filter])

  const toggleSession = (sessionId: string) => {
    const newExpanded = new Set(expandedSessions)
    if (newExpanded.has(sessionId)) {
      newExpanded.delete(sessionId)
    } else {
      newExpanded.add(sessionId)
    }
    setExpandedSessions(newExpanded)
  }

  const toggleDocSelection = async (sessionId: string, jobId: string, e?: React.MouseEvent) => {
    e?.stopPropagation()

    const newSelected = new Set(selectedDocs)
    const isSelected = !newSelected.has(jobId)

    if (isSelected) {
      newSelected.add(jobId)
    } else {
      newSelected.delete(jobId)
    }
    setSelectedDocs(newSelected)

    try {
      await fetch(`${API_BASE}/sessions/${sessionId}/selection`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_ids: [jobId],
          is_selected: isSelected
        })
      })
    } catch (error) {
      console.error('Failed to update selection:', error)
    }
  }

  const selectAll = async (sessionId: string) => {
    const session = sessions.find(s => s.session_id === sessionId)
    if (!session) return

    const filteredDocs = getFilteredDocuments(session.documents)
    const allSelected = filteredDocs.every(doc => selectedDocs.has(doc.job_id))

    const newSelected = new Set(selectedDocs)
    const jobIds = filteredDocs.map(doc => doc.job_id)

    if (allSelected) {
      jobIds.forEach(id => newSelected.delete(id))
    } else {
      jobIds.forEach(id => newSelected.add(id))
    }
    setSelectedDocs(newSelected)

    try {
      await fetch(`${API_BASE}/sessions/${sessionId}/selection`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_ids: jobIds,
          is_selected: !allSelected
        })
      })
    } catch (error) {
      console.error('Failed to update selection:', error)
    }
  }

  const handleDocumentSelect = useCallback((jobId: string) => {
    setNavigatingJobId(jobId)
    onDocumentSelect?.(jobId)
  }, [onDocumentSelect])

  const startOCRProcessing = async (jobId: string, filename: string) => {
    // Add to queue
    setProcessingQueue(prev => [...prev, {
      jobId,
      filename,
      status: 'waiting',
      progress: 0
    }])
    setShowQueue(true)

    try {
      const response = await fetch(`${API_BASE}/process/${jobId}`, {
        method: 'POST'
      })

      if (!response.ok) {
        throw new Error('OCR processing failed')
      }

      // Update queue item to processing
      setProcessingQueue(prev => prev.map(item =>
        item.jobId === jobId ? { ...item, status: 'processing' } : item
      ))
    } catch (error) {
      console.error('Failed to start OCR:', error)
      setProcessingQueue(prev => prev.map(item =>
        item.jobId === jobId ? { ...item, status: 'failed' } : item
      ))
    }
  }

  const startBatchOCR = async () => {
    // Get all selected queued documents across all sessions
    const docsToProcess: { jobId: string; filename: string }[] = []

    sessions.forEach(session => {
      session.documents.forEach(doc => {
        if (selectedDocs.has(doc.job_id) && doc.status === 'queued') {
          docsToProcess.push({ jobId: doc.job_id, filename: doc.original_filename })
        }
      })
    })

    if (docsToProcess.length === 0) {
      alert('처리할 대기 중인 문서를 선택해주세요')
      return
    }

    // Add all to queue
    setProcessingQueue(prev => [
      ...prev,
      ...docsToProcess.map(doc => ({
        jobId: doc.jobId,
        filename: doc.filename,
        status: 'waiting' as const,
        progress: 0
      }))
    ])
    setShowQueue(true)

    // Process sequentially
    for (const doc of docsToProcess) {
      try {
        setProcessingQueue(prev => prev.map(item =>
          item.jobId === doc.jobId ? { ...item, status: 'processing' } : item
        ))

        const response = await fetch(`${API_BASE}/process/${doc.jobId}`, {
          method: 'POST'
        })

        if (!response.ok) {
          setProcessingQueue(prev => prev.map(item =>
            item.jobId === doc.jobId ? { ...item, status: 'failed' } : item
          ))
        }

        // Wait for this job to complete before starting next
        await waitForJobCompletion(doc.jobId)
      } catch (error) {
        console.error(`Failed to process ${doc.jobId}:`, error)
        setProcessingQueue(prev => prev.map(item =>
          item.jobId === doc.jobId ? { ...item, status: 'failed' } : item
        ))
      }
    }
  }

  const waitForJobCompletion = (jobId: string): Promise<void> => {
    return new Promise((resolve) => {
      const checkStatus = async () => {
        try {
          const response = await fetch(`${API_BASE}/status/${jobId}`)
          if (response.ok) {
            const data = await response.json()

            setProcessingQueue(prev => prev.map(item =>
              item.jobId === jobId ? { ...item, progress: data.progress_percent || 0 } : item
            ))

            if (data.status === 'completed' || data.status === 'failed') {
              setProcessingQueue(prev => prev.map(item =>
                item.jobId === jobId ? {
                  ...item,
                  status: data.status === 'completed' ? 'completed' : 'failed',
                  progress: 100
                } : item
              ))
              await fetchSessions()

              // Remove from queue after short delay
              setTimeout(() => {
                setProcessingQueue(prev => prev.filter(item => item.jobId !== jobId))
              }, 2000)

              return true // Job completed
            }
          }
          return false // Job still processing
        } catch (error) {
          console.error('Failed to check job status:', error)
          return false
        }
      }

      // Check immediately first
      checkStatus().then(completed => {
        if (completed) {
          resolve()
          return
        }

        // Then poll every 1 second
        const checkInterval = setInterval(async () => {
          const completed = await checkStatus()
          if (completed) {
            clearInterval(checkInterval)
            resolve()
          }
        }, 1000)
      })
    })
  }

  const batchDeleteDocuments = async () => {
    const selectedJobIds = Array.from(selectedDocs)

    if (selectedJobIds.length === 0) {
      alert('삭제할 문서를 선택해주세요')
      return
    }

    if (!confirm(`선택한 ${selectedJobIds.length}개의 문서를 삭제하시겠습니까?`)) {
      return
    }

    for (const session of sessions) {
      for (const jobId of selectedJobIds) {
        if (session.documents.some(d => d.job_id === jobId)) {
          try {
            await fetch(`${API_BASE}/sessions/${session.session_id}/documents/${jobId}`, {
              method: 'DELETE'
            })
          } catch (error) {
            console.error(`Failed to delete document ${jobId}:`, error)
          }
        }
      }
    }

    setSelectedDocs(new Set())
    await fetchSessions()
  }

  // Cancel a single job
  const cancelJob = async (jobId: string) => {
    try {
      const res = await fetch(`${API_BASE}/cancel/${jobId}`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        console.error('Cancel failed:', res.status, err)
        alert(`중단 실패: ${err.detail || res.statusText}`)
        return
      }

      setProcessingQueue(prev => prev.map(item =>
        item.jobId === jobId ? { ...item, status: 'cancelled' as const } : item
      ))

      setTimeout(() => {
        setProcessingQueue(prev => prev.filter(item => item.jobId !== jobId))
      }, 2000)

      await fetchSessions()
    } catch (error) {
      console.error('Failed to cancel job:', error)
      alert('중단 요청 중 오류가 발생했습니다.')
    }
  }

  // Cancel all jobs in queue
  const cancelAllQueue = async () => {
    if (!confirm('모든 작업을 중단하시겠습니까?')) return

    const jobsToCancel = processingQueue.filter(q => q.status === 'processing' || q.status === 'waiting')

    for (const item of jobsToCancel) {
      if (item.status === 'processing') {
        try {
          await fetch(`${API_BASE}/cancel/${item.jobId}`, {
            method: 'POST'
          })
        } catch (error) {
          console.error(`Failed to cancel job ${item.jobId}:`, error)
        }
      }
    }

    // Clear queue
    setProcessingQueue([])
    await fetchSessions()
  }

  // Remove waiting job from queue
  const removeFromQueue = (jobId: string) => {
    setProcessingQueue(prev => prev.filter(item => item.jobId !== jobId))
  }

  // Open export modal
  const openExportModal = () => {
    const selectedJobIds = Array.from(selectedDocs)
    const completedSelected = sessions.flatMap(s => s.documents)
      .filter(d => selectedJobIds.includes(d.job_id) && d.status === 'completed')

    if (completedSelected.length === 0) {
      alert('내보낼 완료된 문서를 선택해주세요')
      return
    }

    // Find the session with most selected docs
    let targetSession = sessions[0]
    sessions.forEach(session => {
      const count = session.documents.filter(d => selectedDocs.has(d.job_id) && d.status === 'completed').length
      if (count > targetSession.documents.filter(d => selectedDocs.has(d.job_id) && d.status === 'completed').length) {
        targetSession = session
      }
    })

    setExportSessionInfo({
      sessionId: targetSession.session_id,
      sessionName: targetSession.session_name
    })
    setShowExportModal(true)
  }

  // Handle multi-format export from modal
  const handleMultiFormatExport = async (formats: string[], asZip: boolean) => {
    if (!exportSessionInfo) return

    try {
      const response = await fetch(`${API_BASE}/sessions/${exportSessionInfo.sessionId}/export-multi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formats, as_zip: asZip })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail || 'Export failed')
      }

      const data = await response.json()
      const exportId = data.export_id

      // Set initial export state
      setExportProgress({
        exporting: true,
        exportId,
        progress: 0,
        currentFile: 0,
        totalFiles: data.total_files,
        currentPage: 0,
        totalPages: 0,
        message: 'Export starting...'
      })

      // Poll for progress
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch(`${API_BASE}/sessions/export-status/${exportId}`)
          if (!statusRes.ok) {
            clearInterval(pollInterval)
            setExportProgress(prev => ({ ...prev, exporting: false, message: 'Export failed' }))
            return
          }

          const status = await statusRes.json()

          setExportProgress({
            exporting: true,
            exportId,
            progress: status.progress_percent,
            currentFile: status.current_file,
            totalFiles: status.total_files,
            currentPage: status.current_page || 0,
            totalPages: status.total_pages || 0,
            message: status.message || ''
          })

          if (status.status === 'completed') {
            clearInterval(pollInterval)

            // Download the file with progress tracking
            const downloadUrl = `${API_BASE}${status.download_url}`
            const downloadRes = await fetch(downloadUrl)

            if (downloadRes.ok) {
              const contentLength = downloadRes.headers.get('content-length')
              const totalSize = contentLength ? parseInt(contentLength, 10) : 0

              // Format file size
              const formatSize = (bytes: number) => {
                if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`
                if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`
                if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`
                return `${bytes}B`
              }

              setExportProgress(prev => ({
                ...prev,
                message: `다운로드 준비 중... (${formatSize(totalSize)})`
              }))

              if (totalSize > 0 && downloadRes.body) {
                // Stream download with progress
                const reader = downloadRes.body.getReader()
                const chunks: Uint8Array[] = []
                let receivedLength = 0

                while (true) {
                  const { done, value } = await reader.read()
                  if (done) break

                  chunks.push(value)
                  receivedLength += value.length

                  const downloadPercent = Math.round((receivedLength / totalSize) * 100)
                  setExportProgress(prev => ({
                    ...prev,
                    progress: downloadPercent,
                    message: `다운로드 중... ${formatSize(receivedLength)} / ${formatSize(totalSize)} (${downloadPercent}%)`
                  }))
                }

                // Combine chunks into blob
                const blob = new Blob(chunks as BlobPart[])
                const url = window.URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = status.filename || `${exportSessionInfo.sessionName}_export.zip`
                document.body.appendChild(a)
                a.click()
                document.body.removeChild(a)
                window.URL.revokeObjectURL(url)
              } else {
                // Fallback for servers that don't send content-length
                setExportProgress(prev => ({ ...prev, message: '다운로드 중...' }))
                const blob = await downloadRes.blob()
                const url = window.URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = status.filename || `${exportSessionInfo.sessionName}_export.zip`
                document.body.appendChild(a)
                a.click()
                document.body.removeChild(a)
                window.URL.revokeObjectURL(url)
              }
            }

            setExportProgress({
              exporting: false,
              exportId: null,
              progress: 0,
              currentFile: 0,
              totalFiles: 0,
              currentPage: 0,
              totalPages: 0,
              message: ''
            })
          } else if (status.status === 'failed') {
            clearInterval(pollInterval)
            alert(`Export failed: ${status.message}`)
            setExportProgress({
              exporting: false,
              exportId: null,
              progress: 0,
              currentFile: 0,
              totalFiles: 0,
              currentPage: 0,
              totalPages: 0,
              message: ''
            })
          }
        } catch (err) {
          console.error('Failed to check export status:', err)
        }
      }, 500)

    } catch (error) {
      console.error('Multi-format export failed:', error)
      throw error
    }
  }

  const exportMerged = async () => {
    const selectedJobIds = Array.from(selectedDocs)
    const completedSelected = sessions.flatMap(s => s.documents)
      .filter(d => selectedJobIds.includes(d.job_id) && d.status === 'completed')

    if (completedSelected.length === 0) {
      alert('내보낼 완료된 문서를 선택해주세요')
      return
    }

    // Find the session with most selected docs
    let targetSession = sessions[0]
    sessions.forEach(session => {
      const count = session.documents.filter(d => selectedDocs.has(d.job_id) && d.status === 'completed').length
      if (count > targetSession.documents.filter(d => selectedDocs.has(d.job_id) && d.status === 'completed').length) {
        targetSession = session
      }
    })

    try {
      // Start async export
      const response = await fetch(`${API_BASE}/sessions/${targetSession.session_id}/export-merged`, {
        method: 'POST'
      })

      if (!response.ok) {
        const error = await response.json()
        alert(`Export failed: ${error.detail}`)
        return
      }

      const data = await response.json()
      const exportId = data.export_id

      // Set initial export state
      setExportProgress({
        exporting: true,
        exportId,
        progress: 0,
        currentFile: 0,
        totalFiles: data.total_files,
        currentPage: 0,
        totalPages: 0,
        message: 'Export starting...'
      })

      // Poll for progress
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch(`${API_BASE}/sessions/export-status/${exportId}`)
          if (!statusRes.ok) {
            clearInterval(pollInterval)
            setExportProgress(prev => ({ ...prev, exporting: false, message: 'Export failed' }))
            return
          }

          const status = await statusRes.json()

          setExportProgress({
            exporting: true,
            exportId,
            progress: status.progress_percent,
            currentFile: status.current_file,
            totalFiles: status.total_files,
            currentPage: status.current_page || 0,
            totalPages: status.total_pages || 0,
            message: status.message || ''
          })

          if (status.status === 'completed') {
            clearInterval(pollInterval)

            // Download the file with progress tracking
            const downloadUrl = `${API_BASE}${status.download_url}`
            const downloadRes = await fetch(downloadUrl)

            if (downloadRes.ok) {
              const contentLength = downloadRes.headers.get('content-length')
              const totalSize = contentLength ? parseInt(contentLength, 10) : 0

              // Format file size
              const formatSize = (bytes: number) => {
                if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`
                if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`
                if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`
                return `${bytes}B`
              }

              setExportProgress(prev => ({
                ...prev,
                message: `다운로드 준비 중... (${formatSize(totalSize)})`
              }))

              if (totalSize > 0 && downloadRes.body) {
                // Stream download with progress
                const reader = downloadRes.body.getReader()
                const chunks: Uint8Array[] = []
                let receivedLength = 0

                while (true) {
                  const { done, value } = await reader.read()
                  if (done) break

                  chunks.push(value)
                  receivedLength += value.length

                  const downloadPercent = Math.round((receivedLength / totalSize) * 100)
                  setExportProgress(prev => ({
                    ...prev,
                    progress: downloadPercent,
                    message: `다운로드 중... ${formatSize(receivedLength)} / ${formatSize(totalSize)} (${downloadPercent}%)`
                  }))
                }

                // Combine chunks into blob
                const blob = new Blob(chunks as BlobPart[])
                const url = window.URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `${targetSession.session_name}_merged.pdf`
                document.body.appendChild(a)
                a.click()
                document.body.removeChild(a)
                window.URL.revokeObjectURL(url)
              } else {
                // Fallback for servers that don't send content-length
                setExportProgress(prev => ({ ...prev, message: '다운로드 중...' }))
                const blob = await downloadRes.blob()
                const url = window.URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `${targetSession.session_name}_merged.pdf`
                document.body.appendChild(a)
                a.click()
                document.body.removeChild(a)
                window.URL.revokeObjectURL(url)
              }
            }

            setExportProgress({
              exporting: false,
              exportId: null,
              progress: 0,
              currentFile: 0,
              totalFiles: 0,
              currentPage: 0,
              totalPages: 0,
              message: ''
            })
          } else if (status.status === 'failed') {
            clearInterval(pollInterval)
            alert(`Export failed: ${status.message}`)
            setExportProgress({
              exporting: false,
              exportId: null,
              progress: 0,
              currentFile: 0,
              totalFiles: 0,
              currentPage: 0,
              totalPages: 0,
              message: ''
            })
          }
        } catch (err) {
          console.error('Failed to check export status:', err)
        }
      }, 500)  // Poll every 500ms

    } catch (error) {
      console.error('Failed to export merged PDF:', error)
      alert('Failed to export merged PDF')
      setExportProgress({
        exporting: false,
        exportId: null,
        progress: 0,
        currentFile: 0,
        totalFiles: 0,
        currentPage: 0,
        totalPages: 0,
        message: ''
      })
    }
  }

  const createNewSession = async () => {
    if (!newSessionName.trim()) {
      alert('세션 이름을 입력해주세요')
      return
    }

    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}')
      const response = await fetch(`${API_BASE}/sessions?user_id=${user.user_id || ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_name: newSessionName,
          description: ''
        })
      })

      if (response.ok) {
        setNewSessionName('')
        setShowNewSessionModal(false)
        await fetchSessions()
      } else {
        alert('세션 생성 실패')
      }
    } catch (error) {
      console.error('Failed to create session:', error)
      alert('세션 생성 중 오류 발생')
    }
  }

  const deleteSession = async (sessionId: string) => {
    if (sessionId === 'default') {
      alert('기본 세션은 삭제할 수 없습니다')
      return
    }

    if (!confirm('이 세션을 삭제하시겠습니까?')) {
      return
    }

    try {
      const response = await fetch(`${API_BASE}/sessions/${sessionId}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        await fetchSessions()
      } else {
        alert('세션 삭제 실패')
      }
    } catch (error) {
      console.error('Failed to delete session:', error)
    }
  }

  const handleFileSelect = (sessionId: string, isFolder: boolean = false) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.pdf,.png,.jpg,.jpeg'
    input.multiple = true

    if (isFolder) {
      // @ts-ignore - webkitdirectory is not in standard types
      input.webkitdirectory = true
      // @ts-ignore
      input.directory = true
    }

    input.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files
      if (files) {
        // Filter only supported files
        const supportedFiles = Array.from(files).filter(file => {
          const ext = file.name.toLowerCase().split('.').pop()
          return ['pdf', 'png', 'jpg', 'jpeg'].includes(ext || '')
        })

        if (supportedFiles.length === 0) {
          alert('지원되는 파일이 없습니다 (PDF, PNG, JPG)')
          return
        }

        // Show confirmation for folder upload
        if (isFolder && supportedFiles.length > 0) {
          if (!confirm(`${supportedFiles.length}개의 파일을 업로드하시겠습니까?`)) {
            return
          }
        }

        // Upload all files with progress tracking
        const total = supportedFiles.length
        for (let i = 0; i < supportedFiles.length; i++) {
          const file = supportedFiles[i]
          setUploadProgress(prev => ({
            ...prev,
            [sessionId]: { current: i + 1, total, filename: file.name }
          }))
          await uploadFile(sessionId, file)
        }

        // Clear progress when done
        setUploadProgress(prev => {
          const newProgress = { ...prev }
          delete newProgress[sessionId]
          return newProgress
        })
      }
    }
    input.click()
  }

  const uploadFile = async (sessionId: string, file: File) => {
    try {
      setUploadingSessions(prev => new Set(prev).add(sessionId))

      const formData = new FormData()
      formData.append('file', file)

      const uploadResponse = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        body: formData
      })

      if (!uploadResponse.ok) {
        throw new Error('Upload failed')
      }

      const uploadData = await uploadResponse.json()
      const jobId = uploadData.job_id

      if (sessionId !== 'default') {
        await fetch(`${API_BASE}/sessions/${sessionId}/documents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ job_id: jobId })
        })
      }

      setExpandedSessions(prev => new Set(prev).add(sessionId))
      await fetchSessions()
    } catch (error) {
      console.error('Failed to upload file:', error)
      alert('파일 업로드 실패')
    } finally {
      setUploadingSessions(prev => {
        const newSet = new Set(prev)
        newSet.delete(sessionId)
        return newSet
      })
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-3.5 h-3.5 text-green-500" />
      case 'processing':
        return <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />
      case 'failed':
        return <AlertCircle className="w-3.5 h-3.5 text-red-500" />
      default:
        return <Clock className="w-3.5 h-3.5 text-gray-400" />
    }
  }

  // Count selected docs
  const selectedCount = selectedDocs.size
  const selectedQueuedCount = sessions.flatMap(s => s.documents)
    .filter(d => selectedDocs.has(d.job_id) && d.status === 'queued').length
  const selectedCompletedCount = sessions.flatMap(s => s.documents)
    .filter(d => selectedDocs.has(d.job_id) && d.status === 'completed').length

  if (loading) {
    return (
      <div className="w-72 border-r border-gray-200 dark:border-gray-700 p-4 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
      </div>
    )
  }

  return (
    <div className="w-72 border-r border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-border-light dark:border-border-dark">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-1.5">
            <FolderOpen className="w-4 h-4" />
            세션 관리
          </h2>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setShowQueue(!showQueue)}
              className={`p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors ${
                processingQueue.length > 0 ? 'text-primary' : 'text-gray-500'
              }`}
              title="작업 큐"
            >
              <ListTodo className="w-4 h-4" />
              {processingQueue.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-primary text-white text-xs rounded-full flex items-center justify-center">
                  {processingQueue.length}
                </span>
              )}
            </button>
            <button
              onClick={() => fetchSessions(true)}
              disabled={isRefreshing}
              className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 disabled:opacity-50"
              title="새로고침"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setShowNewSessionModal(true)}
              className="p-1.5 rounded bg-primary hover:bg-primary/90 text-white"
              title="새 세션"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-0.5 bg-gray-100 dark:bg-gray-800 rounded p-0.5">
          {(['all', 'pending', 'completed'] as FilterType[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex-1 px-2 py-1 text-xs font-medium rounded transition-colors ${
                filter === f
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {f === 'all' ? '전체' : f === 'pending' ? '대기' : '완료'}
            </button>
          ))}
        </div>
      </div>

      {/* Batch Action Bar - Shows when items are selected */}
      {selectedCount > 0 && (
        <div className="p-2 border-b border-border-light dark:border-border-dark bg-primary/5 dark:bg-primary/10">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-primary">
              {selectedCount}개 선택됨
            </span>
            <button
              onClick={() => setSelectedDocs(new Set())}
              className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >
              선택 해제
            </button>
          </div>
          <div className="flex gap-1">
            {selectedQueuedCount > 0 && (
              <button
                onClick={startBatchOCR}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded"
              >
                <PlayCircle className="w-3 h-3" />
                OCR ({selectedQueuedCount})
              </button>
            )}
            {selectedCompletedCount > 0 && (
              <button
                onClick={openExportModal}
                disabled={exportProgress.exporting}
                className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-white text-xs font-medium rounded ${
                  exportProgress.exporting
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-primary hover:bg-primary/90'
                }`}
              >
                {exportProgress.exporting ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Download className="w-3 h-3" />
                )}
                {exportProgress.exporting ? '내보내는 중...' : '내보내기'}
              </button>
            )}
            <button
              onClick={batchDeleteDocuments}
              className="flex items-center justify-center gap-1 px-2 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* Processing Queue */}
      {showQueue && processingQueue.length > 0 && (
        <div className="p-2 border-b border-border-light dark:border-border-dark bg-blue-50 dark:bg-blue-900/20">
          {/* Queue Header with overall progress */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-blue-700 dark:text-blue-300 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              작업 큐
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-blue-600 dark:text-blue-400">
                {processingQueue.filter(q => q.status === 'completed').length}/{processingQueue.length} 완료
              </span>
              <button
                onClick={cancelAllQueue}
                className="text-xs text-red-500 hover:text-red-700 flex items-center gap-0.5"
                title="전체 중단"
              >
                <StopCircle className="w-3 h-3" />
                중단
              </button>
            </div>
          </div>

          {/* Overall Progress Bar */}
          <div className="mb-2">
            <div className="h-1.5 bg-blue-200 dark:bg-blue-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{
                  width: `${processingQueue.length > 0
                    ? (processingQueue.reduce((acc, q) => acc + (q.status === 'completed' ? 100 : q.progress), 0) / processingQueue.length)
                    : 0}%`
                }}
              />
            </div>
          </div>

          {/* Queue Items */}
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {processingQueue.map((item) => (
              <div
                key={item.jobId}
                className="relative bg-white dark:bg-gray-800 rounded overflow-hidden"
              >
                {/* Progress fill background */}
                {item.status === 'processing' && (
                  <div
                    className="absolute inset-0 bg-blue-500/20 dark:bg-blue-400/20 transition-all duration-300"
                    style={{ width: `${item.progress}%` }}
                  />
                )}
                {item.status === 'completed' && (
                  <div className="absolute inset-0 bg-green-500/15 dark:bg-green-400/15" />
                )}
                {item.status === 'failed' && (
                  <div className="absolute inset-0 bg-red-500/15 dark:bg-red-400/15" />
                )}

                {/* Content */}
                <div className="relative flex items-center gap-2 text-xs p-1.5">
                  {item.status === 'processing' ? (
                    <Loader2 className="w-3 h-3 animate-spin text-blue-500 flex-shrink-0" />
                  ) : item.status === 'completed' ? (
                    <CheckCircle className="w-3 h-3 text-green-500 flex-shrink-0" />
                  ) : item.status === 'failed' ? (
                    <AlertCircle className="w-3 h-3 text-red-500 flex-shrink-0" />
                  ) : item.status === 'cancelled' ? (
                    <StopCircle className="w-3 h-3 text-gray-400 flex-shrink-0" />
                  ) : (
                    <Clock className="w-3 h-3 text-gray-400 flex-shrink-0" />
                  )}
                  <span className="flex-1 truncate text-gray-700 dark:text-gray-300">
                    {item.filename}
                  </span>
                  {item.status === 'processing' && (
                    <>
                      <span className="text-blue-600 dark:text-blue-400 font-medium tabular-nums">
                        {item.progress.toFixed(0)}%
                      </span>
                      <button
                        onClick={() => cancelJob(item.jobId)}
                        className="p-0.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded text-gray-400 hover:text-red-500"
                        title="중단"
                      >
                        <StopCircle className="w-3 h-3" />
                      </button>
                    </>
                  )}
                  {item.status === 'waiting' && (
                    <button
                      onClick={() => removeFromQueue(item.jobId)}
                      className="p-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-400 hover:text-gray-600"
                      title="큐에서 제거"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sessions List */}
      <div className="flex-1 overflow-y-auto">
        {sessions.map((session) => {
          const filteredDocs = getFilteredDocuments(session.documents)
          const allSelected = filteredDocs.length > 0 && filteredDocs.every(doc => selectedDocs.has(doc.job_id))
          const someSelected = filteredDocs.some(doc => selectedDocs.has(doc.job_id))

          return (
            <div key={session.session_id} className="border-b border-border-light dark:border-border-dark">
              {/* Upload Progress Indicator */}
              {uploadProgress[session.session_id] && (
                <div className="px-2 py-1.5 bg-blue-50 dark:bg-blue-900/30 border-b border-blue-200 dark:border-blue-800">
                  <div className="flex items-center gap-2 text-xs">
                    <Loader2 className="w-3 h-3 animate-spin text-blue-500 flex-shrink-0" />
                    <span className="text-blue-700 dark:text-blue-300 font-medium">
                      업로드 중 {uploadProgress[session.session_id].current}/{uploadProgress[session.session_id].total}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-blue-200 dark:bg-blue-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full transition-all duration-300"
                        style={{ width: `${(uploadProgress[session.session_id].current / uploadProgress[session.session_id].total) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-blue-600 dark:text-blue-400">
                      {Math.round((uploadProgress[session.session_id].current / uploadProgress[session.session_id].total) * 100)}%
                    </span>
                  </div>
                  <p className="text-xs text-blue-600 dark:text-blue-400 truncate mt-0.5">
                    {uploadProgress[session.session_id].filename}
                  </p>
                </div>
              )}

              {/* Session Header */}
              <div className="flex items-center px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800">
                {/* Select All Checkbox */}
                <button
                  onClick={() => selectAll(session.session_id)}
                  className={`w-4 h-4 rounded border flex items-center justify-center mr-1 transition-colors ${
                    allSelected
                      ? 'bg-primary border-primary'
                      : someSelected
                      ? 'bg-primary/50 border-primary'
                      : 'border-gray-300 dark:border-gray-600 hover:border-primary'
                  }`}
                >
                  {(allSelected || someSelected) && (
                    <svg className="w-3 h-3 text-white" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                      <path d={allSelected ? "M5 13l4 4L19 7" : "M5 12h14"}></path>
                    </svg>
                  )}
                </button>

                <div
                  className="flex items-center gap-1 flex-1 cursor-pointer"
                  onClick={() => toggleSession(session.session_id)}
                >
                  {expandedSessions.has(session.session_id) ? (
                    <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-gray-500" />
                  )}
                  <FolderOpen className="w-3.5 h-3.5 text-primary" />
                  <span className="text-xs font-medium text-gray-900 dark:text-white flex-1 truncate">
                    {session.session_name}
                  </span>
                  <span className="text-xs text-gray-400">
                    {session.completed_documents}/{session.total_documents}
                  </span>
                </div>

                <div className="flex items-center">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleFileSelect(session.session_id, false)
                    }}
                    disabled={uploadingSessions.has(session.session_id)}
                    className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 disabled:opacity-50"
                    title="파일 추가"
                  >
                    <File className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleFileSelect(session.session_id, true)
                    }}
                    disabled={uploadingSessions.has(session.session_id)}
                    className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 disabled:opacity-50"
                    title="폴더에서 추가"
                  >
                    <FolderPlus className="w-3.5 h-3.5" />
                  </button>
                  {session.session_id !== 'default' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteSession(session.session_id)
                      }}
                      className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-500 hover:text-red-600"
                      title="세션 삭제"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Documents List - VS Code style */}
              {expandedSessions.has(session.session_id) && (
                <div className="bg-gray-50/50 dark:bg-gray-800/50">
                  {filteredDocs.length === 0 ? (
                    <div className="px-4 py-2 text-xs text-gray-400 text-center">
                      {session.documents.length === 0 ? '문서 없음' : '필터된 문서 없음'}
                    </div>
                  ) : (
                    filteredDocs.map((doc) => (
                      <div
                        key={doc.job_id}
                        className={`flex items-center px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-700/50 cursor-pointer group transition-colors ${
                          currentJobId === doc.job_id
                            ? 'bg-primary/10 dark:bg-primary/20 border-l-2 border-primary'
                            : 'border-l-2 border-transparent'
                        } ${navigatingJobId === doc.job_id ? 'animate-pulse' : ''}`}
                      >
                        {/* Checkbox */}
                        <button
                          onClick={(e) => toggleDocSelection(session.session_id, doc.job_id, e)}
                          className={`w-4 h-4 rounded border flex items-center justify-center mr-2 flex-shrink-0 transition-colors ${
                            selectedDocs.has(doc.job_id)
                              ? 'bg-primary border-primary'
                              : 'border-gray-300 dark:border-gray-600 group-hover:border-primary'
                          }`}
                        >
                          {selectedDocs.has(doc.job_id) && (
                            <svg className="w-3 h-3 text-white" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                              <path d="M5 13l4 4L19 7"></path>
                            </svg>
                          )}
                        </button>

                        {/* File info */}
                        <div
                          className="flex items-center gap-1.5 flex-1 min-w-0"
                          onClick={() => handleDocumentSelect(doc.job_id)}
                        >
                          {getStatusIcon(doc.status)}
                          <span className={`text-xs truncate ${
                            currentJobId === doc.job_id
                              ? 'text-primary font-medium'
                              : 'text-gray-700 dark:text-gray-300'
                          }`}>
                            {doc.original_filename}
                          </span>
                        </div>

                        {/* Processing progress */}
                        {doc.status === 'processing' && (
                          <span className="text-xs text-blue-500 ml-1">
                            {doc.progress_percent.toFixed(0)}%
                          </span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* New Session Modal */}
      {showNewSessionModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface-light dark:bg-surface-dark rounded-lg p-5 w-80 mx-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
              새 세션 만들기
            </h3>
            <input
              type="text"
              value={newSessionName}
              onChange={(e) => setNewSessionName(e.target.value)}
              placeholder="세션 이름"
              className="w-full px-3 py-2 text-sm border border-border-light dark:border-border-dark rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white mb-3"
              onKeyPress={(e) => e.key === 'Enter' && createNewSession()}
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowNewSessionModal(false)
                  setNewSessionName('')
                }}
                className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded"
              >
                취소
              </button>
              <button
                onClick={createNewSession}
                className="px-3 py-1.5 text-sm bg-primary hover:bg-primary/90 text-white rounded"
              >
                만들기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Progress Modal */}
      {exportProgress.exporting && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface-light dark:bg-surface-dark rounded-lg p-5 w-80 mx-4">
            <div className="flex items-center gap-2 mb-4">
              <Loader2 className="w-5 h-5 text-primary animate-spin" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                내보내기 진행 중
              </h3>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 mb-3 overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${exportProgress.progress}%` }}
              />
            </div>

            {/* Progress text */}
            <div className="text-center">
              <p className="text-lg font-bold text-primary mb-1">
                {exportProgress.progress.toFixed(0)}%
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">
                {exportProgress.message}
              </p>
              {exportProgress.totalPages > 0 && (
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  페이지 {exportProgress.currentPage.toLocaleString()} / {exportProgress.totalPages.toLocaleString()}
                </p>
              )}
              {exportProgress.totalFiles > 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                  파일 {exportProgress.currentFile} / {exportProgress.totalFiles}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Session Export Modal */}
      {exportSessionInfo && (
        <SessionExportModal
          isOpen={showExportModal}
          onClose={() => {
            setShowExportModal(false)
            setExportSessionInfo(null)
          }}
          sessionId={exportSessionInfo.sessionId}
          sessionName={exportSessionInfo.sessionName}
          selectedCount={Array.from(selectedDocs).filter(jobId =>
            sessions.flatMap(s => s.documents).find(d => d.job_id === jobId && d.status === 'completed')
          ).length}
          onExport={handleMultiFormatExport}
        />
      )}
    </div>
  )
}
