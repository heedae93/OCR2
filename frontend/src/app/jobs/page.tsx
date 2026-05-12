"use client";

import { useEffect, useMemo, useRef, useState, Suspense } from "react";
import Sidebar from "@/components/Sidebar";
import { useRouter } from "next/navigation";
import { API_BASE_URL, searchDocuments } from "@/lib/api";

interface SessionSummary {
  session_id: string;
  session_name: string;
  description?: string | null;
  total: number;
  completed: number;
  failed: number;
  processing?: number;
  queued?: number;
  pending?: number;
  uploaded?: number;
  active?: number;
  total_pages?: number;
  completion_rate: number;
  created_at?: string | null;
  updated_at?: string | null;
  last_activity?: string | null;
}

interface JobListItem {
  job_id: string;
}

type StatusFilter = "all" | "active" | "completed" | "failed" | "empty";
type SortBy = "latest" | "oldest" | "name" | "progress";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

function JobsPageInner() {
  const router = useRouter();

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("latest");
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(0);
  const [uploadingSession, setUploadingSession] = useState<string | null>(null);
  const [deletingFailed, setDeletingFailed] = useState(false);
  const [deletingSessions, setDeletingSessions] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(
    new Set(),
  );
  const [focusSessionName, setFocusSessionName] = useState<string | null>(null);
  const [osMatchedSessionIds, setOsMatchedSessionIds] = useState<Set<string>>(
    new Set(),
  );
  const [osMatchedJobIds, setOsMatchedJobIds] = useState<Set<string>>(
    new Set(),
  );
  const [osTotal, setOsTotal] = useState(0);
  const [osSearching, setOsSearching] = useState(false);

  const sessionsRef = useRef<SessionSummary[]>([]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      const hasActive = sessionsRef.current.some(
        (session) => getActiveCount(session) > 0,
      );
      if (hasActive) {
        loadData(false);
      }
    }, 3000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const sessionName = params.get("sessionName");
    setFocusSessionName(sessionName);
    if (params.get("inProgress") === "1") {
      setStatusFilter("active");
    }
    const q = params.get("q");
    if (q) {
      setSearchQuery(q);
      setSearchInput(q);
      runOpenSearch(q);
    }
  }, []);

  const runOpenSearch = async (q: string) => {
    setOsSearching(true);
    try {
      const res = await searchDocuments(q, 1, 50);
      const sessionIds = new Set<string>(
        res.results.map((r: any) => r.session_id).filter(Boolean),
      );
      const jobIds = new Set<string>(
        res.results.map((r: any) => r.job_id).filter(Boolean),
      );

      setOsMatchedSessionIds(sessionIds);
      setOsMatchedJobIds(jobIds);
      setOsTotal(res.total);
    } catch {
      setOsMatchedSessionIds(new Set());
      setOsMatchedJobIds(new Set());
      setOsTotal(0);
    } finally {
      setOsSearching(false);
    }
  };

  const handleSearch = () => {
    const q = searchInput.trim();

    if (q) {
      router.push(`/jobs?q=${encodeURIComponent(q)}`);
    } else {
      router.push(`/jobs`);
    }

    setSearchQuery(q);
    if (q) {
      runOpenSearch(q);
    } else {
      setOsMatchedSessionIds(new Set());
      setOsMatchedJobIds(new Set());
      setOsTotal(0);
    }
  };

  const getUserId = () => {
    try {
      const user = JSON.parse(localStorage.getItem("user") || "{}");
      return user.user_id || "";
    } catch {
      return "";
    }
  };

  const loadData = async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true);
      const userId = getUserId();
      const params = new URLSearchParams({
        user_id: userId,
        include_empty: "true",
      });
      const response = await fetch(
        `${API_BASE_URL}/api/jobs/statistics/sessions?${params}`,
      );

      if (!response.ok) {
        throw new Error(`Failed to load session summaries: ${response.status}`);
      }

      const data: SessionSummary[] = await response.json();
      setSessions(data.map(normalizeSession));
      setLoadError(null);
    } catch (error) {
      console.error("Failed to load session summaries:", error);
      setSessions([]);
      setLoadError(
        error instanceof Error
          ? error.message
          : "서버에 연결할 수 없습니다. 백엔드(6015)가 실행 중인지 확인하세요.",
      );
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const normalizeSession = (session: SessionSummary): SessionSummary => {
    const total = Number(session.total || 0);
    const completed = Number(session.completed || 0);
    const failed = Number(session.failed || 0);
    const active = session.active ?? Math.max(total - completed - failed, 0);

    return {
      ...session,
      total,
      completed,
      failed,
      active,
      processing: Number(session.processing || 0),
      queued: Number(session.queued || 0),
      pending: Number(session.pending || 0),
      uploaded: Number(session.uploaded || 0),
      total_pages: Number(session.total_pages || 0),
      completion_rate: Number(session.completion_rate || 0),
    };
  };

  const handleUpload = async (sessionId: string, files: FileList | null) => {
    if (!files || files.length === 0) return;

    const userId = getUserId();
    setUploadingSession(sessionId);

    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch(
          `${API_BASE_URL}/api/upload?user_id=${encodeURIComponent(userId)}&session_id=${encodeURIComponent(sessionId)}`,
          { method: "POST", body: formData },
        );

        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          alert(`업로드 실패: ${error.detail || file.name}`);
          continue;
        }
      }

      loadData(false);
    } catch (error) {
      console.error("Failed to upload files:", error);
      alert("업로드 중 오류가 발생했습니다.");
    } finally {
      setUploadingSession(null);
    }
  };

  const fetchAllFailedJobs = async () => {
    const userId = getUserId();
    const failedJobs: JobListItem[] = [];

    for (let offset = 0; ; offset += 100) {
      const params = new URLSearchParams({
        user_id: userId,
        status: "failed",
        limit: "100",
        offset: String(offset),
      });
      const response = await fetch(`${API_BASE_URL}/api/jobs?${params}`);

      if (!response.ok) {
        throw new Error(`Failed to load failed jobs: ${response.status}`);
      }

      const jobs: JobListItem[] = await response.json();
      failedJobs.push(...jobs);

      if (jobs.length < 100) break;
    }

    return failedJobs;
  };

  const handleDeleteAllFailed = async () => {
    const failedCount = totals.failed;
    if (failedCount === 0) return;
    if (!confirm(`실패한 작업 ${failedCount}개를 모두 삭제하시겠습니까?`))
      return;

    try {
      setDeletingFailed(true);
      const failedJobs = await fetchAllFailedJobs();
      await Promise.all(
        failedJobs.map((job) =>
          fetch(`${API_BASE_URL}/api/jobs/${job.job_id}`, {
            method: "DELETE",
          }).catch(() => null),
        ),
      );
      loadData();
    } catch (error) {
      console.error("Failed to delete failed jobs:", error);
      alert("실패 작업 삭제 중 오류가 발생했습니다.");
    } finally {
      setDeletingFailed(false);
    }
  };

  const toggleSessionSelected = (sessionId: string, selected: boolean) => {
    setSelectedSessionIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(sessionId);
      else next.delete(sessionId);
      return next;
    });
  };

  const handleDeleteSessions = async (sessionIds: string[]) => {
    if (sessionIds.length === 0) return;
    if (!confirm(`세션 ${sessionIds.length}개를 삭제하시겠습니까?`)) return;

    try {
      setDeletingSessions(true);
      await Promise.all(
        sessionIds.map((sessionId) =>
          fetch(
            `${API_BASE_URL}/api/sessions/${encodeURIComponent(sessionId)}`,
            { method: "DELETE" },
          ).catch(() => null),
        ),
      );
      setSelectedSessionIds((prev) => {
        const next = new Set(prev);
        sessionIds.forEach((id) => next.delete(id));
        return next;
      });
      loadData(false);
    } catch (error) {
      console.error("Failed to delete sessions:", error);
      alert("세션 삭제 중 오류가 발생했습니다.");
    } finally {
      setDeletingSessions(false);
    }
  };

  const openSession = (sessionId: string) => {
    let url = `/jobs/${encodeURIComponent(sessionId)}`;

    // 검색된 문서가 있다면 파라미터로 job_id 목록을 전달
    if (osMatchedJobIds.size > 0) {
      url += `?matched=${Array.from(osMatchedJobIds).join(",")}`;
    }
    router.push(url);
  };

  const totals = useMemo(() => {
    const totalDocuments = sessions.reduce(
      (sum, session) => sum + session.total,
      0,
    );
    const completed = sessions.reduce(
      (sum, session) => sum + session.completed,
      0,
    );
    const failed = sessions.reduce((sum, session) => sum + session.failed, 0);
    const active = sessions.reduce(
      (sum, session) => sum + getActiveCount(session),
      0,
    );
    const totalPages = sessions.reduce(
      (sum, session) => sum + (session.total_pages || 0),
      0,
    );

    return {
      sessions: sessions.length,
      totalDocuments,
      completed,
      failed,
      active,
      totalPages,
      completionRate:
        totalDocuments > 0 ? Math.round((completed / totalDocuments) * 100) : 0,
    };
  }, [sessions]);

  const filteredSessions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return sessions
      .filter((session) => {
        const matchesName =
          !query ||
          session.session_name.toLowerCase().includes(query) ||
          (session.description || "").toLowerCase().includes(query);
        const matchesOs =
          osMatchedSessionIds.size > 0 &&
          osMatchedSessionIds.has(session.session_id);
        const matchesSearch = matchesName || matchesOs;

        if (!matchesSearch) return false;

        if (statusFilter === "active") return getActiveCount(session) > 0;
        if (statusFilter === "completed")
          return (
            session.total > 0 &&
            session.completed === session.total &&
            session.failed === 0
          );
        if (statusFilter === "failed") return session.failed > 0;
        if (statusFilter === "empty") return session.total === 0;
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "name") {
          return a.session_name.localeCompare(b.session_name, "ko-KR");
        }

        if (sortBy === "progress") {
          return b.completion_rate - a.completion_rate;
        }

        const aTime = getSessionTime(a);
        const bTime = getSessionTime(b);
        return sortBy === "oldest" ? aTime - bTime : bTime - aTime;
      });
  }, [sessions, searchQuery, statusFilter, sortBy, osMatchedSessionIds]);

  useEffect(() => {
    setCurrentPage(0);
  }, [searchQuery, statusFilter, sortBy, pageSize]);

  useEffect(() => {
    if (!focusSessionName) return;
    const targetIndex = filteredSessions.findIndex(
      (session) => session.session_name === focusSessionName,
    );
    if (targetIndex >= 0) {
      setCurrentPage(Math.floor(targetIndex / pageSize));
    }
  }, [filteredSessions, focusSessionName, pageSize]);

  useEffect(() => {
    if (!focusSessionName) return;
    const target = filteredSessions.find(
      (session) => session.session_name === focusSessionName,
    );
    if (!target) return;

    const timer = setTimeout(() => {
      document.getElementById(`session-${target.session_id}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 150);

    return () => clearTimeout(timer);
  }, [filteredSessions, focusSessionName, currentPage]);

  const totalPages = Math.max(1, Math.ceil(filteredSessions.length / pageSize));
  const paginatedSessions = filteredSessions.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize,
  );
  const allPageSelected =
    paginatedSessions.length > 0 &&
    paginatedSessions.every((session) =>
      selectedSessionIds.has(session.session_id),
    );

  return (
    <div className="bg-background-light dark:bg-background-dark min-h-screen">
      <Sidebar />
      <main className="ml-64 mt-14 p-6 lg:p-10">
        <div className="w-full max-w-7xl mx-auto">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold text-text-primary-light dark:text-text-primary-dark">
                작업 내역
              </h1>
              <p className="mt-2 text-sm text-text-secondary-light dark:text-text-secondary-dark">
                작업을 선택하면 해당 작업의 파일 목록을 확인할 수 있습니다.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => loadData()}
                className="inline-flex items-center gap-2 rounded-lg border border-border-light dark:border-border-dark px-4 py-2 text-sm font-medium text-text-secondary-light dark:text-text-secondary-dark hover:text-primary hover:border-primary/40 transition-colors"
              >
                <span className="material-symbols-outlined text-base">
                  refresh
                </span>
                새로고침
              </button>
              <button
                onClick={() =>
                  handleDeleteSessions(Array.from(selectedSessionIds))
                }
                disabled={selectedSessionIds.size === 0 || deletingSessions}
                className="inline-flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <span className="material-symbols-outlined text-base">
                  delete
                </span>
                {deletingSessions
                  ? "삭제 중..."
                  : `선택 항목 삭제 (${selectedSessionIds.size})`}
              </button>
              {totals.failed > 0 && (
                <button
                  onClick={handleDeleteAllFailed}
                  disabled={deletingFailed}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <span className="material-symbols-outlined text-base">
                    delete_sweep
                  </span>
                  {deletingFailed ? "삭제 중..." : "실패 작업 전체 삭제"}
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            <SummaryCard
              icon="folder_open"
              label="총 작업"
              value={`${totals.sessions}개`}
            />
            <SummaryCard
              icon="description"
              label="총 문서"
              value={`${totals.totalDocuments}개`}
              subValue={`${totals.totalPages}p`}
            />
            <SummaryCard
              icon="sync"
              label="진행/대기"
              value={`${totals.active}개`}
            />
            <SummaryCard
              icon="check_circle"
              label="완료율"
              value={`${totals.completionRate}%`}
              subValue={`완료 ${totals.completed}개`}
            />
          </div>

          <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark p-4 mb-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="문서명, 메타데이터 키워드로 검색..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSearch();
                  }}
                  className="h-12 w-full rounded-xl border border-border-light dark:border-cyan-400/40 bg-background-light dark:bg-slate-800/80 px-4 pr-28 text-sm text-text-primary-light dark:text-white shadow-sm dark:shadow-[0_0_0_1px_rgba(34,211,238,0.1)] outline-none placeholder:text-gray-400 dark:placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/20 dark:focus:ring-0 dark:focus:border-cyan-400/80 dark:focus:shadow-[0_0_12px_rgba(34,211,238,0.15)] transition-shadow"
                />
                <button
                  onClick={handleSearch}
                  className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary/90 transition-colors"
                >
                  <span className="material-symbols-outlined text-sm">
                    search
                  </span>
                  검색
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(event.target.value as StatusFilter)
                  }
                  className="h-12 px-3 text-sm bg-background-light dark:bg-background-dark border border-border-light dark:border-border-dark rounded-xl text-text-secondary-light dark:text-text-secondary-dark outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-shadow"
                >
                  <option value="all">모든 상태</option>
                  <option value="active">진행/대기</option>
                  <option value="completed">완료</option>
                  <option value="failed">실패 포함</option>
                  <option value="empty">빈 세션</option>
                </select>

                <select
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value as SortBy)}
                  className="h-12 px-3 text-sm bg-background-light dark:bg-background-dark border border-border-light dark:border-border-dark rounded-xl text-text-secondary-light dark:text-text-secondary-dark outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-shadow"
                >
                  <option value="latest">최근 작업순</option>
                  <option value="oldest">오래된순</option>
                  <option value="name">이름순</option>
                  <option value="progress">완료율순</option>
                </select>

                <select
                  value={pageSize}
                  onChange={(event) => setPageSize(Number(event.target.value))}
                  className="h-12 px-3 text-sm bg-background-light dark:bg-background-dark border border-border-light dark:border-border-dark rounded-xl text-text-secondary-light dark:text-text-secondary-dark outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-shadow"
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                      {size}개씩
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {searchQuery && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-cyan-200 bg-cyan-50 dark:border-cyan-400/30 dark:bg-cyan-950/40 px-4 py-2.5 text-sm">
              <span className="material-symbols-outlined text-cyan-600 dark:text-cyan-400 text-base">
                travel_explore
              </span>
              {osSearching ? (
                <span className="text-cyan-700 dark:text-cyan-300">
                  OpenSearch 검색 중...
                </span>
              ) : (
                <span className="text-cyan-700 dark:text-cyan-300">
                  OpenSearch 문서 검색:{" "}
                  <strong className="text-cyan-900 dark:text-white">
                    {osTotal}건
                  </strong>{" "}
                  일치
                  {osMatchedSessionIds.size > 0 && (
                    <span className="ml-1 text-cyan-600 dark:text-cyan-400">
                      · {osMatchedSessionIds.size}개 작업에서 발견됨
                    </span>
                  )}
                </span>
              )}
              <button
                onClick={() => {
                  setSearchInput("");
                  setSearchQuery("");
                  setOsMatchedSessionIds(new Set());
                  setOsMatchedJobIds(new Set());
                  setOsTotal(0);
                  router.push("/jobs");
                }}
                className="ml-auto text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors"
                title="검색 초기화"
              >
                <span className="material-symbols-outlined text-base">
                  close
                </span>
              </button>
            </div>
          )}

          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-text-secondary-light dark:text-text-secondary-dark">
              총{" "}
              <span className="text-primary font-bold">
                {filteredSessions.length}
              </span>
              개 작업
            </p>
            {focusSessionName && (
              <p className="text-xs font-medium text-primary">
                선택 작업: {focusSessionName}
              </p>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center p-16">
              <span className="material-symbols-outlined animate-spin text-primary text-4xl">
                progress_activity
              </span>
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark p-16 text-center text-text-secondary-light dark:text-text-secondary-dark">
              {loadError ? (
                <>
                  <p className="text-red-600 dark:text-red-400 font-medium">
                    목록을 불러오지 못했습니다
                  </p>
                  <p className="mt-2 text-sm opacity-90">{loadError}</p>
                </>
              ) : (
                "작업 내역이 없습니다"
              )}
            </div>
          ) : (
            <>
              <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1080px] table-fixed">
                    <colgroup>
                      <col style={{ width: "4%" }} />
                      <col style={{ width: "27%" }} />
                      <col style={{ width: "10%" }} />
                      <col style={{ width: "11%" }} />
                      <col style={{ width: "16%" }} />
                      <col style={{ width: "20%" }} />
                      <col style={{ width: "12%" }} />
                    </colgroup>
                    <thead className="bg-background-light dark:bg-background-dark border-b border-border-light dark:border-border-dark">
                      <tr>
                        <th className="px-3 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={allPageSelected}
                            onChange={(event) => {
                              const checked = event.target.checked;
                              setSelectedSessionIds((prev) => {
                                const next = new Set(prev);
                                paginatedSessions.forEach((session) => {
                                  if (checked) next.add(session.session_id);
                                  else next.delete(session.session_id);
                                });
                                return next;
                              });
                            }}
                            onClick={(event) => event.stopPropagation()}
                            className="h-4 w-4 accent-primary cursor-pointer"
                            aria-label="현재 페이지 세션 전체 선택"
                          />
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                          작업
                        </th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                          상태
                        </th>
                        <th className="px-3 py-3 text-right text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                          문서
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                          완료율
                        </th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider whitespace-nowrap">
                          마지막 작업
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider whitespace-nowrap">
                          작업
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-light dark:divide-border-dark">
                      {paginatedSessions.map((session) => {
                        const status = getSessionStatus(session);
                        const activeCount = getActiveCount(session);
                        const isFocused =
                          focusSessionName === session.session_name;
                        const isOsMatch = osMatchedSessionIds.has(
                          session.session_id,
                        );

                        return (
                          <tr
                            key={session.session_id}
                            id={`session-${session.session_id}`}
                            // className={`cursor-pointer transition-colors focus:outline-none focus:bg-primary/10 ${isFocused ? "bg-primary/10" : ""} ${isOsMatch ? "ring-1 ring-inset ring-cyan-300 dark:ring-cyan-400/40 bg-cyan-50 hover:bg-cyan-100 dark:bg-cyan-950/20 dark:hover:bg-cyan-900/40" : "hover:bg-primary/5 dark:hover:bg-primary/10"}`}
                            className={`transition-colors ${isOsMatch ? "bg-cyan-50 dark:bg-cyan-900/20 border-l-4 border-l-cyan-400" : "hover:bg-primary/5 dark:hover:bg-primary/10"}`}
                          >
                            <td className="px-3 py-4 text-center">
                              <input
                                type="checkbox"
                                checked={selectedSessionIds.has(
                                  session.session_id,
                                )}
                                onChange={(event) =>
                                  toggleSessionSelected(
                                    session.session_id,
                                    event.target.checked,
                                  )
                                }
                                onClick={(event) => event.stopPropagation()}
                                className="h-4 w-4 accent-primary cursor-pointer"
                                aria-label={`${session.session_name} 선택`}
                              />
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3 min-w-0">
                                <span
                                  className={`material-symbols-outlined shrink-0 ${isOsMatch ? "text-cyan-600 dark:text-cyan-400" : "text-primary"}`}
                                >
                                  folder_open
                                </span>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <button
                                      onClick={() =>
                                        openSession(session.session_id)
                                      }
                                      className="truncate text-left text-sm font-semibold text-text-primary-light dark:text-text-primary-dark hover:text-primary hover:underline transition-colors"
                                    >
                                      {session.session_name}
                                    </button>
                                    {isOsMatch && (
                                      <span className="shrink-0 inline-flex items-center gap-0.5 rounded-full bg-cyan-100 dark:bg-cyan-900/40 px-2 py-0.5 text-[10px] font-bold text-cyan-700 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-800">
                                        <span className="material-symbols-outlined text-[10px]">
                                          travel_explore
                                        </span>
                                        검색 일치
                                      </span>
                                    )}
                                  </div>
                                  {session.description && (
                                    <p className="mt-1 truncate text-xs text-text-secondary-light dark:text-text-secondary-dark">
                                      {session.description}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-4 text-center">
                              <span
                                className={`inline-flex items-center justify-center rounded-full px-2.5 py-1 text-xs font-semibold ${status.color}`}
                              >
                                {status.label}
                              </span>
                              {activeCount > 0 && (
                                <p className="mt-1 text-[11px] text-text-secondary-light dark:text-text-secondary-dark">
                                  {activeCount}개 진행
                                </p>
                              )}
                            </td>
                            <td className="px-3 py-4 text-right text-sm text-text-secondary-light dark:text-text-secondary-dark">
                              <div className="font-semibold text-text-primary-light dark:text-text-primary-dark">
                                {session.total}개
                              </div>
                              <div className="text-xs">
                                완료 {session.completed} · 실패 {session.failed}
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              <div className="flex items-center gap-3">
                                <div className="h-2 flex-1 rounded-full bg-background-light dark:bg-background-dark overflow-hidden">
                                  <div
                                    className="h-full bg-primary transition-all"
                                    style={{
                                      width: `${Math.min(session.completion_rate, 100)}%`,
                                    }}
                                  />
                                </div>
                                <span className="w-12 text-right text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
                                  {session.completion_rate.toFixed(0)}%
                                </span>
                              </div>
                              <p className="mt-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
                                총 {session.total_pages || 0}p
                              </p>
                            </td>
                            <td className="px-4 py-4 text-right text-sm text-text-secondary-light dark:text-text-secondary-dark">
                              <span
                                className="inline-block max-w-full truncate align-middle whitespace-nowrap"
                                title={formatDate(
                                  session.last_activity ||
                                    session.updated_at ||
                                    session.created_at,
                                )}
                              >
                                {formatDate(
                                  session.last_activity ||
                                    session.updated_at ||
                                    session.created_at,
                                )}
                              </span>
                            </td>
                            <td className="px-4 py-4">
                              <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                                <label
                                  onClick={(event) => event.stopPropagation()}
                                  className={`inline-flex items-center justify-center rounded-lg border border-border-light dark:border-border-dark p-2 text-text-secondary-light dark:text-text-secondary-dark hover:text-primary hover:border-primary/40 transition-colors ${uploadingSession === session.session_id ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                                  title="이 세션에 파일 추가"
                                >
                                  <span className="material-symbols-outlined text-lg leading-none">
                                    upload_file
                                  </span>
                                  <input
                                    type="file"
                                    multiple
                                    accept=".pdf,.png,.jpg,.jpeg"
                                    className="hidden"
                                    disabled={
                                      uploadingSession === session.session_id
                                    }
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      (event.target as HTMLInputElement).value =
                                        "";
                                    }}
                                    onChange={(event) => {
                                      event.stopPropagation();
                                      handleUpload(
                                        session.session_id,
                                        event.target.files,
                                      );
                                    }}
                                  />
                                </label>
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openSession(session.session_id);
                                  }}
                                  className="inline-flex items-center justify-center rounded-lg bg-primary/10 p-2 text-primary hover:bg-primary hover:text-white transition-colors"
                                  title="세션 상세 보기"
                                >
                                  <span className="material-symbols-outlined text-lg leading-none">
                                    chevron_right
                                  </span>
                                </button>
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleDeleteSessions([
                                      session.session_id,
                                    ]);
                                  }}
                                  disabled={deletingSessions}
                                  className="inline-flex items-center justify-center rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-2 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-50 transition-colors"
                                  title="세션 개별 삭제"
                                >
                                  <span className="material-symbols-outlined text-lg leading-none">
                                    delete
                                  </span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 pt-5 pb-4">
                  <button
                    onClick={() =>
                      setCurrentPage((page) => Math.max(0, page - 1))
                    }
                    disabled={currentPage === 0}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border-light dark:border-border-dark text-text-secondary-light dark:text-text-secondary-dark hover:text-primary hover:border-primary/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <span className="material-symbols-outlined text-base leading-none">
                      chevron_left
                    </span>
                  </button>

                  {getVisiblePages(currentPage, totalPages).map((page) => (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={`h-9 min-w-9 rounded-lg px-3 text-sm font-medium transition-colors ${page === currentPage ? "bg-primary text-white" : "border border-border-light dark:border-border-dark text-text-secondary-light dark:text-text-secondary-dark hover:text-primary hover:border-primary/40"}`}
                    >
                      {page + 1}
                    </button>
                  ))}

                  <button
                    onClick={() =>
                      setCurrentPage((page) =>
                        Math.min(totalPages - 1, page + 1),
                      )
                    }
                    disabled={currentPage === totalPages - 1}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border-light dark:border-border-dark text-text-secondary-light dark:text-text-secondary-dark hover:text-primary hover:border-primary/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <span className="material-symbols-outlined text-base leading-none">
                      chevron_right
                    </span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  subValue,
}: {
  icon: string;
  label: string;
  value: string;
  subValue?: string;
}) {
  return (
    <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
            {label}
          </p>
          <p className="mt-1 text-2xl font-bold text-text-primary-light dark:text-text-primary-dark">
            {value}
          </p>
          {subValue && (
            <p className="mt-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
              {subValue}
            </p>
          )}
        </div>
        <span className="material-symbols-outlined text-primary">{icon}</span>
      </div>
    </div>
  );
}

