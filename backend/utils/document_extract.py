"""
업로드 형식에 따라 Java Tika 서버 / PyMuPDF / 순수 디코딩으로 텍스트를 뽑고,
의미 있는 본문이면 OCR 대신 이 경로를 쓴다.

Java TikaHttpServer(tika-server/)가 실행 중이면 TIKA_JAVA_SERVER_URL 로 호출.
그렇지 않으면 공식 Tika 서버(TIKA_SERVER_URL)로 폴백.
"""
from __future__ import annotations

import json
import logging
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import List, Optional, Tuple

from config import Config

logger = logging.getLogger(__name__)

ALLOWED_UPLOAD_EXTENSIONS = frozenset(
    {
        ".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff",
        ".webp", ".bmp", ".txt", ".hwp", ".hwpx",
        ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    }
)
OFFICE_EXTENSIONS = frozenset({".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"})
IMAGE_EXTENSIONS  = frozenset({".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp", ".bmp"})
HWP_EXTENSIONS    = frozenset({".hwp", ".hwpx"})


def extraction_is_meaningful(text: str, page_count: int) -> bool:
    s = (text or "").strip()
    if len(s) < getattr(Config, "EXTRACTION_MIN_CHARS", 40):
        return False
    compact = "".join(s.split())
    pages = max(1, page_count)
    per = getattr(Config, "EXTRACTION_MIN_CHARS_PER_PAGE", 6)
    return len(compact) >= pages * per


# ---------------------------------------------------------------------------
# Java Tika HTTP 서버 호출 (TikaHttpServer.java — POST /extract)
# ---------------------------------------------------------------------------

def _java_tika_extract(raw_path: Path, ext: str, timeout: int = 300) -> Optional[str]:
    """
    커스텀 Java Tika 서버 (tika-server/)에 파일 경로 + 확장자를 전달해
    추출된 텍스트를 받아온다.

    Java TikaExtractor.extractByExt() 가 실행되므로:
    - HWP: HwpV5Parser 직접 사용
    - HWPX: AutoDetect + extractSection0 + cleanPlainText
    - PDF: PDFParserConfig (sortByPosition, extractAnnotations, NO_OCR)
    - Office: OfficeParserConfig
    """
    base = getattr(Config, "TIKA_JAVA_SERVER_URL", "").strip().rstrip("/")
    if not base:
        return None

    url = f"{base}/extract"
    body = json.dumps({"filePath": str(raw_path.resolve()), "ext": ext}).encode("utf-8")

    try:
        req = urllib.request.Request(url, data=body, method="POST")
        req.add_header("Content-Type", "application/json; charset=UTF-8")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace")
        logger.warning("Java Tika 추출 실패 [HTTP %s]: %s", exc.code, error_body)
        return None
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        logger.warning("Java Tika 서버 연결 실패 (%s): %s", url, exc)
        return None


# ---------------------------------------------------------------------------
# 공식 Tika 서버 폴백 (PUT /tika — 파일 바이트 전송)
# ---------------------------------------------------------------------------

def _tika_extract(raw_path: Path, timeout: int = 300) -> Optional[str]:
    """공식 Apache Tika 서버 호출 (TIKA_SERVER_URL 설정 시 폴백으로 사용)."""
    base = (Config.TIKA_SERVER_URL or "").strip().rstrip("/")
    if not base:
        return None
    url = f"{base}/tika"
    try:
        data = raw_path.read_bytes()
        req = urllib.request.Request(url, data=data, method="PUT")
        req.add_header("Accept", "text/plain; charset=UTF-8")
        req.add_header("Content-Type", "application/octet-stream")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except (urllib.error.HTTPError, urllib.error.URLError, OSError, TimeoutError) as exc:
        logger.warning("Tika 요청 실패 (%s): %s", url, exc)
        return None


def _extract_text(raw_path: Path, ext: str) -> Optional[str]:
    """Java 서버 우선, 없으면 공식 Tika 서버로 폴백."""
    # Tika(Java/공식) 호출 비활성화 — Office/HWP 등은 LibreOffice→PDF→OCR 등 다른 경로 사용.
    # text = _java_tika_extract(raw_path, ext)
    # if text is not None:
    #     return text
    # return _tika_extract(raw_path)
    return None


# ---------------------------------------------------------------------------
# PyMuPDF 텍스트 레이어 추출 (PDF 전용)
# ---------------------------------------------------------------------------

def _pdf_pages_text_pymupdf(raw_path: Path) -> List[str]:
    try:
        import fitz
    except ImportError:
        return []
    doc = fitz.open(str(raw_path))
    try:
        return [doc[i].get_text("text") or "" for i in range(len(doc))]
    finally:
        doc.close()


