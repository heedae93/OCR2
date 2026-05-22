"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { useOcrActivity } from "@/contexts/OcrActivityContext";

interface NavItem {
  href: string;
  icon: string;
  label: string;
  badge?: string | number;
  children?: NavItem[];
}

const baseNavItems: NavItem[] = [
  { href: "/dashboard", icon: "dashboard", label: "대시보드" },
  {
    href: "/metadata-management",
    icon: "schema",
    label: "메타데이터 관리",
    children: [
      {
        href: "/metadata-v3",
        icon: "settings_input_component",
        label: "문서 유형별 추출 설정",
      },
      {
        href: "/metadata/extraction-list",
        icon: "list_alt",
        label: "메타데이터 추출 리스트",
      },
    ],
  },
  { href: '/ocr-work', icon: 'document_scanner', label: '문서 작업하기' },
  { href: '/jobs', icon: 'history', label: '작업내역' },
  { href: '/history', icon: 'manage_history', label: '이력관리' },
  { href: '/statistics', icon: 'bar_chart', label: '통계' },
];

const helpNavItem: NavItem = { href: "/help", icon: "help", label: "도움말" };

const adminNavItems: NavItem[] = [
  {
    href: "/admin",
    icon: "manage_accounts",
    label: "사용자 관리",
    children: [
      { href: "/admin/users", icon: "person", label: "사용자관리" },
      { href: "/admin/groups", icon: "groups", label: "그룹관리" },
    ],
  },
];

