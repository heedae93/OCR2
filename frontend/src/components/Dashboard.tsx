'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  FolderOpen,
  FileText,
  CheckCircle,
  Clock,
  TrendingUp,
  Calendar,
  Zap,
  BarChart3,
  AlertCircle
} from 'lucide-react'
import UploadQueueModal from './UploadQueueModal'

interface Session {
  session_id: string
  session_name: string
  description: string | null
  created_at: string
  updated_at: string
  total_documents: number
  completed_documents: number
  documents: any[]
}

interface Stats {
  total_sessions: number
  total_documents: number
  completed_documents: number
  processing_documents: number
  total_pages: number
  success_rate: number
}

export default function Dashboard() {
  const router = useRouter()
  const [sessions, setSessions] = useState<Session[]>([])
  const [stats, setStats] = useState<Stats>({
    total_sessions: 0,
    total_documents: 0,
    completed_documents: 0,
    processing_documents: 0,
    total_pages: 0,
    success_rate: 0
  })
  const [recentSessions, setRecentSessions] = useState<Session[]>([])
  const [showNewSessionModal, setShowNewSessionModal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [bgStats, setBgStats] = useState<{ total: number; completed: number; failed: number; isRunning: boolean } | null>(null)

  const API_BASE = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:6015'}/api`

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const user = JSON.parse(localStorage.getItem('user') || '{}')
      const response = await fetch(`${API_BASE}/sessions?user_id=${user.user_id || ''}`)
      if (response.ok) {
        const data: Session[] = await response.json()
        setSessions(data)

        // Calculate stats
        const totalDocs = data.reduce((sum, s) => sum + s.total_documents, 0)
        const completedDocs = data.reduce((sum, s) => sum + s.completed_documents, 0)
        const processingDocs = data.reduce((sum, s) => {
          const processing = s.documents.filter(d => d.status === 'processing').length
          return sum + processing
        }, 0)
        const totalPages = data.reduce((sum, s) => {
          const pages = s.documents.reduce((p, d) => p + (d.total_pages || 0), 0)
          return sum + pages
        }, 0)

        setStats({
          total_sessions: data.length,
          total_documents: totalDocs,
          completed_documents: completedDocs,
          processing_documents: processingDocs,
          total_pages: totalPages,
          success_rate: totalDocs > 0 ? (completedDocs / totalDocs) * 100 : 0
        })

        // Get recent sessions (last 5)
        const sorted = [...data].sort((a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        )
        setRecentSessions(sorted.slice(0, 5))
      }
    } catch (error) {
      console.error('Failed to fetch data:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return '방금 전'
    if (diffMins < 60) return `${diffMins}분 전`
    if (diffHours < 24) return `${diffHours}시간 전`
    if (diffDays < 7) return `${diffDays}일 전`

    return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-gray-500">로딩 중...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">총 세션</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                {stats.total_sessions}
              </p>
            </div>
            <div className="p-3 bg-blue-100 dark:bg-blue-900 rounded-lg">
              <FolderOpen className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">총 문서</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                {stats.total_documents}
              </p>
            </div>
            <div className="p-3 bg-green-100 dark:bg-green-900 rounded-lg">
              <FileText className="w-6 h-6 text-green-600 dark:text-green-400" />
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">완료된 작업</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                {stats.completed_documents}
              </p>
            </div>
            <div className="p-3 bg-purple-100 dark:bg-purple-900 rounded-lg">
              <CheckCircle className="w-6 h-6 text-purple-600 dark:text-purple-400" />
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">진행률</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                {stats.success_rate.toFixed(0)}%
              </p>
            </div>
            <div className="p-3 bg-yellow-100 dark:bg-yellow-900 rounded-lg">
              <TrendingUp className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-lg p-8 shadow-lg">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="text-white">
            <h2 className="text-2xl font-bold mb-2">빠른 OCR 작업 시작</h2>
            <p className="text-blue-100">
              새 세션을 만들고 PDF를 업로드하여 즉시 OCR 처리를 시작하세요
            </p>
          </div>
          <button
            onClick={() => router.push('/ocr-work')}
            className="flex items-center gap-2 px-6 py-3 bg-white text-blue-600 rounded-lg font-semibold hover:bg-blue-50 transition-colors whitespace-nowrap"
          >
            <Zap className="w-5 h-5" />
            새 작업 시작
          </button>
        </div>
      </div>

      {/* Recent Sessions and Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Sessions */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="p-6 border-b border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              최근 세션
            </h3>
          </div>
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {recentSessions.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                세션이 없습니다. 새 작업을 시작하세요!
              </div>
            ) : (
              recentSessions.map((session) => (
                <div
                  key={session.session_id}
                  className="p-4 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors"
                  onClick={() => {
                    if (session.documents.length > 0) {
                      router.push(`/editor/${session.documents[0].job_id}`)
                    }
                  }}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <FolderOpen className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        <h4 className="font-medium text-gray-900 dark:text-white">
                          {session.session_name}
                        </h4>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        {session.total_documents}개 문서 · {session.completed_documents}개 완료
                      </p>
                      {session.description && (
                        <p className="text-xs text-gray-500 mt-1">{session.description}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-500">{formatDate(session.updated_at)}</p>
                      {session.completed_documents === session.total_documents && session.total_documents > 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400 mt-1">
                          <CheckCircle className="w-3 h-3" />
                          완료
                        </span>
                      ) : session.documents.some(d => d.status === 'processing') ? (
                        <span className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 mt-1">
                          <Clock className="w-3 h-3 animate-spin" />
                          처리 중
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400 mt-1">
                          <AlertCircle className="w-3 h-3" />
                          대기 중
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Stats Summary */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="p-6 border-b border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              통계
            </h3>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-600 dark:text-gray-400">처리 중</span>
                <span className="font-medium text-gray-900 dark:text-white">
                  {stats.processing_documents}
                </span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all"
                  style={{
                    width: `${stats.total_documents > 0 ? (stats.processing_documents / stats.total_documents) * 100 : 0}%`
                  }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-600 dark:text-gray-400">완료됨</span>
                <span className="font-medium text-gray-900 dark:text-white">
                  {stats.completed_documents}
                </span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="bg-green-600 h-2 rounded-full transition-all"
                  style={{
                    width: `${stats.total_documents > 0 ? (stats.completed_documents / stats.total_documents) * 100 : 0}%`
                  }}
                />
              </div>
            </div>

            <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600 dark:text-gray-400">총 페이지</span>
                <span className="text-lg font-bold text-gray-900 dark:text-white">
                  {stats.total_pages}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Upload Queue Modal - 항상 마운트, visibility로 제어 */}
      <UploadQueueModal
        visible={showNewSessionModal}
        onClose={() => setShowNewSessionModal(false)}
        onComplete={() => {
          fetchData()
          setShowNewSessionModal(false)
        }}
        onProcessingChange={(stats) => {
          setBgStats(stats.isRunning || stats.total > 0 ? stats : null)
        }}
      />

      {/* 백그라운드 처리 중 플로팅 위젯 */}
      {bgStats && bgStats.isRunning && !showNewSessionModal && (
        <button
          onClick={() => setShowNewSessionModal(true)}
          className="fixed bottom-6 right-6 flex items-center gap-3 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-xl z-40 transition-colors"
        >
          <div className="relative">
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold leading-none">OCR 처리 중</p>
            <p className="text-xs text-blue-200 mt-0.5">{bgStats.completed}/{bgStats.total} 완료</p>
          </div>
        </button>
      )}
    </div>
  )
}