def _read_plain_txt(raw_path: Path) -> str:
    raw = raw_path.read_bytes()
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return raw.decode("utf-8", errors="replace")


# ---------------------------------------------------------------------------
# 메인 진입점
# ---------------------------------------------------------------------------

def try_extract_pages_skip_ocr(
    raw_path: Path, orig_ext: str
) -> Tuple[Optional[List[str]], str]:
    """
    OCR 생략 가능 시 페이지별 문자열 리스트, 아니면 (None, 이유).

    우선순위:
    1) Java Tika 서버 (TIKA_JAVA_SERVER_URL) — 임베디드 Tika 100% 활용
    2) PyMuPDF 텍스트 레이어 (PDF 전용, Java 서버 없어도 동작)
    3) 공식 Tika 서버 (TIKA_SERVER_URL) 폴백
    """
    ext = (orig_ext or "").lower()
    if not raw_path.is_file():
        return None, "missing_raw"

    # ── 순수 텍스트 ──────────────────────────────────────────────────────────
    if ext == ".txt":
        t = _read_plain_txt(raw_path).strip()
        return [t if t else "(빈 텍스트 파일)"], "plaintext"

    # ── HWP (Java: HwpV5Parser) ───────────────────────────────────────────
    if ext == ".hwp":
        t = _extract_text(raw_path, ext)
        if t and extraction_is_meaningful(t, 1):
            return [t], "tika_hwp"
        return None, "hwp_fallback_ocr"

    # ── HWPX (Java: AutoDetect + extractSection0 + cleanPlainText) ────────
    if ext == ".hwpx":
        t = _extract_text(raw_path, ext)
        if t and extraction_is_meaningful(t, 1):
            return [t], "tika_hwpx"
        return None, "hwpx_fallback_ocr"

    # ── Office 계열 (Java: OfficeParserConfig) ────────────────────────────
    if ext in OFFICE_EXTENSIONS:
        t = _extract_text(raw_path, ext)
        if t and extraction_is_meaningful(t, 1):
            return [t], "tika_office"
        return None, "office_needs_tika"

    # ── PDF (Java: PDFParserConfig + PyMuPDF 선행) ────────────────────────
    if ext == ".pdf":
        # 1단계: PyMuPDF (빠름, Java 서버 불필요)
        page_texts = _pdf_pages_text_pymupdf(raw_path)
        full = "\n".join(page_texts)
        pc = max(1, len(page_texts))
        if page_texts and extraction_is_meaningful(full, pc):
            logger.info("PDF 텍스트 레이어 추출로 OCR 생략 (PyMuPDF, %s페이지)", len(page_texts))
            return page_texts, "pymupdf_text_layer"

        # 2단계: Java Tika (PDFParserConfig.sortByPosition 등 적용)
        t = _extract_text(raw_path, ext)
        if t and extraction_is_meaningful(t, pc):
            logger.info("PDF Java Tika 추출로 OCR 생략")
            return [t], "tika_pdf"

        return None, "pdf_scan_ocr"

    # ── 이미지 ────────────────────────────────────────────────────────────
    if ext in IMAGE_EXTENSIONS:
        t = _extract_text(raw_path, ext)
        if t and extraction_is_meaningful(t, 1):
            return [t], "tika_image"
        return None, "image_ocr"

    return None, "unknown_extension_ocr"


def detect_pdf_type(raw_path: Path) -> dict:
    """
    PDF 페이지별 텍스트/스캔 여부를 감지한다.

    Returns dict with keys:
        total_pages, text_pages, scan_pages, text_ratio (0.0~1.0),
        page_types (list of "text" | "scan")
    """
    try:
        import fitz
    except ImportError:
        return {"total_pages": 0, "text_pages": 0, "scan_pages": 0,
                "text_ratio": 0.0, "page_types": []}

    min_chars = getattr(Config, "FITZ_TEXT_MIN_CHARS_PER_PAGE", 20)
    doc = fitz.open(str(raw_path))
    try:
        total = len(doc)
        page_types: List[str] = []
        for i in range(total):
            compact = "".join((doc[i].get_text("text") or "").split())
            _has_image = bool(doc[i].get_images())
            page_types.append("text" if (len(compact) >= min_chars and not _has_image) else "scan")
    finally:
        doc.close()

    text_count = page_types.count("text")
    return {
        "total_pages": total,
        "text_pages": text_count,
        "scan_pages": total - text_count,
        "text_ratio": text_count / total if total > 0 else 0.0,
        "page_types": page_types,
    }


def describe_office_failure() -> str:
    return (
        "Office 문서는 Java Tika 서버가 필요합니다. "
        "tika-server/ 를 빌드하고 start.sh 로 실행하거나 "
        "TIKA_JAVA_SERVER_URL 환경 변수를 설정하세요."
    )
