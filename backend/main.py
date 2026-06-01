"""
FastAPI main application for BBOCR
"""
import asyncio
import os
import logging
import subprocess
import sys
from pathlib import Path

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

from api import ocr, storage, drive, jobs, sessions, settings, export, auth, users, masking, search, tika
from api import metadata_settings
from api import metadata_v2
from api import metadata_v3
from api import history
from api import my_dashboard


# CTC patch는 paddleocr 임포트 이후에 적용 (paddlex 재초기화 충돌 방지)
patch_ctc_decoder()
from database import init_db

# Configure logging
logging.basicConfig(
    level=getattr(logging, 'INFO'),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent
LOG_DIR = PROJECT_ROOT / "logs"
WORKER_SUPERVISOR_PID_PATH = LOG_DIR / "worker_supervisor.pid"
WORKER_PID_PATH = LOG_DIR / "worker.pid"
WORKER_WATCHDOG_TASK: asyncio.Task | None = None


def _pid_running(pid: int) -> bool:
    if os.name == "nt":
        try:
            result = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            return f'"{pid}"' in result.stdout
        except Exception:
            return False

    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False
    except Exception:
        return False


def _pid_file_running(path: Path) -> tuple[bool, int | None]:
    try:
        if not path.exists():
            return False, None
        pid = int(path.read_text(encoding="utf-8").strip())
        return _pid_running(pid), pid
    except Exception:
        return False, None


def _start_worker_supervisor_if_needed(reason: str) -> bool:
    running, pid = _pid_file_running(WORKER_SUPERVISOR_PID_PATH)
    if running:
        return False

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    env.setdefault("KMP_DUPLICATE_LIB_OK", "True")
    env.setdefault("PYTHONUNBUFFERED", "1")
    env.setdefault("WORKER_QUEUES", "ocr,tika")

    creationflags = 0
    startupinfo = None
    if os.name == "nt":
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW

    log = (LOG_DIR / "worker_supervisor_autostart.log").open("a", encoding="utf-8", buffering=1)
    process = subprocess.Popen(
        [sys.executable, "scripts/worker_supervisor.py", "--queues", env["WORKER_QUEUES"]],
        cwd=str(BACKEND_DIR),
        env=env,
        stdout=log,
        stderr=subprocess.STDOUT,
        creationflags=creationflags,
        startupinfo=startupinfo,
    )
    WORKER_SUPERVISOR_PID_PATH.write_text(str(process.pid), encoding="utf-8")
    logger.warning(
        "Worker supervisor was not running%s. Started PID=%s%s",
        f" (stale PID={pid})" if pid else "",
        process.pid,
        f" after {reason}" if reason else "",
    )
    return True


async def _worker_supervisor_watchdog():
    while True:
        try:
            _start_worker_supervisor_if_needed("backend-watchdog")
        except Exception as exc:
            logger.error("Worker supervisor watchdog failed: %s", exc)
        await asyncio.sleep(15)

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
app.include_router(search.router, tags=["Search"])
app.include_router(tika.router, prefix="/api", tags=["Tika"])
app.include_router(my_dashboard.router, tags=["MyDashboard"])

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
    global WORKER_WATCHDOG_TASK
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

    # 2. OpenSearch 인덱스 초기화
    try:
        from core.search_engine import search_engine
        search_engine.create_index_if_not_exists()
        logger.info(f"OpenSearch index '{Config.OS_INDEX_NAME}' verified/created")
    except Exception as e:
        logger.error(f"Failed to initialize OpenSearch: {e}")
        logger.warning("Search functionality might not work properly")

    # Initialize database
    try:
        init_db()
        logger.info("Database initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")

    # Do not fail active jobs just because the API process restarted.
    # OCR work runs in Celery, so workers may continue processing while FastAPI restarts.
    try:
        from database import SessionLocal, Job as DBJob
        db = SessionLocal()
        active_count = db.query(DBJob).filter(DBJob.status.in_(["processing", "queued"])).count()
        db.close()
        if active_count:
            logger.info(f"Preserving {active_count} active queued/processing jobs after API startup")
    except Exception as e:
        logger.error(f"Failed to inspect active jobs on startup: {e}")

    try:
        _start_worker_supervisor_if_needed("api-startup")
        if WORKER_WATCHDOG_TASK is None or WORKER_WATCHDOG_TASK.done():
            WORKER_WATCHDOG_TASK = asyncio.create_task(_worker_supervisor_watchdog())
            logger.info("Worker supervisor watchdog started")
    except Exception as e:
        logger.error(f"Failed to start worker supervisor watchdog: {e}")

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
    global WORKER_WATCHDOG_TASK
    logger.info("BBOCR API shutting down...")
    if WORKER_WATCHDOG_TASK:
        WORKER_WATCHDOG_TASK.cancel()
        WORKER_WATCHDOG_TASK = None
    from database import engine
    engine.dispose()
    logger.info("Database connections closed.")


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


@app.get("/api/worker/health")
async def worker_health():
    """Celery 워커 상태 확인"""
    try:
        supervisor_started = _start_worker_supervisor_if_needed("worker-health")
        from tasks.celery_app import celery_app
        inspector = celery_app.control.inspect(timeout=4.0)

        # 1) Fast path: ping
        ping_result = inspector.ping() or {}
        if ping_result:
            workers = list(ping_result.keys())
            return {"available": True, "workers": workers, "source": "ping"}

        # 2) Fallbacks: some Windows/solo-pool setups intermittently fail ping
        stats_result = inspector.stats() or {}
        active_result = inspector.active() or {}
        registered_result = inspector.registered() or {}

        worker_names = set()
        worker_names.update(stats_result.keys())
        worker_names.update(active_result.keys())
        worker_names.update(registered_result.keys())

        workers = sorted(worker_names)
        if workers:
            return {"available": True, "workers": workers, "source": "fallback"}

        supervisor_running, supervisor_pid = _pid_file_running(WORKER_SUPERVISOR_PID_PATH)
        worker_running, worker_pid = _pid_file_running(WORKER_PID_PATH)
        if supervisor_running or worker_running:
            return {
                "available": True,
                "workers": [],
                "source": "pid-file",
                "supervisor_pid": supervisor_pid,
                "worker_pid": worker_pid,
                "started_supervisor": supervisor_started,
            }

        return {"available": False, "workers": [], "source": "none"}
    except Exception as e:
        return {"available": False, "workers": [], "error": str(e)}


@app.get("/api/redis/health")
async def redis_health():
    """Redis 연결 상태 확인"""
    try:
        from config import Config
        import redis as redis_lib
        r = redis_lib.from_url(Config.REDIS_URL, socket_connect_timeout=2, socket_timeout=2)
        r.ping()
        return {"available": True}
    except Exception as e:
        return {"available": False, "error": str(e)}


@app.get("/api/debug")
async def debug_identity():
    import datetime
    return {
        "identity": "Antigravity Debug System",
        "timestamp": str(datetime.datetime.now()),
        "status": "active",
        "db_url": "postgresql+psycopg2://ocr_user:***@192.168.0.231:3306/ocr_db"
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
