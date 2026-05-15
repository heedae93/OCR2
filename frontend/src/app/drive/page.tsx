'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import {
  listDriveFiles,
  createFolder,
  uploadDriveFiles,
  moveFiles,
  copyFiles,
  deleteFiles,
  mergePDFs,
  splitPDF,
  DriveItem,
  processJob,
  uploadFile
} from '@/lib/api'
import { useDropzone } from 'react-dropzone'

type ViewMode = 'list' | 'grid'
type ToolbarAction = 'move' | 'copy' | 'delete' | 'ocr' | 'merge' | 'split' | null

export default function DrivePage() {
  const router = useRouter()
  const [currentPath, setCurrentPath] = useState('')
  const [items, setItems] = useState<DriveItem[]>([])
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [activeAction, setActiveAction] = useState<ToolbarAction>(null)
  const [uploading, setUploading] = useState(false)

  const fetchFiles = useCallback(async () => {
    try {
      setLoading(true)
      const data = await listDriveFiles(currentPath)
      setItems(data.items)
    } catch (error) {
      console.error('Failed to fetch files:', error)
    } finally {
      setLoading(false)
    }
  }, [currentPath])

  useEffect(() => {
    fetchFiles()
  }, [fetchFiles])

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return

    setUploading(true)
    try {
      await uploadDriveFiles(acceptedFiles, currentPath)
      await fetchFiles()
    } catch (error) {
      console.error('Upload failed:', error)
      alert('파일 업로드에 실패했습니다.')
    } finally {
      setUploading(false)
    }
  }, [currentPath, fetchFiles])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
  })

  const handleFolderClick = (item: DriveItem) => {
    if (item.type === 'folder') {
      setCurrentPath(item.path)
      setSelectedItems(new Set())
    }
  }

  const handleFileDoubleClick = (item: DriveItem) => {
    if (item.type === 'file' && item.is_ocr_processed) {
      // PDF 파일이면 에디터로 이동
      const jobId = item.path.replace('.pdf', '')
      router.push(`/editor/${jobId}`)
    }
  }

  const handleItemSelect = (path: string) => {
    const newSelected = new Set(selectedItems)
    if (newSelected.has(path)) {
      newSelected.delete(path)
    } else {
      newSelected.add(path)
    }
    setSelectedItems(newSelected)
  }

  const handleSelectAll = () => {
    if (selectedItems.size === items.length) {
      setSelectedItems(new Set())
    } else {
      setSelectedItems(new Set(items.map(item => item.path)))
    }
  }

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return

    try {
      await createFolder(newFolderName, currentPath)
      setShowNewFolderDialog(false)
      setNewFolderName('')
      await fetchFiles()
    } catch (error) {
      console.error('Failed to create folder:', error)
      alert('폴더 생성에 실패했습니다.')
    }
  }

  const handleDelete = async () => {
    if (selectedItems.size === 0) return
    if (!confirm(`${selectedItems.size}개의 항목을 삭제하시겠습니까?`)) return

    try {
      await deleteFiles(Array.from(selectedItems))
      setSelectedItems(new Set())
      await fetchFiles()
    } catch (error) {
      console.error('Failed to delete:', error)
      alert('삭제에 실패했습니다.')
    }
  }

  const handleOCR = async () => {
    if (selectedItems.size === 0) return

    const pdfFiles = items.filter(item =>
      selectedItems.has(item.path) && item.type === 'file' && item.name.endsWith('.pdf')
    )

    if (pdfFiles.length === 0) {
      alert('PDF 파일을 선택해주세요.')
      return
    }

    alert(`${pdfFiles.length}개의 PDF 파일에 대한 OCR이 시작됩니다. (준비 중)`)
    // TODO: OCR 작업 시작
  }

  const handleMerge = async () => {
    const selectedPaths = Array.from(selectedItems)
    const pdfFiles = items.filter(item =>
      selectedPaths.includes(item.path) && item.type === 'file' && item.name.endsWith('.pdf')
    )

    if (pdfFiles.length < 2) {
      alert('병합할 PDF 파일을 2개 이상 선택해주세요.')
      return
    }

    const outputName = prompt('병합된 PDF 파일 이름을 입력하세요:', 'merged.pdf')
    if (!outputName) return

    try {
      await mergePDFs(selectedPaths, outputName)
      setSelectedItems(new Set())
      await fetchFiles()
      alert('PDF 병합이 완료되었습니다.')
    } catch (error) {
      console.error('Failed to merge:', error)
      alert('PDF 병합에 실패했습니다.')
    }
  }

  const handleSplit = async () => {
    if (selectedItems.size !== 1) {
      alert('분할할 PDF 파일을 1개만 선택해주세요.')
      return
    }

    const path = Array.from(selectedItems)[0]
    const item = items.find(i => i.path === path)

    if (!item || item.type !== 'file' || !item.name.endsWith('.pdf')) {
      alert('PDF 파일을 선택해주세요.')
      return
    }

    // Simple split dialog (can be improved with a modal)
    const input = prompt('페이지 범위를 입력하세요 (예: 1-5,6-10):')
    if (!input) return

    try {
      const ranges = input.split(',').map(range => {
        const [start, end] = range.trim().split('-').map(Number)
        return [start, end] as [number, number]
      })

      await splitPDF(path, ranges)
      setSelectedItems(new Set())
      await fetchFiles()
      alert('PDF 분할이 완료되었습니다.')
    } catch (error) {
      console.error('Failed to split:', error)
      alert('PDF 분할에 실패했습니다.')
    }
  }

  const handleBreadcrumbClick = (path: string) => {
    setCurrentPath(path)
    setSelectedItems(new Set())
  }

  const getBreadcrumbs = () => {
    if (!currentPath) return [{ name: '내 드라이브', path: '' }]

    const parts = currentPath.split('/')
    const breadcrumbs = [{ name: '내 드라이브', path: '' }]

    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join('/')
      breadcrumbs.push({ name: part, path })
    })

    return breadcrumbs
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '--'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
  }

  const formatDate = (isoDate: string) => {
    const date = new Date(isoDate)
    return date.toLocaleString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  return (
    <div className="relative flex min-h-screen w-full bg-slate-50 dark:bg-slate-50">
      <Sidebar />

      <main {...getRootProps()} className="ml-64 mt-14 flex-1 p-6 lg:p-10">
        <input {...getInputProps()} />

        <div className="w-full max-w-7xl mx-auto">
          {/* Header */}
          <div className="flex flex-wrap justify-between gap-4 mb-6">
            <div className="flex flex-col gap-2">
              <h1 className="text-text-primary-light dark:text-text-primary-dark text-3xl font-bold leading-tight tracking-tight">
                내 드라이브
              </h1>
              <p className="text-text-secondary-light dark:text-text-secondary-dark text-base font-normal leading-normal">
                파일과 폴더를 관리하고 OCR 작업을 수행하세요.
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2">
              <label className="flex h-10 cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-lg bg-primary px-4 text-sm font-bold text-white hover:bg-primary/90">
                <span className="material-symbols-outlined text-xl">cloud_upload</span>
                <span className="hidden sm:inline">파일 업로드</span>
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) {
                      onDrop(Array.from(e.target.files))
                      e.target.value = ''
                    }
                  }}
                />
              </label>

              <button
                onClick={() => setShowNewFolderDialog(true)}
                className="flex h-10 items-center justify-center gap-2 rounded-lg bg-primary/10 px-4 text-sm font-semibold text-primary hover:bg-primary/20"
              >
                <span className="material-symbols-outlined text-xl">create_new_folder</span>
                <span className="hidden sm:inline">새 폴더</span>
              </button>
            </div>
          </div>

          {/* Toolbar */}
          {selectedItems.size > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-primary/10 dark:bg-primary/20 p-3">
              <span className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">
                {selectedItems.size}개 선택됨
              </span>
              <div className="h-4 w-px bg-border-light dark:bg-border-dark"></div>
              <button
                onClick={handleOCR}
                className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-white dark:bg-surface-dark hover:bg-gray-100 dark:hover:bg-gray-700 text-sm"
              >
                <span className="material-symbols-outlined text-base">document_scanner</span>
                <span>OCR 실행</span>
              </button>
              <button
                onClick={handleMerge}
                className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-white dark:bg-surface-dark hover:bg-gray-100 dark:hover:bg-gray-700 text-sm"
              >
                <span className="material-symbols-outlined text-base">merge</span>
                <span>병합</span>
              </button>
              <button
                onClick={handleSplit}
                className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-white dark:bg-surface-dark hover:bg-gray-100 dark:hover:bg-gray-700 text-sm"
              >
                <span className="material-symbols-outlined text-base">call_split</span>
                <span>분할</span>
              </button>
              <button
                onClick={handleDelete}
                className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-red-500 hover:bg-red-600 text-white text-sm"
              >
                <span className="material-symbols-outlined text-base">delete</span>
                <span>삭제</span>
              </button>
            </div>
          )}

          {/* Breadcrumb */}
          <div className="mb-4 flex items-center gap-2 text-sm">
            {getBreadcrumbs().map((crumb, index) => (
              <div key={crumb.path} className="flex items-center gap-2">
                {index > 0 && (
                  <span className="material-symbols-outlined text-text-secondary-light dark:text-text-secondary-dark text-sm">
                    chevron_right
                  </span>
                )}
                <button
                  onClick={() => handleBreadcrumbClick(crumb.path)}
                  className="text-text-primary-light dark:text-text-primary-dark hover:text-primary font-medium"
                >
                  {crumb.name}
                </button>
              </div>
            ))}
          </div>

          {/* File List */}
          <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark shadow-sm">
            {isDragActive && (
              <div className="absolute inset-0 bg-primary/10 border-2 border-dashed border-primary rounded-xl flex items-center justify-center z-10">
                <div className="text-center">
                  <span className="material-symbols-outlined text-6xl text-primary">cloud_upload</span>
                  <p className="text-xl font-bold text-primary mt-2">파일을 여기에 놓으세요</p>
                </div>
              </div>
            )}

            {uploading ? (
              <div className="flex items-center justify-center py-20">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-text-secondary-light dark:text-text-secondary-dark text-sm">업로드 중...</p>
                </div>
              </div>
            ) : loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-text-secondary-light dark:text-text-secondary-dark text-sm">로딩 중...</p>
                </div>
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-text-secondary-light dark:text-text-secondary-dark">
                <span className="material-symbols-outlined text-6xl mb-4">folder_open</span>
                <p className="text-lg font-medium">폴더가 비어있습니다</p>
                <p className="text-sm mt-2">파일을 업로드하거나 폴더를 생성하세요</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="border-b border-border-light dark:border-border-dark">
                    <tr>
                      <th className="px-4 py-3 w-12">
                        <input
                          type="checkbox"
                          checked={selectedItems.size === items.length && items.length > 0}
                          onChange={handleSelectAll}
                          className="w-4 h-4 text-primary rounded border-border-light dark:border-border-dark"
                        />
                      </th>
                      <th className="px-4 py-3 text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                        이름
                      </th>
                      <th className="px-4 py-3 text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider hidden md:table-cell">
                        수정한 날짜
                      </th>
                      <th className="px-4 py-3 text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider hidden sm:table-cell">
                        크기
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-light dark:divide-border-dark">
                    {items.map((item) => (
                      <tr
                        key={item.path}
                        className={`hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer ${
                          selectedItems.has(item.path) ? 'bg-primary/5 dark:bg-primary/10' : ''
                        }`}
                      >
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedItems.has(item.path)}
                            onChange={() => handleItemSelect(item.path)}
                            onClick={(e) => e.stopPropagation()}
                            className="w-4 h-4 text-primary rounded border-border-light dark:border-border-dark"
                          />
                        </td>
                        <td
                          className="px-4 py-3"
                          onClick={() => handleFolderClick(item)}
                          onDoubleClick={() => handleFileDoubleClick(item)}
                        >
                          <div className="flex items-center gap-3">
                            <span className={`material-symbols-outlined ${
                              item.type === 'folder' ? 'text-yellow-500' : 'text-primary'
                            }`}>
                              {item.type === 'folder' ? 'folder' : 'description'}
                            </span>
                            <span className="text-text-primary-light dark:text-text-primary-dark text-sm font-medium">
                              {item.name}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-text-secondary-light dark:text-text-secondary-dark hidden md:table-cell">
                          {formatDate(item.modified)}
                        </td>
                        <td className="px-4 py-3 text-sm text-text-secondary-light dark:text-text-secondary-dark hidden sm:table-cell">
                          {formatFileSize(item.size)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* New Folder Dialog */}
      {showNewFolderDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="w-full max-w-md rounded-xl bg-surface-light dark:bg-surface-dark shadow-2xl p-6">
            <h2 className="text-xl font-bold text-text-primary-light dark:text-text-primary-dark mb-4">
              새 폴더 만들기
            </h2>
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleCreateFolder()}
              placeholder="폴더 이름"
              className="w-full rounded-lg border border-border-light dark:border-border-dark bg-background-light dark:bg-background-dark px-4 py-3 text-text-primary-light dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-primary"
              autoFocus
            />
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowNewFolderDialog(false)
                  setNewFolderName('')
                }}
                className="flex-1 rounded-lg px-4 py-2 bg-gray-200 dark:bg-surface-dark hover:bg-gray-300 dark:hover:bg-gray-700 text-text-primary-light dark:text-text-primary-dark font-medium"
              >
                취소
              </button>
              <button
                onClick={handleCreateFolder}
                className="flex-1 rounded-lg px-4 py-2 bg-primary hover:bg-primary/90 text-white font-bold"
              >
                만들기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
