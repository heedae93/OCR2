"use client";

import { useState, useEffect, useRef } from "react";
import Sidebar from "@/components/Sidebar";
import PipelineProgress from "@/components/PipelineProgress";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { API_BASE_URL } from "@/lib/api";
import Link from "next/link";

interface Job {
  job_id: string;
  original_filename: string;
  status: string;
  progress_percent: number;
  sub_stage?: string | null;
  total_pages: number;
  current_page: number;
  order: number;
  is_selected: boolean;
  pdf_url?: string | null;
  message?: string | null;
  added_at: string;
}

interface SessionDetail {
  session_id: string;
  session_name: string;
  description?: string;
  created_at: string;
  updated_at: string;
  total_documents: number;
  completed_documents: number;
  documents: Job[];
}

export default function SessionDetailPage() {
  const router = useRouter();
  const params = useParams();
  const sessionId = params.sessionId as string;
  const searchParams = useSearchParams();

  // URL 쿼리 파라미터에서 검색 일치 job_id 목록 가져오기
  const matchedParam = searchParams.get("matched");
  const matchedJobIds = new Set(matchedParam ? matchedParam.split(",") : []);

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [reprocessingJobs, setReprocessingJobs] = useState<Set<string>>(
    new Set(),
  );
  const [reprocessTarget, setReprocessTarget] = useState<Job | null>(null);

  const sessionRef = useRef<SessionDetail | null>(null);

  useEffect(() => {
    loadSession();
  }, [sessionId]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // 자동 갱신 (처리 중인 작업이 있을 때)
  useEffect(() => {
    const timer = setInterval(() => {
      const hasActive = sessionRef.current?.documents.some((j) =>
        ["processing", "queued", "pending", "uploaded"].includes(j.status),
      );
      if (hasActive) {
        loadSession(false);
      }
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  const loadSession = async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true);
      const response = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}`);
      if (response.ok) {
        const data = await response.json();
        setSession(data);
        // 재실행 플래그는 서버 상태가 실제 활성 상태로 바뀌거나 실패했을 때 해제
        setReprocessingJobs((prev) => {
          if (prev.size === 0) return prev;
          const docs: Job[] = Array.isArray(data?.documents)
            ? data.documents
            : [];
          const next = new Set(prev);
          for (const jobId of prev) {
            const doc = docs.find((d) => d.job_id === jobId);
            if (!doc) {
              next.delete(jobId);
              continue;
            }
            if (
              [
                "queued",
                "pending",
                "processing",
                "uploaded",
                "failed",
                "cancelled",
              ].includes(doc.status)
            ) {
              next.delete(jobId);
            }
          }
          return next;
        });
      } else {
        router.push("/jobs");
      }
    } catch (error) {
      console.error("Failed to load session:", error);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const handleReprocess = async (jobId: string) => {
    setReprocessingJobs((prev) => new Set(prev).add(jobId));
    // 즉시 UI를 대기열 상태로 보여 깜빡임을 방지
    setSession((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        documents: prev.documents.map((doc) =>
          doc.job_id === jobId
            ? {
                ...doc,
                status: "queued",
                progress_percent: 0,
                sub_stage: null,
                message: null,
              }
            : doc,
        ),
      };
    });
    try {
      const response = await fetch(`${API_BASE_URL}/api/process/${jobId}`, {
        method: "POST",
      });
      if (response.ok) loadSession(false);
      else {
        // 재실행 시작 실패 시 즉시 해제
        setReprocessingJobs((prev) => {
          const s = new Set(prev);
          s.delete(jobId);
          return s;
        });
      }
    } catch {
      setReprocessingJobs((prev) => {
        const s = new Set(prev);
        s.delete(jobId);
        return s;
      });
    }
  };

  const requestReprocess = (job: Job) => {
    if (reprocessingJobs.has(job.job_id)) return;
    setReprocessTarget(job);
  };

  const confirmReprocess = async () => {
    const target = reprocessTarget;
    if (!target) return;
    setReprocessTarget(null);
    await handleReprocess(target.job_id);
  };

  const handleStartOCR = async (jobId: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/process/${jobId}`, {
        method: "POST",
      });
      if (res.ok) loadSession(false);
    } catch (e) {}
  };

  const handleDeleteJob = async (jobId: string) => {
    if (!confirm("정말 이 파일을 삭제하시겠습니까?")) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/jobs/${jobId}`, {
        method: "DELETE",
      });
      if (response.ok) loadSession(false);
    } catch (e) {}
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
      case "processing":
        return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
      case "failed":
        return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
      default:
        return "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-400";
    }
  };

  const filteredJobs =
    session?.documents.filter((j) => {
      const matchesName = j.original_filename
        .toLowerCase()
        .includes(searchQuery.toLowerCase());
      const normalizedStatus = j.status === "uploaded" ? "queued" : j.status;
      const matchesStatus =
        statusFilter === "all"
          ? true
          : statusFilter === "active"
            ? ["queued", "pending", "processing"].includes(normalizedStatus)
            : normalizedStatus === statusFilter;
      return matchesName && matchesStatus;
    }) || [];

  if (loading && !session) {
    return (
      <div className="bg-background-light dark:bg-background-dark min-h-screen flex items-center justify-center">
        <span className="material-symbols-outlined animate-spin text-primary text-4xl">
          progress_activity
        </span>
      </div>
    );
  }

  return (
    <div className="bg-background-light dark:bg-background-dark min-h-screen text-text-primary-light dark:text-text-primary-dark">
      <Sidebar />
      <main className="ml-64 mt-14 p-8 lg:p-12 transition-all duration-300">
        <div className="max-w-6xl mx-auto">
          {/* Breadcrumbs */}
          <nav className="flex items-center gap-2 text-sm font-bold text-text-secondary-light mb-8">
            <Link
              href="/jobs"
              className="hover:text-primary flex items-center gap-1 transition-colors"
            >
              <span className="material-symbols-outlined text-base">
                history
              </span>
              작업 내역
            </Link>
            <span className="material-symbols-outlined text-base opacity-30">
              chevron_right
            </span>
            <span className="text-text-primary-light dark:text-text-primary-dark">
              {session?.session_name}
            </span>
          </nav>

          {/* Session Header */}
          <div className="mb-6 rounded-2xl border border-border-light bg-surface-light/85 p-5 shadow-sm backdrop-blur-sm dark:border-border-dark dark:bg-surface-dark/70">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h1 className="mb-2 text-3xl font-black tracking-tight">
                  {session?.session_name}
                </h1>
              </div>

              <div className="flex w-full max-w-xl items-center gap-2">
                <div className="relative flex-1">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary-light text-lg">
                    search
                  </span>
                  <input
                    type="text"
                    placeholder="파일명 검색..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        setSearchQuery(searchQuery.trim());
                      }
                    }}
                    className="w-full rounded-xl border border-border-light bg-background-light py-2.5 pl-10 pr-4 text-sm outline-none transition-all focus:border-primary/40 focus:ring-2 focus:ring-primary/20 dark:border-border-dark dark:bg-background-dark"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setSearchQuery(searchQuery.trim())}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-white shadow-sm transition-all hover:bg-primary/90 active:scale-[0.98]"
                >
                  <span className="material-symbols-outlined !text-base">
                    search
                  </span>
                  검색
                </button>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="h-[42px] shrink-0 rounded-xl border border-border-light bg-background-light px-3 text-xs font-bold text-text-primary-light outline-none transition-colors focus:border-primary/40 dark:border-border-dark dark:bg-background-dark dark:text-text-primary-dark dark:[color-scheme:dark]"
                >
                  <option value="all">전체 상태</option>
                  <option value="active">진행중</option>
                  <option value="completed">완료</option>
                  <option value="failed">실패</option>
                  <option value="queued">대기</option>
                </select>
                {(searchQuery.trim() || statusFilter !== "all") && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      setStatusFilter("all");
                    }}
                    className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-border-light bg-surface-light px-3 py-2.5 text-xs font-bold text-text-secondary-light transition-colors hover:border-primary/30 hover:text-primary dark:border-border-dark dark:bg-surface-dark dark:text-text-secondary-dark"
                  >
                    <span className="material-symbols-outlined !text-base">
                      close
                    </span>
                    선택 내용 삭제
                  </button>
                )}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-bold text-primary">
                <span className="material-symbols-outlined !text-sm">
                  description
                </span>
                총 파일 {session?.documents.length ?? 0}개
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                <span className="material-symbols-outlined !text-sm">
                  check_circle
                </span>
                완료{" "}
                {session?.documents.filter((doc) => doc.status === "completed")
                  .length ?? 0}
                개
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-1 text-[11px] font-bold text-red-600 dark:text-red-400">
                <span className="material-symbols-outlined !text-sm">
                  cancel
                </span>
                실패{" "}
                {session?.documents.filter((doc) => doc.status === "failed")
                  .length ?? 0}
                개
              </span>
            </div>
          </div>

          {/* Jobs Table */}
          <div className="overflow-hidden rounded-2xl border border-border-light bg-surface-light shadow-sm dark:border-border-dark dark:bg-surface-dark">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border-light bg-background-light/90 dark:border-border-dark dark:bg-background-dark/70">
                  <th className="px-6 py-4 text-xs font-bold text-text-secondary-light uppercase tracking-wider">
                    파일명
                  </th>
                  <th className="px-6 py-4 text-xs font-bold text-text-secondary-light uppercase tracking-wider text-center">
                    상태
                  </th>
                  <th className="px-6 py-4 text-xs font-bold text-text-secondary-light uppercase tracking-wider text-center whitespace-nowrap">
                    페이지
                  </th>
                  <th className="px-6 py-4 text-xs font-bold text-text-secondary-light uppercase tracking-wider text-right whitespace-nowrap">
                    관리
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light dark:divide-border-dark">
                {filteredJobs.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-6 py-12 text-center text-text-secondary-light font-medium"
                    >
                      파일이 없습니다.
                    </td>
                  </tr>
                ) : (
                  filteredJobs.map((job) => {
                    const isMatch = matchedJobIds.has(job.job_id);
                    return (
                      <tr
                        key={job.job_id}
                        className={`transition-colors ${isMatch ? "bg-cyan-50 dark:bg-cyan-900/20 border-l-4 border-l-cyan-400" : "hover:bg-primary/5 dark:hover:bg-primary/10"}`}
                      >
                        <td className="px-6 py-5">
                          <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() =>
                                  job.status !== "uploaded" &&
                                  router.push(`/editor/${job.job_id}`)
                                }
                                className={`text-sm font-bold text-left ${job.status === "uploaded" ? "cursor-default" : "hover:text-primary hover:underline"}`}
                              >
                                {job.original_filename}
                              </button>
                              {isMatch && (
                                <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] font-bold text-cyan-600 dark:bg-cyan-900/40 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-800">
                                  <span className="material-symbols-outlined text-[10px]">
                                    travel_explore
                                  </span>
                                  검색 일치
                                </span>
                              )}
                            </div>
                            {job.message && (
                              <span className="text-[10px] text-red-500 font-bold mt-1">
                                {job.message}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="min-w-[320px] px-6 py-5">
                          <div className="flex flex-col items-center gap-2">
                            {(() => {
                              const isReprocessing = reprocessingJobs.has(
                                job.job_id,
                              );
                              const displayStatus = isReprocessing
                                ? "queued"
                                : job.status === "uploaded"
                                  ? "queued"
                                  : job.status;
                              const showPipeline =
                                isReprocessing ||
                                !["completed", "failed"].includes(job.status);
                              const displayProgress = isReprocessing
                                ? 0
                                : Number(job.progress_percent || 0);

                              return (
                                <>
                                  <span
                                    className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-tighter ${getStatusBadge(job.status)}`}
                                  >
                                    {job.status === "completed"
                                      ? "완료"
                                      : job.status === "failed"
                                        ? "실패"
                                        : job.status === "processing"
                                          ? "처리중"
                                          : "대기중"}
                                  </span>
                                  {showPipeline && (
                                    <div className="w-full min-w-[280px] rounded-xl border border-border-light bg-background-light/70 p-2.5 dark:border-border-dark dark:bg-background-dark/70">
                                      <p className="mb-1.5 text-[11px] font-bold text-text-secondary-light dark:text-text-secondary-dark">
                                        진행 상태
                                      </p>
                                      <PipelineProgress
                                        status={displayStatus}
                                        progress={displayProgress}
                                        subStage={job.sub_stage}
                                      />
                                    </div>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        </td>
                        <td className="px-6 py-5 text-center font-bold text-sm whitespace-nowrap">
                          {job.total_pages > 0 ? `${job.total_pages}p` : "-"}
                        </td>
                        <td className="px-6 py-5 whitespace-nowrap">
                          <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                            {job.status === "uploaded" ? (
                              <button
                                onClick={() => handleStartOCR(job.job_id)}
                                className="inline-flex shrink-0 items-center rounded-lg bg-green-500/10 px-3 py-1.5 text-xs font-black text-green-600 transition-all hover:bg-green-500 hover:text-white whitespace-nowrap"
                              >
                                OCR 시작
                              </button>
                            ) : (
                              <>
                                {job.status === "completed" && job.pdf_url && (
                                  <a
                                    href={`${API_BASE_URL}${job.pdf_url}`}
                                    download
                                    className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-blue-500/10 px-2.5 py-1.5 text-xs font-bold text-blue-600 transition-all hover:bg-blue-500 hover:text-white whitespace-nowrap"
                                  >
                                    <span className="material-symbols-outlined text-lg">
                                      download
                                    </span>
                                    다운로드
                                  </a>
                                )}
                                {(job.status === "completed" ||
                                  job.status === "failed") && (
                                  <button
                                    onClick={() => requestReprocess(job)}
                                    disabled={reprocessingJobs.has(job.job_id)}
                                    className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-orange-500/10 px-2.5 py-1.5 text-xs font-bold text-orange-600 transition-all hover:bg-orange-500 hover:text-white disabled:opacity-50 whitespace-nowrap"
                                  >
                                    <span className="material-symbols-outlined text-lg">
                                      refresh
                                    </span>
                                    재실행
                                  </button>
                                )}
                              </>
                            )}
                            <button
                              onClick={() => handleDeleteJob(job.job_id)}
                              className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs font-bold text-red-600 transition-all hover:bg-red-500 hover:text-white whitespace-nowrap"
                            >
                              <span className="material-symbols-outlined text-lg">
                                delete
                              </span>
                              삭제
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {reprocessTarget && (
        <div className="fixed inset-y-0 left-64 right-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-border-light bg-surface-light p-5 shadow-xl dark:border-border-dark dark:bg-surface-dark">
            <div className="mb-3 flex items-center gap-2">
              <span className="material-symbols-outlined text-orange-500">
                refresh
              </span>
              <h2 className="text-base font-black">OCR 재실행 확인</h2>
            </div>
            <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
              <span className="font-bold text-text-primary-light dark:text-text-primary-dark">
                {reprocessTarget.original_filename}
              </span>{" "}
              파일을 다시 처리할까요?
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setReprocessTarget(null)}
                className="rounded-xl border border-border-light bg-background-light px-3.5 py-2 text-xs font-bold text-text-secondary-light transition-colors hover:border-primary/30 hover:text-primary dark:border-border-dark dark:bg-background-dark dark:text-text-secondary-dark"
              >
                취소
              </button>
              <button
                type="button"
                onClick={confirmReprocess}
                className="rounded-xl bg-primary px-3.5 py-2 text-xs font-bold text-white transition-colors hover:bg-primary/90"
              >
                재실행
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
