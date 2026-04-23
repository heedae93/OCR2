"""
SQLite database setup and models using SQLAlchemy
"""
from sqlalchemy import create_engine, Column, String, Integer, Float, Boolean, DateTime, Text, ForeignKey, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime
from pathlib import Path
import logging

from config import Config

logger = logging.getLogger(__name__)

# Database URL from Config (with SQLite fallback)
DATABASE_URL = Config.DATABASE_URL or f"sqlite:///{Config.DATA_DIR / 'ocr_gen.db'}"

# Create engine with dialect-specific arguments
engine_args = {"echo": False, "pool_pre_ping": True}
if DATABASE_URL.startswith("sqlite"):
    engine_args["connect_args"] = {"check_same_thread": False}
else:
    # PostgreSQL: 커넥션 풀 제한 (too many clients 방지)
    engine_args["pool_recycle"] = 1800   # 30분마다 커넥션 갱신
    engine_args["pool_size"] = 5         # 최대 풀 크기
    engine_args["max_overflow"] = 5      # 초과 허용 커넥션 수
    engine_args["pool_timeout"] = 30     # 커넥션 대기 타임아웃(초)

engine = create_engine(DATABASE_URL, **engine_args)

# Session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base class for models
Base = declarative_base()


class User(Base):
    """User model"""
    __tablename__ = "users"

    user_id = Column(String(36), primary_key=True)
    username = Column(String(100), unique=True, nullable=False)
    name = Column(String(100), nullable=True)
    email = Column(String(255), unique=True, nullable=True)
    password_hash = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.now)
    last_login = Column(DateTime, nullable=True)
    type = Column(String(1), default="U")  # A: Admin, U: User
    total_jobs = Column(Integer, default=0)
    storage_used_bytes = Column(Integer, default=0)

    # Relationships
    jobs = relationship("Job", back_populates="user", cascade="all, delete-orphan")
    sessions = relationship("Session", back_populates="user", cascade="all, delete-orphan")


class Job(Base):
    """Job metadata model"""
    __tablename__ = "jobs"

    job_id = Column(String(36), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.user_id"), nullable=False)

    # File information
    original_filename = Column(String(255), nullable=False)
    file_type = Column(String(10), nullable=True)  # 'pdf', 'png', 'jpg'
    file_size_bytes = Column(Integer, nullable=True)

    # Processing status
    status = Column(String(20), nullable=False, default="queued")  # queued, processing, completed, failed
    progress_percent = Column(Float, default=0.0)
    current_page = Column(Integer, default=0)
    total_pages = Column(Integer, default=0)

    # OCR information
    ocr_language = Column(String(10), default="ko")  # ko, en, mixed
    total_text_blocks = Column(Integer, default=0)
    is_double_column = Column(Boolean, default=False)
    average_confidence = Column(Float, nullable=True)

    # File paths (actual files stored in filesystem)
    raw_file_path = Column(String(500), nullable=True)
    pdf_file_path = Column(String(500), nullable=True)
    final_pdf_path = Column(String(500), nullable=True)
    ocr_json_path = Column(String(500), nullable=True)

    # Processing time
    created_at = Column(DateTime, default=datetime.now)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    processing_time_seconds = Column(Float, nullable=True)

    # Error information
    error_message = Column(Text, nullable=True)

    # Metadata
    tags = Column(Text, nullable=True)  # JSON string: ["학술논문", "영어"]
    notes = Column(Text, nullable=True)

    # Extracted metadata (from OCR text)
    full_text = Column(Text, nullable=True)             # 전체 추출 텍스트
    detected_language = Column(String(10), nullable=True)  # ko / en / mixed
    doc_type = Column(String(50), nullable=True)         # 공문서 / 계약서 / 보고서 등
    keywords = Column(Text, nullable=True)               # JSON: ["키워드1", "키워드2"]
    detected_dates = Column(Text, nullable=True)         # JSON: ["2026년 4월 10일"]
    char_count = Column(Integer, nullable=True)
    word_count = Column(Integer, nullable=True)
    extracted_fields = Column(Text, nullable=True)   # JSON: NER 추출 KV 쌍 목록
    summary = Column(Text, nullable=True)            # JSON/Text: LLM 요약본
    citations = Column(Text, nullable=True)          # JSON: 추출된 인용문 및 웹 검색 출처 결과

    # Relationships
    user = relationship("User", back_populates="jobs")
    pages = relationship("OCRPage", back_populates="job", cascade="all, delete-orphan")
    session_documents = relationship("SessionDocument", back_populates="job", cascade="all, delete-orphan")
    chunks = relationship("DocumentChunk", back_populates="job", cascade="all, delete-orphan")


class OCRPage(Base):
    """OCR page information model"""
    __tablename__ = "ocr_pages"

    page_id = Column(Integer, primary_key=True, autoincrement=True)
    job_id = Column(String(36), ForeignKey("jobs.job_id", ondelete="CASCADE"), nullable=False)
    page_number = Column(Integer, nullable=False)

    # Page dimensions
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)

    # OCR results statistics
    text_block_count = Column(Integer, default=0)
    average_confidence = Column(Float, nullable=True)
    is_multi_column = Column(Boolean, default=False)
    column_boundary = Column(Float, nullable=True)

    # Processing time
    processing_time_ms = Column(Float, nullable=True)

    # Relationships
    job = relationship("Job", back_populates="pages")


