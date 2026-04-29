'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from '@/contexts/ThemeContext'

export default function Header() {
  const router = useRouter()
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'
  const [user, setUser] = useState<{ name: string; username: string; type?: string } | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem('user')
    if (stored) setUser(JSON.parse(stored))
  }, [])

  return (
    <header className="fixed top-0 left-64 right-0 z-[299] h-14 flex items-center justify-end px-6 bg-surface-light/80 dark:bg-surface-dark/80 backdrop-blur-md border-b border-border-light dark:border-border-dark">
          {/* 오른쪽: 다크모드 + 유저 */}
      <div className="flex items-center gap-3">
        {/* 다크모드 토글 */}
        <button
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="flex items-center justify-center w-9 h-9 rounded-xl bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
        >
          <span className="material-symbols-outlined text-lg text-text-secondary-light dark:text-text-secondary-dark">
            {isDark ? 'dark_mode' : 'light_mode'}
          </span>
        </button>

        {/* 유저 */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen(v => !v)}
            className="flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center text-white text-xs font-bold shadow-sm">
              {(user?.name || user?.username || 'U')[0].toUpperCase()}
            </div>
            <span className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark hidden sm:block">
              {user?.name || user?.username || '사용자'}
            </span>
            <span className={`material-symbols-outlined text-sm text-text-secondary-light dark:text-text-secondary-dark transition-transform duration-200 ${menuOpen ? 'rotate-180' : ''}`}>
              expand_more
            </span>
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1.5 w-40 z-20 rounded-xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark shadow-lg overflow-hidden">
                <button
                  onClick={() => { setMenuOpen(false); router.push('/mypage') }}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-text-primary-light dark:text-text-primary-dark hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                >
                  <span className="material-symbols-outlined text-base">manage_accounts</span>
                  마이페이지
                </button>
                <button
                  onClick={() => router.push('/logout')}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                >
                  <span className="material-symbols-outlined text-base">logout</span>
                  로그아웃
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
