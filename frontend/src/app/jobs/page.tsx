"use client";

import { useEffect, useMemo, useRef, useState, Suspense } from "react";
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
  filename?: string | null;
  status?: string;
  progress_percent?: number;
  current_page?: number;
  total_pages?: number;
  message?: string | null;
  pdf_url?: string | null;
  created_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  processing_time_seconds?: number | null;
  total_text_blocks?: number | null;
  average_confidence?: number | null;
  is_double_column?: boolean | null;
  session_id?: string | null;
  session_name?: string | null;
  doc_type?: string | null;
}

interface SessionDocumentItem {
  job_id: string;
  original_filename?: string | null;
  status?: string;
  progress_percent?: number;
  current_page?: number;
  total_pages?: number;
  pdf_url?: string | null;
  message?: string | null;
  added_at?: string | null;
  doc_type?: string | null;
}

interface SessionWithDocuments {
  session_id: string;
  session_name: string;
  documents?: SessionDocumentItem[];
}

type StatusFilter = "all" | "active" | "completed" | "failed" | "empty";
type SortBy = "latest" | "oldest" | "name" | "progress";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

function JobsPageInner() {
  const router = useRouter();

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("latest");
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(0);
  const [deletingJobs, setDeletingJobs] = useState(false);
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(
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
  const jobsRef = useRef<JobListItem[]>([]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      const hasActive = jobsRef.current.some((job) =>
        isActiveJobStatus(job.status || ""),
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
      const sessionResponse = await fetch(
        `${API_BASE_URL}/api/jobs/statistics/sessions?${params}`,
      );

      if (!sessionResponse.ok) {
        throw new Error(`Failed to load session summaries: ${sessionResponse.status}`);
      }

      const [sessionData, nextJobs, sessionJobMap] = await Promise.all([
        sessionResponse.json() as Promise<SessionSummary[]>,
        fetchAllJobs(userId),
        fetchSessionJobMap(userId),
      ]);
      const nextSessions = sessionData.map(normalizeSession);

      setSessions(nextSessions);
      setJobs(
        nextJobs.map((job) => normalizeJob(enrichJobWithSession(job, sessionJobMap))),
      );
      setLoadError(null);
    } catch (error) {
      console.error("Failed to load session summaries:", error);
      setSessions([]);
      setJobs([]);
      setLoadError(
        error instanceof Error
          ? error.message
          : "서버에 연결할 수 없습니다. 백엔드(6015)가 실행 중인지 확인하세요.",
      );
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const fetchAllJobs = async (userId: string) => {
    const allJobs: JobListItem[] = [];
    for (let offset = 0; ; offset += 100) {
      const params = new URLSearchParams({
        user_id: userId,
        limit: "100",
        offset: String(offset),
      });
      const response = await fetch(`${API_BASE_URL}/api/jobs?${params}`);

      if (!response.ok) {
        throw new Error(`Failed to load jobs: ${response.status}`);
      }

      const page: JobListItem[] = await response.json();
      allJobs.push(...page);
      if (page.length < 100) break;
    }

    return allJobs;
  };

  const fetchSessionJobMap = async (userId: string) => {
    const params = new URLSearchParams({ user_id: userId });
    const response = await fetch(`${API_BASE_URL}/api/sessions?${params}`);

    if (!response.ok) {
      throw new Error(`Failed to load sessions: ${response.status}`);
    }

    const sessionList: SessionWithDocuments[] = await response.json();
    const sessionJobMap = new Map<
      string,
      {
        session_id: string;
        session_name: string;
        document: SessionDocumentItem;
      }
    >();

    for (const session of sessionList) {
      for (const document of session.documents || []) {
        sessionJobMap.set(document.job_id, {
          session_id: session.session_id,
          session_name: session.session_name,
          document,
        });
      }
    }

    return sessionJobMap;
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

  const normalizeJob = (job: JobListItem): JobListItem => ({
    ...job,
    status: job.status === "uploaded" ? "queued" : job.status || "queued",
    progress_percent: Number(job.progress_percent || 0),
    current_page: Number(job.current_page || 0),
    total_pages: Number(job.total_pages || 0),
  });

  const enrichJobWithSession = (
    job: JobListItem,
    sessionJobMap: Map<
      string,
      {
        session_id: string;
        session_name: string;
        document: SessionDocumentItem;
      }
    >,
  ): JobListItem => {
    const sessionInfo = sessionJobMap.get(job.job_id);
    if (!sessionInfo) return job;
    const document = sessionInfo.document;

    return {
      ...job,
      filename: job.filename || document.original_filename,
      status: document.status || job.status,
      progress_percent: document.progress_percent ?? job.progress_percent,
      current_page: document.current_page ?? job.current_page,
      total_pages: document.total_pages ?? job.total_pages,
      pdf_url: document.pdf_url || job.pdf_url,
      message: document.message ?? job.message,
      session_id: sessionInfo.session_id,
      session_name: sessionInfo.session_name,
      doc_type: document.doc_type ?? job.doc_type,
    };
  };

  const toggleJobSelected = (jobId: string, selected: boolean) => {
    setSelectedJobIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(jobId);
      else next.delete(jobId);
      return next;
    });
  };

  const handleDeleteJobs = async (jobIds: string[]) => {
    if (jobIds.length === 0) return;
    if (!confirm(`파일 ${jobIds.length}개를 삭제하시겠습니까?`)) return;

    try {
      setDeletingJobs(true);
      await Promise.all(
        jobIds.map((jobId) =>
          fetch(`${API_BASE_URL}/api/jobs/${jobId}`, { method: "DELETE" }).catch(() => null),
        ),
      );
      setSelectedJobIds((prev) => {
        const next = new Set(prev);
        jobIds.forEach((id) => next.delete(id));
        return next;
      });
      loadData(false);
    } catch (error) {
      console.error("Failed to delete jobs:", error);
      alert("파일 삭제 중 오류가 발생했습니다.");
    } finally {
      setDeletingJobs(false);
    }
  };

  const handleBulkReprocessJobs = async () => {
    for (const jobId of selectedJobIds) {
      try {
        await fetch(`${API_BASE_URL}/api/process/${jobId}`, { method: "POST" });
      } catch {}
    }
    await loadData();
    setSelectedJobIds(new Set());
  };

  const handleBulkDownloadJobs = () => {
    const selectedJobs = jobs.filter(
      (job) => selectedJobIds.has(job.job_id) && job.status === "completed" && job.pdf_url,
    );

    for (const job of selectedJobs) {
      const a = document.createElement("a");
      a.href = `${API_BASE_URL}${job.pdf_url}`;
      a.download = job.filename || "download.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const openJob = (job: JobListItem) => {
    router.push(`/editor/${job.job_id}`);
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

  const filteredJobs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return jobs
      .filter((job) => {
        const matchesName =
          !query ||
          (job.filename || "").toLowerCase().includes(query) ||
          (job.session_name || "").toLowerCase().includes(query) ||
          (job.doc_type || "").toLowerCase().includes(query);
        const matchesOs = osMatchedJobIds.size > 0 && osMatchedJobIds.has(job.job_id);
        const matchesSearch = matchesName || matchesOs;

        if (!matchesSearch) return false;

        const status = job.status || "";
        if (statusFilter === "active") return isActiveJobStatus(status);
        if (statusFilter === "completed") return status === "completed";
        if (statusFilter === "failed") return status === "failed";
        return statusFilter === "empty" ? false : true;
      })
      .sort((a, b) => {
        if (sortBy === "name") {
          return (a.filename || "").localeCompare(b.filename || "", "ko-KR");
        }

        if (sortBy === "progress") {
          return Number(b.progress_percent || 0) - Number(a.progress_percent || 0);
        }

        const aTime = getJobTime(a);
        const bTime = getJobTime(b);
        return sortBy === "oldest" ? aTime - bTime : bTime - aTime;
      });
  }, [jobs, osMatchedJobIds, searchQuery, sortBy, statusFilter]);

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

  const totalPages = Math.max(1, Math.ceil(filteredJobs.length / pageSize));
  const paginatedJobs = filteredJobs.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize,
  );
  const allPageSelected =
    paginatedJobs.length > 0 &&
    paginatedJobs.every((job) =>
      selectedJobIds.has(job.job_id),
    );

  return (
      <main className="ml-64 p-6 lg:p-10">
        <div className="w-full max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-4 gap-4">
            <div>
              <h1 className="text-3xl font-bold text-text-primary-light">
                작업 내역
              </h1>
              <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">
                파일별 처리 내역과 각 파일이 속한 작업을 한 번에 확인할 수 있습니다.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 shrink-0">
              <button
                onClick={() => router.push("/ocr-work")}
                className="inline-flex h-12 items-center gap-2 rounded-xl bg-primary px-5 text-[15px] font-bold text-white shadow-sm transition-colors hover:bg-primary/90"
              >
                <span className="material-symbols-outlined text-xl">upload_file</span>
                문서 작업하기
              </button>
            </div>
          </div>

          <div className="relative mb-8">
            <input
              type="text"
              placeholder="파일명, 작업명, 메타데이터 키워드로 검색..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch();
              }}
              className="h-12 w-full rounded-xl border-2 border-primary/30 bg-white px-4 pr-28 text-sm text-text-primary-light shadow-sm outline-none placeholder:text-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/20 transition-shadow"
            />
            <button
              onClick={handleSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary/90 transition-colors"
            >
              <span className="material-symbols-outlined text-sm">search</span>
              검색
            </button>
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
                  {osMatchedJobIds.size > 0 && (
                    <span className="ml-1 text-cyan-600 dark:text-cyan-400">
                      · {osMatchedJobIds.size}개 파일에서 발견됨
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

          <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="inline-flex items-baseline gap-1">
                <span className="font-semibold text-text-secondary-light dark:text-text-secondary-dark">총 파일</span>
                <span className="font-bold text-primary">{filteredJobs.length}개</span>
              </span>
              <span className="text-border-light dark:text-border-dark">|</span>
              <span className="inline-flex items-baseline gap-1">
                <span className="font-semibold text-text-secondary-light dark:text-text-secondary-dark">작업</span>
                <span className="font-bold text-indigo-600 dark:text-indigo-400">{totals.sessions}개</span>
              </span>
              <span className="text-border-light dark:text-border-dark">|</span>
              <span className="inline-flex items-baseline gap-1">
                <span className="font-semibold text-text-secondary-light dark:text-text-secondary-dark">전체 문서</span>
                <span className="font-bold text-sky-600 dark:text-sky-400">{totals.totalDocuments}개</span>
              </span>
              <span className="text-border-light dark:text-border-dark">|</span>
              <span className="inline-flex items-baseline gap-1">
                <span className="font-semibold text-text-secondary-light dark:text-text-secondary-dark">진행/대기</span>
                <span className="font-bold text-amber-600 dark:text-amber-400">{totals.active}개</span>
              </span>
              <span className="text-border-light dark:text-border-dark">|</span>
              <span className="inline-flex items-baseline gap-1">
                <span className="font-semibold text-text-secondary-light dark:text-text-secondary-dark">완료율</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400">{totals.completionRate}%</span>
              </span>
              {focusSessionName && (
                <span className="text-xs font-medium text-primary">· 선택: {focusSessionName}</span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                className="h-8 px-2 text-xs bg-background-light dark:bg-background-dark border border-border-light dark:border-border-dark rounded-lg text-text-secondary-light dark:text-text-secondary-dark outline-none focus:border-primary transition-shadow"
              >
                <option value="all">모든 상태</option>
                <option value="active">진행/대기</option>
                <option value="completed">완료</option>
                <option value="failed">실패 포함</option>
              </select>
              <select
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value as SortBy)}
                className="h-8 px-2 text-xs bg-background-light dark:bg-background-dark border border-border-light dark:border-border-dark rounded-lg text-text-secondary-light dark:text-text-secondary-dark outline-none focus:border-primary transition-shadow"
              >
                <option value="latest">최근 작업순</option>
                <option value="oldest">오래된순</option>
                <option value="name">이름순</option>
                <option value="progress">완료율순</option>
              </select>
              <select
                value={pageSize}
                onChange={(event) => setPageSize(Number(event.target.value))}
                className="h-8 px-2 text-xs bg-background-light dark:bg-background-dark border border-border-light dark:border-border-dark rounded-lg text-text-secondary-light dark:text-text-secondary-dark outline-none focus:border-primary transition-shadow"
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>{size}개씩</option>
                ))}
              </select>
              <div className="w-px h-4 bg-border-light dark:bg-border-dark" />
              <button
                onClick={handleBulkDownloadJobs}
                disabled={selectedJobIds.size === 0}
                className="inline-flex items-center gap-1 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-3 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <span className="material-symbols-outlined text-sm">download</span>
                선택 다운로드
              </button>
              <button
                onClick={handleBulkReprocessJobs}
                disabled={selectedJobIds.size === 0}
                className="inline-flex items-center gap-1 h-8 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 px-3 text-xs font-medium text-orange-600 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-900/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <span className="material-symbols-outlined text-sm">refresh</span>
                선택 재실행
              </button>
              <button
                onClick={() => handleDeleteJobs(Array.from(selectedJobIds))}
                disabled={selectedJobIds.size === 0 || deletingJobs}
                className="inline-flex items-center gap-1 h-8 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <span className="material-symbols-outlined text-sm">delete</span>
                {deletingJobs ? "삭제 중..." : `선택 삭제 (${selectedJobIds.size})`}
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center p-16">
              <span className="material-symbols-outlined animate-spin text-primary text-4xl">
                progress_activity
              </span>
            </div>
          ) : filteredJobs.length === 0 ? (
            <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark p-16 text-center text-text-secondary-light dark:text-text-secondary-dark">
              {loadError ? (
                <>
                  <p className="text-red-600 dark:text-red-400 font-medium">
                    목록을 불러오지 못했습니다
                  </p>
                  <p className="mt-2 text-sm opacity-90">{loadError}</p>
                </>
              ) : (
                "파일 내역이 없습니다"
              )}
            </div>
          ) : (
            <>
              <div className="bg-white dark:bg-white rounded-xl border border-border-light dark:border-border-dark overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1180px] table-fixed">
                    <colgroup>
                      <col style={{ width: "4%" }} />
                      <col style={{ width: "18%" }} />
                      <col style={{ width: "32%" }} />
                      <col style={{ width: "9%" }} />
                      <col style={{ width: "9%" }} />
                      <col style={{ width: "15%" }} />
                      <col style={{ width: "12%" }} />
                    </colgroup>
                    <thead className="border-b border-primary/20 dark:border-primary/20 bg-primary/10 dark:bg-primary/10">
                      <tr>
                        <th className="px-3 py-3 text-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const checked = !allPageSelected;
                              setSelectedJobIds((prev) => {
                                const next = new Set(prev);
                                paginatedJobs.forEach((job) => {
                                  if (checked) next.add(job.job_id);
                                  else next.delete(job.job_id);
                                });
                                return next;
                              });
                            }}
                            className={`flex h-4 w-4 items-center justify-center rounded-sm border transition-colors ${allPageSelected ? "border-primary bg-primary text-white" : "border-primary bg-surface-light"}`}
                            aria-label="현재 페이지 파일 전체 선택"
                          >
                            {allPageSelected && <span className="material-symbols-outlined text-[14px] leading-none">check</span>}
                          </button>
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                          작업명
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                          파일명
                        </th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                          상태
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                          진행률
                        </th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider whitespace-nowrap">
                          시작시간
                        </th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider whitespace-nowrap">
                          소요시간
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-light dark:divide-border-dark">
                      {paginatedJobs.map((job) => {
                        const status = getJobStatusMeta(job.status || "");
                        const isOsMatch = osMatchedJobIds.has(job.job_id);

                        return (
                          <tr
                            key={job.job_id}
                            id={`job-${job.job_id}`}
                            className={`transition-colors cursor-pointer ${isOsMatch ? "bg-cyan-50 dark:bg-cyan-900/20 border-l-4 border-l-cyan-400" : "hover:bg-primary/5 dark:hover:bg-primary/10"}`}
                            onClick={() => openJob(job)}
                          >
                            <td className="px-3 py-4 text-center">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleJobSelected(job.job_id, !selectedJobIds.has(job.job_id));
                                }}
                                className={`flex h-4 w-4 items-center justify-center rounded-sm border transition-colors ${selectedJobIds.has(job.job_id) ? "border-primary bg-primary text-white" : "border-primary bg-surface-light"}`}
                                aria-label={`${job.filename || job.job_id} 선택`}
                              >
                                {selectedJobIds.has(job.job_id) && <span className="material-symbols-outlined text-[14px] leading-none">check</span>}
                              </button>
                            </td>
                            <td className="px-4 py-4 text-sm text-text-primary-light dark:text-text-primary-dark">
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="material-symbols-outlined shrink-0 text-base text-primary">folder_open</span>
                                <span className="truncate text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
                                  {job.session_name || "미지정 작업"}
                                </span>
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3 min-w-0">
                                <span
                                  className={`material-symbols-outlined shrink-0 ${isOsMatch ? "text-cyan-600 dark:text-cyan-400" : "text-primary"}`}
                                >
                                  description
                                </span>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <button
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        openJob(job);
                                      }}
                                      className="truncate text-left text-sm font-semibold text-text-primary-light dark:text-text-primary-dark hover:text-primary hover:underline transition-colors"
                                    >
                                      {job.filename || job.job_id}
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
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-4 text-center">
                              <span
                                className={`inline-flex items-center justify-center rounded-full px-2.5 py-1 text-xs font-semibold ${status.color}`}
                              >
                                {status.label}
                              </span>
                            </td>
                            <td className="px-4 py-4">
                              <div className="mb-1 text-left text-xs font-bold text-text-primary-light dark:text-text-primary-dark tabular-nums">
                                {Number(job.progress_percent || 0).toFixed(0)}%
                              </div>
                              <div className="flex items-center">
                                <div className="h-2 w-20 rounded-full bg-background-light dark:bg-background-dark overflow-hidden">
                                  <div
                                    className="h-full bg-primary transition-all"
                                    style={{
                                      width: `${Math.min(Number(job.progress_percent || 0), 100)}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-4 text-right text-sm text-text-secondary-light dark:text-text-secondary-dark">
                              <span
                                className="inline-block max-w-full truncate align-middle whitespace-nowrap"
                                title={formatDate(getJobStartDateValue(job))}
                              >
                                {formatDate(getJobStartDateValue(job))}
                              </span>
                            </td>
                            <td className="px-4 py-4 text-right text-sm text-text-secondary-light dark:text-text-secondary-dark">
                              <span
                                className="inline-block max-w-full truncate align-middle whitespace-nowrap font-semibold text-text-primary-light dark:text-text-primary-dark"
                                title={formatJobDuration(job)}
                              >
                                {formatJobDuration(job)}
                              </span>
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
    <div className="bg-white border border-border-light rounded-xl px-3 py-2 flex items-center gap-2 w-32">
      <span className="material-symbols-outlined text-base text-primary shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] text-text-secondary-light leading-none">{label}</p>
        <p className="text-sm font-bold text-text-primary-light leading-tight mt-0.5">{value}</p>
        <p className="text-[11px] text-text-secondary-light leading-none mt-0.5">{subValue ?? ' '}</p>
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
    return { label: "빈 세션", color: "bg-gray-400 text-white" };
  }

  if (active > 0) {
    return { label: "진행/대기", color: "bg-blue-500 text-white" };
  }

  if (session.failed > 0) {
    return {
      label: session.completed > 0 ? "부분 실패" : "실패",
      color: "bg-red-500 text-white",
    };
  }

  if (session.completed === session.total) {
    return { label: "완료", color: "bg-green-500 text-white" };
  }

  return { label: "대기 중", color: "bg-gray-400 text-white" };
}

function isActiveJobStatus(status: string) {
  return ["queued", "pending", "processing", "uploaded"].includes(status);
}

function getJobStatusMeta(status: string) {
  switch (status) {
    case "completed":
      return { label: "완료", color: "bg-green-500 text-white" };
    case "processing":
      return { label: "진행중", color: "bg-blue-500 text-white" };
    case "queued":
    case "pending":
    case "uploaded":
      return { label: "대기", color: "bg-gray-500 text-white" };
    case "failed":
      return { label: "실패", color: "bg-red-500 text-white" };
    case "cancelled":
      return { label: "취소", color: "bg-slate-500 text-white" };
    default:
      return { label: "미확인", color: "bg-gray-400 text-white" };
  }
}

function getSessionTime(session: SessionSummary) {
  const value =
    session.last_activity || session.updated_at || session.created_at;
  if (!value) return 0;

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function getJobTime(job: JobListItem) {
  const value = getJobDateValue(job);
  if (!value) return 0;

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function getJobDateValue(job: JobListItem) {
  return job.completed_at || job.started_at || job.created_at || null;
}

function getJobStartDateValue(job: JobListItem) {
  return job.started_at || job.created_at || null;
}

function formatJobDuration(job: JobListItem) {
  if (typeof job.processing_time_seconds === "number") {
    return formatDuration(job.processing_time_seconds);
  }

  if (isActiveJobStatus(job.status || "")) {
    return "처리 중";
  }

  return "-";
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "-";

  const totalSeconds = Math.round(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}시간 ${minutes}분`;
  }

  if (minutes > 0) {
    return `${minutes}분 ${remainingSeconds}초`;
  }

  return `${remainingSeconds}초`;
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
        <div className="ml-64 flex items-center justify-center min-h-screen">
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
