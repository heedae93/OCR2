"""
OCR processing API endpoints
"""
import logging
from collections import defaultdict, Counter
from concurrent.futures import ThreadPoolExecutor, as_completed, ProcessPoolExecutor
import threading
import multiprocessing
import os
from pathlib import Path
from typing import Optional, List, Dict
import json
import asyncio
import shutil
import time

from fastapi import APIRouter, UploadFile, File, HTTPException, Query
from fastapi.responses import FileResponse

from config import Config
from models.job import JobStatus, JobResponse
from models.ocr import OCRResult, OCRPage, OCRLine, SmartToolElement, PDFExportRequest
from core.pdf_processor import PDFProcessor
from core.ocr_engine import OCREngine
from core.invisible_layer import SearchablePDFGenerator
from core.column_detector import ColumnDetector
from core.layout_detector import LayoutDetector
from core.reading_order_sorter import ReadingOrderSorter
from utils.job_manager import JobManager
from utils.file_utils import save_uploaded_file, generate_unique_id, cleanup_temp_files
from utils.smart_layers import apply_smart_layers_to_image
from utils.ocr_storage import resolve_ocr_json_path
from database import SessionLocal, Job as DBJob, DownloadHistory, FileVersion

# Import pdf_gen pipeline components
from core.pdf_gen_pipeline import CustomOCRModel, OCRPDFGenerator
from core.config_manager import create_legacy_config

logger = logging.getLogger(__name__)

router = APIRouter()

# 취소 플래그 파일 디렉토리 (Worker와 FastAPI 프로세스 간 공유)
CANCEL_FLAGS_DIR = Config.TEMP_DIR / "cancel_flags"
CANCEL_FLAGS_DIR.mkdir(parents=True, exist_ok=True)


def _is_job_cancelled(job_id: str) -> bool:
    """파일 기반 취소 체크 - Worker/FastAPI 프로세스 모두에서 동작"""
    return (CANCEL_FLAGS_DIR / f"{job_id}.cancel").exists()


def _set_cancel_flag(job_id: str):
    """취소 플래그 파일 생성"""
    (CANCEL_FLAGS_DIR / f"{job_id}.cancel").touch()


def _clear_cancel_flag(job_id: str):
    """취소 플래그 파일 삭제"""
    flag = CANCEL_FLAGS_DIR / f"{job_id}.cancel"
    try:
        flag.unlink(missing_ok=True)
    except Exception:
        pass


# Global instances
job_manager = JobManager()
ocr_engine = None
pdf_generator = None
column_detector = None
layout_detector = None
reading_order_sorter = None

# GPU pool for parallel processing (loaded from config.yaml)
AVAILABLE_GPUS = Config.AVAILABLE_GPU_IDS
ocr_engine_pool = {}  # {gpu_id: CustomOCRModel}
layout_detector_pool = {}  # {gpu_id: LayoutDetector}
gpu_pool_lock = threading.Lock()
# Per-GPU locks to prevent concurrent access to the same model (PaddlePaddle is not thread-safe)
gpu_predict_locks = {gpu_id: threading.Lock() for gpu_id in AVAILABLE_GPUS}

# Global OCRPDFGenerator instance (reused across all jobs)
global_pdf_generator = None
models_preloaded = False


async def preload_all_models():
    """
    Pre-load all OCR models at server startup for faster processing.
    This eliminates the cold-start delay on first request.
    """
    global ocr_engine_pool, layout_detector_pool, global_pdf_generator, models_preloaded

    import asyncio

    logger.info("=" * 50)
    logger.info("Starting model pre-loading...")
    start_time = time.time()

    # 1. Pre-load OCR engines for all GPUs
    for gpu_id in AVAILABLE_GPUS:
        try:
            logger.info(f"Pre-loading OCR engine for GPU {gpu_id}...")
            engine = get_ocr_engine_for_gpu(gpu_id)

            # Warm up the engine with a dummy prediction
            import numpy as np
            from PIL import Image
            import tempfile

            # Create a small test image
            dummy_img = Image.new('RGB', (100, 30), color='white')
            with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
                tmp_path = f.name
            dummy_img.save(tmp_path)
            try:
                engine.predict(tmp_path)  # Warm up
            except:
                pass  # Ignore errors on dummy image
            finally:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass

            logger.info(f"OCR engine for GPU {gpu_id} ready!")
        except Exception as e:
            logger.error(f"Failed to pre-load OCR engine for GPU {gpu_id}: {e}")

    # 2. Pre-load Layout Detectors for all GPUs
    if Config.USE_LAYOUT_DETECTION:
        for gpu_id in AVAILABLE_GPUS:
            try:
                logger.info(f"Pre-loading LayoutDetector for GPU {gpu_id}...")
                detector = get_layout_detector_for_gpu(gpu_id)
                logger.info(f"LayoutDetector for GPU {gpu_id} ready!")
            except Exception as e:
                logger.error(f"Failed to pre-load LayoutDetector for GPU {gpu_id}: {e}")

    # 3. Pre-load global PDF generator
    try:
        logger.info("Pre-loading OCRPDFGenerator...")
        pdf_gen_config = create_legacy_config()
        global_pdf_generator = OCRPDFGenerator(pdf_gen_config)
        logger.info("OCRPDFGenerator ready!")
    except Exception as e:
        logger.error(f"Failed to pre-load OCRPDFGenerator: {e}")

    # 4. Pre-load other components
    try:
        get_reading_order_sorter()
        get_column_detector()
        logger.info("ReadingOrderSorter and ColumnDetector ready!")
    except Exception as e:
        logger.error(f"Failed to pre-load other components: {e}")

    elapsed = time.time() - start_time
    models_preloaded = True
    logger.info(f"All models pre-loaded in {elapsed:.1f} seconds!")
    logger.info("=" * 50)


def get_global_pdf_generator():
    """Get the global PDF generator instance (pre-loaded or lazy init)"""
    global global_pdf_generator
    if global_pdf_generator is None:
        pdf_gen_config = create_legacy_config()
        global_pdf_generator = OCRPDFGenerator(pdf_gen_config)
    return global_pdf_generator


def get_ocr_engine_for_gpu(gpu_id: int):
    """Get or create OCR engine for specific GPU"""
    global ocr_engine_pool

    with gpu_pool_lock:
        if gpu_id not in ocr_engine_pool:
            logger.info(f"Initializing OCR engine for GPU {gpu_id}")
            # Set GPU for this engine
            old_cuda_devices = os.environ.get('CUDA_VISIBLE_DEVICES', '')
            os.environ['CUDA_VISIBLE_DEVICES'] = str(gpu_id)

            try:
                from core.pdf_gen_pipeline import CustomOCRModel
                from core.config_manager import create_legacy_config

                pdf_gen_config = create_legacy_config()
                ocr_model = CustomOCRModel(
                    pdf_gen_config['RECOGNITION_MODEL_DIR'],
                    pdf_gen_config['USE_GPU']
                )
                ocr_engine_pool[gpu_id] = ocr_model
                logger.info(f"OCR engine initialized for GPU {gpu_id}")
            finally:
                # Restore original CUDA_VISIBLE_DEVICES
                os.environ['CUDA_VISIBLE_DEVICES'] = old_cuda_devices

        return ocr_engine_pool[gpu_id]


