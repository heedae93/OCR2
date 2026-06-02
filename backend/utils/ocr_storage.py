import json
import math
from pathlib import Path
from typing import Any, Dict, Optional

from config import Config
from database import Job as DBJob, SessionLocal


def resolve_ocr_json_path(job_id: str) -> Optional[Path]:
    """Resolve OCR JSON path from default storage or DB metadata."""
    default_path = Config.PROCESSED_DIR / f"{job_id}_ocr.json"
    if default_path.exists():
        return default_path

    db = SessionLocal()
    try:
        job = db.query(DBJob).filter_by(job_id=job_id).first()
        if not job or not job.ocr_json_path:
            return None

        candidate = Path(job.ocr_json_path)
        if not candidate.is_absolute():
            candidate = Config.BASE_DIR / candidate

        return candidate if candidate.exists() else None
    finally:
        db.close()


def load_ocr_results(job_id: str) -> Optional[Dict[str, Any]]:
    """Load OCR results JSON for a job."""
    json_path = resolve_ocr_json_path(job_id)
    if not json_path:
        return None

    with open(json_path, "r", encoding="utf-8") as f:
        return json.load(f)


def _split_text_into_pages(text: str, page_count: int) -> list[str]:
    normalized = (text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        return []

    target_pages = max(1, page_count or 1)
    lines = normalized.split("\n")
    if target_pages <= 1 or len(lines) <= target_pages:
        return [normalized]

    chunk_size = max(1, math.ceil(len(lines) / target_pages))
    pages = [
        "\n".join(lines[i : i + chunk_size]).strip()
        for i in range(0, len(lines), chunk_size)
    ]
    return [page for page in pages if page]


def _build_text_only_ocr_result(job: DBJob, page_texts: list[str]) -> Dict[str, Any]:
    pages: list[Dict[str, Any]] = []
    total_lines = 0

    for index, page_text in enumerate(page_texts, start=1):
        lines = [
            {
                "text": line.strip(),
                "bbox": None,
                "confidence": 1.0,
                "char_confidences": None,
                "column": None,
                "layout_type": None,
                "reading_order": line_index,
                "words": None,
            }
            for line_index, line in enumerate(page_text.splitlines())
            if line.strip()
        ]
        total_lines += len(lines)
        pages.append(
            {
                "page_number": index,
                "width": 595,
                "height": 842,
                "lines": lines,
                "is_multi_column": False,
                "column_boundary": None,
            }
        )

    return {
        "job_id": job.job_id,
        "has_bbox": False,
        "page_count": len(pages),
        "total_bboxes": total_lines,
        "pages": pages,
        "layout_summary": {"source": "db_full_text_fallback"},
    }


def ensure_text_fallback_artifacts(job_id: str) -> Optional[Path]:
    """
    Recreate minimal shared OCR artifacts for legacy completed jobs whose files
    lived on another machine before shared storage was introduced.
    """
    default_json = Config.PROCESSED_DIR / f"{job_id}_ocr.json"
    default_pdf = Config.PROCESSED_DIR / f"{job_id}.pdf"
    if default_json.exists():
        return default_json

    db = SessionLocal()
    try:
        job = db.query(DBJob).filter_by(job_id=job_id).first()
        if not job or not (job.full_text or "").strip():
            return None

        page_texts = _split_text_into_pages(job.full_text or "", job.total_pages or 1)
        if not page_texts:
            return None

        from utils.text_to_pdf import convert_plain_page_texts_to_pdf

        Config.PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
        if not default_pdf.exists():
            convert_plain_page_texts_to_pdf(page_texts, default_pdf)

        ocr_data = _build_text_only_ocr_result(job, page_texts)
        with open(default_json, "w", encoding="utf-8") as f:
            json.dump(ocr_data, f, ensure_ascii=False, indent=2)

        job.pdf_file_path = str(default_pdf)
        job.ocr_json_path = str(default_json)
        if job.status == "completed":
            job.error_message = None
        db.commit()
        return default_json
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
