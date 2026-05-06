"""
독립적인 Tika 트랙.

- 기존 OCR 파이프라인(좌표/마스킹용)은 그대로 유지한다.
- 별도로 PDF 페이지별 '텍스트 레이어 존재 여부'를 확인하고,
  텍스트 레이어가 있는 페이지만 Tika로 텍스트를 추출해 저장한다.

결과는 data/processed/{job_id}_tika_pages.json 로 저장된다.
"""

from __future__ import annotations

import json
import logging
import tempfile
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

from config import Config

logger = logging.getLogger(__name__)


@dataclass
class TikaPageResult:
    page_number: int
    has_text_layer: bool
    tika_text: Optional[str]
    skipped_reason: Optional[str] = None


def _java_tika_extract_by_path(file_path: Path, ext: str, timeout: int = 120) -> Optional[str]:
    """
    프로젝트의 커스텀 Java Tika Extract Server (POST /extract)를 호출한다.
    환경 변수/Config: TIKA_JAVA_SERVER_URL 필요.
    """
    base = getattr(Config, "TIKA_JAVA_SERVER_URL", "").strip().rstrip("/")
    if not base:
        return None

    url = f"{base}/extract"
    body = json.dumps({"filePath": str(file_path.resolve()), "ext": ext}).encode("utf-8")
    try:
        req = urllib.request.Request(url, data=body, method="POST")
        req.add_header("Content-Type", "application/json; charset=UTF-8")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace")
        logger.warning("TikaTrack Java 추출 실패 [HTTP %s]: %s", exc.code, error_body)
        return None
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        logger.warning("TikaTrack Java 서버 연결 실패 (%s): %s", url, exc)
        return None


def _page_has_text_layer_pymupdf(pdf_path: Path, page_index0: int) -> bool:
    try:
        import fitz  # PyMuPDF
    except ImportError:
        return False
    doc = fitz.open(str(pdf_path))
    try:
        if page_index0 < 0 or page_index0 >= len(doc):
            return False
        page = doc[page_index0]
        # 텍스트 레이어가 있으면 일정 길이 이상의 text가 나온다.
        t = (page.get_text("text") or "").strip()
        return len(t) > 0
    finally:
        doc.close()


def _split_pdf_single_page(pdf_path: Path, page_index0: int, out_pdf: Path) -> None:
    import fitz  # type: ignore

    src = fitz.open(str(pdf_path))
    try:
        dst = fitz.open()
        try:
            dst.insert_pdf(src, from_page=page_index0, to_page=page_index0)
            out_pdf.parent.mkdir(parents=True, exist_ok=True)
            dst.save(str(out_pdf))
        finally:
            dst.close()
    finally:
        src.close()


