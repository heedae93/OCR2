"""
Database helper functions for job tracking
"""
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Dict, Any
import json
from database import SessionLocal, Job, OCRPage, DocumentChunk, User, Session, SessionDocument, DocumentMetadataValue, ExtractionRule, MetadataFieldDefinition

logger = logging.getLogger(__name__)


def _collect_ner_preview_lines(ocr_data: Dict[str, Any], limit: int = 12) -> list[Dict[str, Any]]:
    """Pick a small set of OCR lines to preview in console logs."""
    kv_candidates = []
    fallback_candidates = []

    for page in ocr_data.get('pages', []):
        page_number = page.get('page_number', 1)
        for line in page.get('lines', []):
            text = (line.get('text') or '').strip()
            if not text:
                continue

            preview_line = {
                "page": page_number,
                "text": text,
                "bbox": line.get('bbox'),
            }

            if ':' in text or '：' in text:
                kv_candidates.append(preview_line)
            else:
                fallback_candidates.append(preview_line)

            if len(kv_candidates) >= limit:
                return kv_candidates[:limit]

    if kv_candidates:
        return kv_candidates[:limit]
    return fallback_candidates[:limit]


def log_ner_preview(job_id: str, ocr_data: Dict[str, Any]) -> None:
    """Emit OCR -> NER preview logs so uploads can be verified from console."""
    preview_lines = _collect_ner_preview_lines(ocr_data)
    logger.info("[NER PREVIEW] ===== job %s =====", job_id)

    if not preview_lines:
        logger.info("[NER PREVIEW] No OCR lines available for preview.")
        logger.info("[NER PREVIEW] ============================")
        return

    try:
        from utils.ner_extractor import get_ner_extractor

        extractor = get_ner_extractor()
        if not extractor.is_available:
            logger.warning(
                "[NER PREVIEW] NER model unavailable. Install/load dependencies to see entity mapping."
            )
            for line in preview_lines:
                logger.info(
                    "[NER PREVIEW] page=%s OCR='%s' -> NER unavailable",
                    line["page"],
                    line["text"],
                )
            logger.info("[NER PREVIEW] ============================")
            return

        for line in preview_lines:
            items = extractor.extract_kv_from_lines([{
                "text": line["text"],
                "bbox": line["bbox"],
            }])

            if not items:
                logger.info(
                    "[NER PREVIEW] page=%s OCR='%s' -> no entity detected",
                    line["page"],
                    line["text"],
                )
                continue

            for item in items:
                logger.info(
                    "[NER PREVIEW] page=%s OCR='%s' -> key='%s', value='%s', entity_type='%s', score=%s",
                    line["page"],
                    line["text"],
                    item.get("key"),
                    item.get("value"),
                    item.get("entity_type"),
                    item.get("score"),
                )

    except Exception as preview_err:
        logger.error("[NER PREVIEW] Failed for job %s: %s", job_id, preview_err)

    logger.info("[NER PREVIEW] ============================")


def create_job_in_db(
    job_id: str,
    filename: str,
    file_path: str,
    file_size: int,
    user_id: str = "default",
    doc_type: Optional[str] = None
) -> bool:
    """Create a new job in database"""
    try:
        db = SessionLocal()

        # Check if job already exists
        existing = db.query(Job).filter_by(job_id=job_id).first()
        if existing:
            logger.warning(f"Job {job_id} already exists in database")
            db.close()
            return False

        # Determine file type
        file_ext = Path(filename).suffix.lstrip('.').lower()

        # Create job
        job = Job(
            job_id=job_id,
            user_id=user_id,
            original_filename=filename,
            file_type=file_ext,
            file_size_bytes=file_size,
            status="uploaded",
            raw_file_path=file_path,
            doc_type=doc_type  # 선택한 카테고리 저장
        )

        db.add(job)
        db.commit()
        logger.info(f"Created job {job_id} with category '{doc_type}' in database")

        db.close()
        return True

    except Exception as e:
        logger.error(f"Failed to create job in database: {e}")
        return False


def update_job_status(
    job_id: str,
    status: str,
    progress: Optional[float] = None,
    current_page: Optional[int] = None,
    error_message: Optional[str] = None
) -> bool:
    """Update job status"""
    try:
        db = SessionLocal()
        job = db.query(Job).filter_by(job_id=job_id).first()

        if not job:
            logger.warning(f"Job {job_id} not found in database")
            db.close()
            return False

        job.status = status

        if progress is not None:
            job.progress_percent = progress

        if current_page is not None:
            job.current_page = current_page

        if error_message:
            job.error_message = error_message

        if status == "processing" and not job.started_at:
            job.started_at = datetime.now()

        if status == "completed":
            job.completed_at = datetime.now()
            start = job.started_at or job.created_at
            if start:
                # strip timezone info if present to avoid offset-naive/aware mismatch
                start_naive = start.replace(tzinfo=None) if start.tzinfo else start
                completed_naive = job.completed_at.replace(tzinfo=None)
                job.processing_time_seconds = (completed_naive - start_naive).total_seconds()

        db.commit()
        db.close()
        return True

    except Exception as e:
        logger.error(f"Failed to update job status: {e}")
        return False


