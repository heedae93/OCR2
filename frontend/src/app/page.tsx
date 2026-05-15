'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

export default function RootPage() {
  const router = useRouter()

  useEffect(() => {
    try {
      const user = localStorage.getItem('user')
      if (user) {
        router.replace('/dashboard')
      } else {
        router.replace('/login')
      }
    } catch {
      router.replace('/login')
    }
  }, [router])

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-10 w-10 shrink-0 animate-spin text-blue-600 dark:text-blue-400" aria-hidden />
      <p className="text-sm">페이지로 이동 중…</p>
    </div>
  )
}
