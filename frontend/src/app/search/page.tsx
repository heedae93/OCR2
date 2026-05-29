"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { searchDocuments, SearchResult } from "@/lib/api";

/* ── 하이라이트 렌더러 ── */
const MARK_RE = /<mark>(.*?)<\/mark>/g;

function HighlightedText({ html }: { html: string }) {
  const parts: { text: string; hi: boolean }[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(MARK_RE.source, "g");
  while ((m = re.exec(html)) !== null) {
    if (m.index > last) parts.push({ text: html.slice(last, m.index), hi: false });
    parts.push({ text: m[1], hi: true });
    last = re.lastIndex;
  }
  if (last < html.length) parts.push({ text: html.slice(last), hi: false });
  return (
    <span>
      {parts.map((p, i) =>
        p.hi ? (
          <mark key={i} className="bg-yellow-100 text-yellow-800 rounded px-0.5 font-semibold not-italic">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </span>
  );
}

/* ── 관련도 배지 ── */
function RelevanceBadge({ score }: { score: number }) {
  const pct = Math.min(100, Math.round(score * 20));
  const { bg, text, bar } =
    pct >= 70
      ? { bg: "bg-emerald-50 border-emerald-200", text: "text-emerald-700", bar: "bg-emerald-500" }
      : pct >= 40
      ? { bg: "bg-blue-50 border-blue-200", text: "text-blue-700", bar: "bg-blue-500" }
      : { bg: "bg-slate-100 border-slate-200", text: "text-slate-500", bar: "bg-slate-400" };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${bg} ${text}`}>
      <span className="material-symbols-outlined text-[12px]">analytics</span>
      관련도&nbsp;{score.toFixed(2)}
      <span className="w-12 h-1.5 rounded-full bg-slate-200 overflow-hidden">
        <span className={`block h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

function formatDate(raw: string | null) {
  if (!raw) return null;
  try {
    return new Date(raw).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
  } catch { return raw.slice(0, 10); }
}

/* ── 메인 페이지 ── */
export default function SearchPage() {
  return (
    <div className="h-screen bg-background-light overflow-y-scroll">
      <Suspense fallback={
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        </div>
      }>
        <SearchContent />
      </Suspense>
    </div>
  );
}

/* ── 검색 콘텐츠 ── */
function SearchContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [inputValue, setInputValue] = useState(searchParams.get("q") ?? "");
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [page, setPage] = useState(Number(searchParams.get("page") ?? 1));

  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const SIZE = 10;

  const doSearch = useCallback(async (q: string, p: number) => {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await searchDocuments(q.trim(), p, SIZE);
      setResults(res.results);
      setTotal(res.total);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "검색 중 오류가 발생했습니다.");
      setResults([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (query) doSearch(query, page);
  }, [query, page, doSearch]);

  const submit = () => {
    const q = inputValue.trim();
    if (!q) return;
    setQuery(q);
    setPage(1);
    router.replace(`/search?q=${encodeURIComponent(q)}&page=1`);
  };

  const reset = () => {
    setInputValue("");
    setQuery("");
    setPage(1);
    setResults([]);
    setTotal(0);
    setError(null);
    router.replace("/search");
    inputRef.current?.focus();
  };

  const goPage = (p: number) => {
    setPage(p);
    router.replace(`/search?q=${encodeURIComponent(query)}&page=${p}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const totalPages = Math.ceil(total / SIZE);
  const hasQuery = Boolean(query);

  return (
    <>
      {/* ── 헤더 ── */}
      <div className="sticky top-0 z-10 bg-white border-b border-border-light shadow-sm px-8 py-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-3">
            {/* 뒤로가기 */}
            <button
              onClick={() => router.back()}
              className="flex items-center justify-center w-8 h-8 rounded-lg border border-border-light text-text-secondary-light hover:border-primary hover:text-primary transition-colors shrink-0"
              title="뒤로가기"
            >
              <span className="material-symbols-outlined text-lg">arrow_back</span>
            </button>

            {/* 타이틀 */}
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-2xl">manage_search</span>
              <span className="text-lg font-bold text-text-primary-light">통합검색</span>
            </div>

            {hasQuery && (
              <span className="text-sm text-text-secondary-light">
                — <span className="font-medium text-text-primary-light">"{query}"</span>
                {!loading && (
                  <span className="text-primary font-bold ml-1">{total.toLocaleString()}건</span>
                )}
              </span>
            )}

            {/* 오른쪽: 초기화 */}
            {hasQuery && (
              <button
                onClick={reset}
                className="ml-auto flex items-center gap-1 rounded-lg border border-border-light px-3 py-1.5 text-xs text-text-secondary-light hover:border-primary hover:text-primary transition-colors"
              >
                <span className="material-symbols-outlined text-sm">refresh</span>
                초기화
              </button>
            )}
          </div>

          {/* 검색바 */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xl pointer-events-none">
                search
              </span>
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="검색어를 입력하세요 (예: 계약서, 개인정보, 2024)"
                className="w-full rounded-xl border border-border-light bg-slate-50 pl-10 pr-4 py-2.5 text-sm text-text-primary-light placeholder-slate-400 focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
              />
            </div>
            <button
              onClick={submit}
              disabled={!inputValue.trim() || loading}
              className="shrink-0 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              검색
            </button>
          </div>

          {/* 설명 */}
          {!hasQuery && (
            <p className="mt-1.5 text-xs text-text-secondary-light">
              OCR 본문 · AI 요약 · 키워드 · 파일명에서 전문 검색합니다
            </p>
          )}
        </div>
      </div>

      {/* ── 본문 ── */}
      <div className="max-w-4xl mx-auto px-8 py-8">

        {/* 로딩 */}
        {loading && (
          <div className="flex flex-col items-center gap-3 py-24">
            <div className="w-9 h-9 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            <p className="text-sm text-text-secondary-light">OpenSearch에서 검색 중...</p>
          </div>
        )}

        {/* 에러 */}
        {error && !loading && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
            <span className="material-symbols-outlined align-middle mr-1 text-base">error</span>
            {error}
          </div>
        )}

        {/* 빈 결과 */}
        {!loading && !error && hasQuery && results.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-24 text-center">
            <span className="material-symbols-outlined text-5xl text-slate-300">search_off</span>
            <p className="text-text-primary-light font-medium">검색 결과가 없습니다</p>
            <p className="text-sm text-text-secondary-light">
              다른 키워드로 검색하거나 더 짧게 입력해 보세요
            </p>
          </div>
        )}

        {/* 초기 상태 */}
        {!loading && !error && !hasQuery && (
          <div className="flex flex-col items-center gap-5 py-24 text-center">
            <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-4xl text-primary">travel_explore</span>
            </div>
            <div>
              <p className="text-text-primary-light font-semibold mb-1">무엇이든 찾아보세요</p>
              <p className="text-sm text-text-secondary-light">
                OCR 문서 전체에서 관련 내용을 즉시 찾아드립니다
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 mt-1">
              {["계약서", "개인정보", "청구서", "이메일", "서명", "주민등록"].map((kw) => (
                <button
                  key={kw}
                  onClick={() => {
                    setInputValue(kw);
                    setQuery(kw);
                    setPage(1);
                    router.replace(`/search?q=${encodeURIComponent(kw)}&page=1`);
                  }}
                  className="rounded-full border border-border-light bg-white px-3.5 py-1.5 text-xs text-text-secondary-light hover:border-primary hover:text-primary hover:bg-blue-50 transition-colors shadow-sm"
                >
                  {kw}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 검색 결과 */}
        {!loading && !error && results.length > 0 && (
          <>
            <p className="text-xs text-text-secondary-light mb-4">
              {totalPages > 1 && `${page} / ${totalPages} 페이지 · `}
              총 {total.toLocaleString()}건
            </p>
            <div className="flex flex-col gap-3">
              {results.map((item, idx) => (
                <ResultCard key={item.job_id ?? idx} item={item} />
              ))}
            </div>
          </>
        )}

        {/* 페이지네이션 */}
        {!loading && totalPages > 1 && (
          <div className="mt-8 flex items-center justify-center gap-1">
            <button
              onClick={() => goPage(page - 1)}
              disabled={page <= 1}
              className="flex items-center justify-center w-9 h-9 rounded-lg border border-border-light bg-white text-text-secondary-light hover:border-primary hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              <span className="material-symbols-outlined text-lg">chevron_left</span>
            </button>
            {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
              let p: number;
              if (totalPages <= 7) p = i + 1;
              else if (page <= 4) p = i + 1;
              else if (page >= totalPages - 3) p = totalPages - 6 + i;
              else p = page - 3 + i;
              return (
                <button
                  key={p}
                  onClick={() => goPage(p)}
                  className={`flex items-center justify-center w-9 h-9 rounded-lg text-sm font-medium transition-colors shadow-sm ${
                    p === page
                      ? "bg-primary text-white border border-primary"
                      : "border border-border-light bg-white text-text-secondary-light hover:border-primary hover:text-primary"
                  }`}
                >
                  {p}
                </button>
              );
            })}
            <button
              onClick={() => goPage(page + 1)}
              disabled={page >= totalPages}
              className="flex items-center justify-center w-9 h-9 rounded-lg border border-border-light bg-white text-text-secondary-light hover:border-primary hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              <span className="material-symbols-outlined text-lg">chevron_right</span>
            </button>
          </div>
        )}
      </div>
    </>
  );
}

/* ── 결과 카드 ── */
function ResultCard({ item }: { item: SearchResult }) {
  const [expanded, setExpanded] = useState(false);
  const hasSnippet = Boolean(item.snippet);
  const hasSummary = Boolean(item.summary);
  const hasKeywords = item.keywords?.length > 0;

  return (
    <div className="rounded-xl border border-border-light bg-white shadow-sm hover:shadow-soft hover:border-blue-200 transition-all overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-start gap-3 px-5 py-4">
        <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0 mt-0.5">
          <span className="material-symbols-outlined text-xl text-primary">description</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text-primary-light truncate" title={item.filename}>
            {item.filename || "(파일명 없음)"}
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <RelevanceBadge score={item.score} />
            {item.created_at && (
              <span className="text-[11px] text-text-secondary-light">
                {formatDate(item.created_at)}
              </span>
            )}
          </div>

          {/* 키워드 */}
          {hasKeywords && (
            <div className="flex flex-wrap gap-1 mt-2">
              {item.keywords.slice(0, 8).map((kw) => (
                <span
                  key={kw}
                  className="rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[11px] text-blue-700 font-medium"
                >
                  {kw}
                </span>
              ))}
              {item.keywords.length > 8 && (
                <span className="text-[11px] text-text-secondary-light self-center">
                  +{item.keywords.length - 8}
                </span>
              )}
            </div>
          )}
        </div>

        {/* 열기 버튼 */}
        {item.job_id && (
          <Link
            href={`/editor/${item.job_id}`}
            className="shrink-0 flex items-center gap-1 rounded-lg border border-border-light px-3 py-1.5 text-xs text-text-secondary-light hover:border-primary hover:text-primary hover:bg-blue-50 transition-colors"
          >
            <span className="material-symbols-outlined text-sm">open_in_new</span>
            열기
          </Link>
        )}
      </div>

      {/* 본문 발췌 */}
      {hasSnippet && (
        <div className="px-5 pb-3 border-t border-slate-100">
          <p className="text-[10px] text-text-secondary-light mt-2.5 mb-1 uppercase tracking-widest font-semibold">
            본문 발췌
          </p>
          <p className="text-sm text-slate-600 leading-relaxed line-clamp-3">
            <HighlightedText html={item.snippet} />
          </p>
        </div>
      )}

      {/* AI 요약 토글 */}
      {hasSummary && (
        <div className="px-5 pb-4 border-t border-slate-100">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 mt-2.5 text-xs text-text-secondary-light hover:text-primary transition-colors"
          >
            <span className="material-symbols-outlined text-sm">
              {expanded ? "expand_less" : "expand_more"}
            </span>
            {expanded ? "AI 요약 접기" : "AI 요약 보기"}
          </button>
          {expanded && (
            <div className="mt-2 rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
              <p className="text-[10px] text-text-secondary-light font-semibold uppercase tracking-widest mb-1.5">AI 요약</p>
              <p className="text-sm text-slate-700 leading-relaxed">{item.summary}</p>
            </div>
          )}
        </div>
      )}

      {/* 세션 정보 */}
      {item.session_id && (
        <div className="px-5 pb-3 flex items-center gap-1.5 border-t border-slate-100 pt-2">
          <span className="material-symbols-outlined text-sm text-slate-400">folder</span>
          <span className="text-xs text-text-secondary-light truncate">
            세션: {item.session_id}
          </span>
        </div>
      )}
    </div>
  );
}
