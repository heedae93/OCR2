'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useRef, useEffect } from 'react'

interface NavItem {
  href: string
  icon: string
  label: string
  badge?: string | number
  children?: NavItem[]
}

const baseNavItems: NavItem[] = [
  { href: '/', icon: 'dashboard', label: '대시보드' },
  { 
    href: '/metadata-management', 
    icon: 'schema', 
    label: '메타데이터 관리',
    children: [
      { href: '/metadata-v3', icon: 'settings_input_component', label: '문서 유형별 추출 설정' },
      { href: '/metadata/extraction-list', icon: 'list_alt', label: '메타데이터 추출 리스트' },
    ]
  },
  { href: '/ocr-work', icon: 'document_scanner', label: 'OCR 작업하기' },
  { href: '/jobs', icon: 'history', label: '작업내역' },
  { href: '/history', icon: 'manage_history', label: '이력관리' },
  { href: '/statistics', icon: 'bar_chart', label: '통계' },
  { href: '/metadata', icon: 'settings_suggest', label: '추출 엔진 설정' },
]

const adminNavItems: NavItem[] = [
  { href: '/admin/users', icon: 'manage_accounts', label: '사용자관리' },
]

const bottomNavItems: NavItem[] = [
  { href: '/help', icon: 'help', label: '도움말' },
  { href: '/settings', icon: 'settings', label: '설정' },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [expandedMenus, setExpandedMenus] = useState<string[]>([])
  const [user, setUser] = useState<{ name: string; username: string; type?: string; user_id?: string } | null>(null)
  const [todayCount, setTodayCount] = useState(0)

  useEffect(() => {
    const stored = localStorage.getItem('user')
    if (stored) {
      const parsed = JSON.parse(stored)
      setUser(parsed)
      fetchTodayCount(parsed.user_id || '')
    }
  }, [])

  // Check if current path belongs to a sub-menu and auto-expand
  useEffect(() => {
    baseNavItems.forEach(item => {
      if (item.children?.some(child => pathname.startsWith(child.href))) {
        if (!expandedMenus.includes(item.label)) {
          setExpandedMenus(prev => [...prev, item.label])
        }
      }
    })
  }, [pathname])

  const fetchTodayCount = async (userId: string) => {
    try {
      const { API_BASE_URL } = await import('@/lib/api')
      const res = await fetch(`${API_BASE_URL}/api/jobs/statistics/summary?user_id=${userId}`)
      if (res.ok) {
        const data = await res.json()
        setTodayCount(data.today_completed ?? data.total_jobs ?? 0)
      }
    } catch {}
  }

  const navItems = user?.type === 'A'
    ? [...baseNavItems, ...adminNavItems]
    : baseNavItems
  const bottomItems = user?.type === 'A'
    ? bottomNavItems
    : bottomNavItems.filter(i => i.href !== '/settings')
  const menuRef = useRef<HTMLDivElement>(null)

  const isActive = (path: string) => pathname === path || (path !== '/' && pathname.startsWith(path))

  const toggleMenu = (label: string) => {
    setExpandedMenus(prev => 
      prev.includes(label) ? prev.filter(l => l !== label) : [...prev, label]
    )
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark fixed top-0 left-0 z-[300] pointer-events-auto overflow-y-auto">
      <div className="flex flex-col gap-4 p-4 min-h-full">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 px-2 py-3 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-all duration-200 group">
          <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-primary/10 to-primary/5">
            <Image
              src="/futurenuri.png"
              alt="FutureNuri"
              fill
              className="object-contain object-[center_72%] scale-[4.2]"
            />
          </div>
          <div className="min-w-0 flex flex-col">
            <h1 className="whitespace-nowrap text-text-primary-light dark:text-text-primary-dark text-base font-bold leading-tight tracking-tight">
              AI Doc Intelligence
            </h1>
          </div>
        </Link>

        {/* Divider */}
        <div className="h-px bg-gradient-to-r from-transparent via-border-light dark:via-border-dark to-transparent mx-2" />

        {/* Navigation */}
        <nav className="flex flex-col gap-1 mt-2 flex-grow">
          {navItems.map((item) => {
            const hasChildren = item.children && item.children.length > 0
            const active = isActive(item.href)
            const isExpanded = expandedMenus.includes(item.label)

            return (
              <div key={item.label} className="flex flex-col gap-0.5">
                {hasChildren ? (
                  <button
                    onClick={() => toggleMenu(item.label)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group relative overflow-hidden shrink-0 ${
                      active
                        ? 'bg-primary/10 dark:bg-primary/15 text-primary'
                        : 'hover:bg-black/5 dark:hover:bg-white/5 text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark'
                    }`}
                  >
                    <span className={`material-symbols-outlined text-xl transition-all duration-200 ${
                      active ? 'text-primary' : 'group-hover:scale-110'
                    } ${active ? 'fill' : ''}`}>
                      {item.icon}
                    </span>
                    <span className={`text-sm transition-all duration-200 flex-1 text-left ${
                      active ? 'font-semibold' : 'font-medium'
                    }`}>
                      {item.label}
                    </span>
                    <span className={`material-symbols-outlined text-lg transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>
                      expand_more
                    </span>
                  </button>
                ) : (
                  <Link
                    href={item.href}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group relative overflow-hidden shrink-0 ${
                      active
                        ? 'bg-primary/10 dark:bg-primary/15 text-primary'
                        : 'hover:bg-black/5 dark:hover:bg-white/5 text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark'
                    }`}
                  >
                    {active && !hasChildren && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />
                    )}
                    <span className={`material-symbols-outlined text-xl transition-all duration-200 ${
                      active ? 'text-primary' : 'group-hover:scale-110'
                    } ${active ? 'fill' : ''}`}>
                      {item.icon}
                    </span>
                    <span className={`text-sm transition-all duration-200 ${
                      active ? 'font-semibold' : 'font-medium'
                    }`}>
                      {item.label}
                    </span>
                    {item.badge && (
                      <span className="ml-auto px-2 py-0.5 text-xs font-semibold bg-primary/20 text-primary rounded-full">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                )}

                {/* Sub-menu items */}
                {hasChildren && isExpanded && (
                  <div className="flex flex-col gap-0.5 ml-3 pl-3 border-l border-border-light dark:border-border-dark animate-in fade-in slide-in-from-top-1 duration-200">
                    {item.children!.map((child) => {
                      const childActive = isActive(child.href)
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 group relative ${
                            childActive
                              ? 'text-primary'
                              : 'text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark'
                          }`}
                        >
                          <span className={`material-symbols-outlined text-lg transition-all duration-200 ${
                            childActive ? 'text-primary' : 'group-hover:scale-110'
                          }`}>
                            {child.icon}
                          </span>
                          <span className={`text-[13px] transition-all duration-200 whitespace-nowrap overflow-hidden text-ellipsis ${
                            childActive ? 'font-semibold' : 'font-medium'
                          }`}>
                            {child.label}
                          </span>
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </nav>

        {/* Bottom Navigation (도움말, 설정) */}
        <div className="h-px bg-gradient-to-r from-transparent via-border-light dark:via-border-dark to-transparent mx-2" />
        <nav className="flex flex-col gap-1">
          {bottomItems.map((item) => {
            const active = isActive(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group relative overflow-hidden shrink-0 ${
                  active
                    ? 'bg-primary/10 dark:bg-primary/15 text-primary'
                    : 'hover:bg-black/5 dark:hover:bg-white/5 text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark'
                }`}
              >
                {active && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />
                )}
                <span className={`material-symbols-outlined text-xl transition-all duration-200 ${
                  active ? 'text-primary' : 'group-hover:scale-110'
                }`}>
                  {item.icon}
                </span>
                <span className={`text-sm transition-all duration-200 ${
                  active ? 'font-semibold' : 'font-medium'
                }`}>
                  {item.label}
                </span>
              </Link>
            )
          })}
        </nav>

        {/* Quick Stats Card */}
        <div className="mx-1 p-3 rounded-xl bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/10">
          <div className="flex items-center gap-2 mb-2">
            <span className="material-symbols-outlined text-primary !text-lg">insights</span>
            <span className="text-xs font-semibold text-primary">오늘의 처리량</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold text-text-primary-light dark:text-text-primary-dark">{todayCount}</span>
            <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">파일</span>
          </div>
        </div>

        {/* User Info */}
        <div ref={menuRef} className="flex flex-col gap-1 border-t border-border-light dark:border-border-dark pt-4">
          <div
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-all duration-200 cursor-pointer"
          >
            <div className="relative">
              <div className="bg-gradient-to-br from-primary to-primary/70 rounded-full size-9 flex items-center justify-center text-white font-semibold text-sm shadow-md">
                {(user?.name || user?.username || 'U')[0].toUpperCase()}
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-surface-light dark:border-surface-dark" />
            </div>
            <div className="flex flex-col flex-1 min-w-0">
              <p className="text-text-primary-light dark:text-text-primary-dark text-sm font-semibold leading-tight truncate">
                {user?.name || '사용자'}
              </p>
              <p className="text-text-secondary-light dark:text-text-secondary-dark text-xs truncate">
                {user?.username || ''}
              </p>
            </div>
            <span className={`material-symbols-outlined text-text-secondary-light dark:text-text-secondary-dark text-lg transition-transform duration-200 ${userMenuOpen ? 'rotate-180' : ''}`}>
              expand_more
            </span>
          </div>
          {/* 드롭다운 메뉴 */}
          {userMenuOpen && (
            <div className="mt-1 rounded-xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark shadow-lg overflow-hidden">
              <button
                onClick={() => { setUserMenuOpen(false); router.push('/mypage') }}
                className="flex items-center gap-2 w-full px-3 py-2.5 text-sm text-text-primary-light dark:text-text-primary-dark hover:bg-black/5 dark:hover:bg-white/5 transition-colors duration-150"
              >
                <span className="material-symbols-outlined text-lg">manage_accounts</span>
                마이페이지
              </button>
              <button
                onClick={() => router.push('/logout')}
                className="flex items-center gap-2 w-full px-3 py-2.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors duration-150"
              >
                <span className="material-symbols-outlined text-lg">logout</span>
                로그아웃
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