def update_job_ocr_results(
    job_id: str,
    ocr_data: Dict[str, Any],
    pdf_path: Optional[str] = None,
    ocr_json_path: Optional[str] = None
) -> bool:
    """Update job with OCR results"""
    try:
        db = SessionLocal()
        job = db.query(Job).filter_by(job_id=job_id).first()

        if not job:
            logger.warning(f"Job {job_id} not found in database")
            db.close()
            return False

        # Update job metadata
        job.total_pages = ocr_data.get('page_count', 0)
        job.total_text_blocks = ocr_data.get('total_bboxes', 0)

        if pdf_path:
            job.pdf_file_path = pdf_path

        if ocr_json_path:
            job.ocr_json_path = ocr_json_path

        # Calculate average confidence
        total_conf = 0
        count = 0
        for page_data in ocr_data.get('pages', []):
            for line in page_data.get('lines', []):
                conf = line.get('confidence')
                if conf is not None:
                    total_conf += conf
                    count += 1

        if count > 0:
            job.average_confidence = total_conf / count

        # Add page information
        for page_data in ocr_data.get('pages', []):
            # Check if page already exists
            existing_page = db.query(OCRPage).filter_by(
                job_id=job_id,
                page_number=page_data.get('page_number', 1)
            ).first()

            if existing_page:
                continue

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

        db.commit()
        logger.info(f"Updated OCR results for job {job_id}")

        # 메타데이터 추출 및 저장
        try:
            from utils.metadata_extractor import extract_all_metadata
            from api.metadata_settings import get_user_settings

            # 유저 설정 로드
            settings = get_user_settings(job.user_id, db)
            meta = extract_all_metadata(
                ocr_data,
                chunk_size=settings.chunk_size,
                chunk_overlap=settings.chunk_overlap,
                keywords_top_n=settings.keywords_top_n,
            )

            # Always print a small OCR -> NER preview to the backend console for debugging.
            log_ner_preview(job_id, ocr_data)

            if settings.extract_full_text:
                job.full_text = meta["full_text"]
            if settings.extract_language:
                job.detected_language = meta["detected_language"]
            if settings.extract_doc_type and not job.doc_type:
                job.doc_type = meta["doc_type"]
                logger.info(f"[{job_id}] Auto-detected doc_type: {job.doc_type}")
            elif settings.extract_doc_type and job.doc_type:
                logger.info(f"[{job_id}] Keeping existing doc_type: {job.doc_type} (auto-detected: {meta['doc_type']})")
            if settings.extract_keywords:
                job.keywords = json.dumps(meta["keywords"], ensure_ascii=False)
            if settings.extract_dates:
                job.detected_dates = json.dumps(meta["detected_dates"], ensure_ascii=False)
            if settings.extract_char_count:
                job.char_count = meta["char_count"]
            if settings.extract_word_count:
                job.word_count = meta["word_count"]

            # LLM 요약 및 인용문 출처 추출
            from config import Config
            if getattr(Config, "LLM_ENABLED", False):
                try:
                    from utils.llm_client import process_document_with_llm
                    logger.info(f"[{job_id}] LLM 문서 분석 시작...")
                    summary, citations = process_document_with_llm(meta["full_text"])
                    if summary:
                        job.summary = summary
                        logger.info(f"[{job_id}] LLM summary generated ({len(summary)} chars)")
                    else:
                        logger.warning(f"[{job_id}] LLM summary is empty")
                    if citations and citations != "[]":
                        job.citations = citations
                    logger.info(f"[{job_id}] LLM 분석 완료 (요약 및 인용문 저장)")
                except Exception as llm_err:
                    logger.error(f"[{job_id}] LLM 처리 실패: {llm_err}")

            # 청크 저장
            if settings.extract_chunks:
                db.query(DocumentChunk).filter_by(job_id=job_id).delete()
                for chunk in meta["chunks"]:
                    db.add(DocumentChunk(
                        job_id=job_id,
                        chunk_index=chunk["chunk_index"],
                        text=chunk["text"],
                        page_number=chunk["page_number"],
                        char_start=chunk["char_start"],
                        char_end=chunk["char_end"],
                    ))

            # Rule-based dynamic LLM extraction
            try:
                # 1. 문서 유형에 맞는 추출 규칙(ExtractionRule) 찾기
                current_doc_type = job.doc_type or ""
                rules = db.query(ExtractionRule).filter_by(user_id=job.user_id, doc_type=current_doc_type, is_active=True).all()
                
                if not rules:
                    logger.info(f"[{job_id}] No extraction rules found for user {job.user_id} and doc_type '{current_doc_type}'")
                
                if rules and getattr(Config, "LLM_ENABLED", False) and meta.get("full_text"):
                    fields_to_extract = {}
                    for rule in rules:
                        if rule.field:
                            fields_to_extract[rule.field.field_key] = rule.field.label
                            
                    if fields_to_extract:
                        from utils.llm_client import process_metadata_with_llm
                        logger.info(f"[{job_id}] LLM 기반 동적 메타데이터 추출 시작 (항목: {list(fields_to_extract.values())})")
                        
                        extracted_data = process_metadata_with_llm(meta["full_text"], fields_to_extract)
                        
                        # JSON 형태를 그대로 호환되도록 job.extracted_fields 에도 저장
                        legacy_format = []
                        for k, v in extracted_data.items():
                            if v:  # 빈 값은 저장 제외
                                label = fields_to_extract.get(k, k)
                                legacy_format.append({
                                    "key": k,
                                    "value": v,
                                    "entity_type": k,
                                    "entity_type_ko": label
                                })
                                # 전용 테이블에 저장
                                db.add(DocumentMetadataValue(
                                    job_id=job_id,
                                    field_key=k,
                                    label=label,
                                    field_value=v,
                                    confidence=1.0,
                                    page_number=1
                                ))
                        
                        job.extracted_fields = json.dumps(legacy_format, ensure_ascii=False)
                        logger.info(f"[{job_id}] LLM 동적 메타데이터 추출 성공: {len(legacy_format)} 항목 저장됨")
                elif getattr(settings, "extract_ner", False):
                    # 규칙이 없거나 LLM이 비활성화되어 있고, 기존 NER 설정이 켜져있을 경우의 폴백
                    from utils.ner_extractor import get_ner_extractor
                    extractor = get_ner_extractor()
                    if extractor.is_available:
                        kv_items = extractor.extract_from_ocr_pages(ocr_data.get("pages", []))
                        for item in kv_items:
                            item.pop("raw_entities", None)
                        job.extracted_fields = json.dumps(kv_items, ensure_ascii=False)
                        for item in kv_items:
                            db.add(DocumentMetadataValue(
                                job_id=job_id,
                                field_key=item.get("entity_type", "unknown"),
                                label=item.get("entity_type_ko", item.get("key")),
                                field_value=item.get("value"),
                                confidence=item.get("score"),
                                page_number=item.get("page_number")
                            ))
            except Exception as extract_err:
                logger.error(f"[{job_id}] 동적 메타데이터 추출 실패: {extract_err}")

            db.commit()
            logger.info(
                f"Metadata saved for job {job_id}: "
                f"lang={meta['detected_language']}, doc_type={meta['doc_type']}, "
                f"keywords={len(meta['keywords'])}, chunks={len(meta['chunks'])}"
            )
        except Exception as meta_err:
            logger.error(f"Metadata extraction failed for job {job_id}: {meta_err}")

        db.close()
        return True

    except Exception as e:
        logger.error(f"Failed to update OCR results: {e}")
        return False


