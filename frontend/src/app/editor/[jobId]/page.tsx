"use client";

import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  API_BASE_URL,
  getJobStatus,
  getOCRResults,
  getProcessedFileUrl,
  processJob,
  exportDocument,
  getJSONDownloadUrl,
  saveOCREdits,
  SaveEditsPayload,
} from "@/lib/api";
import { Job, OCRResult, SmartToolLayer } from "@/types";
import PDFViewer from "@/components/PDFViewer";
import ExportModal from "@/components/ExportModal";
import ThemeToggle from "@/components/ThemeToggle";
import TextEditor from "@/components/TextEditor";
import SessionSidebar from "@/components/SessionSidebar";
import OCRProgressOverlay from "@/components/OCRProgressOverlay";
import DataViewer from "@/components/DataViewer";

type SaveStatus = "saved" | "saving" | "unsaved" | "error";

interface PendingEdit {
  page_number: number;
  line_index: number;
  original_text: string;
  new_text: string;
}

type ToolType =
  | "text"
  | "image"
  | "signature"
  | "draw"
  | "shape"
  | "sticker"
  | "highlight"
  | "select"
  | "rotate"
  | "structure"
  | null;

interface TextElement {
  id: string;
  x: number;
  y: number;
  text: string;
  fontSize: number;
  color: string;
  fontFamily: string;
}