def get_ocr_engine():
    """Lazy initialization of PaddleOCR engine (line-level detection)."""
    global ocr_engine
    if ocr_engine is None:
        ocr_engine = OCREngine()
        logger.info("OCREngine initialized (pure PaddleOCR detection)")
    return ocr_engine


def get_pdf_generator():
    """Lazy initialization of PDF generator (using SearchablePDFGenerator)"""
    global pdf_generator
    if pdf_generator is None:
        pdf_generator = SearchablePDFGenerator()
        logger.info("SearchablePDFGenerator initialized")
    return pdf_generator


def get_column_detector():
    """Lazy initialization of column detector"""
    global column_detector
    if column_detector is None:
        column_detector = ColumnDetector()
        logger.info("ColumnDetector initialized")
    return column_detector


def get_layout_detector_for_gpu(gpu_id: int):
    """Get or create layout detector for specific GPU"""
    global layout_detector_pool

    with gpu_pool_lock:
        if gpu_id not in layout_detector_pool:
            logger.info(f"Initializing LayoutDetector for GPU {gpu_id}")
            # Layout detector will use the same GPU as OCR
            device = f"cuda:{gpu_id}" if Config.OCR_USE_GPU else "cpu"
            detector = LayoutDetector(
                model_name=Config.LAYOUT_MODEL_NAME,
                device=device
            )
            layout_detector_pool[gpu_id] = detector
            logger.info(f"LayoutDetector initialized for GPU {gpu_id}")

        return layout_detector_pool[gpu_id]


def get_layout_detector():
    """Lazy initialization of layout detector"""
    global layout_detector
    if layout_detector is None:
        device = "gpu" if Config.OCR_USE_GPU else "cpu"
        layout_detector = LayoutDetector(
            model_name=Config.LAYOUT_MODEL_NAME,
            device=device
        )
        logger.info(f"LayoutDetector initialized with {Config.LAYOUT_MODEL_NAME} on {device}")
    return layout_detector


def get_reading_order_sorter() -> ReadingOrderSorter:
    """Lazy initialization of the smart reading order sorter"""
    global reading_order_sorter
    if reading_order_sorter is None:
        reading_order_sorter = ReadingOrderSorter(
            row_overlap_threshold=Config.READING_ORDER_ROW_OVERLAP,
            column_gap_ratio=Config.READING_ORDER_COLUMN_GAP,
            column_balance_ratio=Config.READING_ORDER_COLUMN_BALANCE
        )
        logger.info(
            "ReadingOrderSorter initialized "
            f"(row_overlap={Config.READING_ORDER_ROW_OVERLAP}, "
            f"column_gap={Config.READING_ORDER_COLUMN_GAP}, "
            f"column_balance={Config.READING_ORDER_COLUMN_BALANCE})"
        )
    return reading_order_sorter


def _merge_ocr_lines(blocks: List[Dict], y_threshold: float = 6.0, x_gap: float = 25.0) -> List[Dict]:
    """Group word-level boxes into line-level entries."""
    if not blocks:
        return []

    sorted_blocks = sorted(blocks, key=lambda b: (b['bbox'][1], b['bbox'][0]))
    merged = []
    current: List[Dict] = []
    current_y = None

    def flush_line(line_blocks: List[Dict]):
        if not line_blocks:
            return
        text_parts = []
        scores = []
        x1s, y1s, x2s, y2s = [], [], [], []
        layout_types = []
        for blk in line_blocks:
            t = blk.get('text', '').strip()
            if t:
                text_parts.append(t)
            scores.append(blk.get('score', 1.0))
            bbox = blk['bbox']
            x1s.append(bbox[0])
            y1s.append(bbox[1])
            x2s.append(bbox[2])
            y2s.append(bbox[3])
            if blk.get('layout_type'):
                layout_types.append(blk['layout_type'])

        merged_text = ' '.join(text_parts).strip()
        if not merged_text:
            return
        merged_bbox = [min(x1s), min(y1s), max(x2s), max(y2s)]
        avg_score = sum(scores) / len(scores) if scores else 1.0
        layout_type = layout_types[0] if layout_types else None
        merged.append({
            'bbox': merged_bbox,
            'text': merged_text,
            'score': avg_score,
            'layout_type': layout_type
        })

    for blk in sorted_blocks:
        bbox = blk['bbox']
        y_center = (bbox[1] + bbox[3]) / 2
        if not current:
            current = [blk]
            current_y = y_center
            continue

        if abs(y_center - current_y) <= y_threshold:
            current.append(blk)
            # update running average
            current_y = (current_y * (len(current) - 1) + y_center) / len(current)
        else:
            flush_line(current)
            current = [blk]
            current_y = y_center

    flush_line(current)
    return merged


@router.post("/upload")
def upload_file(
    file: UploadFile = File(...),
    user_id: str = Config.DEFAULT_USER_ID,
    doc_type: Optional[str] = Query(None),
    session_id: str = "default"
):
    """Upload a file for OCR processing"""
    try:
        # Validate file type
        if not file.filename:
            raise HTTPException(status_code=400, detail="No filename provided")

        file_ext = Path(file.filename).suffix.lower()
        if file_ext not in ['.pdf', '.png', '.jpg', '.jpeg']:
            raise HTTPException(
                status_code=400,
                detail="Unsupported file type. Only PDF, PNG, and JPG are supported."
            )

        # Generate job ID
        job_id = generate_unique_id()

        # Save file
        file_path = save_uploaded_file(
            file.file,
            file.filename,
            Config.RAW_DIR / job_id
        )

        # Create job
        job = job_manager.create_job(
            job_id=job_id,
            filename=file.filename,
            user_id=user_id
        )

        # Save to database
        from utils.db_helper import create_job_in_db, add_job_to_session
        logger.info(f"Saving job {job_id} to database...")
        db_saved = create_job_in_db(
            job_id=job_id,
            filename=file.filename,
            file_path=str(file_path),
            file_size=file_path.stat().st_size,
            user_id=user_id,
            doc_type=doc_type
        )
        if db_saved:
            logger.info(f"Job {job_id} successfully saved to database")

            # Add to specified session (or default)
            target_session = session_id if session_id else "default"
            session_added = add_job_to_session(job_id, target_session)
            if session_added:
                logger.info(f"Job {job_id} added to session {target_session}")
        else:
            logger.error(f"Failed to save job {job_id} to database")

        # Prepare preview PDF - use original for fast upload
        output_pdf = Config.PROCESSED_DIR / f"{job_id}.pdf"

        if file_ext == '.pdf':
            # For PDF files, copy original directly for fast preview
            # High-resolution conversion (300 DPI) will be done during OCR processing only
            try:
                import shutil
                shutil.copy2(file_path, output_pdf)
                logger.info(f"Created preview PDF (original copy): {output_pdf}")
            except Exception as e:
                logger.error(f"Failed to copy preview PDF: {e}")
                raise
        else:
            # For image files, create a simple PDF for preview with EXIF handling
            from PIL import Image, ImageOps
            from reportlab.pdfgen import canvas
            try:
                # CRITICAL: Handle EXIF orientation to prevent image rotation issues
                with Image.open(file_path) as img:
                    # Apply EXIF orientation to ensure consistent display
                    img = ImageOps.exif_transpose(img)
                    if img is None:
                        img = Image.open(file_path)

                    img_width, img_height = img.size

                    # Save corrected image temporarily if EXIF was applied
                    temp_corrected_path = Config.TEMP_DIR / f"preview_{job_id}.png"
                    img.save(temp_corrected_path, 'PNG')

                c = canvas.Canvas(str(output_pdf), pagesize=(img_width, img_height))
                c.drawImage(str(temp_corrected_path), 0, 0, width=img_width, height=img_height)
                c.save()

                # Clean up temporary file
                try:
                    temp_corrected_path.unlink()
                except:
                    pass

                logger.info(f"Created preview PDF from image with EXIF correction: {output_pdf}")
            except Exception as e:
                logger.warning(f"Failed to create preview PDF from image: {e}")

        logger.info(f"File uploaded: {file.filename} -> Job {job_id}")

        return {
            "job_id": job_id,
            "filename": file.filename,
            "status": "uploaded",
            "message": "File uploaded successfully"
        }

    except Exception as e:
        logger.error(f"Upload failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/page-image/{job_id}/{page_number}")
