"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import UploadQueueModal from "./UploadQueueModal";

/* ─── Types ─────────────────────────────────────── */
interface Widget {
  total_sessions: number;
  total_documents: number;
  completed_documents: number;
  detected_pii: number;
  masked_items: number;
  extracted_tags: number;
}

interface DocTypeDist {
  label: string;
  count: number;
  pct: number;
}

interface PiiTypeDist {
  type: string;
  label: string;
  count: number;
}

interface PiiByType {
  type: string;
  label: string;
  count: number;
}

interface DocRow {
  job_id: string;
  filename: string;
  status: string;
  doc_type: string;
  created_at: string | null;
  pii_total: number;
  pii_by_type: PiiByType[];
  tag_count: number;
}

interface TodayStatus {
  completed: number;
  failed: number;
  processing: number;
  queued: number;
  total: number;
}

interface ProcessingStats {
  avg_seconds: number | null;
  success_rate: number | null;
  completed: number;
  failed: number;
  total: number;
}

interface DashboardData {
  processing_stats: ProcessingStats;
  widgets: Widget;
  doc_type_dist: DocTypeDist[];
  pii_type_dist: PiiTypeDist[];
  documents: DocRow[];
  today_status: TodayStatus;
}

/* ─── Constants ─────────────────────────────────── */
const PALETTE = ["#38bdf8", "#34d399", "#a78bfa", "#fb7185", "#fbbf24", "#f472b6", "#4ade80", "#60a5fa"];