class Session(Base):
    """Session model for grouping multiple documents"""
    __tablename__ = "sessions"

    session_id = Column(String(36), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.user_id"), nullable=False)

    # Session information
    session_name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    # Stats
    total_documents = Column(Integer, default=0)
    completed_documents = Column(Integer, default=0)

    # Relationships
    user = relationship("User", back_populates="sessions")
    documents = relationship("SessionDocument", back_populates="session", cascade="all, delete-orphan", order_by="SessionDocument.order")


class SessionDocument(Base):
    """Association table linking sessions to jobs/documents"""
    __tablename__ = "session_documents"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String(36), ForeignKey("sessions.session_id", ondelete="CASCADE"), nullable=False)
    job_id = Column(String(36), ForeignKey("jobs.job_id", ondelete="CASCADE"), nullable=False)

    # Order within session
    order = Column(Integer, nullable=False, default=0)

    # Selection state for export
    is_selected = Column(Boolean, default=False)

    # Timestamps
    added_at = Column(DateTime, default=datetime.now)

    # Relationships
    session = relationship("Session", back_populates="documents")
    job = relationship("Job", back_populates="session_documents")


class DocumentChunk(Base):
    """RAG용 문서 청크 테이블"""
    __tablename__ = "document_chunks"

    chunk_id = Column(Integer, primary_key=True, autoincrement=True)
    job_id = Column(String(36), ForeignKey("jobs.job_id", ondelete="CASCADE"), nullable=False)
    chunk_index = Column(Integer, nullable=False)
    text = Column(Text, nullable=False)
    page_number = Column(Integer, nullable=True)
    char_start = Column(Integer, nullable=True)
    char_end = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.now)

    # Relationships
    job = relationship("Job", back_populates="chunks")


class FileVersion(Base):
    """파일 버전 관리"""
    __tablename__ = "file_versions"

    version_id = Column(Integer, primary_key=True, autoincrement=True)
    job_id = Column(String(36), ForeignKey("jobs.job_id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String(36), ForeignKey("users.user_id"), nullable=False)
    version_number = Column(Integer, nullable=False, default=1)
    version_label = Column(String(100), nullable=True)   # 예: "v1.0", "최종본"
    note = Column(Text, nullable=True)
    pdf_file_path = Column(String(500), nullable=True)
    ocr_json_path = Column(String(500), nullable=True)
    file_size_bytes = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.now)

    job = relationship("Job")
    user = relationship("User")


class DownloadHistory(Base):
    """다운로드 이력"""
    __tablename__ = "download_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    job_id = Column(String(36), ForeignKey("jobs.job_id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String(36), ForeignKey("users.user_id"), nullable=False)
    version_id = Column(Integer, ForeignKey("file_versions.version_id", ondelete="SET NULL"), nullable=True)
    file_type = Column(String(20), nullable=True)   # pdf, excel, json
    downloaded_at = Column(DateTime, default=datetime.now)
    ip_address = Column(String(50), nullable=True)

    job = relationship("Job")
    user = relationship("User")
    version = relationship("FileVersion")


class DocumentCategory(Base):
    """사용자가 추가한 문서 카테고리"""
    __tablename__ = "document_categories"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(36), ForeignKey("users.user_id"), nullable=False)
    name = Column(String(100), nullable=False)
    created_at = Column(DateTime, default=datetime.now)


class CustomMaskingField(Base):
    """사용자 커스텀 필드 정의 (구 마스킹 필드)"""
    __tablename__ = "custom_masking_fields"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(36), ForeignKey("users.user_id"), nullable=False)
    field_key = Column(String(100), nullable=False)   # 내부 고유키 (예: custom_xxx)
    label = Column(String(100), nullable=False)       # UI 표시명 (예: 회사명, 차대번호)
    pattern = Column(String(500), nullable=True)      # 정규식 패턴 지정
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.now)


# ============================================================
# 신규: 메타데이터 관리 전용 테이블
# ============================================================

class MetadataFieldDefinition(Base):
    """추출 가능한 메타데이터 필드 정의"""
    __tablename__ = "metadata_field_definitions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(36), index=True)
    field_key = Column(String(50), nullable=False)  # 예: 'title', 'amount'
    label = Column(String(100), nullable=False)    # 예: '문서 제목', '결제 금액'
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.now)


class ExtractionRule(Base):
    """문서 유형별 추출 필드 연결 규칙"""
    __tablename__ = "extraction_rules"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(36), index=True)
    doc_type = Column(String(100), nullable=False)  # 예: '영수증'
    field_id = Column(Integer, ForeignKey("metadata_field_definitions.id", ondelete="CASCADE"))
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.now)

    field = relationship("MetadataFieldDefinition")


