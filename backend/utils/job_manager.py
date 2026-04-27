"""
Job management for OCR processing
"""
import logging
import json
import os
import sys
from pathlib import Path

# fcntl은 Unix 전용 - Windows에서는 파일 잠금 없이 동작
try:
    import fcntl
    _HAS_FCNTL = True
except ImportError:
    _HAS_FCNTL = False
from typing import Dict, Optional
from datetime import datetime
from models.job import Job, JobStatus

logger = logging.getLogger(__name__)

# File-based status storage for non-blocking status queries
from config import Config
STATUS_DIR = Config.TEMP_DIR / "job_status"
STATUS_DIR.mkdir(parents=True, exist_ok=True)


class JobManager:
    """Manage OCR processing jobs with file-based status storage"""

    def __init__(self):
        self.jobs: Dict[str, Job] = {}
        self.cancelled_jobs: set = set()  # Set of job_ids that should be cancelled
        logger.info("JobManager initialized with file-based status storage")

    def _save_status_to_file(self, job_id: str, job: Job):
        """Save job status to file for non-blocking reads"""
        try:
            status_file = STATUS_DIR / f"{job_id}.json"
            status_data = {
                "job_id": job.job_id,
                "filename": job.filename,
                "status": job.status.value if hasattr(job.status, 'value') else (job.status or "unknown"),
                "progress_percent": job.progress_percent or 0,
                "current_page": job.current_page or 0,
                "total_pages": job.total_pages or 0,
                "message": job.message,
                "sub_stage": job.sub_stage,
                "pdf_url": job.pdf_url,
                "updated_at": datetime.now().isoformat()
            }
            # Atomic write with file locking (Unix only)
            with open(status_file, 'w') as f:
                if _HAS_FCNTL:
                    fcntl.flock(f.fileno(), fcntl.LOCK_EX)
                json.dump(status_data, f)
                if _HAS_FCNTL:
                    fcntl.flock(f.fileno(), fcntl.LOCK_UN)
        except Exception as e:
            logger.warning(f"Failed to save status file for {job_id}: {e}")

    @staticmethod
    def read_status_from_file(job_id: str) -> Optional[dict]:
        """Read job status from file (can be called from any process)"""
        try:
            status_file = STATUS_DIR / f"{job_id}.json"
            if status_file.exists():
                with open(status_file, 'r') as f:
                    if _HAS_FCNTL:
                        fcntl.flock(f.fileno(), fcntl.LOCK_SH)
                    data = json.load(f)
                    if _HAS_FCNTL:
                        fcntl.flock(f.fileno(), fcntl.LOCK_UN)
                    return data
        except Exception as e:
            logger.warning(f"Failed to read status file for {job_id}: {e}")
        return None

    def cancel_job(self, job_id: str) -> bool:
        """Mark a job for cancellation"""
        job = self.jobs.get(job_id)
        if job and job.status == JobStatus.PROCESSING:
            self.cancelled_jobs.add(job_id)
            logger.info(f"Job marked for cancellation: {job_id}")
            return True
        return False

    def is_cancelled(self, job_id: str) -> bool:
        """Check if a job is marked for cancellation"""
        return job_id in self.cancelled_jobs

    def clear_cancelled(self, job_id: str):
        """Clear cancellation flag after job is cancelled"""
        self.cancelled_jobs.discard(job_id)
        logger.info(f"Cancellation flag cleared: {job_id}")

    def create_job(self, job_id: str, filename: str, user_id: str) -> Job:
        """Create a new job"""
        job = Job(
            job_id=job_id,
            filename=filename,
            user_id=user_id,
            status=JobStatus.QUEUED,
            progress_percent=0.0,
            current_page=0,
            total_pages=0,
            created_at=datetime.now(),
            updated_at=datetime.now()
        )
        self.jobs[job_id] = job
        self._save_status_to_file(job_id, job)
        logger.info(f"Job created: {job_id}")
        return job

    def get_job(self, job_id: str) -> Optional[Job]:
        """Get job by ID"""
        return self.jobs.get(job_id)

    def update_job(
        self,
        job_id: str,
        status: Optional[JobStatus] = None,
        progress_percent: Optional[float] = None,
        current_page: Optional[int] = None,
        total_pages: Optional[int] = None,
        message: Optional[str] = None,
        sub_stage: Optional[str] = None,
        pdf_url: Optional[str] = None
    ) -> Optional[Job]:
        """Update job information"""
        job = self.jobs.get(job_id)
        if not job:
            # Try to load from file (especially for workers)
            file_data = self.read_status_from_file(job_id)
            if file_data:
                try:
                    job = Job(
                        job_id=file_data["job_id"],
                        filename=file_data.get("filename", "unknown"),
                        user_id=file_data.get("user_id", "worker"),
                        status=file_data.get("status", JobStatus.QUEUED),
                        progress_percent=file_data.get("progress_percent", 0.0),
                        current_page=file_data.get("current_page", 0),
                        total_pages=file_data.get("total_pages", 0),
                        message=file_data.get("message"),
                        sub_stage=file_data.get("sub_stage"),
                        pdf_url=file_data.get("pdf_url")
                    )
                    self.jobs[job_id] = job
                except Exception as e:
                    logger.warning(f"Failed to restore job from file for update: {e}")
                    return None
            else:
                logger.warning(f"Job not found in memory or file: {job_id}")
                return None

        if status is not None:
            job.status = status
        if progress_percent is not None:
            job.progress_percent = progress_percent
        if current_page is not None:
            job.current_page = current_page
        if total_pages is not None:
            job.total_pages = total_pages
        if message is not None:
            job.message = message
        if sub_stage is not None:
            job.sub_stage = sub_stage
        if pdf_url is not None:
            job.pdf_url = pdf_url

        job.updated_at = datetime.now()

        # Save to file for non-blocking status queries
        self._save_status_to_file(job_id, job)

        logger.debug(f"Job updated: {job_id} - {status}")
        return job

    def delete_job(self, job_id: str) -> bool:
        """Delete a job"""
        if job_id in self.jobs:
            del self.jobs[job_id]
            logger.info(f"Job deleted: {job_id}")
            return True
        return False

    def list_jobs(self, user_id: Optional[str] = None) -> list:
        """List all jobs, optionally filtered by user_id"""
        jobs = list(self.jobs.values())
        if user_id:
            jobs = [j for j in jobs if j.user_id == user_id]
        return sorted(jobs, key=lambda x: x.created_at, reverse=True)

    def get_job_count(self) -> int:
        """Get total number of jobs"""
        return len(self.jobs)

    def get_active_jobs(self) -> list:
        """Get all active (queued or processing) jobs"""
        return [j for j in self.jobs.values()
                if j.status in [JobStatus.QUEUED, JobStatus.PROCESSING]]
