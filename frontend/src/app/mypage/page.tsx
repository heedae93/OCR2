'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { API_BASE_URL } from '@/lib/api'

interface UserInfo {
  user_id: string
  username: string
  name: string
  email: string
  type: string
}

export default function MyPage() {
  const router = useRouter()
  const [user, setUser] = useState<UserInfo | null>(null)

  // 기본정보 수정
  const [infoForm, setInfoForm] = useState({ name: '', email: '' })
  const [infoError, setInfoError] = useState('')
  const [infoSuccess, setInfoSuccess] = useState('')
  const [infoLoading, setInfoLoading] = useState(false)

  // 비밀번호 변경
  const [showPwForm, setShowPwForm] = useState(false)
  const [pwForm, setPwForm] = useState({ current_password: '', new_password: '', confirm_password: '' })
  const [pwError, setPwError] = useState('')
  const [pwSuccess, setPwSuccess] = useState('')
  const [pwLoading, setPwLoading] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const stored = localStorage.getItem('user')
    if (!stored) { router.push('/login'); return }
    const u = JSON.parse(stored)
    setUser(u)
    setInfoForm({ name: u.name || '', email: u.email || '' })
  }, [])

  const handleInfoSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setInfoError('')
    setInfoSuccess('')
    if (!infoForm.name.trim()) { setInfoError('이름을 입력해주세요.'); return }
    setInfoLoading(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/profile/${user!.user_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: infoForm.name, email: infoForm.email }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || '저장 실패')
      // localStorage 업데이트
      const updated = { ...user, name: data.name, email: data.email }
      localStorage.setItem('user', JSON.stringify(updated))
      setUser(updated as UserInfo)
      setInfoSuccess('정보가 저장되었습니다.')
    } catch (e: unknown) {
      setInfoError(e instanceof Error ? e.message : '오류가 발생했습니다.')
    } finally {
      setInfoLoading(false)
    }
  }

  const handlePwSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setPwError('')
    setPwSuccess('')
    if (!pwForm.current_password) { setPwError('현재 비밀번호를 입력해주세요.'); return }
    if (!pwForm.new_password) { setPwError('새 비밀번호를 입력해주세요.'); return }
    if (pwForm.new_password !== pwForm.confirm_password) { setPwError('새 비밀번호가 일치하지 않습니다.'); return }
    if (pwForm.new_password.length < 4) { setPwError('비밀번호는 4자 이상이어야 합니다.'); return }
    setPwLoading(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/profile/${user!.user_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: pwForm.current_password, new_password: pwForm.new_password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || '변경 실패')
      setPwSuccess('비밀번호가 변경되었습니다.')
      setPwForm({ current_password: '', new_password: '', confirm_password: '' })
    } catch (e: unknown) {
      setPwError(e instanceof Error ? e.message : '오류가 발생했습니다.')
    } finally {
      setPwLoading(false)
    }
  }

  const inputClass = 'px-4 py-2.5 rounded-xl border border-border-light dark:border-border-dark text-sm bg-background-light dark:bg-background-dark text-text-primary-light dark:text-text-primary-dark placeholder:text-text-secondary-light dark:placeholder:text-text-secondary-dark outline-none transition-colors focus:border-primary'

  if (!user) return null

  return (
    <div className="bg-background-light dark:bg-background-dark min-h-screen">
      <Sidebar />
      <div className="flex-1 ml-64 mt-14 p-8 max-w-2xl">
        <h1 className="text-2xl font-bold text-primary mb-8">마이페이지</h1>

        {/* 프로필 카드 */}
        <div className="bg-surface-light dark:bg-surface-dark rounded-2xl border border-border-light dark:border-border-dark p-6 mb-6 flex items-center gap-4">
          <div className="bg-gradient-to-br from-primary to-primary/70 rounded-full size-16 flex items-center justify-center text-white font-bold text-2xl shadow-md">
            {(user.name || user.username)[0].toUpperCase()}
          </div>
          <div>
            <p className="text-lg font-bold text-text-primary-light dark:text-text-primary-dark">{user.name || user.username}</p>
            <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">{user.username}</p>
            <span className={`inline-flex items-center mt-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
              user.type === 'A'
                ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'
                : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
            }`}>
              {user.type === 'A' ? '관리자' : '일반 사용자'}
            </span>
          </div>
        </div>

        {/* 기본정보 수정 */}
        <div className="bg-surface-light dark:bg-surface-dark rounded-2xl border border-border-light dark:border-border-dark p-6 mb-6">
          <h2 className="text-base font-bold text-text-primary-light dark:text-text-primary-dark mb-4 flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">person</span>
            기본 정보 수정
          </h2>
          <form onSubmit={handleInfoSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">아이디</label>
              <input type="text" value={user.username} disabled
                className={`${inputClass} opacity-50 cursor-not-allowed`} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">이름 *</label>
              <input type="text" value={infoForm.name} onChange={e => setInfoForm(p => ({ ...p, name: e.target.value }))}
                placeholder="이름" className={inputClass} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">이메일</label>
              <input type="email" value={infoForm.email} onChange={e => setInfoForm(p => ({ ...p, email: e.target.value }))}
                placeholder="이메일" className={inputClass} />
            </div>
            {infoError && <p className="text-sm text-red-500 bg-red-50 dark:bg-red-500/10 px-3 py-2 rounded-lg">{infoError}</p>}
            {infoSuccess && <p className="text-sm text-green-600 bg-green-50 dark:bg-green-500/10 px-3 py-2 rounded-lg">{infoSuccess}</p>}
            <button type="submit" disabled={infoLoading}
              className="w-full py-2.5 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 transition-all disabled:opacity-60">
              {infoLoading ? '저장 중...' : '저장'}
            </button>
          </form>
        </div>

        {/* 비밀번호 변경 */}
        <div className="bg-surface-light dark:bg-surface-dark rounded-2xl border border-border-light dark:border-border-dark p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-text-primary-light dark:text-text-primary-dark flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">lock</span>
              비밀번호 변경
            </h2>
            <button
              onClick={() => { setShowPwForm(v => !v); setPwError(''); setPwSuccess(''); setPwForm({ current_password: '', new_password: '', confirm_password: '' }) }}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border-light dark:border-border-dark text-sm text-text-secondary-light dark:text-text-secondary-dark hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            >
              <span className="material-symbols-outlined text-base">{showPwForm ? 'expand_less' : 'edit'}</span>
              {showPwForm ? '닫기' : '변경하기'}
            </button>
          </div>
          {!showPwForm && (
            <p className="mt-3 text-sm text-text-secondary-light dark:text-text-secondary-dark">
              보안을 위해 주기적으로 비밀번호를 변경해주세요.
            </p>
          )}
          {showPwForm && (
            <form onSubmit={handlePwSubmit} className="flex flex-col gap-4 mt-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">현재 비밀번호</label>
                <input type="password" value={pwForm.current_password} onChange={e => setPwForm(p => ({ ...p, current_password: e.target.value }))}
                  placeholder="현재 비밀번호" className={inputClass} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">새 비밀번호</label>
                <input type="password" value={pwForm.new_password} onChange={e => setPwForm(p => ({ ...p, new_password: e.target.value }))}
                  placeholder="새 비밀번호 (4자 이상)" className={inputClass} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">새 비밀번호 확인</label>
                <input type="password" value={pwForm.confirm_password} onChange={e => setPwForm(p => ({ ...p, confirm_password: e.target.value }))}
                  placeholder="새 비밀번호 확인" className={inputClass} />
              </div>
              {pwError && <p className="text-sm text-red-500 bg-red-50 dark:bg-red-500/10 px-3 py-2 rounded-lg">{pwError}</p>}
              {pwSuccess && <p className="text-sm text-green-600 bg-green-50 dark:bg-green-500/10 px-3 py-2 rounded-lg">{pwSuccess}</p>}
              <button type="submit" disabled={pwLoading}
                className="w-full py-2.5 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 transition-all disabled:opacity-60">
                {pwLoading ? '변경 중...' : '비밀번호 변경'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