const PII_COLORS: Record<string, string> = {
  RRN: "#f97316",
  PHONE: "#3b82f6",
  EMAIL: "#8b5cf6",
  NAME: "#10b981",
  ENGLISH_NAME: "#06b6d4",
  ROAD_ADDRESS: "#f59e0b",
  ACCOUNT_NO: "#ec4899",
  CREDIT_CARD: "#ef4444",
  PASSPORT_NO: "#6366f1",
  DRIVERS_LICENSE: "#84cc16",
  CAR_NO: "#14b8a6",
  BUSINESS_REG_NO: "#f43f5e",
  IP_ADDRESS: "#a78bfa",
  MAC_ADDRESS: "#fb923c",
  FOREIGNER_REG_NO: "#22d3ee",
  HEALTH_INSURANCE_NO: "#4ade80",
};

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  completed: { label: "완료", bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-400" },
  failed: { label: "실패", bg: "bg-rose-50", text: "text-rose-700", dot: "bg-rose-400" },
  processing: { label: "처리중", bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-400" },
  queued: { label: "대기", bg: "bg-gray-100", text: "text-gray-600", dot: "bg-gray-400" },
};

/* ─── Component ─────────────────────────────────── */
export default function Dashboard() {
  const router = useRouter();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchInput, setSearchInput] = useState("");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNewSessionModal, setShowNewSessionModal] = useState(false);
  const [bgStats, setBgStats] = useState<{
    total: number;
    completed: number;
    failed: number;
    isRunning: boolean;
  } | null>(null);

  const API_BASE = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:6015"}`;

  const handleSearch = () => {
    const q = searchInput.trim();
    if (!q) return;
    router.push(`/jobs?q=${encodeURIComponent(q)}`);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const user = JSON.parse(localStorage.getItem("user") || "{}");
      const userId = user.user_id || "";
      const res = await fetch(`${API_BASE}/api/my-dashboard?user_id=${encodeURIComponent(userId)}`);
      if (res.ok) {
        setData(await res.json());
      }
    } catch (e) {
      console.error("Dashboard fetch error:", e);
    } finally {
      setLoading(false);
    }
  };

  /* ── Derived: donut gradient ── */
  const docDist = data?.doc_type_dist ?? [];
  const totalDocCount = Math.max(1, docDist.reduce((s, d) => s + d.count, 0));
  const donutGradient = docDist.length > 0
    ? docDist
        .reduce<{ cursor: number; stops: string[] }>(
          (acc, item, i) => {
            const size = (item.count / totalDocCount) * 100;
            const color = PALETTE[i % PALETTE.length];
            acc.stops.push(`${color} ${acc.cursor}% ${acc.cursor + size}%`);
            acc.cursor += size;
            return acc;
          },
          { cursor: 0, stops: [] }
        )
        .stops.join(", ")
    : "#e2e8f0 0% 100%";

  /* ── PII bar max ── */
  const piiDist = data?.pii_type_dist ?? [];
  const maxPiiCount = Math.max(1, ...piiDist.map((p) => p.count));

  const w = data?.widgets;
  const docs = data?.documents ?? [];
  const ts = data?.today_status;
  const ps = data?.processing_stats;

  if (loading) {
    return (
      <div className="flex h-[70vh] items-center justify-center rounded-xl border border-border-light bg-white text-gray-400">
        <span className="material-symbols-outlined animate-spin text-4xl">progress_activity</span>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100dvh-8rem)] flex-col gap-4 pb-8">
      {/* 검색 */}
      <div>
        <h3 className="mb-3 text-sm font-bold text-gray-800">문서 및 메타데이터 통합 검색</h3>
        <div className="relative">
          <input
            ref={searchInputRef}
            className="h-12 w-full rounded-xl border-2 border-primary/30 bg-white px-4 pr-28 text-sm text-gray-800 shadow-sm outline-none placeholder:text-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/20 transition-shadow"
            placeholder="문서명, 메타데이터 키워드로 검색..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
          />
          <button
            onClick={handleSearch}
            className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary/90 transition-colors"
          >
            <span className="material-symbols-outlined text-sm">search</span>
            검색
          </button>
        </div>
      </div>

      {/* ── Area A: 5개 위젯 ── */}
      <section>
        <h3 className="mb-2 text-sm font-bold text-gray-800">내 작업 통계</h3>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {[
            { label: "내 작업 수", value: w?.total_sessions ?? 0, icon: "folder_open", color: "text-sky-500" },
            { label: "처리된 문서 수", value: w?.total_documents ?? 0, icon: "description", color: "text-blue-500" },
            { label: "검출된 개인정보", value: w?.detected_pii ?? 0, icon: "manage_search", color: "text-violet-500" },
            { label: "마스킹 항목 수", value: w?.masked_items ?? 0, icon: "hide_source", color: "text-rose-500" },
            { label: "추출된 태그", value: w?.extracted_tags ?? 0, icon: "label", color: "text-amber-500" },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-xl border border-gray-200 bg-white px-4 py-3 flex items-center gap-3 shadow-sm"
            >
              <span className={`material-symbols-outlined text-xl shrink-0 ${item.color}`}>{item.icon}</span>
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-500 truncate">{item.label}</p>
                <p className="text-lg font-black leading-tight text-gray-900">{item.value.toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Area B: 도넛차트 + PII 유형 막대차트 ── */}
      <div className="grid gap-4 xl:grid-cols-2">
        {/* B-Left: 문서 유형 도넛 */}
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-gray-800">문서 유형 분포</h3>
          {docDist.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">문서 데이터 없음</p>
          ) : (
            <div className="flex items-center justify-center gap-8">
              <div
                className="relative h-32 w-32 shrink-0 rounded-full"
                style={{ background: `conic-gradient(${donutGradient})` }}
              >
                <div className="absolute inset-8 rounded-full bg-white flex items-center justify-center">
                  <span className="text-xs font-bold text-gray-600">{totalDocCount}건</span>
                </div>
              </div>
              <div className="space-y-2">
                {docDist.map((item, i) => (
                  <div key={item.label} className="flex items-center gap-2 text-xs text-gray-600">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />
                    <span className="font-medium">{item.label}</span>
                    <span className="text-gray-400 ml-1">{item.pct}% ({item.count}건)</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* 완료율 게이지 */}
          {ps && ps.total > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="flex items-center justify-between mb-1.5 text-xs">
                <span className="text-gray-500">OCR 완료율</span>
                <span className="font-bold text-gray-800">{ps.success_rate ?? 0}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full bg-emerald-400 transition-all duration-500"
                  style={{ width: `${ps.success_rate ?? 0}%` }}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-gray-400">
                완료 {ps.completed}건 · 실패 {ps.failed}건 · 전체 {ps.total}건
              </p>
            </div>
          )}
        </section>

        {/* B-Right: PII 유형별 막대차트 */}
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-gray-800">개인정보 유형별 검출 현황</h3>
          {piiDist.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">검출된 개인정보 없음</p>
          ) : (
            <div className="flex flex-col gap-2.5 max-h-52 overflow-y-auto pr-1">
              {piiDist.map((item) => {
                const barPct = (item.count / maxPiiCount) * 100;
                const color = PII_COLORS[item.type] ?? "#94a3b8";
                return (
                  <div key={item.type}>
                    <div className="flex items-center justify-between mb-1 text-xs">
                      <span className="text-gray-600 truncate max-w-[70%]">{item.label}</span>
                      <span className="font-bold text-gray-800 shrink-0">{item.count.toLocaleString()}건</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${barPct}%`, backgroundColor: color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {/* 처리 시간 인포 칩 */}
          {ps && ps.total > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700">
                <span className="material-symbols-outlined text-sm">timer</span>
                평균 처리 {ps.avg_seconds != null ? `${ps.avg_seconds}초` : "측정 중"}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
                <span className="material-symbols-outlined text-sm">check_circle</span>
                성공률 {ps.success_rate ?? 0}%
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700">
                <span className="material-symbols-outlined text-sm">cancel</span>
                실패 {ps.failed}건
              </span>
            </div>
          )}
        </section>
      </div>

      {/* ── Area C: 오늘 현황 + 문서별 상세 ── */}
      <div className="grid gap-4 xl:grid-cols-[1fr_1.6fr]">
        {/* C-Left: 오늘 처리 현황 */}
        <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-3.5">
            <span className="material-symbols-outlined text-lg text-primary">today</span>
            <h3 className="text-sm font-bold text-gray-800">오늘 처리 현황</h3>
            <span className="ml-auto text-[11px] text-gray-400">
              {new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric" })}
            </span>
          </div>
          <div className="p-5">
            <div className="mb-5 flex items-end gap-2">
              <span className="text-4xl font-black text-gray-900">{ts?.completed ?? 0}</span>
              <span className="mb-1 text-sm text-gray-500">건 완료</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "완료", value: ts?.completed ?? 0, dot: "bg-emerald-400", text: "text-emerald-600" },
                { label: "실패", value: ts?.failed ?? 0, dot: "bg-rose-400", text: "text-rose-600" },
                { label: "처리 중", value: ts?.processing ?? 0, dot: "bg-blue-400", text: "text-blue-600" },
                { label: "대기", value: ts?.queued ?? 0, dot: "bg-gray-300", text: "text-gray-600" },
              ].map(({ label, value, dot, text }) => (
                <div
                  key={label}
                  className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5 flex items-center gap-2.5"
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
                  <div>
                    <p className="text-[11px] text-gray-500">{label}</p>
                    <p className={`text-base font-bold ${text}`}>{value.toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs text-gray-500 mb-1">오늘 총 처리 문서</p>
              <p className="text-2xl font-black text-gray-900">{ts?.total ?? 0}<span className="text-sm font-medium text-gray-400 ml-1">건</span></p>
            </div>
          </div>
        </section>

        {/* C-Right: 문서 상세 테이블 */}
        <section className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-3.5">
            <span className="material-symbols-outlined text-lg text-primary">table_rows</span>
            <h3 className="text-sm font-bold text-gray-800">문서별 처리 상세</h3>
            <Link href="/jobs" className="ml-auto text-xs text-primary hover:underline">전체 보기</Link>
          </div>
          {docs.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-400">처리된 문서가 없습니다</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-left text-gray-500">
                    <th className="px-4 py-2.5 font-medium">파일명</th>
                    <th className="px-3 py-2.5 font-medium">유형</th>
                    <th className="px-3 py-2.5 font-medium">상태</th>
                    <th className="px-3 py-2.5 font-medium">개인정보</th>
                    <th className="px-3 py-2.5 font-medium text-right">태그</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {docs.slice(0, 12).map((doc) => {
                    const sc = STATUS_CONFIG[doc.status] ?? STATUS_CONFIG.queued;
                    return (
                      <tr key={doc.job_id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-2.5 max-w-[180px]">
                          <span className="block truncate font-medium text-gray-800" title={doc.filename}>
                            {doc.filename}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{doc.doc_type}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${sc.bg} ${sc.text}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${sc.dot}`} />
                            {sc.label}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          {doc.pii_total === 0 ? (
                            <span className="text-gray-300">-</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {doc.pii_by_type.slice(0, 3).map((p) => (
                                <span
                                  key={p.type}
                                  className="inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold text-white"
                                  style={{ backgroundColor: PII_COLORS[p.type] ?? "#94a3b8" }}
                                  title={p.label}
                                >
                                  {p.label.replace(/번호$/, "").replace(/주소$/, "주소")} {p.count}
                                </span>
                              ))}
                              {doc.pii_by_type.length > 3 && (
                                <span className="text-gray-400 text-[10px] self-center">+{doc.pii_by_type.length - 3}</span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-medium text-gray-700">
                          {doc.tag_count > 0 ? doc.tag_count : <span className="text-gray-300">-</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

      </div>

      <UploadQueueModal
        visible={showNewSessionModal}
        onClose={() => setShowNewSessionModal(false)}
        onComplete={() => { fetchData(); setShowNewSessionModal(false); }}
        onProcessingChange={(state) => {
          setBgStats(state.isRunning || state.total > 0 ? state : null);
        }}
      />

      {bgStats && bgStats.isRunning && !showNewSessionModal && (
        <button
          onClick={() => setShowNewSessionModal(true)}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-3 rounded-full bg-primary px-4 py-3 text-white shadow-xl shadow-primary/25 transition hover:bg-primary/90"
        >
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/25 border-t-white" />
          <div className="text-left">
            <p className="text-sm font-bold leading-none">OCR 처리 중</p>
            <p className="mt-0.5 text-xs text-white/70">{bgStats.completed}/{bgStats.total} 완료</p>
          </div>
        </button>
      )}
    </div>
  );
}
