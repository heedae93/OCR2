"""
Jobs API endpoints - Database-backed job management
"""
import logging
from typing import List, Optional
from datetime import datetime, date, timedelta
from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc, or_, func, cast, Date

from database import get_db, Job, OCRPage, User, Session as DBSession, SessionDocument
from models.job import JobResponse

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/jobs", response_model=List[JobResponse])
async def list_jobs(
    user_id: str = "default",
    status: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = Query(50, le=100),
    offset: int = 0,
    db: Session = Depends(get_db)
):
    """
    List jobs with filtering and pagination

    Args:
        user_id: User ID (default: "default")
        status: Filter by status (queued, processing, completed, failed)
        search: Search in filename
        limit: Maximum number of results (max 100)
        offset: Offset for pagination
    """
    logger.info(f"list_jobs called: user_id={user_id}, status={status}, search={search}")
    print(f"\n[DEBUG] list_jobs called with user_id: '{user_id}'")
    try:
        query = db.query(Job).filter(Job.user_id == user_id)
        total_in_db = db.query(Job).count()
        count_for_user = query.count()
        print(f"[DEBUG] Total jobs in DB: {total_in_db}, Jobs for user '{user_id}': {count_for_user}")
        logger.info(f"Created query for user_id={user_id}")

        # Filter by status
        if status:
            query = query.filter(Job.status == status)

        # Search in filename
        if search:
            query = query.filter(Job.original_filename.like(f"%{search}%"))

        # Order by creation time (newest first)
        query = query.order_by(desc(Job.created_at))

        # Pagination
        total = query.count()
        jobs = query.offset(offset).limit(limit).all()

        # Convert to response format
        job_responses = []
        from utils.job_manager import JobManager
        for job in jobs:
            status = job.status
            progress_percent = job.progress_percent or 0
            current_page = job.current_page or 0
            total_pages = job.total_pages or 0
            message = job.error_message if job.status == "failed" else None

            # Prefer file-based status for active jobs (and check for recent failures/completions)
            file_status = JobManager.read_status_from_file(job.job_id)
            if file_status:
                file_state = file_status.get("status")
                # If file status is different from DB, or if it's currently active, use file status
                if job.status in ("processing", "queued", "pending") or file_state in ("failed", "completed"):
                    status = file_state or status
                    progress_percent = file_status.get("progress_percent", progress_percent)
                    current_page = file_status.get("current_page", current_page)
                    total_pages = file_status.get("total_pages", total_pages)
                    if status == "failed":
                        message = file_status.get("message", message)

            job_responses.append(JobResponse(
                job_id=job.job_id,
                filename=job.original_filename,
                status=status,
                progress_percent=progress_percent,
                current_page=current_page,
                total_pages=total_pages,
                message=message,
                pdf_url=f"/files/processed/{job.job_id}.pdf" if job.pdf_file_path else None,
                raw_file_url=None,
                created_at=job.created_at.isoformat() if job.created_at else None,
                completed_at=job.completed_at.isoformat() if job.completed_at else None,
                processing_time_seconds=job.processing_time_seconds,
                total_text_blocks=job.total_text_blocks,
                average_confidence=job.average_confidence,
                is_double_column=job.is_double_column
            ))

        logger.info(f"Listed {len(job_responses)} jobs (total: {total})")
        return job_responses

    except Exception as e:
        logger.error(f"Failed to list jobs: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/jobs/{job_id}", response_model=JobResponse)
