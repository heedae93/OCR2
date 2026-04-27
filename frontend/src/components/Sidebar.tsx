'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

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
    ],
  },
  { href: '/ocr-work', icon: 'document_scanner', label: 'OCR 작업하기' },
  { href: '/jobs', icon: 'history', label: '작업내역' },
  { href: '/history', icon: 'manage_history', label: '이력관리' },
  { href: '/statistics', icon: 'bar_chart', label: '통계' },
  { href: '/metadata', icon: 'settings_suggest', label: '추출 엔진 설정' },
]

const adminNavItems: NavItem[] = [
  {
    href: '/admin',
    icon: 'manage_accounts',
    label: '사용자 관리',
    children: [
      { href: '/admin/users', icon: 'person', label: '사용자관리' },
      { href: '/admin/groups', icon: 'groups', label: '그룹관리' },
    ],
  },
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
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const stored = localStorage.getItem('user')
    if (stored) {
      const parsed = JSON.parse(stored)
      setUser(parsed)
      fetchTodayCount(parsed.user_id || '')
    }
  }, [])

  useEffect(() => {
    const expandableItems = user?.type === 'A'
      ? [...baseNavItems, ...adminNavItems]
      : baseNavItems

    expandableItems.forEach(item => {
      if (item.children?.some(child => pathname.startsWith(child.href))) {
        setExpandedMenus(prev => (prev.includes(item.label) ? prev : [...prev, item.label]))
      }
    })
  }, [pathname, user?.type])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

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

  const navItems = user?.type === 'A' ? [...baseNavItems, ...adminNavItems] : baseNavItems
  const bottomItems = user?.type === 'A' ? bottomNavItems : bottomNavItems.filter(item => item.href !== '/settings')

  const isActive = (path: string) => pathname === path || (path !== '/' && pathname.startsWith(path))

  const toggleMenu = (label: string) => {
    setExpandedMenus(prev => (prev.includes(label) ? prev.filter(item => item !== label) : [...prev, label]))
  }

  return (
    <aside className="fixed left-0 top-0 z-[300] flex h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-border-light bg-surface-light pointer-events-auto dark:border-border-dark dark:bg-surface-dark">
      <div className="flex min-h-full flex-col gap-4 p-4">
        <Link href="/" className="group flex items-center gap-3 rounded-xl px-2 py-3 transition-all duration-200 hover:bg-black/5 dark:hover:bg-white/5">
          <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-primary/10 to-primary/5">
            <Image
              src="/futurenuri.png"
              alt="FutureNuri"
              fill
              className="object-contain object-[center_72%] scale-[4.2]"
            />
          </div>
          <div className="min-w-0 flex flex-col">
            <h1 className="whitespace-nowrap text-base font-bold leading-tight tracking-tight text-text-primary-light dark:text-text-primary-dark">
              AI Doc Intelligence
            </h1>
          </div>
        </Link>

        <div className="mx-2 h-px bg-gradient-to-r from-transparent via-border-light to-transparent dark:via-border-dark" />

        <nav className="mt-2 flex flex-grow flex-col gap-1">
          {navItems.map(item => {
            const hasChildren = Boolean(item.children?.length)
            const active = isActive(item.href)
            const isExpanded = expandedMenus.includes(item.label)

            return (
              <div key={item.label} className="flex flex-col gap-0.5">
                {hasChildren ? (
                  <button
                    onClick={() => toggleMenu(item.label)}
                    className={`relative flex shrink-0 items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 transition-all duration-200 group ${
                      active
                        ? 'bg-primary/10 text-primary dark:bg-primary/15'
                        : 'text-text-secondary-light hover:bg-black/5 hover:text-text-primary-light dark:text-text-secondary-dark dark:hover:bg-white/5 dark:hover:text-text-primary-dark'
                    }`}
                  >
                    <span
                      className={`material-symbols-outlined text-xl transition-all duration-200 ${
                        active ? 'fill text-primary' : 'group-hover:scale-110'
                      }`}
                    >
                      {item.icon}
                    </span>
                    <span className={`flex-1 text-left text-sm transition-all duration-200 ${active ? 'font-semibold' : 'font-medium'}`}>
                      {item.label}
                    </span>
                    <span className={`material-symbols-outlined text-lg transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>
                      expand_more
                    </span>
                  </button>
                ) : (
                  <Link
                    href={item.href}
                    className={`group relative flex shrink-0 items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 transition-all duration-200 ${
                      active
                        ? 'bg-primary/10 text-primary dark:bg-primary/15'
                        : 'text-text-secondary-light hover:bg-black/5 hover:text-text-primary-light dark:text-text-secondary-dark dark:hover:bg-white/5 dark:hover:text-text-primary-dark'
                    }`}
                  >
                    {active && <div className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-primary" />}
                    <span
                      className={`material-symbols-outlined text-xl transition-all duration-200 ${
                        active ? 'fill text-primary' : 'group-hover:scale-110'
                      }`}
                    >
                      {item.icon}
                    </span>
                    <span className={`text-sm transition-all duration-200 ${active ? 'font-semibold' : 'font-medium'}`}>
                      {item.label}
                    </span>
                    {item.badge && (
                      <span className="ml-auto rounded-full bg-primary/20 px-2 py-0.5 text-xs font-semibold text-primary">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                )}

                {hasChildren && isExpanded && (
                  <div className="animate-in slide-in-from-top-1 ml-3 flex flex-col gap-0.5 border-l border-border-light pl-3 duration-200 fade-in dark:border-border-dark">
                    {item.children!.map(child => {
                      const childActive = isActive(child.href)
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 transition-all duration-200 ${
                            childActive
                              ? 'text-primary'
                              : 'text-text-secondary-light hover:text-text-primary-light dark:text-text-secondary-dark dark:hover:text-text-primary-dark'
                          }`}
                        >
                          <span
                            className={`material-symbols-outlined text-lg transition-all duration-200 ${
                              childActive ? 'text-primary' : 'group-hover:scale-110'
                            }`}
                          >
                            {child.icon}
                          </span>
                          <span className={`overflow-hidden text-ellipsis whitespace-nowrap text-[13px] transition-all duration-200 ${childActive ? 'font-semibold' : 'font-medium'}`}>
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

        <div className="mx-2 h-px bg-gradient-to-r from-transparent via-border-light to-transparent dark:via-border-dark" />

        <nav className="flex flex-col gap-1">
          {bottomItems.map(item => {
            const active = isActive(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group relative flex shrink-0 items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 transition-all duration-200 ${
                  active
                    ? 'bg-primary/10 text-primary dark:bg-primary/15'
                    : 'text-text-secondary-light hover:bg-black/5 hover:text-text-primary-light dark:text-text-secondary-dark dark:hover:bg-white/5 dark:hover:text-text-primary-dark'
                }`}
              >
                {active && <div className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-primary" />}
                <span className={`material-symbols-outlined text-xl transition-all duration-200 ${active ? 'text-primary' : 'group-hover:scale-110'}`}>
                  {item.icon}
                </span>
                <span className={`text-sm transition-all duration-200 ${active ? 'font-semibold' : 'font-medium'}`}>
                  {item.label}
                </span>
              </Link>
            )
          })}
        </nav>

        <div className="mx-1 rounded-xl border border-primary/10 bg-gradient-to-br from-primary/5 to-primary/10 p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="material-symbols-outlined !text-lg text-primary">insights</span>
            <span className="text-xs font-semibold text-primary">오늘의 처리량</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold text-text-primary-light dark:text-text-primary-dark">{todayCount}</span>
            <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">파일</span>
          </div>
        </div>

        <div ref={menuRef} className="flex flex-col gap-1 border-t border-border-light pt-4 dark:border-border-dark">
          <div
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 transition-all duration-200 hover:bg-black/5 dark:hover:bg-white/5"
          >
            <div className="relative">
              <div className="flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-sm font-semibold text-white shadow-md">
                {(user?.name || user?.username || 'U')[0].toUpperCase()}
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface-light bg-green-500 dark:border-surface-dark" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <p className="truncate text-sm font-semibold leading-tight text-text-primary-light dark:text-text-primary-dark">
                {user?.name || '사용자'}
              </p>
              <p className="truncate text-xs text-text-secondary-light dark:text-text-secondary-dark">
                {user?.username || ''}
              </p>
            </div>
            <span className={`material-symbols-outlined text-lg text-text-secondary-light transition-transform duration-200 dark:text-text-secondary-dark ${userMenuOpen ? 'rotate-180' : ''}`}>
              expand_more
            </span>
          </div>

          {userMenuOpen && (
            <div className="mt-1 overflow-hidden rounded-xl border border-border-light bg-surface-light shadow-lg dark:border-border-dark dark:bg-surface-dark">
              <button
                onClick={() => {
                  setUserMenuOpen(false)
                  router.push('/mypage')
                }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-text-primary-light transition-colors duration-150 hover:bg-black/5 dark:text-text-primary-dark dark:hover:bg-white/5"
              >
                <span className="material-symbols-outlined text-lg">manage_accounts</span>
                마이페이지
              </button>
              <button
                onClick={() => router.push('/logout')}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-red-500 transition-colors duration-150 hover:bg-red-50 dark:hover:bg-red-500/10"
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