const bottomNavItems: NavItem[] = [
  { href: "/settings", icon: "settings", label: "설정" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [expandedMenus, setExpandedMenus] = useState<string[]>([]);
  const { trackedJobs } = useOcrActivity();
  const [user, setUser] = useState<{
    name: string;
    username: string;
    type?: string;
    user_id?: string;
  } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const isProcessing = useMemo(
    () =>
      trackedJobs.some(
        (job) => job.status === "processing" || job.status === "queued",
      ),
    [trackedJobs],
  );

  useEffect(() => {
    const stored = localStorage.getItem("user");
    if (stored) {
      const parsed = JSON.parse(stored);
      setUser(parsed);
    }
  }, []);

  useEffect(() => {
    const expandableItems =
      user?.type === "A" ? [...baseNavItems, ...adminNavItems] : baseNavItems;

    expandableItems.forEach((item) => {
      if (item.children?.some((child) => pathname.startsWith(child.href))) {
        setExpandedMenus((prev) =>
          prev.includes(item.label) ? prev : [...prev, item.label],
        );
      }
    });
  }, [pathname, user?.type]);

  const navItems =
    user?.type === "A"
      ? [...baseNavItems, ...adminNavItems, ...bottomNavItems, helpNavItem]
      : [...baseNavItems, helpNavItem];

  const isActive = (path: string) =>
    pathname === path || (path !== "/" && path !== "/dashboard" && pathname.startsWith(path));

  const toggleMenu = (label: string) => {
    setExpandedMenus((prev) =>
      prev.includes(label)
        ? prev.filter((item) => item !== label)
        : [...prev, label],
    );
  };

  return (
    <aside className="fixed inset-y-0 left-0 z-[300] flex h-dvh w-64 shrink-0 flex-col overflow-hidden border-r border-[#334155] bg-[#1E293B] pointer-events-auto">
      {/* 로고 */}
      <div className="shrink-0 px-4 pt-3">
        <Link
          href="/"
          className="group flex items-center transition-all duration-200 hover:opacity-80"
          style={{ height: '64px' }}
        >
          <Image
            src="/aidoc.png"
            alt="AiDoc"
            width={462}
            height={240}
            className="w-full object-contain"
          />
        </Link>
        <div className="-mx-2 mt-2 h-px bg-gradient-to-r from-transparent via-[#475569] to-transparent" />
      </div>

      {/* 스크롤 가능한 nav 영역 */}
      <div
        className="flex-1 overflow-y-auto overscroll-contain px-4 py-2"
        style={{ scrollbarGutter: 'stable' }}
      >
        <nav className="flex flex-col gap-1 mt-2">
          {navItems.map((item) => {
            const hasChildren = Boolean(item.children?.length);
            const active = isActive(item.href);
            const isExpanded = expandedMenus.includes(item.label);

            return (
              <div key={item.label} className="flex flex-col gap-0.5">
                {hasChildren ? (
                  <button
                    onClick={() => toggleMenu(item.label)}
                    className={`relative flex shrink-0 items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 transition-all duration-200 group ${
                      active
                        ? "bg-primary/15 text-primary"
                        : "text-[#94A3B8] hover:bg-white/5 hover:text-[#F1F5F9]"
                    }`}
                  >
                    <span
                      className={`material-symbols-outlined text-xl transition-all duration-200 ${
                        active ? "fill text-primary" : "group-hover:scale-110"
                      }`}
                    >
                      {item.icon}
                    </span>
                    <span
                      className={`flex-1 text-left text-sm transition-all duration-200 ${active ? "font-semibold" : "font-medium"}`}
                    >
                      {item.label}
                    </span>
                    <span
                      className={`material-symbols-outlined text-lg transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                    >
                      expand_more
                    </span>
                  </button>
                ) : (
                  <Link
                    href={item.href}
                    className={`group relative flex shrink-0 items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 transition-all duration-200 ${
                      active
                        ? "bg-primary/15 text-primary"
                        : "text-[#94A3B8] hover:bg-white/5 hover:text-[#F1F5F9]"
                    }`}
                  >
                    <span
                      className={`material-symbols-outlined text-xl transition-all duration-200 ${
                        active ? "fill text-primary" : "group-hover:scale-110"
                      }`}
                    >
                      {item.icon}
                    </span>
                    <span
                      className={`text-sm transition-all duration-200 ${active ? "font-semibold" : "font-medium"}`}
                    >
                      {item.label}
                    </span>
                    {item.href === "/ocr-work" && isProcessing && (
                      <Loader2 className="ml-auto w-4 h-4 text-primary animate-spin" />
                    )}
                    {item.badge && (
                      <span className="ml-auto rounded-full bg-primary/20 px-2 py-0.5 text-xs font-semibold text-primary">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                )}

                {hasChildren && isExpanded && (
                  <div className="animate-in slide-in-from-top-1 ml-3 flex flex-col gap-0.5 border-l border-[#475569] pl-3 duration-200 fade-in">
                    {item.children!.map((child) => {
                      const childActive = isActive(child.href);
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 transition-all duration-200 ${
                            childActive
                              ? "text-primary"
                              : "text-[#94A3B8] hover:text-[#F1F5F9]"
                          }`}
                        >
                          <span
                            className={`material-symbols-outlined text-lg transition-all duration-200 ${
                              childActive
                                ? "text-primary"
                                : "group-hover:scale-110"
                            }`}
                          >
                            {child.icon}
                          </span>
                          <span
                            className={`overflow-hidden text-ellipsis whitespace-nowrap text-[13px] transition-all duration-200 ${childActive ? "font-semibold" : "font-medium"}`}
                          >
                            {child.label}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </div>

      {/* 하단 고정 계정 정보 */}
      <div className="shrink-0 px-4 pb-3">
        <div className="-mx-2 mb-3 h-px bg-gradient-to-r from-transparent via-[#475569] to-transparent" />
        <div className="relative rounded-xl border border-[#334155] bg-[#0F172A] p-3">
          {/* 드롭업 메뉴 */}
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute bottom-full left-0 right-0 z-20 mb-2 overflow-hidden rounded-xl border border-[#334155] bg-[#1E293B] shadow-lg">
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); router.push('/mypage'); }}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-[#F1F5F9] hover:bg-white/5 transition-colors"
                >
                  <span className="material-symbols-outlined text-base">manage_accounts</span>
                  마이페이지
                </button>
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); router.push('/logout'); }}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <span className="material-symbols-outlined text-base">logout</span>
                  로그아웃
                </button>
              </div>
            </>
          )}

          <button
            type="button"
            onClick={() => setMenuOpen(v => !v)}
            className="flex w-full items-center gap-2.5 hover:opacity-80 transition-opacity"
          >
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center text-white text-sm font-bold shadow-sm shrink-0">
              {(user?.name || user?.username || 'U')[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-sm font-semibold text-[#F1F5F9] truncate">{user?.name || user?.username || '사용자'}</p>
              <p className="text-[11px] text-[#64748B] truncate">{user?.username || ''}</p>
            </div>
            <span className={`material-symbols-outlined text-sm text-[#64748B] transition-transform duration-200 ${menuOpen ? 'rotate-180' : ''}`}>
              expand_more
            </span>
          </button>
        </div>
      </div>
    </aside>
  );
}
