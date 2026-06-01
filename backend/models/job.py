"""
Job models for OCR processing
"""
from enum import Enum
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field


class JobStatus(str, Enum):
    """Job status enumeration"""
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    UPLOADED = "uploaded"


class JobCreate(BaseModel):
    """Job creation request"""
    filename: str
    user_id: Optional[str] = None


class Job(BaseModel):
    """Job model"""
    job_id: str
    filename: str
    user_id: str
    status: JobStatus = JobStatus.QUEUED
    progress_percent: float = 0.0
    current_page: int = 0
    total_pages: int = 0
    message: Optional[str] = None
    sub_stage: Optional[str] = None
    pdf_url: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)

    class Config:
        use_enum_values = True


class JobResponse(BaseModel):
    """Job response"""
    job_id: str
    filename: Optional[str] = None
    status: str
    progress_percent: float
    current_page: int
    total_pages: int
    message: Optional[str] = None
    sub_stage: Optional[str] = None
    pdf_url: Optional[str] = None
    raw_file_url: Optional[str] = None
    created_at: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    processing_time_seconds: Optional[float] = None
    total_text_blocks: Optional[int] = None
    average_confidence: Optional[float] = None
    is_double_column: Optional[bool] = None
    session_id: Optional[str] = None
    session_name: Optional[str] = None
    doc_type: Optional[str] = None