def get_page_image(job_id: str, page_number: int):
    """Get a specific page image for rendering"""
    try:
        # Check in processed directory
        image_dir = Config.PROCESSED_DIR / f"{job_id}_pages"
        image_path = image_dir / f"page_{page_number:04d}.png"

        if not image_path.exists():
            raise HTTPException(status_code=404, detail=f"Page {page_number} image not found")

        return FileResponse(
            path=str(image_path),
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=3600"}
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get page image: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/process/{job_id}")
def process_job(job_id: str):
    """Start OCR processing for a job"""
    try:
        job = job_manager.get_job(job_id)

        # If job not in memory, try to restore from database
        if not job:
            from database import SessionLocal, Job as DBJob
            db = SessionLocal()
            try:
                db_job = db.query(DBJob).filter_by(job_id=job_id).first()
                if db_job:
                    # Restore job to memory
                    job = job_manager.create_job(
                        job_id=job_id,
                        filename=db_job.original_filename,
                        user_id="restored"
                    )
                    logger.info(f"Restored job from database: {job_id}")
                else:
                    raise HTTPException(status_code=404, detail="Job not found")
            finally:
                db.close()

        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        # If already processing, reject
        if job.status == JobStatus.PROCESSING:
            raise HTTPException(status_code=400, detail="Job is already processing")

        # If completed or failed, allow re-processing by resetting status
        if job.status in [JobStatus.COMPLETED, JobStatus.FAILED]:
            logger.info(f"Re-processing job {job_id} (previous status: {job.status})")
            # Clean up old processed files
            try:
                old_pdf = Config.PROCESSED_DIR / f"{job_id}.pdf"
                if old_pdf.exists():
                    old_pdf.unlink()
                old_json = Config.PROCESSED_DIR / f"{job_id}_ocr.json"
                if old_json.exists():
                    old_json.unlink()
            except Exception as e:
                logger.warning(f"Failed to clean up old files for {job_id}: {e}")
            # Reset to queued
            job_manager.update_job(job_id, status=JobStatus.QUEUED, progress_percent=0.0)

        # Celery Worker에 작업 전달 (Redis 큐를 통해)
        from celery_app import celery_app as _celery
        _celery.send_task('ocr.process', args=[job_id], queue='ocr')
        logger.info(f"Dispatched job {job_id} to Celery OCR queue")

        return {
            "job_id": job_id,
            "status": "processing",
            "message": "Processing started"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to start processing: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/cancel/{job_id}")
def cancel_job(job_id: str):
    """Cancel an OCR processing job"""
    try:
        job = job_manager.get_job(job_id)

        # job_manager가 재시작 등으로 비어있을 경우 DB에서 복원
        if not job:
            db = SessionLocal()
            try:
                db_job = db.query(DBJob).filter_by(job_id=job_id).first()
                if db_job:
                    job = job_manager.create_job(
                        job_id=job_id,
                        filename=db_job.original_filename,
                        user_id="restored"
                    )
                    # DB 상태 반영
                    if db_job.status == 'processing':
                        job_manager.update_job(job_id, status=JobStatus.PROCESSING)
                    logger.info(f"Restored job from DB for cancel: {job_id}")
                else:
                    raise HTTPException(status_code=404, detail="Job not found")
            finally:
                db.close()

        if job.status not in [JobStatus.PROCESSING, JobStatus.QUEUED]:
            raise HTTPException(status_code=400, detail="Job is not processing")

        # 파일 기반 취소 플래그 (Worker/Celery 프로세스에서도 감지 가능)
        _set_cancel_flag(job_id)
        # 메모리 기반 취소도 병행
        job_in_memory = job_id in job_manager.jobs
        job_manager.cancelled_jobs.add(job_id)

        # 스레드가 없거나 서버 재시작 후 복원된 경우 → 즉시 CANCELLED로 강제 전환
        if not job_in_memory or job_id not in [j for j in job_manager.jobs if job_manager.jobs[j].status == JobStatus.PROCESSING]:
            job_manager.update_job(job_id, status=JobStatus.CANCELLED, message="중단됨")
            job_manager.clear_cancelled(job_id)
            logger.info(f"Job force-cancelled (no active thread): {job_id}")
            return {"job_id": job_id, "status": "cancelled", "message": "중단되었습니다"}

        logger.info(f"Cancellation signal sent to active thread: {job_id}")
        return {"job_id": job_id, "status": "cancelling", "message": "중단 요청됨"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to cancel job: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/cancel-all")
def cancel_all_jobs():
    """Cancel all processing and queued jobs"""
    try:
        db = SessionLocal()
        try:
            # Find all active jobs
            active_jobs = db.query(DBJob).filter(
                DBJob.status.in_(['processing', 'queued'])
            ).all()
            
            count = 0
            for db_job in active_jobs:
                job_id = db_job.job_id
                # Set cancel flag
                _set_cancel_flag(job_id)
                # Update memory
                if job_id in job_manager.jobs:
                    job_manager.cancelled_jobs.add(job_id)
                    job_manager.update_job(job_id, status=JobStatus.CANCELLED, message="모두 중단됨")
                
                # Update DB
                db_job.status = 'cancelled'
                db_job.message = '모두 중단됨'
                count += 1
            
            db.commit()
            logger.info(f"Batch cancelled {count} jobs")
            return {"status": "success", "cancelled_count": count, "message": f"{count}개의 작업이 중단되었습니다."}
        finally:
            db.close()
    except Exception as e:
        logger.error(f"Failed to cancel all jobs: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def process_job_task(job_id: str):
    """
    Background task for OCR processing with improved text scaling

    Pipeline:
    1. Load image/PDF
    2. Perform OCR (detection + recognition)
    3. Detect columns (for proper reading order)
    4. Generate searchable PDF with PRECISE text scaling
    """
    temp_files = []

    try:
        # Update status
        job_manager.update_job(job_id, status=JobStatus.PROCESSING, progress_percent=0.0)
        from utils.db_helper import update_job_status as _db_update_status
        _db_update_status(job_id, "processing", progress=0.0)

        job = job_manager.get_job(job_id)
        if not job:
            # Worker 프로세스 실행 시 메모리에 job이 없으므로 DB에서 복원
            from database import SessionLocal, Job as DBJob
            db = SessionLocal()
            try:
                db_job = db.query(DBJob).filter_by(job_id=job_id).first()
                if db_job:
                    job = job_manager.create_job(
                        job_id=job_id,
                        filename=db_job.original_filename,
                        user_id=db_job.user_id or 'worker'
                    )
                    logger.info(f"Restored job {job_id} from DB for processing")
                else:
                    logger.error(f"Job not found in DB: {job_id}")
                    return
            finally:
                db.close()

        # Find uploaded file
        job_dir = Config.RAW_DIR / job_id
        uploaded_files = list(job_dir.glob("*"))
        if not uploaded_files:
            raise FileNotFoundError(f"No file found for job {job_id}")

        input_file = uploaded_files[0]
        logger.info(f"Processing file: {input_file}")

        # Check file type
        pdf_processor = PDFProcessor()
        is_pdf = pdf_processor.is_pdf(str(input_file))

        # Convert to images
        if is_pdf:
            job_manager.update_job(job_id, sub_stage="Converting PDF to images", progress_percent=1.0)
            # Save images to processed directory for frontend access
            image_dir = Config.PROCESSED_DIR / f"{job_id}_pages"
            image_dir.mkdir(exist_ok=True)
            pdf_convert_start = time.time()

            # Progress callback for PDF conversion (1-10% of total progress)
            def pdf_progress_callback(current_page: int, total_pages: int):
                # PDF conversion represents 1-10% of total progress
                progress = 1.0 + (current_page / total_pages) * 9.0
                job_manager.update_job(
                    job_id,
                    sub_stage=f"Converting PDF page {current_page}/{total_pages}",
                    progress_percent=progress
                )

            image_paths = pdf_processor.pdf_to_images(
                str(input_file),
                image_dir,
                dpi=Config.PDF_DPI or 300,
                progress_callback=pdf_progress_callback
            )
            pdf_convert_time = time.time() - pdf_convert_start
            logger.info(f"[TIMING] PDF to images: {pdf_convert_time:.2f}s ({len(image_paths)} pages)")
            # Don't add to temp_files - keep images for frontend
        else:
            # Single image - get dimensions
            from PIL import Image, ImageOps
            with Image.open(input_file) as img:
                # Handle EXIF orientation
                img = ImageOps.exif_transpose(img)
                if img is None:
                    img = Image.open(input_file)
                width, height = img.size
            image_paths = [(str(input_file), width, height)]

        total_pages = len(image_paths)
        job_manager.update_job(job_id, total_pages=total_pages)

        # Use global pre-loaded PDF generator (much faster than creating new instance)
        pdf_generator = get_global_pdf_generator()
        # Set job_id for debugging
        pdf_generator.current_job_id = job_id

        logger.info(f"Starting OCR processing for {total_pages} pages (models pre-loaded: {models_preloaded})")

        # Prepare parallel page processing
        page_contexts = []
        for page_num, (image_path, width, height) in enumerate(image_paths, 1):
            if width == 0 or height == 0:
                from PIL import Image
                with Image.open(image_path) as img:
                    width, height = img.size
            page_contexts.append((page_num, image_path, width, height))

        # Locks removed - each GPU has its own engine instance
        layout_image_cache: Dict[str, str] = {}

        def get_layout_input_image(page_num: int, image_path: str, width: int, height: int) -> str:
            max_dim = getattr(Config, 'LAYOUT_MAX_DIMENSION', 1400) or 0
            if max_dim <= 0:
                return image_path

            cache_key = f"{image_path}:{width}x{height}:{max_dim}"
            if cache_key in layout_image_cache:
                return layout_image_cache[cache_key]

            longest = max(width, height)
            if longest <= max_dim:
                layout_image_cache[cache_key] = image_path
                return image_path

            scale = max_dim / float(longest)
            new_size = (max(1, int(width * scale)), max(1, int(height * scale)))
            from PIL import Image

            temp_path = Config.TEMP_DIR / f"{job_id}_layout_{page_num:04d}.jpg"
            try:
                with Image.open(image_path) as img:
                    img = img.resize(new_size, Image.LANCZOS)
                    img.save(temp_path, format='JPEG', quality=85)
                layout_image_cache[cache_key] = str(temp_path)
                temp_files.append(str(temp_path))
                logger.debug(
                    "Downscaled layout image for page %s: %s -> %s",
                    page_num,
                    (width, height),
                    new_size,
                )
                return str(temp_path)
            except Exception as exc:
                logger.warning(f"Layout image downscale failed for page {page_num}: {exc}")
                layout_image_cache[cache_key] = image_path
                return image_path

        def process_single_page(context):
            page_num, image_path, width, height = context
            page_start_time = time.time()
            try:
                # Check for cancellation before starting
                if _is_job_cancelled(job_id):
                    logger.info(f"[Page {page_num}] Cancelled before processing")
                    return {'page_number': page_num, 'cancelled': True}

                # Assign GPU for this page (round-robin across GPUs 1, 2, 3)
                gpu_id = AVAILABLE_GPUS[(page_num - 1) % len(AVAILABLE_GPUS)]
                logger.info(f"[Page {page_num}/{total_pages}] Starting OCR on GPU {gpu_id}")

                # Get GPU-specific OCR engine with per-GPU lock (PaddlePaddle is not thread-safe)
                ocr_start = time.time()
                page_ocr_model = get_ocr_engine_for_gpu(gpu_id)
                # Use per-GPU lock to prevent concurrent access to the same model
                with gpu_predict_locks[gpu_id]:
                    ocr_results = page_ocr_model.predict(image_path)
                structured_result = getattr(page_ocr_model, 'structured_result', None) or {}
                ocr_elapsed = time.time() - ocr_start

                if not ocr_results:
                    logger.warning(f"[Page {page_num}] No OCR results")
                    ocr_results = []
                else:
                    logger.info(f"[Page {page_num}] OCR completed in {ocr_elapsed:.2f}s ({len(ocr_results)} text blocks)")
                
                # Progress update: OCR done
                if total_pages == 1:
                    job_manager.update_job(job_id, progress_percent=40.0, sub_stage=f"Page {page_num}: OCR completed, starting layout analysis...")

                layout_regions = structured_result.get('layout_info', {}).get('regions', []) or []
                table_regions = structured_result.get('layout_info', {}).get('tables', []) or []
                column_info = {
                    'is_double_column': False,
                    'column_boundary': None,
                    'layout_type': 'single'
                }

                if ocr_results:
                    layout_cache_enabled = getattr(Config, 'LAYOUT_CACHE_ENABLED', True)
                    layout_cache_path = Config.PROCESSED_DIR / f"{job_id}_page_{page_num:04d}_layout.json"

                    if Config.USE_LAYOUT_DETECTION and not layout_regions:
                        cached = False
                        if layout_cache_enabled and layout_cache_path.exists():
                            try:
                                with open(layout_cache_path, 'r', encoding='utf-8') as f:
                                    layout_regions = json.load(f)
                                    cached = True
                                    logger.debug(f"Loaded cached layout for page {page_num}")
                            except Exception as cache_exc:
                                logger.warning(f"Failed to read layout cache for page {page_num}: {cache_exc}")
                                layout_regions = []

                        if not cached:
                            try:
                                detect_path = get_layout_input_image(page_num, image_path, width, height)
                                # Use GPU-specific layout detector (no lock needed)
                                layout_detector_instance = get_layout_detector_for_gpu(gpu_id)
                                layout_regions = layout_detector_instance.detect(detect_path)
                                if layout_regions and layout_cache_enabled:
                                    try:
                                        with open(layout_cache_path, 'w', encoding='utf-8') as f:
                                            json.dump(layout_regions, f, ensure_ascii=False)
                                    except Exception as write_exc:
                                        logger.warning(f"Failed to write layout cache for page {page_num}: {write_exc}")
                            except Exception as layout_exc:
                                logger.warning(f"Layout detection failed on page {page_num}: {layout_exc}")
                                layout_regions = []
                        
                        # Progress update: Layout done
                        if total_pages == 1:
                            job_manager.update_job(job_id, progress_percent=70.0, sub_stage=f"Page {page_num}: Layout analysis completed, finalizing results...")

                    sorter = get_reading_order_sorter()

                    if Config.USE_SMART_READING_ORDER:
                        sorted_blocks, detected_column_info = sorter.sort_reading_order(
                            ocr_results,
                            page_width=width,
                            page_height=height,
                            use_layout_priority=bool(layout_regions)
                        )
                        column_info = detected_column_info or column_info
                        ocr_results = sorter.add_column_labels(sorted_blocks, column_info, width)

                    # Text-layer/UI numbering follows visual order:
                    # left-to-right within a row, then top-to-bottom.
                    ocr_results = sorter.sort_visual_left_to_right_top_to_bottom(ocr_results)
                    for idx, block in enumerate(ocr_results):
                        block['reading_order'] = idx

                    for block in ocr_results:
                        block.setdefault('layout_type', 'text')
                else:
                    layout_regions = []

                layout_counts = Counter()
                for block in ocr_results:
                    layout_counts[block.get('layout_type', 'text')] += 1

                column_boundary = column_info.get('column_boundary')
                if column_boundary is None:
                    column_boundary = column_info.get('boundary')

                layout_summary_entry = {
                    "page_number": page_num,
                    "is_double_column": bool(column_info.get('is_double_column')),
                    "column_boundary": column_boundary,
                    "column_confidence": column_info.get('confidence'),
                    "layout_type": column_info.get('layout_type', 'single'),
                    "layout_regions": len(layout_regions),
                    "layout_counts": dict(layout_counts),
                    "table_count": len(table_regions),
                    "table_model": Config.OCR_PPSTRUCTURE_TABLE_MODEL if table_regions else None,
                    "table_regions": table_regions,
                }

                ocr_page = OCRPage(
                    page_number=page_num,
                    width=width,
                    height=height,
                    lines=[
                        OCRLine(
                            text=r['text'],
                            bbox=r['bbox'],
                            confidence=r.get('score'),
                            char_confidences=r.get('char_confidences'),
                            column=r.get('column'),
                            layout_type=r.get('layout_type'),
                            reading_order=r.get('reading_order')
                        ) for r in ocr_results
                    ] if ocr_results else [],
                    is_multi_column=bool(column_info.get('is_double_column')),
                    column_boundary=column_boundary
                )

                page_elapsed = time.time() - page_start_time
                logger.info(f"[Page {page_num}/{total_pages}] Completed in {page_elapsed:.2f}s (OCR: {ocr_elapsed:.2f}s)")

                return {
                    'page_number': page_num,
                    'image_path': image_path,
                    'width': width,
                    'height': height,
                    'ocr_results': ocr_results,
                    'ocr_page': ocr_page,
                    'column_info': column_info,
                    'layout_summary': layout_summary_entry,
                    'layout_counts': layout_counts,
                    'layout_regions_count': len(layout_regions),
                    'processing_time': page_elapsed
                }
            except Exception as exc:
                logger.error(f"[Page {page_num}] Error: {exc}")
                return {'page_number': page_num, 'error': exc}

        # Process pages in parallel using available GPUs
        max_workers = min(max(1, total_pages), len(AVAILABLE_GPUS))
        page_results = []
        ocr_start_time = time.time()

        logger.info(f"Starting parallel OCR with {max_workers} workers for {total_pages} pages")

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_map = {executor.submit(process_single_page, ctx): ctx[0] for ctx in page_contexts}
            processed_pages = 0
            cancelled = False
            for future in as_completed(future_map):
                # Check for cancellation
                if _is_job_cancelled(job_id):
                    logger.info(f"[Job {job_id}] Cancellation detected, stopping processing")
                    cancelled = True
                    for f in future_map:
                        f.cancel()
                    break

                page_result = future.result()

                # Check if page was cancelled
                if page_result.get('cancelled'):
                    cancelled = True
                    break

                processed_pages += 1
                progress = 10.0 + (processed_pages / total_pages) * 80.0
                page_num_update = page_result.get('page_number', future_map[future])
                job_manager.update_job(
                    job_id,
                    sub_stage=f"OCR processing page {page_num_update}/{total_pages}",
                    current_page=page_num_update,
                    progress_percent=progress
                )

                if page_result.get('error'):
                    raise page_result['error']

                page_results.append(page_result)

            # Handle cancellation
            if cancelled:
                job_manager.update_job(job_id, status=JobStatus.CANCELLED, message="Cancelled by user")
                _clear_cancel_flag(job_id)
                cleanup_temp_files(temp_files)
                logger.info(f"[Job {job_id}] Processing cancelled")
                return

        # Calculate OCR statistics
        ocr_total_time = time.time() - ocr_start_time
        page_times = [r.get('processing_time', 0) for r in page_results if 'processing_time' in r]
        avg_page_time = sum(page_times) / len(page_times) if page_times else 0

        logger.info("=" * 50)
        logger.info(f"OCR STATISTICS:")
        logger.info(f"  Total pages: {total_pages}")
        logger.info(f"  Total OCR time: {ocr_total_time:.2f}s")
        logger.info(f"  Avg time per page: {avg_page_time:.2f}s")
        logger.info(f"  Effective throughput: {total_pages / ocr_total_time:.2f} pages/sec")
        logger.info("=" * 50)

        page_results.sort(key=lambda r: r['page_number'])

        ocr_results_all = []
        page_pdfs = []
        layout_page_summaries = []
        document_layout_counter = Counter()

        # Generate PDFs with progress updates
        pdf_generation_start = time.time()
        for idx, page_data in enumerate(page_results):
            page_num = page_data['page_number']
            image_path = page_data['image_path']
            width = page_data['width']
            height = page_data['height']
            ocr_results = page_data['ocr_results']
            column_info = page_data['column_info']

            ocr_results_all.append(page_data['ocr_page'])
            layout_page_summaries.append(page_data['layout_summary'])
            document_layout_counter.update(page_data['layout_counts'])

            # Update progress for PDF generation phase (80-90%)
            pdf_progress = 80.0 + ((idx + 1) / total_pages) * 10.0
            job_manager.update_job(
                job_id,
                sub_stage=f"Generating PDF for page {page_num}/{total_pages}",
                current_page=page_num,
                progress_percent=pdf_progress
            )

            page_pdf_path = Config.TEMP_DIR / f"{job_id}_page_{page_num}.pdf"
            page_pdf_result = pdf_generator.generate_pdf(image_path, ocr_results, str(page_pdf_path))

            if page_pdf_result:
                page_pdfs.append(str(page_pdf_path))
                temp_files.append(str(page_pdf_path))
                logger.info(f"Page {page_num} PDF generated: {page_pdf_path}")
            else:
                logger.warning(f"Page {page_num} PDF generation failed, creating image-only PDF")
                from reportlab.pdfgen import canvas as pdf_canvas
                from PIL import Image
                img = Image.open(image_path)
                img_width, img_height = img.size
                c = pdf_canvas.Canvas(str(page_pdf_path), pagesize=(img_width, img_height))
                c.drawImage(image_path, 0, 0, width=img_width, height=img_height)
                c.save()
                page_pdfs.append(str(page_pdf_path))
                temp_files.append(str(page_pdf_path))

        pdf_generation_time = time.time() - pdf_generation_start
        logger.info(f"PDF generation completed in {pdf_generation_time:.1f}s ({total_pages} pages)")

        # STEP 3: Merge all page PDFs into final output
        job_manager.update_job(
            job_id,
            sub_stage="Merging pages into final PDF",
            progress_percent=90.0
        )

        merge_start = time.time()
        output_pdf = Config.PROCESSED_DIR / f"{job_id}.pdf"

        if len(page_pdfs) == 1:
            shutil.copy2(page_pdfs[0], output_pdf)
        else:
            from PyPDF2 import PdfMerger
            merger = PdfMerger()
            for pdf_path in page_pdfs:
                merger.append(pdf_path)
            merger.write(str(output_pdf))
            merger.close()

        merge_time = time.time() - merge_start
        logger.info(f"[TIMING] PDF merge: {merge_time:.2f}s ({len(page_pdfs)} pages)")

        layout_summary = None
        if layout_page_summaries:
            double_column_pages = sum(1 for p in layout_page_summaries if p.get('is_double_column'))
            layout_summary = {
                "pages": layout_page_summaries,
                "has_double_column": double_column_pages > 0,
                "double_column_pages": double_column_pages,
                "dominant_layout": "double_column" if double_column_pages >= (len(layout_page_summaries) / 2) else "single_column",
                "layout_counts": dict(document_layout_counter)
            }

        # Save OCR results as JSON
        ocr_result = OCRResult(
            job_id=job_id,
            has_bbox=True,
            page_count=total_pages,
            total_bboxes=sum(len(p.lines) for p in ocr_results_all),
            pages=ocr_results_all,
            layout_summary=layout_summary
        )
        ocr_json_path = Config.PROCESSED_DIR / f"{job_id}_ocr.json"
        with open(ocr_json_path, 'w', encoding='utf-8') as f:
            json.dump(ocr_result.dict(), f, ensure_ascii=False, indent=2)

        # PII 추출 및 마스킹 PDF 생성 (OCR 완료 직후 자동 실행)
        try:
            from core.pii_extractor import extract_pii_from_pages, mask_value
            from api.masking import _apply_masking

            ocr_pages = ocr_result.dict()["pages"]
            job_manager.update_job(job_id, message="개인정보 감지 중...")

            pii_boxes = extract_pii_from_pages(ocr_pages)
            for box in pii_boxes:
                box["masked_value"] = mask_value(box["type"], box["value"])

            pii_items = [
                {"type": b["type"], "value": b["value"], "masked_value": b["masked_value"]}
                for b in pii_boxes
            ]

            pii_result = {"job_id": job_id, "pii_items": pii_items, "masked_boxes": pii_boxes}
            pii_json_path = Config.PROCESSED_DIR / f"{job_id}_pii.json"
            with open(pii_json_path, 'w', encoding='utf-8') as f:
                json.dump(pii_result, f, ensure_ascii=False, indent=2)

            logger.info(f"[{job_id}] PII 추출 완료: {len(pii_items)}개")

            # 마스킹 PDF 생성 및 저장
            if output_pdf.exists():
                boxes_with_bbox = [
                    b for b in pii_boxes
                    if b.get("bbox") and b.get("masked_value") != b.get("value")
                ]
                masked_pdf_bytes = _apply_masking(output_pdf, boxes_with_bbox, ocr_result.dict())
                with open(Config.PROCESSED_DIR / f"{job_id}_masked.pdf", "wb") as f:
                    f.write(masked_pdf_bytes)
                logger.info(f"[{job_id}] 마스킹 PDF 생성 완료")

        except Exception as pii_e:
            logger.error(f"[{job_id}] PII/마스킹 처리 실패: {pii_e}")

        # Update job as completed
        timestamp = int(time.time() * 1000)
        pdf_url = f"/files/processed/{job_id}.pdf?v={timestamp}"
        job_manager.update_job(
            job_id,
            status=JobStatus.COMPLETED,
            progress_percent=100.0,
            message="Processing completed successfully",
            pdf_url=pdf_url
        )

        # Update database with OCR results
        from utils.db_helper import update_job_status, update_job_ocr_results
        update_job_status(job_id, "completed", progress=100.0)
        update_job_ocr_results(
            job_id,
            ocr_data=ocr_result.dict(),
            pdf_path=str(output_pdf),
            ocr_json_path=str(ocr_json_path)
        )

        logger.info(f"Job {job_id} completed successfully")

    except Exception as e:
        logger.error(f"Job {job_id} failed: {e}", exc_info=True)
        # Update file-based status
        job_manager.update_job(
            job_id,
            status=JobStatus.FAILED,
            message=str(e)
        )
        # Update database status
        try:
            from utils.db_helper import update_job_status
            update_job_status(job_id, "failed", error_message=str(e))
        except Exception as db_err:
            logger.error(f"Failed to update DB status for failed job {job_id}: {db_err}")
    finally:
        cleanup_temp_files(temp_files)


def _convert_page_lines_to_raw(page: Optional[OCRPage]) -> list:
    if not page or not page.lines:
        return []

    raw_lines = []
    for line in page.lines:
        if not line.bbox or len(line.bbox) != 4:
            continue
        text = (line.text or '').strip()
        if not text:
            continue
        raw_block = {
            'bbox': line.bbox,
            'text': text,
            'score': line.confidence if line.confidence is not None else 1.0
        }
        if line.column is not None:
            raw_block['column'] = line.column
        if line.layout_type:
            raw_block['layout_type'] = line.layout_type
        if line.reading_order is not None:
            raw_block['reading_order'] = line.reading_order
        raw_lines.append(raw_block)
    return raw_lines


@router.post("/export/{job_id}")
async def export_with_smart_tools(job_id: str, payload: PDFExportRequest, user_id: str = ""):
    """Apply Smart Tool edits and regenerate the final PDF."""
    job = job_manager.get_job(job_id)
    if not job:
        # job_manager는 메모리 기반이라 재시작 후 사라짐 → DB에서 fallback 조회
        try:
            db = SessionLocal()
            db_job = db.query(DBJob).filter_by(job_id=job_id).first()
            db.close()
            if db_job:
                job = {"job_id": job_id, "status": db_job.status, "original_filename": db_job.original_filename}
            else:
                raise HTTPException(status_code=404, detail="Job not found")
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=404, detail="Job not found")

    if payload.ocr_results.job_id != job_id:
        logger.warning("Payload job_id mismatch detected. Overriding with server job_id.")
        payload.ocr_results.job_id = job_id

    # Persist editor state for auditing
    editor_state_path = Config.PROCESSED_DIR / f"{job_id}_editor_state.json"
    try:
        with open(editor_state_path, 'w', encoding='utf-8') as f:
            json.dump(payload.dict(), f, ensure_ascii=False, indent=2)
    except Exception as exc:
        logger.warning(f"Failed to persist editor state: {exc}")

    job_dir = Config.RAW_DIR / job_id
    uploaded_files = list(job_dir.glob("*"))
    if not uploaded_files:
        raise HTTPException(status_code=404, detail="Original file not found")

    input_file = uploaded_files[0]
    pdf_processor = PDFProcessor()
    is_pdf = pdf_processor.is_pdf(str(input_file))

    temp_files = []
    export_image_dir = Config.TEMP_DIR / f"export_{job_id}"
    image_infos = []

    try:
        if is_pdf:
            image_infos = pdf_processor.pdf_to_images(
                str(input_file),
                export_image_dir,
                dpi=Config.PDF_DPI or 300
            )
            temp_files.extend(path for path, _, _ in image_infos)
        else:
            from PIL import Image, ImageOps

            with Image.open(input_file) as img:
                img = ImageOps.exif_transpose(img)
                width, height = img.size
            image_infos = [(str(input_file), width, height)]

        if not image_infos:
            raise HTTPException(status_code=500, detail="Failed to build page images for export")

        pdf_gen = get_pdf_generator()
        col_detector = get_column_detector()

        pages_by_number = {page.page_number: page for page in payload.ocr_results.pages}
        elements_by_page = defaultdict(list)
        for element in payload.smart_layers:
            elements_by_page[element.page_number].append(element)

        page_pdf_paths = []

        def _sort_positional(lines: list) -> list:
            """Return lines sorted by (y, x) to match actual PDF coordinates."""
            return sorted(
                lines,
                key=lambda b: (
                    b.get('bbox', [0, 0, 0, 0])[1],
                    b.get('bbox', [0, 0, 0, 0])[0]
                )
            )

        for idx, (image_path, width, height) in enumerate(image_infos, 1):
            page = pages_by_number.get(idx)
            raw_lines = _convert_page_lines_to_raw(page)
            pdf_lines = _sort_positional(raw_lines)
            page_elements = elements_by_page.get(idx, [])

            modified_image_path = image_path
            if page_elements:
                smart_image_path = Config.TEMP_DIR / f"{job_id}_smart_page_{idx}.png"
                modified_image_path = apply_smart_layers_to_image(
                    image_path,
                    page_elements,
                    smart_image_path,
                )
                if modified_image_path != image_path:
                    temp_files.append(modified_image_path)

            # Detect columns for the page
            column_info = None
            if pdf_lines and width and height:
                column_info = col_detector.detect_columns(pdf_lines, width, height)
                pdf_lines = col_detector.clamp_to_column_bounds(pdf_lines, column_info, width)

            # Generate PDF using SearchablePDFGenerator
            page_output = Config.TEMP_DIR / f"{job_id}_export_page_{idx}.pdf"
            pdf_gen.create_searchable_pdf(
                image_path=modified_image_path,
                ocr_results=pdf_lines,
                output_path=str(page_output),
                column_info=column_info
            )
            page_pdf_paths.append(page_output)
            temp_files.append(page_output)

        final_filename = f"{job_id}_final.pdf"
        final_pdf_path = Config.PROCESSED_DIR / final_filename

        if len(page_pdf_paths) == 1:
            shutil.copy2(page_pdf_paths[0], final_pdf_path)
        else:
            from PyPDF2 import PdfMerger

            merger = PdfMerger()
            for pdf_path in page_pdf_paths:
                merger.append(str(pdf_path))
            merger.write(str(final_pdf_path))
            merger.close()

        # Keep legacy filename updated for compatibility
        legacy_pdf_path = Config.PROCESSED_DIR / f"{job_id}.pdf"
        try:
            shutil.copy2(final_pdf_path, legacy_pdf_path)
        except Exception as exc:
            logger.warning(f"Failed to update legacy PDF path: {exc}")

        # Persist latest OCR results & smart layers for downstream use
        updated_json_path = Config.PROCESSED_DIR / f"{job_id}_ocr.json"
        try:
            with open(updated_json_path, 'w', encoding='utf-8') as f:
                json.dump(payload.ocr_results.dict(), f, ensure_ascii=False, indent=2)
        except Exception as exc:
            logger.warning(f"Failed to write updated OCR JSON: {exc}")

        smart_layers_path = Config.PROCESSED_DIR / f"{job_id}_smart_layers.json"
        try:
            with open(smart_layers_path, 'w', encoding='utf-8') as f:
                json.dump([layer.dict() for layer in payload.smart_layers], f, ensure_ascii=False, indent=2)
        except Exception as exc:
            logger.warning(f"Failed to write smart layers JSON: {exc}")

        timestamp = int(time.time() * 1000)
        pdf_url = f"/api/files/processed/{final_filename}?v={timestamp}"
        json_url = f"/api/download-json/{job_id}?v={timestamp}"

        job_manager.update_job(job_id, pdf_url=pdf_url)

        # 다운로드 이력 기록 + 버전 자동 생성
        if user_id:
            try:
                db = SessionLocal()
                # 다운로드 이력
                record = DownloadHistory(job_id=job_id, user_id=user_id, file_type="pdf")
                db.add(record)

                # 버전 자동 생성
                last = db.query(FileVersion).filter_by(job_id=job_id).order_by(FileVersion.version_number.desc()).first()
                next_num = (last.version_number + 1) if last else 1
                db_job = db.query(DBJob).filter_by(job_id=job_id).first()
                version = FileVersion(
                    job_id=job_id,
                    user_id=user_id,
                    version_number=next_num,
                    version_label=f"v{next_num}.0",
                    note="내보내기 시 자동 생성",
                    pdf_file_path=str(final_pdf_path),
                    ocr_json_path=str(updated_json_path),
                    file_size_bytes=final_pdf_path.stat().st_size if final_pdf_path.exists() else None,
                )
                db.add(version)
                db.commit()
                db.close()
            except Exception as e:
                logger.warning(f"Failed to record download/version: {e}")

        return {
            "message": "Export completed",
            "pdf_url": pdf_url,
            "json_url": json_url,
            "smart_layers_url": f"/files/processed/{job_id}_smart_layers.json?v={timestamp}"
        }

    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Export failed for job {job_id}: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        cleanup_temp_files(temp_files)


@router.get("/status/{job_id}", response_model=JobResponse)
async def get_job_status(job_id: str):
    """Get job status from file or database (non-blocking)"""
    from database import SessionLocal, Job as DBJob
    from utils.job_manager import JobManager
    import time

    def build_response(
        *,
        job_id_value: str,
        filename: Optional[str],
        status: str,
        progress_percent: float = 0,
        current_page: int = 0,
        total_pages: int = 0,
        message: Optional[str] = None,
        sub_stage: Optional[str] = None,
        pdf_url: Optional[str] = None,
        created_at: Optional[str] = None,
        completed_at: Optional[str] = None,
        processing_time_seconds: Optional[float] = None,
        total_text_blocks: Optional[int] = None,
        average_confidence: Optional[float] = None,
        is_double_column: Optional[bool] = None,
    ) -> JobResponse:
        raw_file_url = None
        if filename:
            raw_file_url = f"/files/raw/{job_id_value}/{filename}"

        return JobResponse(
            job_id=job_id_value,
            filename=filename,
            status=status,
            progress_percent=progress_percent,
            current_page=current_page,
            total_pages=total_pages,
            message=message,
            sub_stage=sub_stage,
            pdf_url=pdf_url,
            raw_file_url=raw_file_url,
            created_at=created_at,
            completed_at=completed_at,
            processing_time_seconds=processing_time_seconds,
            total_text_blocks=total_text_blocks,
            average_confidence=average_confidence,
            is_double_column=is_double_column,
        )

    # Prefer file-based status when worker is actively updating progress.
    file_status = JobManager.read_status_from_file(job_id)
    if file_status:
        # Check if DB has completed/failed state (which might have more info like processing_time)
        db = SessionLocal()
        try:
            db_job = db.query(DBJob).filter_by(job_id=job_id).first()
            if db_job and db_job.status in {"completed", "failed", "cancelled"} and file_status.get("status") != "failed":
                # Fall through to DB check if DB is already finished and file isn't failed
                pass
            else:
                return build_response(
                    job_id_value=file_status["job_id"],
                    filename=file_status.get("filename"),
                    status=file_status.get("status", "unknown"),
                    progress_percent=file_status.get("progress_percent", 0),
                    current_page=file_status.get("current_page", 0),
                    total_pages=file_status.get("total_pages", 0),
                    message=file_status.get("message"),
                    sub_stage=file_status.get("sub_stage"),
                    pdf_url=file_status.get("pdf_url"),
                )
        finally:
            db.close()

    db = SessionLocal()
    try:
        db_job = db.query(DBJob).filter_by(job_id=job_id).first()
        if not db_job and not file_status:
            raise HTTPException(status_code=404, detail="Job not found")

        # Completed/failed states from DB are more authoritative than stale in-memory queued state.
        if db_job and db_job.status in {"completed", "failed", "cancelled"}:
            pdf_url = None
            if db_job.pdf_file_path:
                import os
                filename = os.path.basename(db_job.pdf_file_path)
                timestamp = int(time.time() * 1000)
                pdf_url = f"/files/processed/{filename}?v={timestamp}"

            return build_response(
                job_id_value=db_job.job_id,
                filename=db_job.original_filename,
                status=db_job.status,
                progress_percent=db_job.progress_percent,
                current_page=db_job.current_page,
                total_pages=db_job.total_pages,
                message=db_job.error_message,
                pdf_url=pdf_url,
                created_at=db_job.created_at.isoformat() if db_job.created_at else None,
                completed_at=db_job.completed_at.isoformat() if db_job.completed_at else None,
                processing_time_seconds=db_job.processing_time_seconds,
                total_text_blocks=db_job.total_text_blocks,
                average_confidence=db_job.average_confidence,
                is_double_column=db_job.is_double_column,
            )

        # If there is a file-based queued state, prefer it over stale memory.
        if file_status and file_status.get("status") in {"queued", "failed", "completed", "cancelled"}:
            return build_response(
                job_id_value=file_status["job_id"],
                filename=file_status.get("filename"),
                status=file_status.get("status", "unknown"),
                progress_percent=file_status.get("progress_percent", 0),
                current_page=file_status.get("current_page", 0),
                total_pages=file_status.get("total_pages", 0),
                message=file_status.get("message"),
                sub_stage=file_status.get("sub_stage"),
                pdf_url=file_status.get("pdf_url"),
            )

        # Try memory for active jobs in the API process.
        memory_job = job_manager.get_job(job_id)
        if memory_job:
            status_str = memory_job.status.value if hasattr(memory_job.status, 'value') else memory_job.status
            return build_response(
                job_id_value=memory_job.job_id,
                filename=memory_job.filename,
                status=status_str,
                progress_percent=memory_job.progress_percent,
                current_page=memory_job.current_page,
                total_pages=memory_job.total_pages,
                message=memory_job.message,
                sub_stage=memory_job.sub_stage,
                pdf_url=memory_job.pdf_url,
            )

        if db_job:
            return build_response(
                job_id_value=db_job.job_id,
                filename=db_job.original_filename,
                status=db_job.status,
                progress_percent=db_job.progress_percent,
                current_page=db_job.current_page,
                total_pages=db_job.total_pages,
                message=db_job.error_message,
                created_at=db_job.created_at.isoformat() if db_job.created_at else None,
                completed_at=db_job.completed_at.isoformat() if db_job.completed_at else None,
                processing_time_seconds=db_job.processing_time_seconds,
                total_text_blocks=db_job.total_text_blocks,
                average_confidence=db_job.average_confidence,
                is_double_column=db_job.is_double_column,
            )

        raise HTTPException(status_code=404, detail="Job not found")
    finally:
        db.close()


@router.get("/ocr-results/{job_id}")
async def get_ocr_results(job_id: str):
    """Get OCR results for a job"""
    ocr_json_path = resolve_ocr_json_path(job_id)

    if not ocr_json_path:
        db = SessionLocal()
        try:
            db_job = db.query(DBJob).filter_by(job_id=job_id).first()
        finally:
            db.close()

        if db_job:
            raise HTTPException(
                status_code=404,
                detail="OCR result file is missing for this job",
            )
        raise HTTPException(status_code=404, detail="Job not found")

    try:
        with open(ocr_json_path, 'r', encoding='utf-8') as f:
            ocr_data = json.load(f)
        return ocr_data
    except Exception as e:
        logger.error(f"Failed to read OCR results: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/download-json/{job_id}")
async def download_json(job_id: str):
    """Download OCR results as JSON file"""
    ocr_json_path = resolve_ocr_json_path(job_id)

    if not ocr_json_path:
        raise HTTPException(status_code=404, detail="OCR results not found")

    return FileResponse(
        path=str(ocr_json_path),
        filename=f"{job_id}_ocr.json",
        media_type="application/json"
    )


@router.post("/save-edits/{job_id}")
async def save_ocr_edits(job_id: str, payload: dict):
    """
    Save user's OCR text edits for model fine-tuning.
    Logs edits separately and updates the main OCR JSON.
    """
    from datetime import datetime

    try:
        # Validate job exists
        job = job_manager.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        ocr_json_path = resolve_ocr_json_path(job_id)
        if not ocr_json_path:
            raise HTTPException(status_code=404, detail="OCR results not found")

        # Read current OCR results
        with open(ocr_json_path, 'r', encoding='utf-8') as f:
            ocr_data = json.load(f)

        # Extract edits from payload
        edits = payload.get('edits', [])
        ocr_results = payload.get('ocr_results')

        if not edits and not ocr_results:
            return {"status": "success", "message": "No changes to save", "saved_at": datetime.now().isoformat()}

        # Log edits for fine-tuning (append to edit log file)
        edit_log_path = Config.DATA_DIR / "edit_logs" / f"{job_id}_edits.jsonl"
        edit_log_path.parent.mkdir(parents=True, exist_ok=True)

        log_entry = {
            "timestamp": datetime.now().isoformat(),
            "job_id": job_id,
            "edits": edits,
            "user_agent": "web_editor"
        }

        with open(edit_log_path, 'a', encoding='utf-8') as f:
            f.write(json.dumps(log_entry, ensure_ascii=False) + '\n')

        logger.info(f"Logged {len(edits)} edits for job {job_id}")

        # Update main OCR results if provided
        if ocr_results:
            with open(ocr_json_path, 'w', encoding='utf-8') as f:
                json.dump(ocr_results, f, ensure_ascii=False, indent=2)
            logger.info(f"Updated OCR results for job {job_id}")

        return {
            "status": "success",
            "message": f"Saved {len(edits)} edits",
            "saved_at": datetime.now().isoformat()
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to save edits: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Jobs endpoints have been moved to api/jobs.py for database-backed implementation
