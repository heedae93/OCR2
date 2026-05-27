'use client'

import { useState, useEffect, useCallback } from 'react'
import { FolderOpen, ChevronDown, ChevronRight, Download, Trash2, Loader2, RefreshCw, CheckCircle, Clock, AlertCircle, StopCircle, FolderPlus, File } from 'lucide-react'
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
  filterToCurrentSession?: boolean  // true이면 currentJobId가 속한 세션만 표시
  embedded?: boolean  // true이면 고정 너비/border 없이 부모 컨테이너에 맞춤
  onOpenExportModal?: (jobIds: string[]) => void
}

interface QueueItem {
  jobId: string
  filename: string
  status: 'waiting' | 'processing' | 'completed' | 'failed' | 'cancelled'
  progress: number
}

type FilterType = 'all' | 'completed' | 'pending'

export default function SessionSidebar({ onDocumentSelect, currentJobId, filterToCurrentSession = false, embedded = false, onOpenExportModal }: SessionSidebarProps) {
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
  const [addFileModal, setAddFileModal] = useState<{ sessionId: string } | null>(null)
  const [sidebarSelectedJobs, setSidebarSelectedJobs] = useState<Set<string>>(new Set())
  const [uploadProgress, setUploadProgress] = useState<{[sessionId: string]: {current: number, total: number, filename: string}}>({})
  const [filter] = useState<FilterType>('all')
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

  // currentJobId가 바뀌면 해당 세션을 자동으로 펼침
  useEffect(() => {
    if (!currentJobId || sessions.length === 0) return
    const target = sessions.find(s => s.documents.some(d => d.job_id === currentJobId))
    if (target) {
      setExpandedSessions(prev => {
        if (prev.has(target.session_id)) return prev
        const next = new Set(prev)
        next.add(target.session_id)
        return next
      })
    }
  }, [currentJobId, sessions])

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

      const uploadResponse = await fetch(`${API_BASE}/upload?session_id=${encodeURIComponent(sessionId)}`, {
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

      // 업로드 즉시 OCR 처리 시작
      await fetch(`${API_BASE}/process/${jobId}`, { method: 'POST' })

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

  if (loading) {
    return (
      <div className={`${embedded ? 'flex-1' : 'w-72 border-r border-gray-200 dark:border-gray-700'} p-4 flex items-center justify-center`}>
        <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
      </div>
    )
  }

  return (
    <div className={`${embedded ? 'flex flex-col h-full w-full' : 'w-72 border-r border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark flex flex-col h-full'}`}>
      {/* Header */}
      <div className="px-3 py-3 border-b border-border-light dark:border-border-dark bg-white dark:bg-surface-dark">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            {filterToCurrentSession ? (() => {
              const activeSession = sessions.find(s => s.documents.some(d => d.job_id === currentJobId))
              return (
                <div className="flex items-center justify-between w-full gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="flex-shrink-0 w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center">
                      <FolderOpen className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <span className="text-sm font-bold text-gray-900 truncate">
                      {activeSession ? activeSession.session_name : '세션 관리'}
                    </span>
                  </div>
                  {activeSession && (
                    <button
                      onClick={() => setAddFileModal({ sessionId: activeSession.session_id })}
                      disabled={uploadingSessions.has(activeSession.session_id)}
                      className="flex-shrink-0 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-500 text-white border border-emerald-600 hover:bg-emerald-600 active:bg-emerald-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                    >
                      파일 추가
                    </button>
                  )}
                </div>
              )
            })() : (
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-1.5">
                <FolderOpen className="w-4 h-4 flex-shrink-0" />
                세션 관리
              </h2>
            )}
          </div>
        </div>
      </div>

      {/* Processing Queue */}
      {false && showQueue && processingQueue.length > 0 && (
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
        {[...sessions]
          .filter(session =>
            !filterToCurrentSession ||
            !currentJobId ||
            session.documents.some(d => d.job_id === currentJobId)
          )
          .sort((a, b) => {
            const aActive = !!currentJobId && a.documents.some(d => d.job_id === currentJobId)
            const bActive = !!currentJobId && b.documents.some(d => d.job_id === currentJobId)
            return aActive === bActive ? 0 : aActive ? -1 : 1
          }).map((session) => {
          const filteredDocs = getFilteredDocuments(session.documents)
          const allSelected = filteredDocs.length > 0 && filteredDocs.every(doc => selectedDocs.has(doc.job_id))
          const someSelected = filteredDocs.some(doc => selectedDocs.has(doc.job_id))
          const isActiveSession = !!currentJobId && session.documents.some(d => d.job_id === currentJobId)

          // filterToCurrentSession 모드: 세션 헤더 없이 파일만 표시
          if (filterToCurrentSession) {
            return (
              <div key={session.session_id}>
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
                {/* 액션바 */}
                <div className="px-3 pt-3 pb-2">
                  <div className="flex gap-1">
                    <button
                      disabled={sidebarSelectedJobs.size === 0}
                      onClick={() => {
                        if (sidebarSelectedJobs.size === 0) return
                        const selectedIds = Array.from(sidebarSelectedJobs)
                        if (onOpenExportModal) {
                          onOpenExportModal(selectedIds)
                          return
                        }
                        const selectedDocs = session.documents.filter(d => sidebarSelectedJobs.has(d.job_id))
                        const downloadable = selectedDocs.filter(d => d.status === 'completed' && d.pdf_url)
                        downloadable.forEach(d => {
                          const a = document.createElement('a')
                          a.href = `${API_BASE}${d.pdf_url}`
                          a.download = d.original_filename.replace(/\.[^.]+$/, '') + '_ocr.pdf'
                          a.click()
                        })
                      }}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-semibold bg-blue-500 text-white border border-blue-600 hover:bg-blue-600 active:bg-blue-700 disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
                    >
                      <Download className="w-3 h-3" />
                      내보내기
                    </button>
                    <button
                      disabled={sidebarSelectedJobs.size === 0}
                      onClick={async () => {
                        for (const jobId of sidebarSelectedJobs) {
                          await fetch(`${API_BASE}/process/${jobId}`, { method: 'POST' })
                        }
                        fetchSessions()
                      }}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-semibold bg-orange-500 text-white border border-orange-600 hover:bg-orange-600 active:bg-orange-700 disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
                    >
                      <RefreshCw className="w-3 h-3" />
                      재처리
                    </button>
                    <button
                      disabled={sidebarSelectedJobs.size === 0}
                      onClick={async () => {
                        if (!confirm(`선택한 ${sidebarSelectedJobs.size}개 파일을 삭제할까요?`)) return
                        for (const jobId of sidebarSelectedJobs) {
                          await fetch(`${API_BASE}/jobs/${jobId}`, { method: 'DELETE' })
                        }
                        setSidebarSelectedJobs(new Set())
                        fetchSessions()
                      }}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-semibold bg-red-500 text-white border border-red-600 hover:bg-red-600 active:bg-red-700 disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                      삭제
                    </button>
                  </div>
                </div>
                {/* 구분선 */}
                <div className="border-t border-gray-200 mx-3" />
                {/* 전체 선택 */}
                <div className="px-3 py-2 flex items-center justify-between">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <button
                      onClick={() => {
                        const allSelected = filteredDocs.length > 0 && filteredDocs.every(d => sidebarSelectedJobs.has(d.job_id))
                        if (!allSelected) setSidebarSelectedJobs(new Set(filteredDocs.map(d => d.job_id)))
                        else setSidebarSelectedJobs(new Set())
                      }}
                      className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm border-2 transition-colors ${
                        filteredDocs.length > 0 && filteredDocs.every(d => sidebarSelectedJobs.has(d.job_id))
                          ? 'border-primary bg-primary text-white'
                          : 'border-gray-400 bg-white hover:border-primary'
                      }`}
                    >
                      {filteredDocs.length > 0 && filteredDocs.every(d => sidebarSelectedJobs.has(d.job_id)) && (
                        <span className="material-symbols-outlined text-[10px] leading-none">check</span>
                      )}
                    </button>
                    <span className="text-[11px] text-gray-700 font-semibold">전체 선택</span>
                  </label>
                  {sidebarSelectedJobs.size > 0 && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-primary">{sidebarSelectedJobs.size}개 선택됨</span>
                      <button
                        onClick={() => setSidebarSelectedJobs(new Set())}
                        className="text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        해제
                      </button>
                    </div>
                  )}
                </div>
                {/* Documents only */}
                <div className="py-1">
                  {filteredDocs.length === 0 ? (
                    <div className="px-4 py-3 text-xs text-gray-400 text-center">
                      {session.documents.length === 0 ? '문서 없음' : '필터된 문서 없음'}
                    </div>
                  ) : (
                    filteredDocs.map((doc) => (
                      <div
                        key={doc.job_id}
                        className={`flex items-center pl-2 pr-2 py-2 cursor-pointer transition-colors ${
                          currentJobId === doc.job_id
                            ? 'bg-primary/10 border-l-2 border-primary'
                            : 'hover:bg-blue-50 border-l-2 border-transparent hover:border-primary/40'
                        } ${navigatingJobId === doc.job_id ? 'animate-pulse' : ''}`}
                        onClick={() => handleDocumentSelect(doc.job_id)}
                      >
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setSidebarSelectedJobs(prev => {
                              const next = new Set(prev)
                              next.has(doc.job_id) ? next.delete(doc.job_id) : next.add(doc.job_id)
                              return next
                            })
                          }}
                          className={`mr-2 flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-sm border-2 transition-colors ${
                            sidebarSelectedJobs.has(doc.job_id)
                              ? 'border-primary bg-primary text-white'
                              : 'border-gray-400 bg-white hover:border-primary'
                          }`}
                        >
                          {sidebarSelectedJobs.has(doc.job_id) && (
                            <span className="material-symbols-outlined text-[10px] leading-none">check</span>
                          )}
                        </button>
                        {getStatusIcon(doc.status)}
                        <span className={`text-sm truncate ml-1.5 flex-1 min-w-0 font-medium ${
                          currentJobId === doc.job_id ? 'text-primary' : 'text-gray-900'
                        }`}>
                          {doc.original_filename.split('/').pop() || doc.original_filename}
                        </span>
                        {doc.status === 'processing' && (
                          <span className="text-[10px] text-blue-500 ml-1 flex-shrink-0 tabular-nums">
                            {doc.progress_percent.toFixed(0)}%
                          </span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )
          }

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
              <div className={`flex items-center px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
                isActiveSession ? 'bg-primary/5 dark:bg-primary/10 border-l-2 border-primary' : 'border-l-2 border-transparent'
              }`}>
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
                    <ChevronDown className={`w-3.5 h-3.5 ${isActiveSession ? 'text-primary' : 'text-gray-500'}`} />
                  ) : (
                    <ChevronRight className={`w-3.5 h-3.5 ${isActiveSession ? 'text-primary' : 'text-gray-500'}`} />
                  )}
                  <FolderOpen className={`w-3.5 h-3.5 ${isActiveSession ? 'text-primary' : 'text-primary'}`} />
                  <span className={`text-xs font-medium flex-1 truncate ${
                    isActiveSession ? 'text-primary dark:text-primary' : 'text-gray-900 dark:text-white'
                  }`}>
                    {session.session_name}
                  </span>
                  {isActiveSession && (
                    <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0 mr-1" />
                  )}
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
              onKeyDown={(e) => e.key === 'Enter' && createNewSession()}
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

      {/* 파일 추가 확인 모달 */}
      {addFileModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark shadow-2xl overflow-hidden">
            {/* 모달 헤더 */}
            <div className="px-5 pt-5 pb-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-sky-100 dark:bg-sky-900/40 flex items-center justify-center flex-shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sky-500"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text-primary-light dark:text-text-primary-dark">파일 추가 안내</h3>
                  <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-0.5">OCR 작업이 자동으로 시작됩니다</p>
                </div>
              </div>
              <div className="rounded-xl bg-sky-50 dark:bg-sky-900/20 border border-sky-100 dark:border-sky-800/40 px-4 py-3 text-xs text-sky-700 dark:text-sky-300 leading-relaxed">
                파일을 추가하면 <span className="font-semibold">즉시 OCR 처리가 시작</span>됩니다.<br/>
                진행 상황은 작업 내역에서 확인하실 수 있습니다.
              </div>
            </div>
            {/* 지원 형식 */}
            <div className="px-5 pb-4 flex items-center gap-1.5">
              {['PDF', 'PNG', 'JPG', 'JPEG'].map(ext => (
                <span key={ext} className="px-2 py-0.5 rounded-md bg-background-light dark:bg-background-dark border border-border-light dark:border-border-dark text-[10px] font-bold text-text-secondary-light dark:text-text-secondary-dark">{ext}</span>
              ))}
              <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark ml-1">지원</span>
            </div>
            {/* 버튼 */}
            <div className="px-5 pb-5 flex gap-2">
              <button
                onClick={() => setAddFileModal(null)}
                className="flex-1 py-2.5 rounded-xl border border-border-light dark:border-border-dark text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark hover:border-primary/30 hover:text-primary transition-colors"
              >
                취소
              </button>
              <button
                onClick={() => {
                  const { sessionId } = addFileModal
                  setAddFileModal(null)
                  handleFileSelect(sessionId)
                }}
                className="flex-1 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 active:bg-sky-700 text-xs font-bold text-white transition-colors"
              >
                파일 선택하기
              </button>
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
