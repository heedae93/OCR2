'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { API_BASE_URL } from '@/lib/api'

export default function JoinPage() {
  const router = useRouter()
  const [form, setForm] = useState({
    name: '',
    username: '',
    email: '',
    password: '',
    passwordConfirm: '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
    setErrors(prev => ({ ...prev, [name]: '' }))
  }

  const validate = () => {
    const newErrors: Record<string, string> = {}
    if (!form.name.trim()) newErrors.name = '이름을 입력해주세요.'
    if (!form.username.trim()) newErrors.username = '아이디를 입력해주세요.'
    else if (form.username.length < 4) newErrors.username = '아이디는 4자 이상이어야 합니다.'
    if (!form.email.trim()) newErrors.email = '이메일을 입력해주세요.'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) newErrors.email = '올바른 이메일 형식이 아닙니다.'
    if (!form.password) newErrors.password = '비밀번호를 입력해주세요.'
    else if (form.password.length < 8) newErrors.password = '비밀번호는 8자 이상이어야 합니다.'
    if (!form.passwordConfirm) newErrors.passwordConfirm = '비밀번호 확인을 입력해주세요.'
    else if (form.password !== form.passwordConfirm) newErrors.passwordConfirm = '비밀번호가 일치하지 않습니다.'
    return newErrors
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const newErrors = validate()
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          username: form.username,
          email: form.email,
          password: form.password,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || '회원가입에 실패했습니다.')
      }
      setSuccess(true)
      setTimeout(() => router.push('/login'), 2000)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '회원가입에 실패했습니다. 다시 시도해주세요.'
      setErrors({ submit: msg })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background-light dark:bg-background-dark px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">          
          <h1 className="text-text-primary-light dark:text-text-primary-dark text-2xl font-bold">AI Doc Intelligence</h1>          
        </div>

        {/* Form Card */}
        <div className="bg-surface-light dark:bg-surface-dark rounded-2xl border border-border-light dark:border-border-dark p-8 shadow-sm">
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">

            {/* 이름 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">
                이름
              </label>
              <input
                type="text"
                name="name"
                value={form.name}
                onChange={handleChange}
                placeholder="홍길동"
                className={`px-4 py-2.5 rounded-xl border text-sm bg-background-light dark:bg-background-dark text-text-primary-light dark:text-text-primary-dark placeholder:text-text-secondary-light dark:placeholder:text-text-secondary-dark outline-none transition-colors focus:border-primary ${
                  errors.name ? 'border-red-400' : 'border-border-light dark:border-border-dark'
                }`}
              />
              {errors.name && <p className="text-xs text-red-500">{errors.name}</p>}
            </div>

            {/* 아이디 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">
                아이디
              </label>
              <input
                type="text"
                name="username"
                value={form.username}
                onChange={handleChange}
                placeholder="영문/숫자 4자 이상"
                className={`px-4 py-2.5 rounded-xl border text-sm bg-background-light dark:bg-background-dark text-text-primary-light dark:text-text-primary-dark placeholder:text-text-secondary-light dark:placeholder:text-text-secondary-dark outline-none transition-colors focus:border-primary ${
                  errors.username ? 'border-red-400' : 'border-border-light dark:border-border-dark'
                }`}
              />
              {errors.username && <p className="text-xs text-red-500">{errors.username}</p>}
            </div>

            {/* 이메일 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">
                이메일
              </label>
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                placeholder="example@email.com"
                className={`px-4 py-2.5 rounded-xl border text-sm bg-background-light dark:bg-background-dark text-text-primary-light dark:text-text-primary-dark placeholder:text-text-secondary-light dark:placeholder:text-text-secondary-dark outline-none transition-colors focus:border-primary ${
                  errors.email ? 'border-red-400' : 'border-border-light dark:border-border-dark'
                }`}
              />
              {errors.email && <p className="text-xs text-red-500">{errors.email}</p>}
            </div>

            {/* 비밀번호 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">
                비밀번호
              </label>
              <input
                type="password"
                name="password"
                value={form.password}
                onChange={handleChange}
                placeholder="8자 이상"
                className={`px-4 py-2.5 rounded-xl border text-sm bg-background-light dark:bg-background-dark text-text-primary-light dark:text-text-primary-dark placeholder:text-text-secondary-light dark:placeholder:text-text-secondary-dark outline-none transition-colors focus:border-primary ${
                  errors.password ? 'border-red-400' : 'border-border-light dark:border-border-dark'
                }`}
              />
              {errors.password && <p className="text-xs text-red-500">{errors.password}</p>}
            </div>

            {/* 비밀번호 확인 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">
                비밀번호 확인
              </label>
              <input
                type="password"
                name="passwordConfirm"
                value={form.passwordConfirm}
                onChange={handleChange}
                placeholder="비밀번호 재입력"
                className={`px-4 py-2.5 rounded-xl border text-sm bg-background-light dark:bg-background-dark text-text-primary-light dark:text-text-primary-dark placeholder:text-text-secondary-light dark:placeholder:text-text-secondary-dark outline-none transition-colors focus:border-primary ${
                  errors.passwordConfirm ? 'border-red-400' : 'border-border-light dark:border-border-dark'
                }`}
              />
              {errors.passwordConfirm && <p className="text-xs text-red-500">{errors.passwordConfirm}</p>}
            </div>

            {/* 성공 메시지 */}
            {success && (
              <p className="text-sm text-green-600 text-center font-medium">가입되었습니다. 로그인 페이지로 이동합니다.</p>
            )}

            {/* 서버 에러 */}
            {errors.submit && (
              <p className="text-sm text-red-500 text-center">{errors.submit}</p>
            )}

            {/* 가입 버튼 */}
            <button
              type="submit"
              disabled={loading}
              className="mt-1 w-full py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="material-symbols-outlined text-lg animate-spin">progress_activity</span>
                  처리 중...
                </span>
              ) : '회원가입'}
            </button>
          </form>
        </div>

        {/* 로그인 링크 */}
        <p className="text-center text-sm text-text-secondary-light dark:text-text-secondary-dark mt-6">
          이미 계정이 있으신가요?{' '}
          <Link href="/" className="text-primary font-semibold hover:underline">
            로그인
          </Link>
        </p>
      </div>
    </div>
  )
}