def ensure_default_user():
    """Ensure default user exists"""
    try:
        db = SessionLocal()
        user = db.query(User).filter_by(user_id="default").first()

        if not user:
            user = User(
                user_id="default",
                username="default_user",
                email="default@ocr-gen.local"
            )
            db.add(user)
            db.commit()
            logger.info("Created default user")

        db.close()

    except Exception as e:
        logger.error(f"Failed to ensure default user: {e}")


def add_job_to_session(job_id: str, session_id: str = "default") -> bool:
    """Add a job to a session"""
    try:
        db = SessionLocal()

        # Check if job exists
        job = db.query(Job).filter_by(job_id=job_id).first()
        if not job:
            logger.warning(f"Job {job_id} not found")
            db.close()
            return False

        # Check if session exists
        session = db.query(Session).filter_by(session_id=session_id).first()
        if not session:
            logger.warning(f"Session {session_id} not found")
            db.close()
            return False

        # Check if already in session
        existing = db.query(SessionDocument).filter_by(
            session_id=session_id,
            job_id=job_id
        ).first()

        if existing:
            logger.info(f"Job {job_id} already in session {session_id}")
            db.close()
            return True

        # Get max order
        max_order = db.query(SessionDocument).filter_by(
            session_id=session_id
        ).count()

        # Add to session
        session_doc = SessionDocument(
            session_id=session_id,
            job_id=job_id,
            order=max_order,
            is_selected=True
        )

        db.add(session_doc)
        session.updated_at = datetime.now()
        db.commit()

        logger.info(f"Added job {job_id} to session {session_id}")
        db.close()
        return True

    except Exception as e:
        logger.error(f"Failed to add job to session: {e}")
        return False
