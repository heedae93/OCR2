'use client'

import { useTheme } from '@/contexts/ThemeContext'

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'

  return (
    <button
      onClick={toggleTheme}
      aria-label="Toggle theme"
      className="flex items-center justify-center w-9 h-9 rounded-xl bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
    >
      <span className="material-symbols-outlined text-lg text-text-secondary-light dark:text-text-secondary-dark">
        {isDark ? 'dark_mode' : 'light_mode'}
      </span>
    </button>
  )
}
