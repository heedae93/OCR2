"""
Celery Worker for BBOCR OCR processing

실행 방법:
  cd backend
  celery -A ocr_worker worker -Q ocr --loglevel=info --pool=solo

Windows에서는 반드시 --pool=solo 옵션 필요 (fork 미지원)
"""
import concurrent.futures
import os
import sys
import logging

# backend 디렉토리를 Python path에 추가
sys.path.insert(0, os.path.dirname(__file__))

# ── 환경 초기화 (main.py와 동일한 순서로) ──────────────────────
from config import Config

os.environ['CUDA_VISIBLE_DEVICES'] = Config.CUDA_VISIBLE_DEVICES
os.environ.setdefault('PADDLE_PDX_EAGER_INIT', '0')
os.environ['KMP_DUPLICATE_LIB_OK'] = 'True'

# langchain 호환 shim (paddlex 내부 의존성)
import types
try:
    from langchain_community.docstore.document import Document as _LCDocument
    _ds_mod = types.ModuleType("langchain.docstore")
    _ds_doc_mod = types.ModuleType("langchain.docstore.document")
    _ds_doc_mod.Document = _LCDocument
    _ds_mod.document = _ds_doc_mod
    sys.modules.setdefault("langchain.docstore", _ds_mod)
    sys.modules.setdefault("langchain.docstore.document", _ds_doc_mod)
except ImportError:
    pass

from core.ctc_patch import patch_ctc_decoder
patch_ctc_decoder()

# ── Celery 앱 및 로거 ──────────────────────────────────────────
from celery_app import celery_app

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def _mark_job_failed(job_id: str, error_message: str):
    """작업을 실패 상태로 업데이트 (파일 + DB)"""
    try:
        from api.ocr import job_manager
        from utils.job_manager import JobStatus
        job_manager.update_job(job_id, status=JobStatus.FAILED, message=error_message)
    except Exception as e:
        logger.error(f"[Worker] Failed to update memory status for {job_id}: {e}")
    try:
        from utils.db_helper import update_job_status
        update_job_status(job_id, "failed", error_message=error_message)
    except Exception as e:
        logger.error(f"[Worker] Failed to update DB status for {job_id}: {e}")


def _restore_job_to_manager(job_id: str) -> bool:
    """
    Worker 프로세스의 job_manager는 빈 상태이므로
    DB에서 job 정보를 읽어 메모리에 복원한다.
    """
    from api.ocr import job_manager
    from database import SessionLocal, Job as DBJob

    if job_manager.get_job(job_id):
        return True  # 이미 메모리에 있음

    db = SessionLocal()
    try:
        db_job = db.query(DBJob).filter_by(job_id=job_id).first()
        if not db_job:
            logger.error(f"[Worker] Job {job_id} not found in DB")
            return False
        job_manager.create_job(
            job_id=job_id,
            filename=db_job.original_filename,
            user_id=db_job.user_id or 'worker'
        )
        logger.info(f"[Worker] Restored job {job_id} from DB")
        return True
    finally:
        db.close()


@celery_app.task(
    bind=True,
    name='ocr.process',
    max_retries=2,
    default_retry_delay=30,
    acks_late=True,
)
def process_ocr_task(self, job_id: str):
    """
    OCR 처리 Celery Task

    FastAPI가 Redis 큐에 등록하면 Worker가 꺼내서 실행.
    상태 업데이트는 기존 파일/DB 방식 그대로 유지.
    """
    logger.info(f"[Worker] Task received: job_id={job_id}")

    # Worker 프로세스 job_manager에 job 복원
    if not _restore_job_to_manager(job_id):
        logger.error(f"[Worker] Cannot process job {job_id} - not found in DB")
        try:
            from utils.db_helper import update_job_status
            update_job_status(job_id, "failed", error_message="Job not found in database")
        except Exception:
            pass
        return

    timeout_seconds = Config.JOB_TIMEOUT_SECONDS
    from api.ocr import process_job_task

    executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    try:
        future = executor.submit(process_job_task, job_id)
        try:
            future.result(timeout=timeout_seconds)
            logger.info(f"[Worker] Task completed: job_id={job_id}")
        except concurrent.futures.TimeoutError:
            error_msg = f"작업 시간 초과 ({timeout_seconds // 60}분 초과)"
            logger.error(f"[Worker] Task timed out: job_id={job_id}")
            _mark_job_failed(job_id, error_msg)
            # 타임아웃은 재시도하지 않음
        except Exception as exc:
            logger.error(f"[Worker] Task failed: job_id={job_id}, error={exc}", exc_info=True)
            _mark_job_failed(job_id, str(exc))
            # 오류 발생 시 무한 재시도하지 않고 즉시 실패 처리하도록 주석 처리
            # raise self.retry(exc=exc)
    finally:
        executor.shutdown(wait=False)