class DocumentMetadataValue(Base):
    """실제 추출된 메타데이터 결과 값 (문서당 여러 행)"""
    __tablename__ = "document_metadata_values"

    id = Column(Integer, primary_key=True, autoincrement=True)
    job_id = Column(String(36), ForeignKey("jobs.job_id", ondelete="CASCADE"), index=True)
    field_key = Column(String(50), nullable=False)   # 영문 키 (복제 보관)
    label = Column(String(100), nullable=True)      # 한글 필드명 (스냅샷 저장)
    field_value = Column(Text, nullable=True)
    confidence = Column(Float, nullable=True)
    page_number = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.now)

    job = relationship("Job")


def init_db():
    """Initialize database and create tables"""
    try:
        # Create all tables
        Base.metadata.create_all(bind=engine)
        logger.info(f"Database initialized at {DATABASE_URL}")

        # 기존 DB에 새 컬럼 추가 (없는 경우에만)
        with engine.connect() as conn:
            for col_sql, col_name in [
                ("ALTER TABLE jobs ADD COLUMN extracted_fields TEXT", "jobs.extracted_fields"),
                ("ALTER TABLE jobs ADD COLUMN summary TEXT", "jobs.summary"),
                ("ALTER TABLE jobs ADD COLUMN citations TEXT", "jobs.citations"),
            ]:
                try:
                    conn.execute(text(col_sql))
                    conn.commit()
                    logger.info(f"DB migration: {col_name} 컬럼 추가 완료")
                except Exception:
                    pass  # 이미 존재하면 무시

        # Create default user if not exists
        db = SessionLocal()
        try:
            default_user = db.query(User).filter_by(user_id=Config.DEFAULT_USER_ID).first()
            if not default_user:
                default_user = User(
                    user_id=Config.DEFAULT_USER_ID,
                    username=Config.DEFAULT_USER_NAME,
                    email=Config.DEFAULT_USER_EMAIL
                )
                db.add(default_user)
                db.commit()
                logger.info(f"Default user created: {Config.DEFAULT_USER_ID}")

            # Create default session if not exists
            default_session = db.query(Session).filter_by(session_id="default").first()
            if not default_session:
                default_session = Session(
                    session_id="default",
                    user_id=Config.DEFAULT_USER_ID,
                    session_name="기본 세션",
                    description="자동 생성된 기본 세션입니다."
                )
                db.add(default_session)
                db.commit()
                logger.info("Default session created")
        finally:
            db.close()

    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")
        raise


def get_db():
    """
    Dependency to get database session
    Usage in FastAPI:
        @app.get("/...")
        async def endpoint(db: Session = Depends(get_db)):
            ...
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def migrate_existing_jobs():
    """Migrate existing jobs from filesystem to database"""
    from config import Config
    import json

    logger.info("Starting migration of existing jobs...")

    db = SessionLocal()
    try:
        # Get default user
        default_user = db.query(User).filter_by(user_id=Config.DEFAULT_USER_ID).first()

        # Scan processed directory
        processed_dir = Config.PROCESSED_DIR
        pdf_files = list(processed_dir.glob("*.pdf"))

        migrated_count = 0
        for pdf_file in pdf_files:
            job_id = pdf_file.stem.replace("_final", "")

            # Skip if already migrated
            existing = db.query(Job).filter_by(job_id=job_id).first()
            if existing:
                continue

            # Check for OCR JSON
            ocr_json_path = processed_dir / f"{job_id}_ocr.json"
            if not ocr_json_path.exists():
                continue

            # Load OCR data
            with open(ocr_json_path, 'r', encoding='utf-8') as f:
                ocr_data = json.load(f)

            # Create job entry
            job = Job(
                job_id=job_id,
                user_id=default_user.user_id,
                original_filename=ocr_data.get('job_id', job_id) + ".pdf",
                file_type="pdf",
                file_size_bytes=pdf_file.stat().st_size,
                status="completed",
                progress_percent=100.0,
                total_pages=ocr_data.get('page_count', 0),
                total_text_blocks=ocr_data.get('total_bboxes', 0),
                pdf_file_path=str(pdf_file),
                ocr_json_path=str(ocr_json_path),
                created_at=datetime.fromtimestamp(pdf_file.stat().st_mtime),
                completed_at=datetime.fromtimestamp(pdf_file.stat().st_mtime)
            )

            db.add(job)

            # Add page information
            for page_data in ocr_data.get('pages', []):
                page = OCRPage(
                    job_id=job_id,
                    page_number=page_data.get('page_number', 1),
                    width=page_data.get('width', 0),
                    height=page_data.get('height', 0),
                    text_block_count=len(page_data.get('lines', [])),
                    is_multi_column=page_data.get('is_multi_column', False),
                    column_boundary=page_data.get('column_boundary')
                )
                db.add(page)

            migrated_count += 1

        db.commit()
        logger.info(f"Migration completed: {migrated_count} jobs migrated")

    except Exception as e:
        logger.error(f"Migration failed: {e}")
        db.rollback()
    finally:
        db.close()


if __name__ == "__main__":
    # Initialize database
    init_db()

    # Migrate existing jobs
    migrate_existing_jobs()
