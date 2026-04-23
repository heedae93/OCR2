"""
FastAPI main application for BBOCR
"""
import os
import logging

# Load config first to get GPU settings
from config import Config

# Set CUDA_VISIBLE_DEVICES from config (before importing paddle)
os.environ['CUDA_VISIBLE_DEVICES'] = Config.CUDA_VISIBLE_DEVICES

# paddleocr과 layout_detector가 각각 paddlex를 import할 때 "already initialized" 오류 방지
# EAGER_INITIALIZATION=False → repo_manager.initialize()를 지연 초기화로 전환
os.environ.setdefault('PADDLE_PDX_EAGER_INIT', '0')

# langchain 1.x에서 제거된 langchain.docstore 호환 shim (paddlex 내부에서 사용)
import sys, types
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

# Set cuDNN/cuBLAS library paths
if not Config.GPU_AUTO_DETECT_LIBS:
    # Use manually specified paths from config.yaml
    cudnn_path = Config.GPU_CUDNN_LIB_PATH
    cublas_path = Config.GPU_CUBLAS_LIB_PATH
    if cudnn_path or cublas_path:
        current_ld_path = os.environ.get('LD_LIBRARY_PATH', '')
        parts = [p for p in [cudnn_path, cublas_path, current_ld_path] if p]
        os.environ['LD_LIBRARY_PATH'] = ':'.join(parts)

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError, DatabaseError

# Import CTC patch module (paddlex 초기화는 patch_ctc_decoder() 호출 시 발생)
from core.ctc_patch import patch_ctc_decoder

# PaddleOCR/paddlex 먼저 임포트 (paddlex 초기화 1회 수행)

from api import ocr, storage, drive, jobs, sessions, settings, export, auth, users,masking
from api import metadata_settings
from api import metadata_v2
from api import metadata_v3
from api import history


# CTC patch는 paddleocr 임포트 이후에 적용 (paddlex 재초기화 충돌 방지)
patch_ctc_decoder()
from database import init_db

# Configure logging
logging.basicConfig(
    level=getattr(logging, 'INFO'),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title="BBOCR API",
    description="Powerful multilingual OCR with searchable PDF generation",
    version="1.0.0"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=Config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def log_requests(request: Request, call_next):
    logger.info(f"Incoming request: {request.method} {request.url}")
    response = await call_next(request)
    logger.info(f"Response status: {response.status_code}")
    return response


# DB 연결 오류를 HTTP 503으로 변환 (CORS 헤더가 포함된 응답 반환)
@app.exception_handler(OperationalError)
async def db_operational_error_handler(request: Request, exc: OperationalError):
    logger.error(f"DB connection error: {exc}")
    return JSONResponse(status_code=503, content={"detail": "데이터베이스 연결 오류입니다. 잠시 후 다시 시도해주세요."})

@app.exception_handler(DatabaseError)
async def db_error_handler(request: Request, exc: DatabaseError):
    logger.error(f"DB error: {exc}")
    return JSONResponse(status_code=503, content={"detail": "데이터베이스 오류가 발생했습니다."})

# Include routers
app.include_router(ocr.router, prefix="/api", tags=["OCR"])
app.include_router(storage.router, prefix="/api", tags=["Storage"])
app.include_router(drive.router, tags=["Drive"])
app.include_router(jobs.router, prefix="/api", tags=["Jobs"])
app.include_router(sessions.router, prefix="/api", tags=["Sessions"])
app.include_router(settings.router, tags=["Settings"])
app.include_router(export.router, tags=["Export"])
app.include_router(auth.router, prefix="/api", tags=["Auth"])
app.include_router(masking.router, tags=["Masking"])
app.include_router(users.router, prefix="/api", tags=["Users"])
app.include_router(metadata_settings.router, prefix="/api", tags=["MetadataSettings"])
app.include_router(metadata_v2.router, prefix="/api", tags=["MetadataV2"])
app.include_router(metadata_v3.router, prefix="/api", tags=["MetadataV3"])
app.include_router(history.router, prefix="/api", tags=["History"])

# Mount static files
try:
    app.mount(
        "/files/processed",
        StaticFiles(directory=str(Config.PROCESSED_DIR)),
        name="processed"
    )
    logger.info("Mounted processed files directory")
except Exception as e:
    logger.warning(f"Failed to mount processed files: {e}")


@app.on_event("startup")
async def startup_event():
    """Application startup"""
    logger.info("=" * 60)
    logger.info("BBOCR API Starting...")
    logger.info(f"Backend URL: http://{Config.BACKEND_HOST}:{Config.BACKEND_PORT}")
    logger.info(f"Data directory: {Config.DATA_DIR}")
    logger.info(f"CUDA_VISIBLE_DEVICES: {Config.CUDA_VISIBLE_DEVICES}")
    logger.info(f"Available GPU IDs: {Config.AVAILABLE_GPU_IDS}")
    logger.info("=" * 60)

    # Ensure directories exist
    Config.ensure_directories()
    logger.info("Data directories verified")

    # Initialize database
    try:
        init_db()
        logger.info("Database initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")

    # Reset orphaned 'processing' jobs left from previous crash/restart
    try:
        from database import SessionLocal, Job as DBJob
        db = SessionLocal()
        orphaned = db.query(DBJob).filter(DBJob.status.in_(["processing", "queued"])).all()
        for job in orphaned:
            job.status = "failed"
            job.error_message = "서버 재시작으로 인해 중단됨"
        db.commit()
        db.close()
        if orphaned:
            logger.warning(f"Reset {len(orphaned)} orphaned processing/queued jobs to failed")
    except Exception as e:
        logger.error(f"Failed to reset orphaned jobs: {e}")

    # Pre-load OCR models for all GPUs at startup
    logger.info("=" * 60)
    logger.info("Pre-loading OCR models for faster processing...")
    try:
        from api.ocr import preload_all_models
        # await preload_all_models()  # Temporarily bypassed to fix Windows startup hangs
        logger.info("All OCR models pre-loaded successfully!")
    except Exception as e:
        logger.error(f"Failed to pre-load OCR models: {e}")
        logger.warning("Models will be loaded on first request (slower)")
    logger.info("=" * 60)


@app.on_event("shutdown")
async def shutdown_event():
    """Application shutdown"""
    logger.info("BBOCR API shutting down...")


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "name": "BBOCR API",
        "version": "1.0.0",
        "status": "running",
        "docs": "/docs"
    }


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "message": "BBOCR API is running"
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=Config.BACKEND_HOST,
        port=Config.BACKEND_PORT,
        reload=True,
        log_level="info"
    )
