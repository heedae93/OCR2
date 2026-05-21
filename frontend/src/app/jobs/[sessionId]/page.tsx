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
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());

  const sessionRef = useRef<SessionDetail | null>(null);

  const toggleJobSelected = (jobId: string, checked: boolean) => {
    setSelectedJobIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(jobId);
      else next.delete(jobId);
      return next;
    });
  };

  const toggleAllSelected = (checked: boolean) => {
    if (checked) setSelectedJobIds(new Set(filteredJobs.map((j) => j.job_id)));
    else setSelectedJobIds(new Set());
  };

  const handleBulkDownload = () => {
    const jobs = filteredJobs.filter(
      (j) => selectedJobIds.has(j.job_id) && j.status === "completed" && j.pdf_url,
    );
    jobs.forEach((j) => {
      const a = document.createElement("a");
      a.href = `${API_BASE_URL}${j.pdf_url}`;
      a.download = j.original_filename;
      a.click();
    });
  };

  const handleBulkReprocess = async () => {
    for (const jobId of selectedJobIds) {
      await handleReprocess(jobId);
    }
    setSelectedJobIds(new Set());
  };

  const handleBulkDelete = async () => {
    for (const jobId of selectedJobIds) {
      await handleDeleteJob(jobId);
    }
    setSelectedJobIds(new Set());
  };

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
        return "bg-emerald-500 text-white";
      case "processing":
        return "bg-blue-500 text-white";
      case "failed":
        return "bg-red-500 text-white";
      default:
        return "bg-gray-400 text-white";
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
      <div className="bg-slate-50 dark:bg-slate-50 min-h-screen flex items-center justify-center">
        <span className="material-symbols-outlined animate-spin text-primary text-4xl">
          progress_activity
        </span>
      </div>
    );
  }

  return (
    <div className="bg-slate-50 dark:bg-slate-50 min-h-screen text-text-primary-light dark:text-text-primary-dark">
      <Sidebar />
      <main className="ml-64 p-8 lg:p-12 transition-all duration-300">
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
          <h1 className="mb-3 text-3xl font-black tracking-tight text-text-primary-light dark:text-text-primary-dark">
            {session?.session_name}
          </h1>

          {/* 일괄 액션바 */}
          <div className="mb-3 flex items-center justify-end gap-2">
            {selectedJobIds.size > 0 && (
              <span className="text-xs font-semibold text-primary">{selectedJobIds.size}개 선택됨</span>
            )}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-8 shrink-0 rounded-lg border border-border-light bg-background-light px-2 text-xs font-bold text-text-primary-light outline-none transition-colors focus:border-primary/40 dark:border-border-dark dark:bg-background-dark dark:text-text-primary-dark dark:[color-scheme:dark]"
            >
              <option value="all">전체 상태</option>
              <option value="active">진행중</option>
              <option value="completed">완료</option>
              <option value="failed">실패</option>
              <option value="queued">대기</option>
            </select>
            <button
              onClick={handleBulkDownload}
              disabled={selectedJobIds.size === 0}
              className="inline-flex items-center gap-1 h-8 rounded-lg bg-blue-500/10 px-3 text-xs font-bold text-blue-600 hover:bg-blue-500 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <span className="material-symbols-outlined text-sm">download</span>
              선택 다운로드
            </button>
            <button
              onClick={handleBulkReprocess}
              disabled={selectedJobIds.size === 0}
              className="inline-flex items-center gap-1 h-8 rounded-lg bg-orange-500/10 px-3 text-xs font-bold text-orange-600 hover:bg-orange-500 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <span className="material-symbols-outlined text-sm">refresh</span>
              선택 재실행
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={selectedJobIds.size === 0}
              className="inline-flex items-center gap-1 h-8 rounded-lg bg-red-500/10 px-3 text-xs font-bold text-red-600 hover:bg-red-500 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <span className="material-symbols-outlined text-sm">delete</span>
              선택 삭제
            </button>
          </div>

          {/* Jobs Table */}
          <div className="overflow-hidden rounded-2xl border border-border-light bg-surface-light shadow-sm dark:border-border-dark dark:bg-surface-dark">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border-light bg-background-light/90 dark:border-border-dark dark:bg-background-dark/70">
                  <th className="px-4 py-4 text-center">
                    <button
                      onClick={() => toggleAllSelected(!(filteredJobs.length > 0 && filteredJobs.every((j) => selectedJobIds.has(j.job_id))))}
                      className={`flex h-4 w-4 items-center justify-center rounded-sm border transition-colors ${filteredJobs.length > 0 && filteredJobs.every((j) => selectedJobIds.has(j.job_id)) ? "border-primary bg-primary text-white" : "border-primary bg-surface-light"}`}
                      aria-label="전체 선택"
                    >
                      {filteredJobs.length > 0 && filteredJobs.every((j) => selectedJobIds.has(j.job_id)) && <span className="material-symbols-outlined text-[14px] leading-none">check</span>}
                    </button>
                  </th>
                  <th className="px-6 py-4 text-xs font-bold text-text-secondary-light uppercase tracking-wider">
                    파일명
                  </th>
                  <th className="px-6 py-4 text-xs font-bold text-text-secondary-light uppercase tracking-wider text-center">
                    상태
                  </th>
                  <th className="px-6 py-4 text-xs font-bold text-text-secondary-light uppercase tracking-wider text-center whitespace-nowrap">
                    페이지
                  </th>
                  <th className="px-6 py-4 text-xs font-bold text-text-secondary-light uppercase tracking-wider text-center whitespace-nowrap">
                    작업시간
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
                        <td className="px-4 py-5 text-center">
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleJobSelected(job.job_id, !selectedJobIds.has(job.job_id)) }}
                            className={`flex h-4 w-4 items-center justify-center rounded-sm border transition-colors ${selectedJobIds.has(job.job_id) ? "border-primary bg-primary text-white" : "border-primary bg-surface-light"}`}
                            aria-label={`${job.original_filename} 선택`}
                          >
                            {selectedJobIds.has(job.job_id) && <span className="material-symbols-outlined text-[14px] leading-none">check</span>}
                          </button>
                        </td>
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
                          </div>
                        </td>
                        <td className="min-w-[320px] px-6 py-5">
                          <div className="flex flex-col items-center gap-2">
                            {job.status === "uploaded" ? (
                              <button
                                onClick={() => handleStartOCR(job.job_id)}
                                className="inline-flex shrink-0 items-center rounded-lg bg-green-500/10 px-3 py-1.5 text-xs font-black text-green-600 transition-all hover:bg-green-500 hover:text-white whitespace-nowrap"
                              >
                                OCR 시작
                              </button>
                            ) : (() => {
                              const isReprocessing = reprocessingJobs.has(job.job_id);
                              const displayStatus = isReprocessing ? "queued" : job.status;
                              const showPipeline = isReprocessing || !["completed", "failed"].includes(job.status);
                              const displayProgress = isReprocessing ? 0 : Number(job.progress_percent || 0);
                              return (
                                <>
                                  <span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-tighter ${getStatusBadge(job.status)}`}>
                                    {job.status === "completed" ? "완료" : job.status === "failed" ? "실패" : job.status === "processing" ? "처리중" : "대기중"}
                                  </span>
                                  {job.status === "failed" && job.message && (
                                    <span className="text-[10px] text-red-500 font-medium text-center max-w-[280px]">
                                      {job.message}
                                    </span>
                                  )}
                                  {showPipeline && (
                                    <div className="w-full min-w-[280px] rounded-xl border border-border-light bg-background-light/70 p-2.5 dark:border-border-dark dark:bg-background-dark/70">
                                      <p className="mb-1.5 text-[11px] font-bold text-text-secondary-light dark:text-text-secondary-dark">진행 상태</p>
                                      <PipelineProgress status={displayStatus} progress={displayProgress} subStage={job.sub_stage} />
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
                        <td className="px-6 py-5 text-center text-xs text-text-secondary-light dark:text-text-secondary-dark whitespace-nowrap">
                          {job.updated_at ? new Date(job.updated_at).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : "-"}
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
