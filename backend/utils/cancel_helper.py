import os
from pathlib import Path
from config import Config

# 취소 플래그 파일 디렉토리 (Worker와 FastAPI 프로세스 간 공유)
CANCEL_FLAGS_DIR = Config.TEMP_DIR / "cancel_flags"
CANCEL_FLAGS_DIR.mkdir(parents=True, exist_ok=True)

def is_job_cancelled(job_id: str) -> bool:
    """파일 기반 취소 체크 - Worker/FastAPI 프로세스 모두에서 동작"""
    return (CANCEL_FLAGS_DIR / f"{job_id}.cancel").exists()

def set_cancel_flag(job_id: str):
    """취소 플래그 파일 생성"""
    (CANCEL_FLAGS_DIR / f"{job_id}.cancel").touch()

def clear_cancel_flag(job_id: str):
    """취소 플래그 파일 삭제"""
    flag = CANCEL_FLAGS_DIR / f"{job_id}.cancel"
    try:
        flag.unlink(missing_ok=True)
    except Exception:
        pass
