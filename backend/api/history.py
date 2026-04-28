"""
파일 버전 및 다운로드 이력 관리 API
"""
import logging
from typing import Optional
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends, Request
from sqlalchemy.orm import Session
from sqlalchemy import desc

from database import get_db, Job, FileVersion, DownloadHistory, User

logger = logging.getLogger(__name__)
router = APIRouter()


# ─────────────────────────── 파일 버전 ───────────────────────────

@router.get("/history/versions")
async def list_versions(user_id: str = "", job_id: Optional[str] = None, db: Session = Depends(get_db)):
    """사용자의 파일 버전 목록 조회"""
    try:
        q = db.query(FileVersion, Job).join(Job, FileVersion.job_id == Job.job_id)
        if user_id:
            q = q.filter(FileVersion.user_id == user_id)
        if job_id:
            q = q.filter(FileVersion.job_id == job_id)
        rows = q.order_by(desc(FileVersion.created_at)).all()

        result = []
        for v, job in rows:
            result.append({
                "version_id": v.version_id,
                "job_id": v.job_id,
                "filename": job.original_filename,
                "version_number": v.version_number,
                "version_label": v.version_label,
                "note": v.note,
                "file_size_bytes": v.file_size_bytes,
                "created_at": v.created_at.strftime("%Y-%m-%d %H:%M:%S") if v.created_at else None,
            })
        return result
    except Exception as e:
        logger.error(f"Failed to list versions: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/history/versions")
async def create_version(payload: dict, db: Session = Depends(get_db)):
    """버전 수동 생성"""
    try:
        job_id = payload.get("job_id")
        user_id = payload.get("user_id")
        if not job_id or not user_id:
            raise HTTPException(status_code=400, detail="job_id and user_id required")

        job = db.query(Job).filter_by(job_id=job_id).first()
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        # 현재 최대 버전 번호
        last = db.query(FileVersion).filter_by(job_id=job_id).order_by(desc(FileVersion.version_number)).first()
        next_num = (last.version_number + 1) if last else 1

        version = FileVersion(
            job_id=job_id,
            user_id=user_id,
            version_number=next_num,
            version_label=payload.get("version_label", f"v{next_num}.0"),
            note=payload.get("note"),
            pdf_file_path=job.pdf_file_path,
            ocr_json_path=job.ocr_json_path,
            file_size_bytes=job.file_size_bytes,
        )
        db.add(version)
        db.commit()
        db.refresh(version)

        return {"version_id": version.version_id, "version_number": next_num, "version_label": version.version_label}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create version: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/history/versions/{version_id}")
async def update_version(version_id: int, payload: dict, db: Session = Depends(get_db)):
    """버전 라벨/노트 수정"""
    try:
        version = db.query(FileVersion).filter_by(version_id=version_id).first()
        if not version:
            raise HTTPException(status_code=404, detail="Version not found")
        if "version_label" in payload:
            version.version_label = payload["version_label"]
        if "note" in payload:
            version.note = payload["note"]
        db.commit()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/history/versions/{version_id}")
async def delete_version(version_id: int, db: Session = Depends(get_db)):
    """버전 삭제"""
    try:
        version = db.query(FileVersion).filter_by(version_id=version_id).first()
        if not version:
            raise HTTPException(status_code=404, detail="Version not found")
        db.delete(version)
        db.commit()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────── 다운로드 이력 ───────────────────────────

@router.get("/history/downloads")
async def list_downloads(user_id: str = "", job_id: Optional[str] = None, db: Session = Depends(get_db)):
    """다운로드 이력 조회"""
    try:
        q = db.query(DownloadHistory, Job).join(Job, DownloadHistory.job_id == Job.job_id)
        if user_id:
            q = q.filter(DownloadHistory.user_id == user_id)
        if job_id:
            q = q.filter(DownloadHistory.job_id == job_id)
        rows = q.order_by(desc(DownloadHistory.downloaded_at)).limit(200).all()

        result = []
        for d, job in rows:
            result.append({
                "id": d.id,
                "job_id": d.job_id,
                "filename": job.original_filename,
                "file_type": d.file_type,
                "version_id": d.version_id,
                "downloaded_at": d.downloaded_at.strftime("%Y-%m-%d %H:%M:%S") if d.downloaded_at else None,
                "ip_address": d.ip_address,
            })
        return result
    except Exception as e:
        logger.error(f"Failed to list downloads: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/history/downloads/record")
async def record_download(payload: dict, request: Request, db: Session = Depends(get_db)):
    """다운로드 이력 기록"""
    try:
        job_id = payload.get("job_id")
        user_id = payload.get("user_id")
        if not job_id or not user_id:
            raise HTTPException(status_code=400, detail="job_id and user_id required")

        ip = request.client.host if request.client else None

        record = DownloadHistory(
            job_id=job_id,
            user_id=user_id,
            version_id=payload.get("version_id"),
            file_type=payload.get("file_type", "pdf"),
            ip_address=ip,
        )
        db.add(record)
        db.commit()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to record download: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/history/downloads/{record_id}")
async def delete_download_record(record_id: int, db: Session = Depends(get_db)):
    """다운로드 이력 개별 삭제"""
    try:
        record = db.query(DownloadHistory).filter_by(id=record_id).first()
        if not record:
            raise HTTPException(status_code=404, detail="Record not found")
        db.delete(record)
        db.commit()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