async def get_job(job_id: str, db: Session = Depends(get_db)):
    """Get job details by ID"""
    try:
        job = db.query(Job).filter(Job.job_id == job_id).first()

        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        from utils.job_manager import JobManager
        status = job.status
        progress_percent = job.progress_percent or 0
        current_page = job.current_page or 0
        total_pages = job.total_pages or 0
        message = job.error_message if job.status == "failed" else None

        # Prefer file-based status for active jobs (and check for recent failures/completions)
        file_status = JobManager.read_status_from_file(job.job_id)
        if file_status:
            file_state = file_status.get("status")
            if job.status in ("processing", "queued", "pending") or file_state in ("failed", "completed"):
                status = file_state or status
                progress_percent = file_status.get("progress_percent", progress_percent)
                current_page = file_status.get("current_page", current_page)
                total_pages = file_status.get("total_pages", total_pages)
                if status == "failed":
                    message = file_status.get("message", message)

        return JobResponse(
            job_id=job.job_id,
            filename=job.original_filename,
            status=status,
            progress_percent=progress_percent,
            current_page=current_page,
            total_pages=total_pages,
            message=message,
            pdf_url=f"/files/processed/{job.job_id}.pdf" if job.pdf_file_path else None,
            created_at=job.created_at.isoformat() if job.created_at else None,
            completed_at=job.completed_at.isoformat() if job.completed_at else None,
            processing_time_seconds=job.processing_time_seconds,
            total_text_blocks=job.total_text_blocks,
            average_confidence=job.average_confidence,
            is_double_column=job.is_double_column
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get job {job_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/jobs/{job_id}")
async def delete_job(job_id: str, db: Session = Depends(get_db)):
    """Delete a job and its associated files"""
    try:
        job = db.query(Job).filter(Job.job_id == job_id).first()

        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        # Delete associated files
        from pathlib import Path
        import shutil
        from config import Config

        files_to_delete = [
            job.raw_file_path,
            job.pdf_file_path,
            job.final_pdf_path,
            job.ocr_json_path
        ]

        deleted_files = 0
        for file_path in files_to_delete:
            if file_path:
                try:
                    path = Path(file_path)
                    if path.exists():
                        path.unlink()
                        deleted_files += 1
                except Exception as e:
                    logger.warning(f"Failed to delete file {file_path}: {e}")

        # 관련 디렉토리 삭제 (raw 업로드 폴더, pages 폴더)
        for dir_path in [
            Config.RAW_DIR / job_id,
            Config.PROCESSED_DIR / f"{job_id}_pages",
        ]:
            try:
                if dir_path.exists():
                    shutil.rmtree(dir_path)
                    deleted_files += 1
            except Exception as e:
                logger.warning(f"Failed to delete directory {dir_path}: {e}")

        # 추가 파일들 (pii, masked, smart_layers, editor_state 등)
        for extra in [
            Config.PROCESSED_DIR / f"{job_id}_pii.json",
            Config.PROCESSED_DIR / f"{job_id}_masked.pdf",
            Config.PROCESSED_DIR / f"{job_id}_smart_layers.json",
            Config.PROCESSED_DIR / f"{job_id}_editor_state.json",
            Config.PROCESSED_DIR / f"{job_id}_final.pdf",
        ]:
            try:
                if extra.exists():
                    extra.unlink()
            except Exception as e:
                logger.warning(f"Failed to delete extra file {extra}: {e}")

        # Delete from database (cascade will delete pages)
        db.delete(job)
        db.commit()

        logger.info(f"Deleted job {job_id} ({deleted_files} files)")
        return {"message": f"Job deleted successfully ({deleted_files} files removed)"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete job {job_id}: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/jobs/statistics/summary")
async def get_statistics(user_id: str = "default", db: Session = Depends(get_db)):
    """Get job statistics for a user"""
    try:
        # Total jobs
        total_jobs = db.query(func.count(Job.job_id)).filter(Job.user_id == user_id).scalar()

        # Jobs by status
        status_counts = db.query(Job.status, func.count(Job.job_id)).filter(
            Job.user_id == user_id
        ).group_by(Job.status).all()

        # Total pages processed
        total_pages = db.query(func.sum(Job.total_pages)).filter(
            Job.user_id == user_id,
            Job.status == "completed"
        ).scalar() or 0

        # Average processing time
        avg_processing_time = db.query(func.avg(Job.processing_time_seconds)).filter(
            Job.user_id == user_id,
            Job.status == "completed"
        ).scalar() or 0

        # Storage used
        storage_used = db.query(func.sum(Job.file_size_bytes)).filter(
            Job.user_id == user_id
        ).scalar() or 0

        # Today completed jobs
        today = date.today()
        today_completed = db.query(func.count(Job.job_id)).filter(
            Job.user_id == user_id,
            Job.status == "completed",
            func.date(Job.completed_at) == today
        ).scalar() or 0

        return {
            "total_jobs": total_jobs,
            "status_counts": {status: count for status, count in status_counts},
            "total_pages_processed": total_pages,
            "average_processing_time_seconds": float(avg_processing_time) if avg_processing_time else 0,
            "storage_used_bytes": storage_used,
            "storage_used_mb": round(storage_used / (1024 * 1024), 2),
            "today_completed": today_completed
        }

    except Exception as e:
        logger.error(f"Failed to get statistics: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/jobs/statistics/trend")
async def get_trend(user_id: str = "default", period: str = "daily", db: Session = Depends(get_db)):
    """Get processing trend data (daily/weekly/monthly)"""
    try:
        today = date.today()

        if period == "daily":
            days = 14
            labels = [(today - timedelta(days=i)).strftime("%m/%d") for i in range(days - 1, -1, -1)]
            dates = [(today - timedelta(days=i)) for i in range(days - 1, -1, -1)]

            completed_counts = []
            failed_counts = []
            for d in dates:
                c = db.query(func.count(Job.job_id)).filter(
                    Job.user_id == user_id,
                    Job.status == "completed",
                    cast(Job.completed_at, Date) == d
                ).scalar() or 0
                f = db.query(func.count(Job.job_id)).filter(
                    Job.user_id == user_id,
                    Job.status == "failed",
                    cast(Job.created_at, Date) == d
                ).scalar() or 0
                completed_counts.append(c)
                failed_counts.append(f)

        elif period == "weekly":
            weeks = 8
            labels = []
            completed_counts = []
            failed_counts = []
            for i in range(weeks - 1, -1, -1):
                week_end = today - timedelta(weeks=i)
                week_start = week_end - timedelta(days=6)
                labels.append(f"{week_start.strftime('%m/%d')}~{week_end.strftime('%m/%d')}")
                c = db.query(func.count(Job.job_id)).filter(
                    Job.user_id == user_id,
                    Job.status == "completed",
                    cast(Job.completed_at, Date) >= week_start,
                    cast(Job.completed_at, Date) <= week_end
                ).scalar() or 0
                f = db.query(func.count(Job.job_id)).filter(
                    Job.user_id == user_id,
                    Job.status == "failed",
                    cast(Job.created_at, Date) >= week_start,
                    cast(Job.created_at, Date) <= week_end
                ).scalar() or 0
                completed_counts.append(c)
                failed_counts.append(f)

        else:  # monthly
            months = 6
            labels = []
            completed_counts = []
            failed_counts = []
            for i in range(months - 1, -1, -1):
                m = today.month - i
                y = today.year
                while m <= 0:
                    m += 12
                    y -= 1
                labels.append(f"{y}/{m:02d}")
                month_start = date(y, m, 1)
                if m == 12:
                    month_end = date(y + 1, 1, 1) - timedelta(days=1)
                else:
                    month_end = date(y, m + 1, 1) - timedelta(days=1)
                c = db.query(func.count(Job.job_id)).filter(
                    Job.user_id == user_id,
                    Job.status == "completed",
                    cast(Job.completed_at, Date) >= month_start,
                    cast(Job.completed_at, Date) <= month_end
                ).scalar() or 0
                f = db.query(func.count(Job.job_id)).filter(
                    Job.user_id == user_id,
                    Job.status == "failed",
                    cast(Job.created_at, Date) >= month_start,
                    cast(Job.created_at, Date) <= month_end
                ).scalar() or 0
                completed_counts.append(c)
                failed_counts.append(f)

        return {
            "labels": labels,
            "completed": completed_counts,
            "failed": failed_counts
        }
    except Exception as e:
        logger.error(f"Failed to get trend: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/jobs/statistics/accuracy")
async def get_accuracy_distribution(user_id: str = "default", db: Session = Depends(get_db)):
    """Get OCR accuracy distribution (confidence buckets)"""
    try:
        jobs = db.query(Job).filter(
            Job.user_id == user_id,
            Job.status == "completed",
            Job.average_confidence != None
        ).all()

        high = sum(1 for j in jobs if j.average_confidence >= 0.9)
        mid = sum(1 for j in jobs if 0.7 <= j.average_confidence < 0.9)
        low = sum(1 for j in jobs if j.average_confidence < 0.7)
        total = len(jobs)

        return {
            "total": total,
            "high": high,    # 90%+
            "mid": mid,      # 70~90%
            "low": low,      # 70% 미만
            "high_pct": round(high / total * 100, 1) if total else 0,
            "mid_pct": round(mid / total * 100, 1) if total else 0,
            "low_pct": round(low / total * 100, 1) if total else 0,
        }
    except Exception as e:
        logger.error(f"Failed to get accuracy distribution: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/jobs/statistics/file-types")
async def get_file_type_distribution(user_id: str = "default", db: Session = Depends(get_db)):
    """Get file type breakdown"""
    try:
        counts = db.query(Job.file_type, func.count(Job.job_id)).filter(
            Job.user_id == user_id
        ).group_by(Job.file_type).all()

        result = {}
        total = 0
        for ft, cnt in counts:
            key = (ft or 'unknown').lower()
            result[key] = result.get(key, 0) + cnt
            total += cnt

        return {"total": total, "counts": result}
    except Exception as e:
        logger.error(f"Failed to get file type distribution: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/jobs/statistics/processing-time")
async def get_processing_time_distribution(user_id: str = "default", db: Session = Depends(get_db)):
    """Get processing time distribution (fast/normal/slow)"""
    try:
        jobs = db.query(Job).filter(
            Job.user_id == user_id,
            Job.status == "completed",
            Job.processing_time_seconds != None
        ).all()

        fast = sum(1 for j in jobs if j.processing_time_seconds < 30)
        normal = sum(1 for j in jobs if 30 <= j.processing_time_seconds < 120)
        slow = sum(1 for j in jobs if j.processing_time_seconds >= 120)
        total = len(jobs)

        return {
            "total": total,
            "fast": fast,    # < 30s
            "normal": normal, # 30~120s
            "slow": slow,    # 120s+
            "fast_pct": round(fast / total * 100, 1) if total else 0,
            "normal_pct": round(normal / total * 100, 1) if total else 0,
            "slow_pct": round(slow / total * 100, 1) if total else 0,
        }
    except Exception as e:
        logger.error(f"Failed to get processing time distribution: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/jobs/statistics/monthly-pages")
async def get_monthly_pages(user_id: str = "default", db: Session = Depends(get_db)):
    """Get monthly cumulative page counts (last 12 months)"""
    try:
        today = date.today()
        labels = []
        pages_list = []
        cumulative = 0
        monthly_data = []

        for i in range(11, -1, -1):
            m = today.month - i
            y = today.year
            while m <= 0:
                m += 12
                y -= 1
            month_start = date(y, m, 1)
            if m == 12:
                month_end = date(y + 1, 1, 1) - timedelta(days=1)
            else:
                month_end = date(y, m + 1, 1) - timedelta(days=1)

            pages = db.query(func.sum(Job.total_pages)).filter(
                Job.user_id == user_id,
                Job.status == "completed",
                cast(Job.completed_at, Date) >= month_start,
                cast(Job.completed_at, Date) <= month_end
            ).scalar() or 0

            labels.append(f"{m}월")
            monthly_data.append(int(pages))

        # Build cumulative
        running = 0
        cumulative_data = []
        for v in monthly_data:
            running += v
            cumulative_data.append(running)

        return {
            "labels": labels,
            "monthly": monthly_data,
            "cumulative": cumulative_data
        }
    except Exception as e:
        logger.error(f"Failed to get monthly pages: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/jobs/statistics/sessions")
async def get_session_statistics(user_id: str = "default", db: Session = Depends(get_db)):
    """Get session-based work statistics"""
    try:
        sessions = db.query(DBSession).filter(DBSession.user_id == user_id).all()
        result = []

        for session in sessions:
            docs = db.query(SessionDocument).filter(
                SessionDocument.session_id == session.session_id
            ).all()
            job_ids = [d.job_id for d in docs]
            if not job_ids:
                continue

            jobs = db.query(Job).filter(Job.job_id.in_(job_ids)).all()
            total = len(jobs)
            completed = sum(1 for j in jobs if j.status == "completed")
            failed = sum(1 for j in jobs if j.status == "failed")
            last_job = max((j.created_at for j in jobs if j.created_at), default=None)

            result.append({
                "session_id": session.session_id,
                "session_name": session.session_name,
                "total": total,
                "completed": completed,
                "failed": failed,
                "completion_rate": round(completed / total * 100, 1) if total else 0,
                "last_activity": last_job.isoformat() if last_job else None
            })

        result.sort(key=lambda x: x["last_activity"] or "", reverse=True)
        return result
    except Exception as e:
        logger.error(f"Failed to get session statistics: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/jobs/{job_id}/tags")
async def update_job_tags(job_id: str, tags: List[str], db: Session = Depends(get_db)):
    """Update job tags"""
    try:
        job = db.query(Job).filter(Job.job_id == job_id).first()

        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        import json
        job.tags = json.dumps(tags, ensure_ascii=False)
        db.commit()

        return {"message": "Tags updated", "tags": tags}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update tags for job {job_id}: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/jobs/{job_id}/notes")
async def update_job_notes(job_id: str, notes: str, db: Session = Depends(get_db)):
    """Update job notes"""
    try:
        job = db.query(Job).filter(Job.job_id == job_id).first()

        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        job.notes = notes
        db.commit()

        return {"message": "Notes updated", "notes": notes}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update notes for job {job_id}: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