export default function EditorPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.jobId as string;

  const [job, setJob] = useState<Job | null>(null);
  const [ocrResults, setOcrResults] = useState<OCRResult | null>(null);
  const [ocrLoadError, setOcrLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [showExportModal, setShowExportModal] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolType>(null);
  const [zoom, setZoom] = useState(50);
  const [fitToWidth, setFitToWidth] = useState(true); // Default: fit to width enabled
  const [showOCRComparison, setShowOCRComparison] = useState(false);
  const [showTextLayer, setShowTextLayer] = useState(false);
  const [showAccuracy, setShowAccuracy] = useState(false);
  const [showMasking, setShowMasking] = useState(false);
  const [maskingData, setMaskingData] = useState<any[]>([]);
  const [isProcessingOCR, setIsProcessingOCR] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrCurrentPage, setOcrCurrentPage] = useState(0);
  const [ocrTotalPages, setOcrTotalPages] = useState(0);
  const [ocrStage, setOcrStage] = useState("OCR 처리 중...");
  const [showProgressOverlay, setShowProgressOverlay] = useState(false);
  const [showOCRPanel, setShowOCRPanel] = useState(false);
  const [selectedLineIndex, setSelectedLineIndex] = useState<number | null>(
    null,
  );
  const [showDataViewer, setShowDataViewer] = useState(false);
  const [smartLayers] = useState<SmartToolLayer[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [pageThumbnails, setPageThumbnails] = useState<{
    [key: number]: string;
  }>({});
  const thumbnailCanvasRefs = useRef<{ [key: number]: HTMLCanvasElement }>({});
  const [totalPdfPages, setTotalPdfPages] = useState(0);
  const [textElements, setTextElements] = useState<TextElement[]>([]);
  const [pageWidth, setPageWidth] = useState(0);
  const [pageHeight, setPageHeight] = useState(0);
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const [showSmartTools, setShowSmartTools] = useState(false);

  // Auto-save state
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [pendingEdits, setPendingEdits] = useState<PendingEdit[]>([]);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 항상 원본 PDF를 표시 — 마스킹은 프론트엔드 오버레이로 처리
  const timestamp = useMemo(() => Date.now(), [jobId]);
  const pdfUrl = useMemo(() => `${getProcessedFileUrl(jobId)}?v=${timestamp}`, [jobId, timestamp]);

  // Debounced auto-save function
  const performSave = useCallback(async () => {
    if (pendingEdits.length === 0 || !ocrResults) return;

    setSaveStatus("saving");
    try {
      const payload: SaveEditsPayload = {
        edits: pendingEdits,
        ocr_results: ocrResults,
      };
      const response = await saveOCREdits(jobId, payload);
      setSaveStatus("saved");
      setLastSavedAt(response.saved_at);
      setPendingEdits([]); // Clear pending edits after successful save
    } catch (error) {
      console.error("Auto-save failed:", error);
      setSaveStatus("error");
    }
  }, [pendingEdits, ocrResults, jobId]);

  // Auto-save effect with debounce
  useEffect(() => {
    if (pendingEdits.length === 0) return;

    setSaveStatus("unsaved");

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Set new timeout for auto-save (2 seconds after last edit)
    saveTimeoutRef.current = setTimeout(() => {
      performSave();
    }, 2000);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [pendingEdits, performSave]);

  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;

    const fetchData = async () => {
      try {
        setOcrLoadError(null);
        const jobData = await getJobStatus(jobId);
        setJob(jobData);

        if (jobData.status === "completed") {
          try {
            const ocr = await getOCRResults(jobId);
            setOcrResults(ocr);
            setIsProcessingOCR(false);
            setShowProgressOverlay(false);
            setOcrProgress(100);
          } catch (error: any) {
            console.error("Failed to load OCR results:", error);
            setOcrResults(null);
            setIsProcessingOCR(false);
            setShowProgressOverlay(false);
            setOcrLoadError(
              error?.response?.data?.detail || "OCR 결과를 불러오지 못했습니다.",
            );
            if (intervalId) {
              clearInterval(intervalId);
            }
          }

          // Stop polling when completed
          if (intervalId) {
            clearInterval(intervalId);
          }

          // OCR 완료 시 자동으로 PII 감지 + 마스킹 PDF 기본 표시
          try {
            const res = await fetch(`${API_BASE_URL}/api/masking/${jobId}/detect`);
            if (res.ok) {
              const data = await res.json();
              setMaskingData(data.masked_boxes || []);
              setShowMasking(true); // 마스킹 PDF 기본 표시
            }
          } catch (e) {
            console.warn("PII 자동 감지 실패:", e);
          }
        } else if (jobData.status === "processing") {
          setIsProcessingOCR(true);
          setShowProgressOverlay(true);
          // Update progress info
          setOcrProgress(jobData.progress_percent || 0);
          setOcrCurrentPage(jobData.current_page || 0);
          setOcrTotalPages(jobData.total_pages || 0);
          setOcrStage(jobData.sub_stage || "OCR 처리 중...");
          // Continue polling
        } else if (jobData.status === "failed") {
          setIsProcessingOCR(false);
          setShowProgressOverlay(false);
          // Stop polling on failure
          if (intervalId) {
            clearInterval(intervalId);
          }
        }
      } catch (error) {
        console.error("Failed to fetch data:", error);
      } finally {
        setLoading(false);
      }
    };

    // Initial fetch
    fetchData();

    // Poll every 2 seconds if processing
    intervalId = setInterval(fetchData, 2000);

    // Cleanup
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [jobId]);

  // 브라우저 탭 타이틀을 파일명으로 업데이트
  useEffect(() => {
    if (job?.filename) {
      document.title = `${job.filename} — AI Doc Intelligence`;
    } else {
      document.title = "AI Doc Intelligence";
    }
    return () => {
      document.title = "AI Doc Intelligence";
    };
  }, [job?.filename]);

  const handleStartOCR = async () => {
    try {
      setIsProcessingOCR(true);
      setShowProgressOverlay(true);
      setOcrProgress(0);
      setOcrCurrentPage(0);
      setOcrTotalPages(0);
      setOcrStage("OCR 처리 시작...");
      await processJob(jobId);
    } catch (error) {
      console.error("Failed to start OCR:", error);
      setIsProcessingOCR(false);
      setShowProgressOverlay(false);
    }
  };

  const handleCloseProgressOverlay = () => {
    // Allow users to continue working in background
    setShowProgressOverlay(false);
  };

  const triggerDownload = (relativePath: string, filename?: string) => {
    const url = relativePath.startsWith("http")
      ? relativePath
      : `${API_BASE_URL}${relativePath}`;

    const link = document.createElement("a");
    link.href = url;
    if (filename) {
      link.download = filename;
    }
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleEditOCRText = (lineIndex: number, newText: string) => {
    if (!ocrResults) return;

    const updatedResults = { ...ocrResults };
    const pageIndex = updatedResults.pages.findIndex(
      (p) => p.page_number === currentPage,
    );
    if (pageIndex >= 0 && updatedResults.pages[pageIndex].lines[lineIndex]) {
      const originalText =
        updatedResults.pages[pageIndex].lines[lineIndex].text || "";

      // Only track if text actually changed
      if (originalText !== newText) {
        // Add to pending edits for auto-save
        setPendingEdits((prev) => {
          // Check if this line was already edited
          const existingIndex = prev.findIndex(
            (e) => e.page_number === currentPage && e.line_index === lineIndex,
          );
          if (existingIndex >= 0) {
            // Update existing edit
            const updated = [...prev];
            updated[existingIndex] = {
              ...updated[existingIndex],
              new_text: newText,
            };
            return updated;
          }
          // Add new edit
          return [
            ...prev,
            {
              page_number: currentPage,
              line_index: lineIndex,
              original_text: originalText,
              new_text: newText,
            },
          ];
        });
      }

      updatedResults.pages[pageIndex].lines[lineIndex].text = newText;
      setOcrResults(updatedResults);
    }
  };

  const handleExportDocument = async (format: "pdf" | "json" | "both") => {
    if (!ocrResults) {
      throw new Error("OCR 결과가 아직 준비되지 않았습니다.");
    }

    setIsExporting(true);
    try {
      // If only JSON, download directly without calling export API
      if (format === "json") {
        const jsonPath = getJSONDownloadUrl(jobId);
        triggerDownload(jsonPath, `${jobId}_ocr.json`);
        return;
      }

      // For PDF or both, call export API
      const response = await exportDocument(jobId, {
        ocr_results: ocrResults,
        smart_layers: smartLayers,
      });

      if ((format === "pdf" || format === "both") && response.pdf_url) {
        triggerDownload(response.pdf_url);
      }

      if (format === "both") {
        // Add slight delay for sequential downloads to avoid browser blocking
        await new Promise((resolve) => setTimeout(resolve, 100));
        const jsonPath = response.json_url || getJSONDownloadUrl(jobId);
        triggerDownload(jsonPath, `${jobId}_ocr.json`);
      }
    } catch (error) {
      console.error("Export failed:", error);
      throw error;
    } finally {
      setIsExporting(false);
    }
  };

  const handleTextAdd = (element: TextElement) => {
    setTextElements((prev) => [...prev, element]);
  };

  const handleElementUpdate = (id: string, updates: Partial<TextElement>) => {
    setTextElements((prev) =>
      prev.map((el) => (el.id === id ? { ...el, ...updates } : el)),
    );
  };

  const handleElementDelete = (id: string) => {
    setTextElements((prev) => prev.filter((el) => el.id !== id));
  };

  const handleToolClick = (tool: ToolType) => {
    setActiveTool(activeTool === tool ? null : tool);

    // Tool-specific actions
    switch (tool) {
      case "text":
        // Text editor is activated via activeTool state
        break;
      case "image":
        // 이미지 업로드 다이얼로그
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.onchange = (e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (file) {
            console.log("이미지 추가:", file.name);
            // TODO: 이미지를 PDF에 추가하는 로직
          }
        };
        input.click();
        break;
      case "signature":
        console.log("서명 추가 모드 활성화");
        break;
      case "draw":
        console.log("그리기 모드 활성화");
        break;
      case "shape":
        console.log("도형 추가 모드 활성화");
        break;
      case "sticker":
        console.log("스티커 추가 모드 활성화");
        break;
      case "highlight":
        console.log("하이라이트 모드 활성화");
        break;
      case "select":
        console.log("영역 선택 모드 활성화");
        break;
      case "rotate":
        // 페이지 회전 즉시 실행
        console.log("현재 페이지 90도 회전");
        alert("페이지 회전 기능은 준비 중입니다");
        break;
      case "structure":
        console.log("구조 편집 모드 활성화");
        break;
    }
  };

  const handleZoomIn = () => {
    setFitToWidth(false); // Disable fit-to-width when manually zooming
    setZoom((prev) => Math.min(200, prev + 25));
  };

  const handleZoomOut = () => {
    setFitToWidth(false); // Disable fit-to-width when manually zooming
    setZoom((prev) => Math.max(25, prev - 25));
  };

  const handleFitToWidth = () => {
    setFitToWidth((prev) => !prev);
  };

  // Debug: Log page and PDF state changes
  useEffect(() => {
    console.log(
      `[Editor] State: currentPage=${currentPage}, totalPdfPages=${totalPdfPages}, ocrPages=${ocrResults?.pages?.length || 0}`,
    );
  }, [currentPage, totalPdfPages, ocrResults]);

  // PDF document reference for lazy thumbnail generation
  const pdfDocRef = useRef<any>(null);
  const thumbnailObserverRef = useRef<IntersectionObserver | null>(null);
  const thumbnailElementsRef = useRef<Map<number, HTMLDivElement>>(new Map());

  // Initialize PDF document for thumbnails (don't generate all at once)
  useEffect(() => {
    if (!pdfUrl) return;

    let cancelled = false;

    const initPdfDoc = async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

        const loadingTask = pdfjsLib.getDocument({
          url: pdfUrl,
          disableAutoFetch: true,
          disableStream: false,
        });
        const pdfDoc = await loadingTask.promise;

        if (cancelled) return;

        pdfDocRef.current = pdfDoc;

        // Use OCR page count if available
        const actualPageCount = ocrResults?.page_count || pdfDoc.numPages;
        console.log(
          `[Editor] PDF pages: ${pdfDoc.numPages}, OCR pages: ${ocrResults?.page_count || "N/A"}, using: ${actualPageCount}`,
        );
        setTotalPdfPages(actualPageCount);

        // Generate only the first page thumbnail immediately
        if (pdfDoc.numPages > 0) {
          generateThumbnail(1, pdfDoc);
        }
      } catch (error) {
        console.error("Failed to init PDF for thumbnails:", error);
      }
    };

    initPdfDoc();

    return () => {
      cancelled = true;
    };
  }, [pdfUrl]);

  // Generate a single thumbnail
  const generateThumbnail = useCallback(
    async (pageNum: number, pdfDoc?: any) => {
      const doc = pdfDoc || pdfDocRef.current;
      if (!doc || pageThumbnails[pageNum]) return;

      try {
        const page = await doc.getPage(pageNum);
        const viewport = page.getViewport({ scale: 0.15, dontFlip: false }); // Very small scale for fast thumbnails

        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d")!;
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({
          canvasContext: context,
          viewport: viewport,
        }).promise;

        setPageThumbnails((prev) => ({
          ...prev,
          [pageNum]: canvas.toDataURL("image/jpeg", 0.6), // JPEG with compression for smaller size
        }));
      } catch (error) {
        console.error(
          `Failed to generate thumbnail for page ${pageNum}:`,
          error,
        );
      }
    },
    [pageThumbnails],
  );

  // Setup Intersection Observer for lazy loading thumbnails
  useEffect(() => {
    if (thumbnailObserverRef.current) {
      thumbnailObserverRef.current.disconnect();
    }

    thumbnailObserverRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const pageNum = parseInt(
              entry.target.getAttribute("data-page") || "0",
            );
            if (pageNum > 0 && !pageThumbnails[pageNum]) {
              generateThumbnail(pageNum);
            }
          }
        });
      },
      {
        root: null,
        rootMargin: "100px", // Load slightly before visible
        threshold: 0.1,
      },
    );

    // Observe all thumbnail elements
    thumbnailElementsRef.current.forEach((element) => {
      thumbnailObserverRef.current?.observe(element);
    });

    return () => {
      thumbnailObserverRef.current?.disconnect();
    };
  }, [generateThumbnail, pageThumbnails]);

  // Register thumbnail element for observation
  const registerThumbnailRef = useCallback(
    (pageNum: number, element: HTMLDivElement | null) => {
      if (element) {
        thumbnailElementsRef.current.set(pageNum, element);
        thumbnailObserverRef.current?.observe(element);
      } else {
        thumbnailElementsRef.current.delete(pageNum);
      }
    },
    [],
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background-light dark:bg-background-dark">
        <div className="flex flex-col items-center gap-2">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
          <p className="text-text-primary-light dark:text-text-primary-dark text-lg">
            문서 로딩 중...
          </p>
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background-light dark:bg-background-dark">
        <div className="text-center">
          <p className="text-text-primary-light dark:text-text-primary-dark text-xl mb-4">
            작업을 찾을 수 없습니다
          </p>
          <button
            onClick={() => router.push("/")}
            className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary/90"
          >
            대시보드로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  if (job.status === "processing") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background-light dark:bg-background-dark">
        <div className="flex flex-col items-center gap-4 max-w-md">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
          <p className="text-text-primary-light dark:text-text-primary-dark text-xl font-semibold">
            OCR 처리 중...
          </p>
          {job.sub_stage && (
            <p className="text-text-secondary-light dark:text-text-secondary-dark text-sm">
              {job.sub_stage}
            </p>
          )}
          {job.current_page && job.total_pages ? (
            <p className="text-text-secondary-light dark:text-text-secondary-dark text-sm">
              페이지 {job.current_page} / {job.total_pages}
            </p>
          ) : null}
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mt-2">
            <div
              className="bg-primary h-2 rounded-full transition-all duration-300"
              style={{ width: `${job.progress_percent || 0}%` }}
            ></div>
          </div>
          <p className="text-text-secondary-light dark:text-text-secondary-dark text-xs">
            {Math.round(job.progress_percent || 0)}% 완료
          </p>
        </div>
      </div>
    );
  }

  if (job.status === "failed") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background-light dark:bg-background-dark">
        <div className="text-center">
          <p className="text-text-primary-light dark:text-text-primary-dark text-xl mb-4">
            OCR 처리 실패
          </p>
          <p className="text-text-secondary-light dark:text-text-secondary-dark text-sm mb-4">
            {job.message || "알 수 없는 오류가 발생했습니다"}
          </p>
          <button
            onClick={() => router.push("/")}
            className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary/90"
          >
            대시보드로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  if (job.status === "completed" && !ocrResults && ocrLoadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background-light dark:bg-background-dark">
        <div className="max-w-lg rounded-2xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark p-8 text-center shadow-sm">
          <p className="mb-3 text-xl font-semibold text-text-primary-light dark:text-text-primary-dark">
            OCR 결과를 열 수 없습니다
          </p>
          <p className="mb-6 text-sm text-text-secondary-light dark:text-text-secondary-dark">
            {ocrLoadError}
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => router.push("/jobs")}
              className="rounded-lg bg-primary px-5 py-2 text-white hover:bg-primary/90"
            >
              작업 목록으로 이동
            </button>
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg border border-border-light px-5 py-2 text-text-primary-light hover:bg-black/5 dark:border-border-dark dark:text-text-primary-dark dark:hover:bg-white/10"
            >
              다시 시도
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Show editor for queued and completed status
  const hasOCRResults = job.status === "completed" && ocrResults;

  return (
    <>
      <div className="flex h-screen w-full flex-col bg-background-light dark:bg-background-dark">
        {/* Header */}
        <header className="flex h-16 w-full flex-shrink-0 items-center justify-between border-b border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark px-4 sm:px-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/")}
              className="flex items-center gap-2 text-primary hover:opacity-80 transition-opacity"
            >
              <span className="material-symbols-outlined text-3xl">
                document_scanner
              </span>
              <h1 className="text-lg font-bold text-text-primary-light dark:text-text-primary-dark">
                AI Doc Intelligence
              </h1>
            </button>
            <div className="hidden md:flex items-center gap-2 max-w-xs">
              <span className="material-symbols-outlined text-text-secondary-light dark:text-text-secondary-dark flex-shrink-0">
                description
              </span>
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark truncate leading-tight" title={job?.filename || jobId}>
                  {job?.filename || `${jobId.substring(0, 12)}...`}
                </span>
                {hasOCRResults && (
                  <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark leading-tight">
                    {currentPage} / {totalPdfPages || ocrResults?.page_count || "?"} 페이지
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-1 items-center justify-end gap-3 sm:gap-4">
            <div className="hidden lg:flex items-center gap-2 text-sm text-text-secondary-light dark:text-text-secondary-dark">
              {saveStatus === "saved" && (
                <>
                  <span className="material-symbols-outlined text-base text-green-500">
                    cloud_done
                  </span>
                  <span className="text-green-600 dark:text-green-400">
                    저장됨
                  </span>
                </>
              )}
              {saveStatus === "saving" && (
                <>
                  <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                  <span className="text-primary">저장 중...</span>
                </>
              )}
              {saveStatus === "unsaved" && (
                <>
                  <span className="material-symbols-outlined text-base text-orange-500">
                    edit
                  </span>
                  <span className="text-orange-600 dark:text-orange-400">
                    편집 중
                  </span>
                </>
              )}
              {saveStatus === "error" && (
                <>
                  <span className="material-symbols-outlined text-base text-red-500">
                    error
                  </span>
                  <span className="text-red-600 dark:text-red-400">
                    저장 실패
                  </span>
                </>
              )}
            </div>
            {/* <div className="flex items-center gap-1 sm:gap-2">
              <button className="group flex h-9 w-9 cursor-pointer items-center justify-center overflow-hidden rounded-lg bg-transparent text-text-secondary-light dark:text-text-secondary-dark hover:bg-black/5 dark:hover:bg-white/10 relative">
                <span className="material-symbols-outlined text-xl">undo</span>
                <span className="absolute bottom-[-24px] group-hover:bottom-1.5 transition-all duration-200 text-xs bg-gray-700 text-white px-1.5 py-0.5 rounded-sm whitespace-nowrap">
                  Ctrl+Z
                </span>
              </button>
              <button className="group flex h-9 w-9 cursor-pointer items-center justify-center overflow-hidden rounded-lg bg-transparent text-text-secondary-light dark:text-text-secondary-dark hover:bg-black/5 dark:hover:bg-white/10 relative">
                <span className="material-symbols-outlined text-xl">redo</span>
                <span className="absolute bottom-[-24px] group-hover:bottom-1.5 transition-all duration-200 text-xs bg-gray-700 text-white px-1.5 py-0.5 rounded-sm whitespace-nowrap">
                  Ctrl+Y
                </span>
              </button>
            </div> */}
            <div className="h-6 w-px bg-border-light dark:bg-border-dark"></div>
            <ThemeToggle />
            <div className="h-6 w-px bg-border-light dark:bg-border-dark"></div>
            <div className="flex items-center gap-1 sm:gap-2">
              <button
                onClick={async () => {
                  if (!confirm('OCR을 다시 처리하시겠습니까?\n기존 결과가 초기화됩니다.')) return
                  try {
                    await processJob(jobId)
                    setIsProcessingOCR(true)
                    setShowProgressOverlay(true)
                    setOcrProgress(0)
                    setOcrCurrentPage(0)
                    setOcrStage('OCR 재처리 시작...')
                  } catch (e) {
                    alert('재처리 요청에 실패했습니다.')
                  }
                }}
                disabled={isProcessingOCR}
                className="flex h-9 cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-lg bg-transparent px-3 text-sm font-medium text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-950/30 disabled:opacity-50 disabled:cursor-not-allowed"
                title="OCR 재처리"
              >
                <span className="material-symbols-outlined text-xl">refresh</span>
                <span className="hidden sm:inline">재처리</span>
              </button>
              <button
                onClick={() => setShowDataViewer(true)}
                disabled={!ocrResults}
                className="flex h-9 cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-lg bg-transparent px-3 text-sm font-medium text-text-secondary-light dark:text-text-secondary-dark hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-xl">
                  data_object
                </span>
                <span className="hidden sm:inline">데이터</span>
              </button>
              {/* <button className="flex h-9 cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-lg bg-transparent px-3 text-sm font-medium text-text-secondary-light dark:text-text-secondary-dark hover:bg-black/5 dark:hover:bg-white/10">
                <span className="material-symbols-outlined text-xl">share</span>
                <span className="hidden sm:inline">공유</span>
              </button> */}
              <button
                onClick={() => setShowExportModal(true)}
                className="flex h-9 cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-lg bg-primary px-3 text-sm font-bold text-white hover:bg-primary/90"
              >
                <span className="material-symbols-outlined text-xl">
                  file_download
                </span>
                <span className="hidden sm:inline">내보내기</span>
              </button>
            </div>
            <div className="h-6 w-px bg-border-light dark:bg-border-dark"></div>
            <div className="bg-primary rounded-full size-9 flex items-center justify-center text-white font-semibold text-sm">
              U
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex flex-1 w-full overflow-hidden">
          <div className="flex w-full h-full">
            {/* Session Sidebar - Left */}
            <SessionSidebar
              currentJobId={jobId}
              onDocumentSelect={(newJobId) =>
                router.push(`/editor/${newJobId}`)
              }
            />

            {/* Page Thumbnails Sidebar */}
            <aside
              className={`flex h-full flex-shrink-0 flex-col justify-between border-r border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark overflow-y-auto transition-all duration-300 ${previewCollapsed ? "w-10 p-0" : "w-64 p-4"}`}
            >
              {previewCollapsed ? (
                <div className="flex flex-col items-center pt-3 gap-2">
                  <button
                    onClick={() => setPreviewCollapsed(false)}
                    className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-text-secondary-light dark:text-text-secondary-dark"
                    title="미리보기 펼치기"
                  >
                    <span className="material-symbols-outlined text-xl">
                      chevron_right
                    </span>
                  </button>
                  <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark [writing-mode:vertical-rl] mt-2 select-none">
                    미리보기
                  </span>
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-base font-medium text-text-primary-light dark:text-text-primary-dark">
                          페이지 미리보기
                        </h2>
                        <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
                          드래그하여 페이지 순서 변경
                        </p>
                      </div>
                      <button
                        onClick={() => setPreviewCollapsed(true)}
                        className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-text-secondary-light dark:text-text-secondary-dark flex-shrink-0"
                        title="미리보기 접기"
                      >
                        <span className="material-symbols-outlined text-xl">
                          chevron_left
                        </span>
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {(() => {
                        // Determine page list to show
                        const pageList = ocrResults?.pages
                          ? ocrResults.pages.map((p) => p.page_number)
                          : totalPdfPages > 0
                            ? Array.from(
                                { length: totalPdfPages },
                                (_, i) => i + 1,
                              )
                            : [1];

                        return pageList.map((pageNum) => (
                          <div
                            key={pageNum}
                            ref={(el) => registerThumbnailRef(pageNum, el)}
                            data-page={pageNum}
                            onClick={() => setCurrentPage(pageNum)}
                            className="group relative flex flex-col gap-2 cursor-pointer"
                          >
                            <div
                              className={`w-full rounded-lg bg-gray-200 dark:bg-gray-700 aspect-[3/4] flex items-center justify-center overflow-hidden transition-all ${
                                currentPage === pageNum
                                  ? "ring-2 ring-primary shadow-lg"
                                  : "hover:ring-1 hover:ring-primary/50"
                              }`}
                            >
                              {pageThumbnails[pageNum] ? (
                                <img
                                  src={pageThumbnails[pageNum]}
                                  alt={`Page ${pageNum}`}
                                  className="w-full h-full object-contain"
                                  loading="lazy"
                                />
                              ) : (
                                <div className="flex flex-col items-center gap-1">
                                  <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                                  <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                                    {pageNum}
                                  </span>
                                </div>
                              )}
                            </div>
                            <p
                              className={`text-sm font-medium text-center ${
                                currentPage === pageNum
                                  ? "text-primary"
                                  : "text-text-primary-light dark:text-text-primary-dark"
                              }`}
                            >
                              {pageNum}
                            </p>
                            {ocrResults?.pages && (
                              <div className="absolute top-1 right-1 hidden group-hover:flex gap-1">
                                <button className="flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70">
                                  <span className="material-symbols-outlined text-sm">
                                    rotate_90_degrees_ccw
                                  </span>
                                </button>
                                <button className="flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white hover:bg-red-500">
                                  <span className="material-symbols-outlined text-sm">
                                    delete
                                  </span>
                                </button>
                              </div>
                            )}
                          </div>
                        ));
                      })()}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <button className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-lg bg-primary/20 text-sm font-bold text-primary hover:bg-primary/30">
                      <span className="material-symbols-outlined">add</span>
                      <span className="truncate">페이지 추가</span>
                    </button>
                    <button className="flex h-10 w-full items-center justify-center gap-2 rounded-lg text-sm font-medium text-text-secondary-light dark:text-text-secondary-dark hover:bg-black/5 dark:hover:bg-white/10">
                      <span className="material-symbols-outlined">map</span>
                      <span>페이지 맵</span>
                    </button>
                  </div>
                </>
              )}
            </aside>

            {/* Center - PDF Viewer */}
            <section className="flex flex-1 flex-col bg-background-light dark:bg-background-dark overflow-hidden">
              <div className="flex flex-shrink-0 items-center justify-between border-b border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark px-4 py-1.5">
                <div className="flex items-center gap-1 min-w-[180px]">
                  <button
                    onClick={handleFitToWidth}
                    className={`p-2 rounded-lg transition-colors ${
                      fitToWidth
                        ? "bg-primary/10 text-primary"
                        : "text-text-secondary-light dark:text-text-secondary-dark hover:bg-black/5 dark:hover:bg-white/10"
                    }`}
                    title="너비에 맞춤"
                  >
                    <span className="material-symbols-outlined">fit_width</span>
                  </button>
                  <button
                    onClick={handleZoomIn}
                    className="p-2 rounded-lg text-text-secondary-light dark:text-text-secondary-dark hover:bg-black/5 dark:hover:bg-white/10"
                  >
                    <span className="material-symbols-outlined">zoom_in</span>
                  </button>
                  <span className="text-sm font-medium w-16 text-center text-text-primary-light dark:text-text-primary-dark">
                    {zoom}%
                  </span>
                  <button
                    onClick={handleZoomOut}
                    className="p-2 rounded-lg text-text-secondary-light dark:text-text-secondary-dark hover:bg-black/5 dark:hover:bg-white/10"
                  >
                    <span className="material-symbols-outlined">zoom_out</span>
                  </button>
                </div>
                <div className="flex items-center gap-1 min-w-[120px] justify-center">
                  <button
                    onClick={() => {
                      const newPage = Math.max(1, currentPage - 1);
                      console.log(
                        `[Editor] Page navigation: ${currentPage} → ${newPage} (previous)`,
                      );
                      setCurrentPage(newPage);
                    }}
                    className="p-2 rounded-lg text-text-secondary-light dark:text-text-secondary-dark hover:bg-black/5 dark:hover:bg-white/10"
                  >
                    <span className="material-symbols-outlined">
                      keyboard_arrow_up
                    </span>
                  </button>
                  <div className="flex items-center">
                    <input
                      className="w-8 h-7 text-center border-0 bg-transparent text-sm text-text-primary-light dark:text-text-primary-dark"
                      type="text"
                      value={currentPage}
                      readOnly
                    />
                    <span className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
                      / {ocrResults?.page_count || totalPdfPages || 1}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      const maxPage =
                        ocrResults?.page_count || totalPdfPages || 1;
                      const newPage = Math.min(maxPage, currentPage + 1);
                      console.log(
                        `[Editor] Page navigation: ${currentPage} → ${newPage} (next, max=${maxPage})`,
                      );
                      setCurrentPage(newPage);
                    }}
                    className="p-2 rounded-lg text-text-secondary-light dark:text-text-secondary-dark hover:bg-black/5 dark:hover:bg-white/10"
                  >
                    <span className="material-symbols-outlined">
                      keyboard_arrow_down
                    </span>
                  </button>
                </div>
                <div className="flex items-center gap-2 min-w-[300px] justify-end">
                  <button
                    onClick={() => setShowSmartTools(!showSmartTools)}
                    className={`flex items-center gap-2 p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 whitespace-nowrap ${
                      showSmartTools
                        ? "bg-primary/10 text-primary"
                        : "text-text-secondary-light dark:text-text-secondary-dark"
                    }`}
                    title="Smart Tools"
                  >
                    <span className="material-symbols-outlined">build</span>
                    <span className="text-sm hidden lg:inline">
                      Smart Tools
                    </span>
                  </button>
                  <button
                    onClick={() => setShowOCRComparison(!showOCRComparison)}
                    className={`flex items-center gap-2 p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 whitespace-nowrap ${
                      showOCRComparison
                        ? "bg-primary/10 text-primary"
                        : "text-text-secondary-light dark:text-text-secondary-dark"
                    }`}
                    title="OCR 비교"
                  >
                    <span className="material-symbols-outlined">
                      compare_arrows
                    </span>
                    <span className="text-sm hidden lg:inline">OCR 비교</span>
                  </button>
                  <button
                    onClick={() => setShowTextLayer(!showTextLayer)}
                    className={`flex items-center gap-2 p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 whitespace-nowrap ${
                      showTextLayer
                        ? "bg-primary/10 text-primary"
                        : "text-text-secondary-light dark:text-text-secondary-dark"
                    }`}
                    title="텍스트 레이어"
                  >
                    <span className="material-symbols-outlined">
                      visibility
                    </span>
                    <span className="text-sm hidden lg:inline">
                      텍스트 레이어
                    </span>
                  </button>
                  <button
                    onClick={() => setShowMasking(!showMasking)}
                    className={`flex items-center gap-2 p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 whitespace-nowrap ${
                      showMasking
                        ? "bg-primary/10 text-primary"
                        : "text-text-secondary-light dark:text-text-secondary-dark"
                    }`}
                    title="개인정보 마스킹"
                  >
                    <span className="material-symbols-outlined">gpp_maybe</span>
                    <span className="text-sm hidden lg:inline">개인정보 마스킹</span>
                  </button>
                  <button
                    onClick={() => setShowAccuracy(!showAccuracy)}
                    className={`flex items-center gap-2 p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 whitespace-nowrap ${
                      showAccuracy
                        ? "bg-primary/10 text-primary"
                        : "text-text-secondary-light dark:text-text-secondary-dark"
                    }`}
                    title="정확도 시각화"
                  >
                    <span className="material-symbols-outlined">verified</span>
                    <span className="text-sm hidden lg:inline">
                      정확도 시각화
                    </span>
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-hidden">
                <PDFViewer
                  pdfUrl={pdfUrl}
                  currentPage={currentPage}
                  onPageChange={setCurrentPage}
                  zoom={zoom}
                  fitToWidth={fitToWidth}
                  onZoomChange={setZoom}
                  ocrResults={ocrResults}
                  showTextLayer={showTextLayer}
                  showOCRComparison={showOCRComparison}
                  showAccuracy={showAccuracy}
                  showMasking={showMasking}
                  maskingData={maskingData}
                  highlightedLineIndex={selectedLineIndex}
                  onPageDimensionsChange={(width, height) => {
                    setPageWidth(width);
                    setPageHeight(height);
                  }}
                >
                  <TextEditor
                    isActive={activeTool === "text"}
                    onTextAdd={handleTextAdd}
                    pageWidth={pageWidth}
                    pageHeight={pageHeight}
                    elements={textElements}
                    onElementUpdate={handleElementUpdate}
                    onElementDelete={handleElementDelete}
                  />
                </PDFViewer>
              </div>
            </section>

            {/* Smart Tools Floating Panel */}
            {showSmartTools && (
              <aside className="h-full w-72 flex-shrink-0 flex-col border-l border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark p-4 flex">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
                    Smart Tools
                  </span>
                  <button
                    onClick={() => setShowSmartTools(false)}
                    className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-text-secondary-light dark:text-text-secondary-dark"
                  >
                    <span className="material-symbols-outlined text-xl">
                      close
                    </span>
                  </button>
                </div>
                <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
                  {/* OCR Insertion Button */}
                  {!hasOCRResults && !isProcessingOCR && (
                    <button
                      onClick={handleStartOCR}
                      className="flex items-center justify-center gap-2 p-4 rounded-lg bg-gradient-to-r from-primary to-purple-600 text-white font-semibold hover:opacity-90 transition-opacity"
                    >
                      <span className="material-symbols-outlined">
                        auto_fix_high
                      </span>
                      <span>OCR 텍스트 레이어 삽입</span>
                    </button>
                  )}

                  {isProcessingOCR && (
                    <div className="flex flex-col items-center gap-2 p-4 rounded-lg bg-primary/10 border border-primary">
                      <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                      <p className="text-sm text-primary font-medium">
                        OCR 처리 중...
                      </p>
                      {job?.progress_percent ? (
                        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                          {Math.round(job.progress_percent)}% 완료
                        </p>
                      ) : null}
                    </div>
                  )}

                  {hasOCRResults && (
                    <div className="flex flex-col gap-2 p-4 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-500">
                      <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                        <span className="material-symbols-outlined">
                          check_circle
                        </span>
                        <span className="font-semibold">OCR 완료</span>
                      </div>
                      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                        {ocrResults?.total_bboxes || 0}개의 텍스트 박스 감지됨
                      </p>
                      <button
                        onClick={() => setShowOCRPanel(!showOCRPanel)}
                        className="mt-2 flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-primary text-white text-sm font-medium hover:bg-primary/90"
                      >
                        <span className="material-symbols-outlined text-base">
                          edit_note
                        </span>
                        <span>
                          {showOCRPanel ? "OCR 패널 닫기" : "OCR 텍스트 편집"}
                        </span>
                      </button>
                    </div>
                  )}

                  <div className="h-px bg-border-light dark:border-border-dark"></div>

                  <div className="grid grid-cols-3 gap-3">
                    {[
                      {
                        icon: "edit",
                        label: "텍스트 편집",
                        tool: "text" as ToolType,
                      },
                      {
                        icon: "add_photo_alternate",
                        label: "이미지",
                        tool: "image" as ToolType,
                      },
                      {
                        icon: "signature",
                        label: "서명",
                        tool: "signature" as ToolType,
                      },
                      {
                        icon: "draw",
                        label: "그리기",
                        tool: "draw" as ToolType,
                      },
                      {
                        icon: "shapes",
                        label: "도형",
                        tool: "shape" as ToolType,
                      },
                      {
                        icon: "sticky_note_2",
                        label: "스티커",
                        tool: "sticker" as ToolType,
                      },
                    ].map((tool) => (
                      <button
                        key={tool.icon}
                        onClick={() => handleToolClick(tool.tool)}
                        className={`flex flex-col items-center gap-1.5 p-2 rounded-lg transition-colors ${
                          activeTool === tool.tool
                            ? "bg-primary/20 dark:bg-primary/30"
                            : "hover:bg-black/5 dark:hover:bg-white/10"
                        }`}
                      >
                        <div
                          className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                            activeTool === tool.tool
                              ? "bg-primary text-white"
                              : "bg-primary/10 text-primary"
                          }`}
                        >
                          <span className="material-symbols-outlined">
                            {tool.icon}
                          </span>
                        </div>
                        <span
                          className={`text-xs text-center ${
                            activeTool === tool.tool
                              ? "text-primary font-medium"
                              : "text-text-secondary-light dark:text-text-secondary-dark"
                          }`}
                        >
                          {tool.label}
                        </span>
                      </button>
                    ))}
                  </div>

                  <div className="h-px bg-border-light dark:bg-border-dark"></div>

                  <div className="grid grid-cols-3 gap-3">
                    {[
                      {
                        icon: "format_ink_highlighter",
                        label: "하이라이트",
                        tool: "highlight" as ToolType,
                      },
                      {
                        icon: "select_all",
                        label: "영역 선택",
                        tool: "select" as ToolType,
                      },
                      {
                        icon: "rotate_90_degrees_cw",
                        label: "페이지 회전",
                        tool: "rotate" as ToolType,
                      },
                      {
                        icon: "account_tree",
                        label: "구조 편집",
                        tool: "structure" as ToolType,
                      },
                    ].map((tool) => (
                      <button
                        key={tool.icon}
                        onClick={() => handleToolClick(tool.tool)}
                        className={`flex flex-col items-center gap-1.5 p-2 rounded-lg transition-colors ${
                          activeTool === tool.tool
                            ? "bg-primary/20 dark:bg-primary/30"
                            : "hover:bg-black/5 dark:hover:bg-white/10"
                        }`}
                      >
                        <div
                          className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                            activeTool === tool.tool
                              ? "bg-primary text-white"
                              : "bg-primary/10 text-primary"
                          }`}
                        >
                          <span className="material-symbols-outlined">
                            {tool.icon}
                          </span>
                        </div>
                        <span
                          className={`text-xs text-center ${
                            activeTool === tool.tool
                              ? "text-primary font-medium"
                              : "text-text-secondary-light dark:text-text-secondary-dark"
                          }`}
                        >
                          {tool.label}
                        </span>
                      </button>
                    ))}
                  </div>

                  <div className="h-px bg-border-light dark:bg-border-dark"></div>

                  <div>
                    <h3 className="font-medium mb-3 text-text-primary-light dark:text-text-primary-dark">
                      텍스트 속성
                    </h3>
                    <div className="flex flex-col gap-4">
                      <div className="flex items-center justify-between">
                        <label className="text-sm text-text-primary-light dark:text-text-primary-dark">
                          글꼴
                        </label>
                        <select className="w-40 rounded-md border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark text-sm p-1.5 text-text-primary-light dark:text-text-primary-dark">
                          <option>Noto Sans KR</option>
                          <option>Inter</option>
                          <option>Times New Roman</option>
                        </select>
                      </div>
                      <div className="flex items-center justify-between">
                        <label className="text-sm text-text-primary-light dark:text-text-primary-dark">
                          크기
                        </label>
                        <input
                          className="w-40 rounded-md border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark text-sm p-1.5 text-text-primary-light dark:text-text-primary-dark"
                          type="number"
                          defaultValue="32"
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <label className="text-sm text-text-primary-light dark:text-text-primary-dark">
                          색상
                        </label>
                        <div className="w-40 h-8 rounded-md border border-border-light dark:border-border-dark bg-black"></div>
                      </div>
                    </div>
                  </div>

                  {/* OCR Text Editing Panel */}
                  {showOCRPanel && hasOCRResults && (
                    <>
                      <div className="h-px bg-border-light dark:border-border-dark"></div>
                      <div>
                        <h3 className="font-medium mb-3 text-text-primary-light dark:text-text-primary-dark">
                          OCR 텍스트 편집
                        </h3>
                        <div className="flex flex-col gap-2 max-h-96 overflow-y-auto">
                          {ocrResults?.pages
                            ?.find((p) => p.page_number === currentPage)
                            ?.lines?.map((line, idx) => (
                              <div
                                key={idx}
                                className="flex flex-col gap-1 p-2 rounded-md border border-border-light dark:border-border-dark hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                                onClick={() =>
                                  setSelectedLineIndex(
                                    selectedLineIndex === idx ? null : idx,
                                  )
                                }
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                                    Line {idx + 1}
                                  </span>
                                  <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                                    {((line.confidence || 0) * 100).toFixed(0)}%
                                  </span>
                                </div>
                                {selectedLineIndex === idx ? (
                                  <input
                                    type="text"
                                    value={line.text}
                                    onChange={(e) =>
                                      handleEditOCRText(idx, e.target.value)
                                    }
                                    className="text-sm p-1 border rounded bg-white dark:bg-gray-800 border-border-light dark:border-border-dark text-text-primary-light dark:text-text-primary-dark"
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                ) : (
                                  <p className="text-sm truncate text-text-primary-light dark:text-text-primary-dark">
                                    {line.text}
                                  </p>
                                )}
                              </div>
                            ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </aside>
            )}
          </div>
        </main>
      </div>

      {/* Export Modal */}
      <ExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        jobId={jobId}
        onExport={handleExportDocument}
        isExporting={isExporting}
      />

      {/* Data Viewer Modal */}
      <DataViewer
        isOpen={showDataViewer}
        onClose={() => setShowDataViewer(false)}
        ocrResults={ocrResults}
        jobId={jobId}
      />

      {/* OCR Progress Overlay */}
      <OCRProgressOverlay
        isVisible={showProgressOverlay}
        progress={ocrProgress}
        currentPage={ocrCurrentPage}
        totalPages={ocrTotalPages}
        stage={ocrStage}
        onCancel={handleCloseProgressOverlay}
      />
    </>
  );
}
