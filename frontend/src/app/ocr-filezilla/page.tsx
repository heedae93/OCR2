'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import {
  Folder,
  FileText,
  ChevronRight,
  Loader2,
  Zap,
  Upload,
  Trash2,
  X,
  CheckCircle,
  AlertCircle,
  Clock,
  ArrowRight,
  HardDrive
} from 'lucide-react'

// API_BASE configuration matching current project
const API_BASE = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:6015'}/api`

const DEFAULT_DOC_TYPES = ['공문서', '계약서', '보고서', '학술논문', '법령문서', '회의록', '영수증', '신분증', '기타', '미분류']


// --- Types ---
type FileStatus = 'pending' | 'uploading' | 'processing' | 'completed' | 'failed'

interface QueueFile {
  id: string
  file: File
  status: FileStatus
  progress: number
  error?: string
  jobId?: string
}

interface LocalItem {
  name: string
  kind: 'file' | 'directory'
  handle: FileSystemHandle
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function OcrFilezillaPage() {
  const router = useRouter()
  
  // Local Explorer State
  const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(null)
  const [localItems, setLocalItems] = useState<LocalItem[]>([])
  const [pathStack, setPathStack] = useState<FileSystemDirectoryHandle[]>([])
  const [loadingLocal, setLoadingLocal] = useState(false)
  
  // Queue State
  const [sessionName, setSessionName] = useState('')
  const [queue, setQueue] = useState<QueueFile[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [isDone, setIsDone] = useState(false)
  const [selectedDocType, setSelectedDocType] = useState(DEFAULT_DOC_TYPES[0])
  const [categories, setCategories] = useState<{ id: number; name: string }[]>([])
  
  // Browser Support Check
  const [isSupported, setIsSupported] = useState(true)

  useEffect(() => {
    // File System Access API support check
    if (typeof window !== 'undefined' && !('showDirectoryPicker' in window)) {
      setIsSupported(false)
    }

    // Fetch categories
    const fetchCategories = async () => {
      try {
        const user = JSON.parse(localStorage.getItem('user') || '{}')
        const userId = user.user_id || 'default'
        const res = await fetch(`${API_BASE}/metadata-v3/categories?user_id=${encodeURIComponent(userId)}`)
        if (res.ok) {
          const data = await res.json()
          setCategories(data)
        }
      } catch (e) {
        console.error('Failed to fetch categories', e)
      }
    }
    fetchCategories()
  }, [])

  // --- Local Explorer Functions ---

  const connectFolder = async () => {
    try {
      const handle = await (window as any).showDirectoryPicker()
      setDirHandle(handle)
      setPathStack([handle])
      await listItems(handle)
    } catch (err) {
      console.error('Directory picker cancelled or failed', err)
    }
  }

  const listItems = async (handle: FileSystemDirectoryHandle) => {
    setLoadingLocal(true)
    try {
      const items: LocalItem[] = []
      // List all entries in the directory
      for await (const entry of (handle as any).values()) {
        if (entry.kind === 'file') {
          const name = entry.name.toLowerCase()
          // Only show supported files
          if (name.endsWith('.pdf') || name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg')) {
            items.push({ name: entry.name, kind: 'file', handle: entry })
          }
        } else {
          items.push({ name: entry.name, kind: 'directory', handle: entry })
        }
      }
      
      // Sort: Folders first, then files alphabetically
      items.sort((a, b) => {
        if (a.kind === b.kind) return a.name.localeCompare(b.name)
        return a.kind === 'directory' ? -1 : 1
      })
      setLocalItems(items)
    } catch (err) {
      console.error('Failed to list items', err)
    } finally {
      setLoadingLocal(false)
    }
  }

  const navigateTo = async (item: LocalItem) => {
    if (item.kind === 'directory') {
      const handle = item.handle as FileSystemDirectoryHandle
      setPathStack(prev => [...prev, handle])
      await listItems(handle)
    }
  }

  const goUp = async () => {
    if (pathStack.length > 1) {
      const newStack = [...pathStack]
      newStack.pop()
      const parent = newStack[newStack.length - 1]
      setPathStack(newStack)
      await listItems(parent)
    }
  }

  const addToQueue = async (item: LocalItem) => {
    if (item.kind !== 'file') return
    // Convert FileSystemFileHandle to regular File object
    const file = await (item.handle as FileSystemFileHandle).getFile()
    const newItem: QueueFile = {
      id: `${Date.now()}-${Math.random()}`,
      file,
      status: 'pending',
      progress: 0,
    }
    setQueue(prev => [...prev, newItem])
  }

  const addAllToQueue = async () => {
    const files = localItems.filter(i => i.kind === 'file')
    const newItems: QueueFile[] = []
    for (const item of files) {
      const file = await (item.handle as FileSystemFileHandle).getFile()
      newItems.push({
        id: `${Date.now()}-${Math.random()}`,
        file,
        status: 'pending',
        progress: 0,
      })
    }
    setQueue(prev => [...prev, ...newItems])
  }

  const allDocTypes = useCallback(() => {
    const dbTypeNames = categories.map(c => c.name)
    return [
      ...DEFAULT_DOC_TYPES,
      ...dbTypeNames.filter(name => !DEFAULT_DOC_TYPES.includes(name))
    ]
  }, [categories])()

  const updateQueueFile = (id: string, patch: Partial<QueueFile>) =>
    setQueue(prev => prev.map(f => (f.id === id ? { ...f, ...patch } : f)))

  const pollStatus = (jobId: string, fileId: string): Promise<void> =>
    new Promise((resolve, reject) => {
      const interval = setInterval(async () => {
        try {
          const res = await fetch(`${API_BASE}/status/${jobId}`)
          if (!res.ok) throw new Error('상태 조회 실패')
          const data = await res.json()
          
          // Progress mapping (50% upload + 50% processing)
          const mapped = 50 + Math.round(((data.progress_percent ?? 0) / 100) * 50)
          updateQueueFile(fileId, { progress: Math.min(mapped, 99) })
          
          if (data.status === 'completed') {
            clearInterval(interval)
            updateQueueFile(fileId, { status: 'completed', progress: 100 })
            resolve()
          } else if (data.status === 'failed') {
            clearInterval(interval)
            updateQueueFile(fileId, { status: 'failed', error: data.error_message || '처리 실패' })
            reject(new Error(data.error_message || '처리 실패'))
          }
        } catch (err) {
          clearInterval(interval)
          updateQueueFile(fileId, { status: 'failed', error: String(err) })
          reject(err)
        }
      }, 2000)
    })

  const startOcr = async () => {
    const pending = queue.filter(f => f.status === 'pending')
    if (!sessionName.trim() || pending.length === 0) {
      alert('세션 이름과 작업할 파일을 확인해주세요.')
      return
    }
    setIsRunning(true)
    setIsDone(false)

    let sessionId: string
    try {
      const res = await fetch(`${API_BASE}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_name: sessionName, description: 'Filezilla-style Upload' }),
      })
      if (!res.ok) throw new Error()
      sessionId = (await res.json()).session_id
    } catch {
      alert('세션 생성에 실패했습니다.')
      setIsRunning(false)
      return
    }

    // Process files sequentially
    for (const qf of pending) {
      try {
        updateQueueFile(qf.id, { status: 'uploading', progress: 0 })
        
        // 1. Upload File via XHR for progress tracking
        const jobId = await new Promise<string>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          const params = new URLSearchParams()
          if (selectedDocType && selectedDocType !== '미분류') {
            params.set('doc_type', selectedDocType)
          }
          xhr.open('POST', `${API_BASE}/upload?${params.toString()}`)
          xhr.upload.onprogress = e => {
            if (e.lengthComputable)
              updateQueueFile(qf.id, { progress: Math.round((e.loaded / e.total) * 50) })
          }
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try { resolve(JSON.parse(xhr.responseText).job_id) }
              catch { reject(new Error('응답 파싱 실패')) }
            } else {
              reject(new Error(`업로드 실패 (${xhr.status})`))
            }
          }
          xhr.onerror = () => reject(new Error('네트워크 오류'))
          const fd = new FormData()
          fd.append('file', qf.file)
          xhr.send(fd)
        })

        // 2. Add document to the session
        updateQueueFile(qf.id, { status: 'processing', progress: 50, jobId })
        await fetch(`${API_BASE}/sessions/${sessionId}/documents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ job_id: jobId }),
        })

        // 3. Trigger OCR processing
        await fetch(`${API_BASE}/process/${jobId}`, { method: 'POST' })
        
        // 4. Poll status until completion
        await pollStatus(jobId, qf.id)
      } catch (err) {
        updateQueueFile(qf.id, {
          status: 'failed',
          error: err instanceof Error ? err.message : '알 수 없는 오류',
        })
      }
    }

    setIsRunning(false)
    setIsDone(true)
  }

  const removeQueueItem = (id: string) => setQueue(prev => prev.filter(f => f.id !== id))
  const clearQueue = () => { if (!isRunning) setQueue([]) }

  if (!isSupported) {
    return (
      <div className="flex min-h-screen bg-background-light dark:bg-background-dark text-black dark:text-white">
        <Sidebar />
        <main className="flex-grow flex items-center justify-center p-10">
          <div className="max-w-md text-center bg-surface-light dark:bg-surface-dark p-8 rounded-2xl border border-border-light dark:border-border-dark shadow-xl">
            <AlertCircle className="w-16 h-16 text-orange-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-4">기능 미지원 브라우저</h2>
            <p className="text-text-secondary-light dark:text-text-secondary-dark mb-6">
              '파일질라 스타일' 기능은 현재 Chrome, Edge 등 일부 브라우저에서만 지원하는 File System Access API를 사용합니다. 
              표준 업로드 기능을 이용해 주세요.
            </p>
            <button 
              onClick={() => router.push('/ocr-work')}
              className="px-6 py-3 bg-primary text-white rounded-xl font-bold hover:bg-primary/90 transition-colors"
            >
              표준 OCR 작업으로 이동
            </button>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-background-light dark:bg-background-dark text-black dark:text-white">
      <Sidebar />
      <main className="flex-grow flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Header */}
        <header className="px-8 py-6 border-b border-border-light dark:border-border-dark bg-surface-light/50 dark:bg-surface-dark/50 backdrop-blur-md">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-text-primary-light dark:text-text-primary-dark">OCR 작업하기 (파일질라)</h1>
              <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark mt-1">로컬 폴더를 직접 연결하여 끊김 없이 OCR 작업을 진행하세요.</p>
            </div>
            {!dirHandle ? (
              <button 
                onClick={connectFolder}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-xl font-bold shadow-lg shadow-primary/20 hover:shadow-primary/30 active:scale-95 transition-all"
              >
                <HardDrive className="w-5 h-5" />
                내 컴퓨터 폴더 연결
              </button>
            ) : (
              <div className="flex items-center gap-3 bg-primary/10 px-4 py-2 rounded-xl border border-primary/20">
                <Folder className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold text-primary truncate max-w-xs">{dirHandle.name} 연결됨</span>
                <button onClick={connectFolder} className="text-xs text-primary underline hover:text-primary/80">변경</button>
              </div>
            )}
          </div>
        </header>

        {/* Dual-Pane View */}
        <div className="flex-grow flex overflow-hidden p-6 gap-6">
          
          {/* Left Panel: Local Explorer */}
          <section className="flex-1 flex flex-col bg-surface-light dark:bg-surface-dark rounded-2xl border border-border-light dark:border-border-dark shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border-light dark:border-border-dark bg-black/5 dark:bg-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2 overflow-hidden">
                <span className="text-sm font-bold text-text-primary-light dark:text-text-primary-dark whitespace-nowrap">로컬 탐색기</span>
                <div className="flex items-center gap-1 text-xs text-text-secondary-light dark:text-text-secondary-dark truncate">
                  {pathStack.map((h, i) => (
                    <span key={i} className="flex items-center gap-1">
                      {i > 0 && <ChevronRight className="w-3 h-3" />}
                      {h.name}
                    </span>
                  ))}
                </div>
              </div>
              {dirHandle && (
                <button 
                  onClick={addAllToQueue}
                  className="px-3 py-1 text-xs bg-primary/10 text-primary border border-primary/20 rounded-md hover:bg-primary/20 font-semibold"
                >
                  모두 전송
                </button>
              )}
            </div>

            <div className="flex-grow overflow-y-auto custom-scrollbar">
              {!dirHandle ? (
                <div className="flex flex-col items-center justify-center h-full text-center p-10 opacity-40">
                  <HardDrive className="w-16 h-16 mb-4" />
                  <p className="text-sm">폴더를 연결하면 파일 목록이 여기에 표시됩니다.</p>
                </div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-surface-light dark:bg-surface-dark border-b border-border-light dark:border-border-dark z-10">
                    <tr>
                      <th className="px-5 py-2.5 text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">이름</th>
                      <th className="px-5 py-2.5 text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider w-20 text-center">작업</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pathStack.length > 1 && (
                      <tr 
                        onClick={goUp}
                        className="hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer border-b border-border-light/50 dark:border-border-dark/50"
                      >
                        <td className="px-5 py-3 flex items-center gap-2">
                          <span className="material-symbols-outlined text-text-secondary-light dark:text-text-secondary-dark text-xl">keyboard_return</span>
                          <span className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">.. (상위 폴더)</span>
                        </td>
                        <td />
                      </tr>
                    )}
                    {localItems.map(item => (
                      <tr 
                        key={item.name}
                        onDoubleClick={() => item.kind === 'directory' ? navigateTo(item) : addToQueue(item)}
                        className="hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer border-b border-border-light/50 dark:border-border-dark/50 group"
                      >
                        <td className="px-5 py-3" onClick={() => navigateTo(item)}>
                          <div className="flex items-center gap-3">
                            {item.kind === 'directory' ? (
                              <Folder className="w-5 h-5 text-yellow-500" />
                            ) : (
                              <FileText className="w-5 h-5 text-primary" />
                            )}
                            <span className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark truncate max-w-md">{item.name}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-center">
                          {item.kind === 'file' && (
                            <button 
                              onClick={(e) => { e.stopPropagation(); addToQueue(item); }}
                              className="w-8 h-8 inline-flex items-center justify-center rounded-lg bg-primary/10 text-primary opacity-0 group-hover:opacity-100 hover:bg-primary hover:text-white transition-all shadow-sm"
                              title="대기열에 추가"
                            >
                              <ArrowRight className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {localItems.length === 0 && (
                      <tr>
                        <td colSpan={2} className="px-5 py-20 text-center text-sm text-text-secondary-light dark:text-text-secondary-dark opacity-50">
                          표시할 수 있는 파일이 없습니다.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          {/* Right Panel: OCR Queue */}
          <section className="flex-1 flex flex-col bg-surface-light dark:bg-surface-dark rounded-2xl border border-border-light dark:border-border-dark shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border-light dark:border-border-dark bg-black/5 dark:bg-white/5 flex items-center justify-between">
              <span className="text-sm font-bold text-text-primary-light dark:text-text-primary-dark">OCR 작업 대기열</span>
              <div className="flex items-center gap-3">
                <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">전체 {queue.length}건</span>
                <button 
                  onClick={clearQueue}
                  disabled={isRunning || queue.length === 0}
                  className="text-xs text-red-500 hover:text-red-600 disabled:opacity-40 flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  비우기
                </button>
              </div>
            </div>

            {/* Session Settings Bar */}
            <div className="p-5 border-b border-border-light dark:border-border-dark bg-primary/5">
              <div className="flex gap-4 items-end">
                <div className="flex-grow">
                  <label className="block text-[10px] font-bold text-primary mb-1.5 uppercase tracking-widest px-1">작업 세션 이름</label>
                  <input 
                    type="text" 
                    value={sessionName}
                    onChange={e => setSessionName(e.target.value)}
                    placeholder="예: 2024년 정산서 일괄 OCR"
                    disabled={isRunning}
                    className="w-full px-4 py-2.5 rounded-xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark text-sm focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                  />
                </div>
                <div className="w-48">
                  <label className="block text-[10px] font-bold text-primary mb-1.5 uppercase tracking-widest px-1">문서 유형</label>
                  <select
                    value={selectedDocType}
                    onChange={e => setSelectedDocType(e.target.value)}
                    disabled={isRunning}
                    className="w-full px-4 py-2.5 rounded-xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark text-sm focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                  >
                    {allDocTypes.map(type => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>
                <button 
                  onClick={startOcr}
                  disabled={isRunning || queue.length === 0 || !sessionName.trim()}
                  className="h-[42px] px-6 flex items-center gap-2 bg-primary text-white rounded-xl font-bold hover:bg-primary/90 disabled:opacity-40 disabled:scale-100 hover:scale-[1.02] active:scale-95 transition-all shadow-lg shadow-primary/20"
                >
                  {isRunning ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> 처리 중</>
                  ) : (
                    <><Zap className="w-4 h-4" /> OCR 시작</>
                  )}
                </button>
              </div>
            </div>

            {/* Queue List with Custom Design */}
            <div className="flex-grow overflow-y-auto custom-scrollbar bg-black/[0.01] dark:bg-white/[0.01]">
              {queue.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center p-10 opacity-40">
                  <ArrowRight className="w-16 h-16 mb-4 text-primary" />
                  <p className="text-sm">왼쪽에서 파일을 선택하거나<br/>더블클릭하여 추가하세요.</p>
                </div>
              ) : (
                <div className="divide-y divide-border-light/40 dark:divide-border-dark/40">
                  {queue.map(qf => (
                    <div key={qf.id} className="p-4 flex items-center gap-4 bg-surface-light dark:bg-surface-dark hover:bg-black/[0.01] transition-colors">
                      <div className="size-11 rounded-xl bg-primary/5 flex items-center justify-center text-primary shrink-0 relative">
                        {qf.status === 'pending' && <Clock className="w-5 h-5 opacity-30" />}
                        {qf.status === 'uploading' && <Upload className="w-5 h-5 animate-pulse" />}
                        {qf.status === 'processing' && <Loader2 className="w-5 h-5 animate-spin" />}
                        {qf.status === 'completed' && <CheckCircle className="w-5 h-5" />}
                        {qf.status === 'failed' && <AlertCircle className="w-5 h-5 text-red-500" />}
                        
                        <div className={`absolute -top-1 -right-1 size-3.5 rounded-full border-2 border-surface-light dark:border-surface-dark ${
                          qf.status === 'completed' ? 'bg-green-500' : 
                          qf.status === 'failed' ? 'bg-red-500' : 
                          qf.status === 'processing' ? 'bg-orange-500' : 
                          qf.status === 'uploading' ? 'bg-blue-500' : 'bg-gray-400'
                        }`} />
                      </div>
                      
                      <div className="flex-grow min-w-0">
                        <div className="flex items-center justify-between gap-4 mb-2">
                          <span className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark truncate underline decoration-primary/10 underline-offset-4">{qf.file.name}</span>
                          <span className="text-[10px] font-bold text-text-secondary-light/60 dark:text-text-secondary-dark/60 bg-black/5 dark:bg-white/5 px-2 py-0.5 rounded-md">{formatBytes(qf.file.size)}</span>
                        </div>
                        
                        <div className="flex items-center gap-4">
                          <div className="flex-grow h-1.5 bg-black/5 dark:bg-white/5 rounded-full overflow-hidden">
                            <div 
                              className={`h-full transition-all duration-300 rounded-full ${
                                qf.status === 'failed' ? 'bg-red-500' : 
                                qf.status === 'completed' ? 'bg-green-500' : 
                                qf.status === 'uploading' ? 'bg-blue-500' : 'bg-primary'
                              }`}
                              style={{ width: `${qf.progress}%` }}
                            />
                          </div>
                          <span className="text-[11px] font-bold text-primary w-8 text-right tabular-nums">{qf.progress}%</span>
                        </div>
                        
                        {qf.error && <p className="text-[10px] text-red-500 mt-1.5 font-medium italic">⚠ {qf.error}</p>}
                      </div>

                      {!isRunning && qf.status === 'pending' && (
                        <button 
                          onClick={() => removeQueueItem(qf.id)} 
                          className="p-2 text-text-secondary-light hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Bottom Status / Toast */}
            {isDone && (
              <div className="m-4 p-4 rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center gap-4 shadow-sm">
                <div className="size-10 rounded-full bg-green-500 flex items-center justify-center text-white shadow-md shadow-green-500/20">
                    <CheckCircle className="w-5 h-5" />
                </div>
                <div className="flex-grow">
                    <p className="text-sm font-bold text-green-700 dark:text-green-400">모든 작업이 성공적으로 완료되었습니다.</p>
                    <p className="text-xs text-green-600/70 dark:text-green-500/50">작업 내역 메뉴에서 결과를 확인하고 PDF를 다운로드할 수 있습니다.</p>
                </div>
                <button 
                  onClick={() => router.push('/jobs')}
                  className="px-4 py-2 bg-green-500 text-white rounded-xl text-xs font-bold hover:bg-green-600 transition-colors shadow-sm"
                >
                  결과 보기
                </button>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}
