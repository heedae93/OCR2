"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { useOcrActivity } from "@/contexts/OcrActivityContext";
import Header from "@/components/Header";

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
 ]

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
  { href: "/help", icon: "help", label: "도움말" },
  { href: "/settings", icon: "settings", label: "설정" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [expandedMenus, setExpandedMenus] = useState<string[]>([]);
  const { trackedJobs } = useOcrActivity();
  const [user, setUser] = useState<{
    name: string;
    username: string;
    type?: string;
    user_id?: string;
  } | null>(null);
  const [todayCount, setTodayCount] = useState(0);

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
      fetchTodayCount(parsed.user_id || "");
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

const fetchTodayCount = async (userId: string) => {
    try {
      const { API_BASE_URL } = await import("@/lib/api");
      const res = await fetch(
        `${API_BASE_URL}/api/jobs/statistics/summary?user_id=${userId}`,
      );
      if (res.ok) {
        const data = await res.json();
        setTodayCount(data.today_completed ?? data.total_jobs ?? 0);
      }
    } catch {}
  };

  const navItems =
    user?.type === "A" ? [...baseNavItems, ...adminNavItems] : baseNavItems;
  const bottomItems =
    user?.type === "A"
      ? bottomNavItems
      : bottomNavItems.filter((item) => item.href !== "/settings");

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
    <>
    <aside className="fixed left-0 top-0 z-[300] flex h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-[#334155] bg-[#1E293B] pointer-events-auto" style={{ scrollbarGutter: 'stable' }}>
      <div className="flex min-h-full flex-col gap-2 p-4">
        <Link
          href="/"
          className="group flex items-center transition-all duration-200 hover:opacity-80"
          style={{ height: '75px' }}
        >
          <Image
            src="/aidoc.png"
            alt="AiDoc"
            width={462}
            height={240}
            className="w-full object-contain"
          />
        </Link>

        <div className="mx-2 mt-3 h-px bg-gradient-to-r from-transparent via-[#475569] to-transparent" />

        <nav className="flex flex-grow flex-col gap-1 mt-3">
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

        <div className="mx-2 h-px bg-gradient-to-r from-transparent via-[#475569] to-transparent" />

        <nav className="flex flex-col gap-1">
          {bottomItems.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group relative flex shrink-0 items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 transition-all duration-200 ${
                  active
                    ? "bg-primary/15 text-primary"
                    : "text-[#94A3B8] hover:bg-white/5 hover:text-[#F1F5F9]"
                }`}
              >
                {active && (
                  <div className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-primary" />
                )}
                <span
                  className={`material-symbols-outlined text-xl transition-all duration-200 ${active ? "text-primary" : "group-hover:scale-110"}`}
                >
                  {item.icon}
                </span>
                <span
                  className={`text-sm transition-all duration-200 ${active ? "font-semibold" : "font-medium"}`}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="mx-1 rounded-xl border border-primary/10 bg-gradient-to-br from-primary/5 to-primary/10 p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="material-symbols-outlined !text-lg text-primary">
              insights
            </span>
            <span className="text-xs font-semibold text-primary">
              오늘의 처리량
            </span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold text-[#F1F5F9]">
              {todayCount}
            </span>
            <span className="text-xs text-[#94A3B8]">
              파일
            </span>
          </div>
        </div>

      </div>
    </aside>
    <Header />
    </>
  );
}