function getActiveCount(session: SessionSummary) {
  return (
    session.active ??
    Math.max(session.total - session.completed - session.failed, 0)
  );
}

function getSessionStatus(session: SessionSummary) {
  const active = getActiveCount(session);

  if (session.total === 0) {
    return {
      label: "빈 세션",
      color: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
    };
  }

  if (active > 0) {
    return {
      label: "진행/대기",
      color: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
    };
  }

  if (session.failed > 0) {
    return {
      label: session.completed > 0 ? "부분 실패" : "실패",
      color: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
    };
  }

  if (session.completed === session.total) {
    return {
      label: "완료",
      color:
        "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
    };
  }

  return {
    label: "대기 중",
    color: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
  };
}

function getSessionTime(session: SessionSummary) {
  const value =
    session.last_activity || session.updated_at || session.created_at;
  if (!value) return 0;

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function formatDate(dateString?: string | null) {
  if (!dateString) return "-";

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getVisiblePages(currentPage: number, totalPages: number) {
  const start = Math.max(0, currentPage - 2);
  const end = Math.min(totalPages, start + 5);
  const adjustedStart = Math.max(0, end - 5);

  return Array.from(
    { length: end - adjustedStart },
    (_, index) => adjustedStart + index,
  );
}

export default function JobsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <span className="material-symbols-outlined animate-spin text-primary text-4xl">
            progress_activity
          </span>
        </div>
      }
    >
      <JobsPageInner />
    </Suspense>
  );
}