def run_tika_track_for_pdf(job_id: str, pdf_path: Path) -> Dict[str, Any]:
    """
    PDF에 대해 페이지별 텍스트레이어 확인 후, 텍스트가 있는 페이지만 Tika 추출.
    """
    pdf_path = Path(pdf_path)
    result: Dict[str, Any] = {
        "job_id": job_id,
        "pdf_path": str(pdf_path),
        "tika_java_server_url": getattr(Config, "TIKA_JAVA_SERVER_URL", ""),
        "pages": [],
        "combined_text": "",
        "skipped": False,
        "skip_reason": None,
    }

    if not pdf_path.is_file():
        result["skipped"] = True
        result["skip_reason"] = "missing_pdf"
        return result

    # PyMuPDF 없으면 텍스트 레이어 판별 자체가 불가 → Tika 트랙 스킵
    try:
        import fitz  # noqa: F401
    except ImportError:
        result["skipped"] = True
        result["skip_reason"] = "pymupdf_missing"
        return result

    tika_base = getattr(Config, "TIKA_JAVA_SERVER_URL", "").strip()
    tika_enabled = bool(tika_base)
    if not tika_enabled:
        # 페이지별 text-layer 판별은 가능하므로, 페이지 row는 저장하되 텍스트 추출만 생략한다.
        result["skipped"] = True
        result["skip_reason"] = "tika_java_server_url_missing"

    import fitz  # type: ignore

    doc = fitz.open(str(pdf_path))
    try:
        page_count = len(doc)
    finally:
        doc.close()

    pages: List[TikaPageResult] = []
    combined: List[str] = []

    with tempfile.TemporaryDirectory(prefix=f"tika_track_{job_id}_") as tmp:
        tmp_dir = Path(tmp)
        for i0 in range(page_count):
            has_text = _page_has_text_layer_pymupdf(pdf_path, i0)
            if not has_text:
                pages.append(TikaPageResult(page_number=i0 + 1, has_text_layer=False, tika_text=None, skipped_reason="no_text_layer"))
                continue

            if not tika_enabled:
                pages.append(
                    TikaPageResult(
                        page_number=i0 + 1,
                        has_text_layer=True,
                        tika_text=None,
                        skipped_reason="tika_server_missing",
                    )
                )
                continue

            one_pdf = tmp_dir / f"page_{i0+1}.pdf"
            try:
                _split_pdf_single_page(pdf_path, i0, one_pdf)
            except Exception as exc:
                pages.append(
                    TikaPageResult(
                        page_number=i0 + 1,
                        has_text_layer=True,
                        tika_text=None,
                        skipped_reason=f"split_failed:{type(exc).__name__}",
                    )
                )
                continue

            t = _java_tika_extract_by_path(one_pdf, ".pdf", timeout=120)
            if t is None:
                pages.append(
                    TikaPageResult(
                        page_number=i0 + 1,
                        has_text_layer=True,
                        tika_text=None,
                        skipped_reason="tika_failed",
                    )
                )
                continue
            pages.append(TikaPageResult(page_number=i0 + 1, has_text_layer=True, tika_text=t))
            combined.append(t)

    result["pages"] = [
        {
            "page_number": p.page_number,
            "has_text_layer": p.has_text_layer,
            "tika_text": p.tika_text,
            "skipped_reason": p.skipped_reason,
        }
        for p in pages
    ]
    result["combined_text"] = "\n\n".join([s.strip() for s in combined if (s or "").strip()])
    return result


def save_tika_track_result(job_id: str, tika_result: Dict[str, Any]) -> Path:
    out = Config.PROCESSED_DIR / f"{job_id}_tika_pages.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(tika_result, ensure_ascii=False, indent=2), encoding="utf-8")
    return out


def persist_tika_track_to_db(job_id: str, tika_result: Dict[str, Any]) -> int:
    """
    Tika 결과를 DB에 저장한다.
    - `tika_page_texts`: 페이지별 결과를 페이지당 1행으로 저장
    기존 데이터는 job_id 기준으로 삭제 후 재삽입한다. (재실행/재처리 대비)
    """
    import uuid
    from database import SessionLocal, TikaRun, TikaRunPage

    pages = tika_result.get("pages") or []
    db = SessionLocal()
    try:
        run_id = str(uuid.uuid4())
        run = TikaRun(
            run_id=run_id,
            job_id=job_id,
            source_pdf_path=tika_result.get("pdf_path"),
            tika_server_url=tika_result.get("tika_java_server_url"),
            page_count=len(pages),
            combined_text=tika_result.get("combined_text"),
            status="skipped" if tika_result.get("skipped") else "completed",
            skip_reason=tika_result.get("skip_reason"),
        )
        db.add(run)

        inserted_rows = 0
        for p in pages:
            db.add(
                TikaRunPage(
                    run_id=run_id,
                    job_id=job_id,
                    page_number=int(p.get("page_number") or 0),
                    has_text_layer=bool(p.get("has_text_layer")),
                    tika_text=p.get("tika_text"),
                    skipped_reason=p.get("skipped_reason"),
                )
            )
            inserted_rows += 1
        db.commit()
        return inserted_rows
    finally:
        db.close()

