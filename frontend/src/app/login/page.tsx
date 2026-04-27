'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { API_BASE_URL } from '@/lib/api'

export default function LoginPage() {
  const router = useRouter()
  const [form, setForm] = useState({ username: '', password: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)

  // 비밀번호 찾기
  const [showFindPw, setShowFindPw] = useState(false)
  const [findPwForm, setFindPwForm] = useState({ username: '', email: '', new_password: '', confirm_password: '' })
  const [findPwError, setFindPwError] = useState('')
  const [findPwSuccess, setFindPwSuccess] = useState('')
  const [findPwLoading, setFindPwLoading] = useState(false)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
    setErrors(prev => ({ ...prev, [name]: '' }))
  }

  const validate = () => {
    const newErrors: Record<string, string> = {}
    if (!form.username.trim()) newErrors.username = '아이디를 입력해주세요.'
    if (!form.password) newErrors.password = '비밀번호를 입력해주세요.'
    return newErrors
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const newErrors = validate()
    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return }
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: form.username, password: form.password }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || '로그인에 실패했습니다.')
      }
      const data = await res.json()
      localStorage.setItem('user', JSON.stringify(data))
      router.push('/dashboard')
    } catch (e: unknown) {
      setErrors({ submit: e instanceof Error ? e.message : '로그인에 실패했습니다.' })
    } finally {
      setLoading(false)
    }
  }

  const handleFindPw = async (e: React.FormEvent) => {
    e.preventDefault()
    setFindPwError('')
    setFindPwSuccess('')
    if (!findPwForm.username.trim()) { setFindPwError('아이디를 입력해주세요.'); return }
    if (!findPwForm.email.trim()) { setFindPwError('이메일을 입력해주세요.'); return }
    if (!findPwForm.new_password) { setFindPwError('새 비밀번호를 입력해주세요.'); return }
    if (findPwForm.new_password !== findPwForm.confirm_password) { setFindPwError('비밀번호가 일치하지 않습니다.'); return }
    setFindPwLoading(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/find-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: findPwForm.username, email: findPwForm.email, new_password: findPwForm.new_password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || '변경 실패')
      setFindPwSuccess('비밀번호가 변경되었습니다. 새 비밀번호로 로그인하세요.')
      setFindPwForm({ username: '', email: '', new_password: '', confirm_password: '' })
    } catch (e: unknown) {
      setFindPwError(e instanceof Error ? e.message : '오류가 발생했습니다.')
    } finally {
      setFindPwLoading(false)
    }
  }

  const inputClass = (err?: string) =>
    `px-4 py-2.5 rounded-xl border text-sm bg-background-light dark:bg-background-dark text-text-primary-light dark:text-text-primary-dark placeholder:text-text-secondary-light dark:placeholder:text-text-secondary-dark outline-none transition-colors focus:border-primary ${err ? 'border-red-400' : 'border-border-light dark:border-border-dark'}`

  return (
    <div className="flex min-h-screen items-center justify-center bg-background-light dark:bg-background-dark px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="bg-gradient-to-br from-primary to-primary/70 rounded-2xl size-14 flex items-center justify-center shadow-lg shadow-primary/20 mb-4">
            <span className="material-symbols-outlined text-white !text-3xl">document_scanner</span>
          </div>
          <h1 className="text-text-primary-light dark:text-text-primary-dark text-2xl font-bold">AI Doc Intelligence</h1>
          <p className="text-text-secondary-light dark:text-text-secondary-dark text-sm mt-1">계정에 로그인하세요</p>
        </div>

        {/* Form Card */}
        <div className="bg-surface-light dark:bg-surface-dark rounded-2xl border border-border-light dark:border-border-dark p-8 shadow-sm">
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">아이디</label>
              <input type="text" name="username" value={form.username} onChange={handleChange} placeholder="아이디 입력" autoFocus className={inputClass(errors.username)} />
              {errors.username && <p className="text-xs text-red-500">{errors.username}</p>}
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">비밀번호</label>
                <button type="button" onClick={() => { setShowFindPw(true); setFindPwError(''); setFindPwSuccess('') }}
                  className="text-xs text-primary hover:underline">
                  비밀번호 찾기
                </button>
              </div>
              <input type="password" name="password" value={form.password} onChange={handleChange} placeholder="비밀번호 입력" className={inputClass(errors.password)} />
              {errors.password && <p className="text-xs text-red-500">{errors.password}</p>}
            </div>

            {errors.submit && <p className="text-sm text-red-500 text-center">{errors.submit}</p>}

            <button type="submit" disabled={loading}
              className="mt-1 w-full py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed">
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="material-symbols-outlined text-lg animate-spin">progress_activity</span>
                  로그인 중...
                </span>
              ) : '로그인'}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-text-secondary-light dark:text-text-secondary-dark mt-6">
          계정이 없으신가요?{' '}
          <Link href="/join" className="text-primary font-semibold hover:underline">회원가입</Link>
        </p>
      </div>

      {/* 비밀번호 찾기 모달 */}
      {showFindPw && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-surface-light dark:bg-surface-dark rounded-2xl border border-border-light dark:border-border-dark shadow-2xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-light dark:border-border-dark">
              <h2 className="text-lg font-bold text-text-primary-light dark:text-text-primary-dark">비밀번호 찾기</h2>
              <button onClick={() => setShowFindPw(false)} className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5">
                <span className="material-symbols-outlined text-text-secondary-light dark:text-text-secondary-dark">close</span>
              </button>
            </div>
            <form onSubmit={handleFindPw} className="p-6 flex flex-col gap-4">
              <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
                가입 시 등록한 아이디와 이메일을 입력하면 새 비밀번호로 변경할 수 있습니다.
              </p>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">아이디</label>
                <input type="text" value={findPwForm.username} onChange={e => setFindPwForm(p => ({ ...p, username: e.target.value }))}
                  placeholder="아이디" className={inputClass()} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">이메일</label>
                <input type="email" value={findPwForm.email} onChange={e => setFindPwForm(p => ({ ...p, email: e.target.value }))}
                  placeholder="가입 시 등록한 이메일" className={inputClass()} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">새 비밀번호</label>
                <input type="password" value={findPwForm.new_password} onChange={e => setFindPwForm(p => ({ ...p, new_password: e.target.value }))}
                  placeholder="새 비밀번호" className={inputClass()} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">새 비밀번호 확인</label>
                <input type="password" value={findPwForm.confirm_password} onChange={e => setFindPwForm(p => ({ ...p, confirm_password: e.target.value }))}
                  placeholder="새 비밀번호 확인" className={inputClass()} />
              </div>
              {findPwError && <p className="text-sm text-red-500 bg-red-50 dark:bg-red-500/10 px-3 py-2 rounded-lg">{findPwError}</p>}
              {findPwSuccess && <p className="text-sm text-green-600 bg-green-50 dark:bg-green-500/10 px-3 py-2 rounded-lg">{findPwSuccess}</p>}
              <div className="flex gap-3 mt-1">
                <button type="button" onClick={() => setShowFindPw(false)}
                  className="flex-1 px-4 py-2 rounded-xl border border-border-light dark:border-border-dark text-text-primary-light dark:text-text-primary-dark hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                  취소
                </button>
                <button type="submit" disabled={findPwLoading}
                  className="flex-1 px-4 py-2 rounded-xl bg-primary text-white hover:bg-primary/90 transition-colors font-medium disabled:opacity-60">
                  {findPwLoading ? '처리 중...' : '비밀번호 변경'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
