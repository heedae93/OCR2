"""
Configuration management for BBOCR application
"""
import os
from pathlib import Path
from typing import Optional, Dict, Any, List
import yaml


class Config:
    """Application configuration"""

    # Base paths
    BASE_DIR = Path(__file__).parent.parent
    DATA_DIR = BASE_DIR / "data"

    # Data directories
    RAW_DIR = DATA_DIR / "raw"
    PROCESSED_DIR = DATA_DIR / "processed"
    DEBUG_DIR = DATA_DIR / "debug"
    MODELS_DIR = DATA_DIR / "models"
    TEMP_DIR = DATA_DIR / "temp"

    # Server settings
    BACKEND_HOST = os.getenv("BACKEND_HOST", "0.0.0.0")
    BACKEND_PORT = int(os.getenv("BACKEND_PORT", "5015"))
    FRONTEND_HOST = "0.0.0.0"
    FRONTEND_PORT = 5017
    CORS_ORIGINS = [
        "http://localhost:5017",
        "http://127.0.0.1:5017",
    ]

    # Database settings
    DATABASE_URL: Optional[str] = None

    # GPU settings
    CUDA_VISIBLE_DEVICES = os.getenv("CUDA_VISIBLE_DEVICES", "0")
    AVAILABLE_GPU_IDS: List[int] = [0]
    GPU_AUTO_DETECT_LIBS = True
    GPU_CUDNN_LIB_PATH = ""
    GPU_CUBLAS_LIB_PATH = ""

    # OCR settings
    OCR_USE_GPU = True
    OCR_GPU_ID = 0
    OCR_CPU_THREADS = 8
    OCR_BATCH_SIZE = 64
    OCR_REC_BATCH_NUM = 32
    OCR_DETECTION_LIMIT = 4000
    OCR_LANG = "korean"
    OCR_MODEL_DIR = MODELS_DIR / "best_0828"
    OCR_CHAR_DICT_PATH: Optional[Path] = None
    OCR_ENABLE_LINE_MERGE = False
    OCR_ENGINE = "pp_structure"
    OCR_PPSTRUCTURE_LAYOUT_MODEL = "PP-DocLayout-L"
    OCR_PPSTRUCTURE_REC_MODEL = "PP-OCRv5_server_rec"
    OCR_PPSTRUCTURE_TABLE_MODEL = "SLANet_plus"
    OCR_PPSTRUCTURE_WIRELESS_TABLE_MODEL = "SLANet"
    OCR_PPSTRUCTURE_USE_TABLE_RECOGNITION = True

    # Tiling (chunking) settings
    OCR_TILING_ENABLED = True
    OCR_TILE_SIZE = 1500
    OCR_TILE_OVERLAP = 150
    OCR_TILE_NMS_IOU = 0.3

    # Table Transformer settings
    # backend: slanet | table_transformer | hybrid
    OCR_TABLE_BACKEND = "hybrid"
    TABLE_TRANSFORMER_DET_MODEL = "microsoft/table-transformer-detection"
    TABLE_TRANSFORMER_STR_MODEL = (
        "microsoft/table-transformer-structure-recognition-v1.1-all"
    )
    TABLE_TRANSFORMER_DET_THRESHOLD = 0.9
    TABLE_TRANSFORMER_STR_THRESHOLD = 0.6

    # Reading order settings
    USE_SMART_READING_ORDER = True
    READING_ORDER_ROW_OVERLAP = 0.4
    READING_ORDER_COLUMN_GAP = 0.08
    READING_ORDER_COLUMN_BALANCE = 0.25

    # Layout detection
    USE_LAYOUT_DETECTION = True
    LAYOUT_MODEL_NAME = "PP-DocLayout-L"
    LAYOUT_IOU_THRESHOLD = 0.5
    LAYOUT_MAX_DIMENSION = 1400
    LAYOUT_CACHE_ENABLED = True

    # PDF processing
    PDF_DPI = None
    PDF_FAST_MODE = True

    # Preprocessing
    DENOISE_ENABLED = True
    DENOISE_H = 6
    UPSCALE_ENABLED = True
    UPSCALE_MIN_EDGE = 1600
    UPSCALE_MAX_SCALE = 2.0
    CLAHE_ENABLED = True
    CLAHE_CLIP_LIMIT = 3.0
    CLAHE_TILE_GRID = (8, 8)

    # Text layer settings
    EXPAND_CLICK_AREA = True
    BBOX_EXPANSION_PIXELS = 0
    FONT_SIZE_BOOST = 1.0
    COVERAGE_FILL_RATIO = 1.0
    WIDTH_OVERSHOOT_RATIO = 1.0

    # Column detection
    COLUMN_DEBUG_OUTPUT = True
    COLUMN_CONFIDENCE_THRESHOLD = 0.05
    COLUMN_MIN_BLOCKS = 4

    # LLM & Web Search (EXAONE)
    LLM_ENABLED = True
    LLM_API_URL = "http://211.233.58.220:8079"
    LLM_MODEL_NAME = "exaone3.5:latest"
    LLM_ENABLE_WEB_SEARCH = True

    # Redis settings (Celery broker)
    REDIS_URL = "redis://localhost:6379/0"

    # User settings
    DEFAULT_USER_ID = "user001"
    DEFAULT_USER_NAME = "사용자"
    DEFAULT_USER_EMAIL = "user@email.com"

    @classmethod
    def ensure_directories(cls):
        """Create necessary directories if they don't exist"""
        for directory in [cls.RAW_DIR, cls.PROCESSED_DIR, cls.DEBUG_DIR,
                         cls.MODELS_DIR, cls.TEMP_DIR]:
            directory.mkdir(parents=True, exist_ok=True)

    @classmethod
    def _resolve_path(cls, path_str: str) -> Path:
        """Resolve a path: absolute paths stay as-is, relative paths resolve from BASE_DIR"""
        p = Path(path_str)
        if p.is_absolute():
            return p
        return cls.BASE_DIR / p

    @classmethod
    def load_from_yaml(cls, yaml_path: Optional[Path] = None):
        """Load configuration from YAML file"""
        if yaml_path is None:
            yaml_path = cls.BASE_DIR / "config.yaml"

        if not yaml_path.exists():
            return

        with open(yaml_path, 'r', encoding='utf-8') as f:
            config_data = yaml.safe_load(f)

        # Update GPU settings
        if "gpu" in config_data:
            gpu = config_data["gpu"]
            cls.CUDA_VISIBLE_DEVICES = os.getenv(
                "CUDA_VISIBLE_DEVICES",
                str(gpu.get("cuda_visible_devices", cls.CUDA_VISIBLE_DEVICES))
            )
            cls.AVAILABLE_GPU_IDS = gpu.get("available_gpu_ids", cls.AVAILABLE_GPU_IDS)
            cls.GPU_AUTO_DETECT_LIBS = gpu.get("auto_detect_libs", cls.GPU_AUTO_DETECT_LIBS)
            cls.GPU_CUDNN_LIB_PATH = gpu.get("cudnn_lib_path", cls.GPU_CUDNN_LIB_PATH)
            cls.GPU_CUBLAS_LIB_PATH = gpu.get("cublas_lib_path", cls.GPU_CUBLAS_LIB_PATH)

        # Update OCR settings
        if "ocr" in config_data:
            ocr = config_data["ocr"]
            cls.OCR_USE_GPU = ocr.get("use_gpu", cls.OCR_USE_GPU)
            cls.OCR_GPU_ID = ocr.get("gpu_id", cls.OCR_GPU_ID)
            cls.OCR_CPU_THREADS = ocr.get("cpu_threads", cls.OCR_CPU_THREADS)
            cls.OCR_BATCH_SIZE = ocr.get("batch_size", cls.OCR_BATCH_SIZE)
            cls.OCR_REC_BATCH_NUM = ocr.get("rec_batch_num", cls.OCR_REC_BATCH_NUM)
            cls.OCR_DETECTION_LIMIT = ocr.get("detection_limit_side_len", cls.OCR_DETECTION_LIMIT)
            cls.OCR_ENABLE_LINE_MERGE = ocr.get("enable_line_merge", cls.OCR_ENABLE_LINE_MERGE)
            cls.OCR_ENGINE = ocr.get("engine", cls.OCR_ENGINE)
            cls.OCR_PPSTRUCTURE_LAYOUT_MODEL = ocr.get("ppstructure_layout_model", cls.OCR_PPSTRUCTURE_LAYOUT_MODEL)
            cls.OCR_PPSTRUCTURE_REC_MODEL = ocr.get("ppstructure_recognition_model", cls.OCR_PPSTRUCTURE_REC_MODEL)
            cls.OCR_PPSTRUCTURE_TABLE_MODEL = ocr.get("table_model_name", cls.OCR_PPSTRUCTURE_TABLE_MODEL)
            cls.OCR_PPSTRUCTURE_WIRELESS_TABLE_MODEL = ocr.get(
                "wireless_table_model_name",
                cls.OCR_PPSTRUCTURE_WIRELESS_TABLE_MODEL,
            )
            cls.OCR_PPSTRUCTURE_USE_TABLE_RECOGNITION = ocr.get(
                "use_table_recognition",
                cls.OCR_PPSTRUCTURE_USE_TABLE_RECOGNITION,
            )
            cls.OCR_TABLE_BACKEND = ocr.get(
                "table_recognition_backend", cls.OCR_TABLE_BACKEND
            )
            if "table_transformer" in ocr:
                tt = ocr["table_transformer"]
                cls.TABLE_TRANSFORMER_DET_MODEL = tt.get(
                    "detection_model", cls.TABLE_TRANSFORMER_DET_MODEL
                )
                cls.TABLE_TRANSFORMER_STR_MODEL = tt.get(
                    "structure_model", cls.TABLE_TRANSFORMER_STR_MODEL
                )
                cls.TABLE_TRANSFORMER_DET_THRESHOLD = tt.get(
                    "detection_threshold", cls.TABLE_TRANSFORMER_DET_THRESHOLD
                )
                cls.TABLE_TRANSFORMER_STR_THRESHOLD = tt.get(
                    "structure_threshold", cls.TABLE_TRANSFORMER_STR_THRESHOLD
                )

            if "recognition_model_dir" in ocr:
                model_dir_value = ocr["recognition_model_dir"]
                if model_dir_value:
                    cls.OCR_MODEL_DIR = cls._resolve_path(model_dir_value)

            if "char_dict_path" in ocr:
                char_path = ocr["char_dict_path"]
                if char_path:
                    cls.OCR_CHAR_DICT_PATH = cls._resolve_path(char_path)

            # Tiling settings
            if "tiling" in ocr:
                tiling = ocr["tiling"]
                cls.OCR_TILING_ENABLED = tiling.get("enabled", cls.OCR_TILING_ENABLED)
                cls.OCR_TILE_SIZE = tiling.get("tile_size", cls.OCR_TILE_SIZE)
                cls.OCR_TILE_OVERLAP = tiling.get("overlap", cls.OCR_TILE_OVERLAP)
                cls.OCR_TILE_NMS_IOU = tiling.get("nms_iou_threshold", cls.OCR_TILE_NMS_IOU)

            # Reading order settings
            cls.USE_SMART_READING_ORDER = ocr.get("use_smart_reading_order", cls.USE_SMART_READING_ORDER)
            if "reading_order" in ocr:
                ro = ocr["reading_order"]
                cls.READING_ORDER_ROW_OVERLAP = ro.get("row_overlap_threshold", cls.READING_ORDER_ROW_OVERLAP)
                cls.READING_ORDER_COLUMN_GAP = ro.get("column_gap_ratio", cls.READING_ORDER_COLUMN_GAP)
                cls.READING_ORDER_COLUMN_BALANCE = ro.get("column_balance_ratio", cls.READING_ORDER_COLUMN_BALANCE)

        # Update PDF processing settings
        if "pdf_processing" in config_data:
            pdf = config_data["pdf_processing"]
            cls.PDF_DPI = pdf.get("dpi", cls.PDF_DPI)
            cls.PDF_FAST_MODE = pdf.get("fast_mode", cls.PDF_FAST_MODE)

        # Update preprocessing settings
        if "preprocessing" in config_data:
            prep = config_data["preprocessing"]
            if "denoise" in prep:
                cls.DENOISE_ENABLED = prep["denoise"].get("enabled", cls.DENOISE_ENABLED)
                cls.DENOISE_H = prep["denoise"].get("h", cls.DENOISE_H)
            if "upscale" in prep:
                cls.UPSCALE_ENABLED = prep["upscale"].get("enabled", cls.UPSCALE_ENABLED)
                cls.UPSCALE_MIN_EDGE = prep["upscale"].get("min_edge", cls.UPSCALE_MIN_EDGE)
                cls.UPSCALE_MAX_SCALE = prep["upscale"].get("max_scale", cls.UPSCALE_MAX_SCALE)
            if "clahe" in prep:
                cls.CLAHE_ENABLED = prep["clahe"].get("enabled", cls.CLAHE_ENABLED)
                cls.CLAHE_CLIP_LIMIT = prep["clahe"].get("clip_limit", cls.CLAHE_CLIP_LIMIT)
                cls.CLAHE_TILE_GRID = tuple(prep["clahe"].get("tile_grid_size", cls.CLAHE_TILE_GRID))

        # Update text coverage settings
        if "text_coverage" in config_data:
            text_cov = config_data["text_coverage"]
            cls.EXPAND_CLICK_AREA = text_cov.get("expand_click_area", cls.EXPAND_CLICK_AREA)
            cls.BBOX_EXPANSION_PIXELS = text_cov.get("bbox_expansion_pixels", cls.BBOX_EXPANSION_PIXELS)
            cls.FONT_SIZE_BOOST = text_cov.get("font_size_boost", cls.FONT_SIZE_BOOST)
            cls.COVERAGE_FILL_RATIO = text_cov.get("coverage_fill_ratio", cls.COVERAGE_FILL_RATIO)
            cls.WIDTH_OVERSHOOT_RATIO = text_cov.get("width_overshoot_ratio", cls.WIDTH_OVERSHOOT_RATIO)

        # Update layout detection settings
        if "layout_detection" in config_data:
            layout = config_data["layout_detection"]
            cls.USE_LAYOUT_DETECTION = layout.get("enabled", cls.USE_LAYOUT_DETECTION)
            cls.LAYOUT_MODEL_NAME = layout.get("model_name", cls.LAYOUT_MODEL_NAME)
            cls.LAYOUT_IOU_THRESHOLD = layout.get("iou_threshold", cls.LAYOUT_IOU_THRESHOLD)
            cls.LAYOUT_MAX_DIMENSION = layout.get("max_dimension", cls.LAYOUT_MAX_DIMENSION)
            cls.LAYOUT_CACHE_ENABLED = layout.get("cache_enabled", cls.LAYOUT_CACHE_ENABLED)

        # Update column detection settings
        if "column_detection" in config_data:
            col_det = config_data["column_detection"]
            cls.COLUMN_DEBUG_OUTPUT = col_det.get("enable_debug_output", cls.COLUMN_DEBUG_OUTPUT)
            cls.COLUMN_CONFIDENCE_THRESHOLD = col_det.get("confidence_threshold", cls.COLUMN_CONFIDENCE_THRESHOLD)
            cls.COLUMN_MIN_BLOCKS = col_det.get("min_blocks_for_detection", cls.COLUMN_MIN_BLOCKS)

        # Update user settings
        if "user" in config_data:
            user = config_data["user"]
            cls.DEFAULT_USER_ID = user.get("default_id", cls.DEFAULT_USER_ID)
            cls.DEFAULT_USER_NAME = user.get("default_name", cls.DEFAULT_USER_NAME)
            cls.DEFAULT_USER_EMAIL = user.get("default_email", cls.DEFAULT_USER_EMAIL)

        # Update LLM settings
        if "llm_integration" in config_data:
            llm = config_data["llm_integration"]
            cls.LLM_ENABLED = llm.get("enabled", cls.LLM_ENABLED)
            cls.LLM_API_URL = llm.get("api_url", cls.LLM_API_URL)
            cls.LLM_MODEL_NAME = llm.get("model_name", cls.LLM_MODEL_NAME)
            cls.LLM_ENABLE_WEB_SEARCH = llm.get("enable_web_search", cls.LLM_ENABLE_WEB_SEARCH)

        # Update database settings
        if "database" in config_data:
            db_config = config_data["database"]
            cls.DATABASE_URL = db_config.get("url", cls.DATABASE_URL)

        # Update Redis settings
        if "redis" in config_data:
            cls.REDIS_URL = config_data["redis"].get("url", cls.REDIS_URL)

        # Update server settings
        if "server" in config_data:
            server = config_data["server"]
            if "backend" in server:
                cls.BACKEND_HOST = server["backend"].get("host", cls.BACKEND_HOST)
                cls.BACKEND_PORT = server["backend"].get("port", cls.BACKEND_PORT)
            if "frontend" in server:
                cls.FRONTEND_HOST = server["frontend"].get("host", cls.FRONTEND_HOST)
                cls.FRONTEND_PORT = server["frontend"].get("port", cls.FRONTEND_PORT)
            if "cors_origins" in server:
                cls.CORS_ORIGINS = server["cors_origins"]
            else:
                # Auto-generate CORS origins from frontend port
                import socket
                cls.CORS_ORIGINS = [
                    f"http://localhost:{cls.FRONTEND_PORT}",
                    f"http://127.0.0.1:{cls.FRONTEND_PORT}",
                ]
                try:
                    local_ip = socket.gethostbyname(socket.gethostname())
                    if local_ip and local_ip != "127.0.0.1":
                        cls.CORS_ORIGINS.append(f"http://{local_ip}:{cls.FRONTEND_PORT}")
                except Exception:
                    pass


# Initialize configuration
Config.ensure_directories()
if (Config.BASE_DIR / "config.yaml").exists():
    Config.load_from_yaml()
