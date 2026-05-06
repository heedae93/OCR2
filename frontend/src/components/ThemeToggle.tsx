'use client'

import { useTheme } from '@/contexts/ThemeContext'

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'

  return (
    <button
      onClick={toggleTheme}
      aria-label="Toggle theme"
      className="group relative flex w-full shrink-0 items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 transition-all duration-200 text-text-secondary-light hover:bg-black/5 hover:text-text-primary-light dark:text-text-secondary-dark dark:hover:bg-white/5 dark:hover:text-text-primary-dark"
    >
      <span className="material-symbols-outlined text-xl transition-all duration-200 group-hover:scale-110">
        {isDark ? 'dark_mode' : 'light_mode'}
      </span>
      <span className="text-sm font-medium">
        {isDark ? '다크 모드' : '라이트 모드'}
      </span>
      <div className="ml-auto flex h-5 w-9 items-center rounded-full bg-black/10 px-0.5 transition-colors dark:bg-white/10">
        <div className={`h-4 w-4 rounded-full bg-current transition-transform duration-200 ${isDark ? 'translate-x-4' : 'translate-x-0'}`} />
      </div>
    </button>
  )
}
