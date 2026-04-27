import json
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
