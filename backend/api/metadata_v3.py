"""
메타데이터 관리 v3 API
- 처리 완료된 문서의 메타데이터 조회 / 검색 / 편집
- RAG 검색을 위한 문서 메타데이터 브라우저
- 문서 유형별 자동 추출 메타데이터 필드 설정 (추출 규칙)
"""
import json
import logging
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import Column, String, Integer, Text, DateTime
from sqlalchemy.orm import Session

from database import Base, engine, get_db, Job, DocumentChunk, DocumentCategory, CustomMaskingField, MetadataFieldDefinition, ExtractionRule, DocumentMetadataValue

logger = logging.getLogger(__name__)
router = APIRouter()


# ============================================================
# DB 모델 — 문서 유형별 추출 필드 설정
# ============================================================

class MaskingRuleModel(Base):
    """문서 유형별 자동 추출 메타데이터 필드 설정"""
    __tablename__ = "masking_rules_v3"
    __table_args__ = {"extend_existing": True}

    id         = Column(Integer, primary_key=True, autoincrement=True)
    user_id    = Column(String(36), nullable=False, index=True)
    doc_type   = Column(String(100), nullable=False)   # 예: 공문서, 계약서
    pii_types  = Column(Text, default="[]")            # JSON 배열: ["rrn","phone",...]
    updated_at = Column(DateTime, default=datetime.now)


Base.metadata.create_all(bind=engine)


# ============================================================
# Pydantic 스키마
# ============================================================

class DocumentMeta(BaseModel):
    job_id: str
    original_filename: str
    file_type: Optional[str]
    file_size_bytes: Optional[int]
    status: str
    total_pages: int
    ocr_language: Optional[str]
    average_confidence: Optional[float]
    detected_language: Optional[str]
    doc_type: Optional[str]
    keywords: Optional[List[str]]
    detected_dates: Optional[List[str]]
    char_count: Optional[int]
    word_count: Optional[int]
    tags: Optional[List[str]]
    notes: Optional[str]
    chunk_count: int
    summary: Optional[str]
    citations: Optional[List[dict]]
    created_at: str
    completed_at: Optional[str]

    class Config:
        from_attributes = True


class DocumentDetail(DocumentMeta):
    full_text: Optional[str]
    chunks: List[dict]


class PatchDocumentRequest(BaseModel):
    tags: Optional[List[str]] = None
    notes: Optional[str] = None
    doc_type: Optional[str] = None


class StatsResponse(BaseModel):
    total_documents: int
    completed_documents: int
    total_chunks: int
    total_pages: int
    language_dist: dict
    doc_type_dist: dict


class MaskingRuleUpsert(BaseModel):
    doc_type: str
    pii_types: List[str]  # ["title", "date", "amount", "vendor", "address", "person"]


# ============================================================
# 헬퍼
# ============================================================

def _parse_json_field(value: Optional[str]) -> Optional[List[str]]:
    if not value:
        return []
    try:
        return json.loads(value)
    except Exception:
        return []


def _parse_extracted_fields(value: Optional[str]) -> List[dict]:
    if not value:
        return []
    try:
        return json.loads(value)
    except Exception:
        return []


def _build_fallback_extracted_fields(job: Job) -> List[dict]:
    items: List[dict] = []

    if job.doc_type:
        items.append({
            "key": "문서유형",
            "value": job.doc_type,
            "entity_type": "DOC_TYPE",
            "entity_type_ko": "문서유형",
        })

    if job.detected_language:
        items.append({
            "key": "언어",
            "value": job.detected_language,
            "entity_type": "LANGUAGE",
            "entity_type_ko": "언어",
        })

    for date in _parse_json_field(job.detected_dates)[:3]:
        if date:
            items.append({
                "key": "날짜",
                "value": date,
                "entity_type": "DATE",
                "entity_type_ko": "날짜",
            })

    for keyword in _parse_json_field(job.keywords)[:5]:
        if keyword:
            items.append({
                "key": "키워드",
                "value": keyword,
                "entity_type": "KEYWORD",
                "entity_type_ko": "키워드",
            })

    return items


def _job_to_meta(job: Job, chunk_count: int, db: Optional[Session] = None,
                 allowed_field_keys: Optional[set] = None) -> dict:
    # 신규 테이블 방식 데이터
    structured_metadata = []
    if db:
        rows = db.query(DocumentMetadataValue).filter_by(job_id=job.job_id).all()
        structured_metadata = [
            {
                "key": r.field_key,
                "label": r.label,
                "value": r.field_value,
                "confidence": r.confidence,
                "page_number": r.page_number
            }
            for r in rows
        ]

    # 기존 JSON 방식 데이터 (호환성 유지)
    extracted_fields_json = _parse_extracted_fields(getattr(job, "extracted_fields", None))

    if structured_metadata:
        raw_fields = structured_metadata
    elif extracted_fields_json:
        raw_fields = extracted_fields_json
    else:
        raw_fields = _build_fallback_extracted_fields(job)

    # 추출 설정에 정의된 필드만 표시 (allowed_field_keys 가 전달된 경우)
    if allowed_field_keys is not None:
        raw_fields = [f for f in raw_fields if f.get("key") in allowed_field_keys]

    return {
        "job_id": job.job_id,
        "original_filename": job.original_filename,
        "file_type": job.file_type,
        "file_size_bytes": job.file_size_bytes,
        "status": job.status,
        "total_pages": job.total_pages or 0,
        "ocr_language": job.ocr_language,
        "average_confidence": job.average_confidence,
        "detected_language": job.detected_language,
        "doc_type": job.doc_type,
        "keywords": _parse_json_field(job.keywords),
        "detected_dates": _parse_json_field(job.detected_dates),
        "char_count": job.char_count,
        "word_count": job.word_count,
        "tags": _parse_json_field(job.tags),
        "notes": job.notes,
        "chunk_count": chunk_count,
        "extracted_fields": raw_fields,
        "summary": job.summary,
        "citations": _parse_extracted_fields(getattr(job, "citations", None)),
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
    }


# ============================================================
# 엔드포인트
# ============================================================

@router.get("/metadata-v3/stats", response_model=StatsResponse)
def get_stats(
    user_id: str = Query(...),
    db: Session = Depends(get_db),
):
    """통계 개요"""
    jobs = db.query(Job).filter(Job.user_id == user_id).all()
    completed = [j for j in jobs if j.status == "completed"]

    total_chunks = db.query(DocumentChunk).join(Job).filter(Job.user_id == user_id).count()
    total_pages = sum(j.total_pages or 0 for j in jobs)

    lang_dist: dict = {}
    doc_type_dist: dict = {}
    for j in completed:
        lang = j.detected_language or j.ocr_language or "unknown"
        lang_dist[lang] = lang_dist.get(lang, 0) + 1
        dt = j.doc_type or "미분류"
        doc_type_dist[dt] = doc_type_dist.get(dt, 0) + 1

    return {
        "total_documents": len(jobs),
        "completed_documents": len(completed),
        "total_chunks": total_chunks,
        "total_pages": total_pages,
        "language_dist": lang_dist,
        "doc_type_dist": doc_type_dist,
    }


@router.get("/metadata-v3/documents")
def list_documents(
    user_id: str = Query(...),
    search: Optional[str] = Query(None),
    doc_type: Optional[str] = Query(None),
    language: Optional[str] = Query(None),
    status: Optional[str] = Query(None, description="completed|failed|processing|queued"),
    date_from: Optional[str] = Query(None, description="YYYY-MM-DD"),
    date_to: Optional[str] = Query(None, description="YYYY-MM-DD"),
    sort_by: str = Query("created_at", description="created_at|filename|doc_type|total_pages"),
    sort_dir: str = Query("desc", description="asc|desc"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """문서 목록 조회 (필터 + 검색 + 페이지네이션)"""
    query = db.query(Job).filter(Job.user_id == user_id)

    # 검색 (파일명)
    if search:
        query = query.filter(Job.original_filename.ilike(f"%{search}%"))

    # 필터
    if doc_type:
        query = query.filter(Job.doc_type == doc_type)
    if language:
        query = query.filter(
            (Job.detected_language == language) | (Job.ocr_language == language)
        )
    if status:
        query = query.filter(Job.status == status)
    if date_from:
        from datetime import datetime
        query = query.filter(Job.created_at >= datetime.fromisoformat(date_from))
    if date_to:
        from datetime import datetime
        query = query.filter(Job.created_at <= datetime.fromisoformat(date_to + "T23:59:59"))

    # 정렬
    sort_col_map = {
        "created_at": Job.created_at,
        "filename": Job.original_filename,
        "doc_type": Job.doc_type,
        "total_pages": Job.total_pages,
    }
    sort_col = sort_col_map.get(sort_by, Job.created_at)
    query = query.order_by(sort_col.desc() if sort_dir == "desc" else sort_col.asc())

    total = query.count()
    jobs = query.offset((page - 1) * page_size).limit(page_size).all()

    # 청크 수 집계
    job_ids = [j.job_id for j in jobs]
    chunk_counts: dict = {}
    if job_ids:
        rows = db.query(DocumentChunk.job_id, DocumentChunk.chunk_id).filter(
            DocumentChunk.job_id.in_(job_ids)
        ).all()
        for row in rows:
            chunk_counts[row.job_id] = chunk_counts.get(row.job_id, 0) + 1

    # 문서 유형별 허용 필드 키 맵 {doc_type: set(field_key)}
    rules = db.query(ExtractionRule).filter_by(user_id=user_id, is_active=True).all()
    allowed_by_doc_type: dict = {}
    for rule in rules:
        if rule.field:
            allowed_by_doc_type.setdefault(rule.doc_type, set()).add(rule.field.field_key)

    def _allowed_keys(doc_type: Optional[str]) -> Optional[set]:
        if doc_type and doc_type in allowed_by_doc_type:
            return allowed_by_doc_type[doc_type]
        # 설정된 규칙이 없으면 None → 필터링 안 함
        return None

    items = [_job_to_meta(j, chunk_counts.get(j.job_id, 0), db, _allowed_keys(j.doc_type)) for j in jobs]

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": items,
    }


@router.get("/metadata-v3/documents/{job_id}")
def get_document(
    job_id: str,
    user_id: str = Query(...),
    db: Session = Depends(get_db),
):
    """문서 상세 조회 (청크 포함)"""
    job = db.query(Job).filter(Job.job_id == job_id, Job.user_id == user_id).first()
    if not job:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")

    chunks = db.query(DocumentChunk).filter(DocumentChunk.job_id == job_id).order_by(
        DocumentChunk.chunk_index
    ).all()

    chunk_list = [
        {
            "chunk_index": c.chunk_index,
            "text": c.text[:200] + "..." if len(c.text) > 200 else c.text,
            "page_number": c.page_number,
            "char_start": c.char_start,
            "char_end": c.char_end,
        }
        for c in chunks
    ]

    data = _job_to_meta(job, len(chunks))
    data["full_text"] = (job.full_text or "")[:500] + "..." if job.full_text and len(job.full_text) > 500 else (job.full_text or "")
    data["chunks"] = chunk_list
    return data


@router.patch("/metadata-v3/documents/{job_id}")
def patch_document(
    job_id: str,
    body: PatchDocumentRequest,
    user_id: str = Query(...),
    db: Session = Depends(get_db),
):
    """문서 메타데이터 수정 (태그, 노트, 문서유형)"""
    job = db.query(Job).filter(Job.job_id == job_id, Job.user_id == user_id).first()
    if not job:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")

    if body.tags is not None:
        job.tags = json.dumps(body.tags, ensure_ascii=False)
    if body.notes is not None:
        job.notes = body.notes
    if body.doc_type is not None:
        job.doc_type = body.doc_type

    db.commit()
    db.refresh(job)

    chunks = db.query(DocumentChunk).filter(DocumentChunk.job_id == job_id).count()
    return _job_to_meta(job, chunks)


# ============================================================
# 추출 규칙 API (전용 테이블 활용 버전)
# ============================================================

def _ensure_default_fields(user_id: str, db: Session):
    """기본 메타데이터 필드 정의가 없으면 생성"""
    defaults = [
        {"key": "title",   "label": "제목"},
        {"key": "date",    "label": "날짜"},
        {"key": "amount",  "label": "금액"},
        {"key": "vendor",  "label": "업체/기관명"},
        {"key": "address", "label": "주소"},
        {"key": "person",  "label": "인명"},
    ]
    for d in defaults:
        exists = db.query(MetadataFieldDefinition).filter_by(user_id=user_id, field_key=d["key"]).first()
        if not exists:
            db.add(MetadataFieldDefinition(user_id=user_id, field_key=d["key"], label=d["label"]))
    db.commit()


def _ensure_default_categories(user_id: str, db: Session):
    """Ensure default categories exist"""
    defaults = ["공문서", "계약서", "보고서", "학술논문", "법령문서", "회의록", "영수증", "신분증", "기타", "미분류"]
    for name in defaults:
        exists = db.query(DocumentCategory).filter_by(user_id=user_id, name=name).first()
        if not exists:
            db.add(DocumentCategory(user_id=user_id, name=name))
    db.commit()


def _is_korean_doc_category(name: str) -> bool:
    """한글/숫자/공백/일부 구분자만 허용하고 영문 카테고리는 제외"""
    if not name:
        return False
    # ASCII 알파벳 포함 시 영어 카테고리로 간주
    if any(('a' <= ch.lower() <= 'z') for ch in name):
        return False
    return True


@router.get("/metadata-v3/masking-rules")
def get_masking_rules(
    user_id: str = Query(...),
    db: Session = Depends(get_db),
):
    """문서 유형별 추출 필드 목록 전체 조회 (신규 테이블 기반)"""
    _ensure_default_fields(user_id, db)
    
    # 1. 모든 규칙 조회
    rules = db.query(ExtractionRule).filter_by(user_id=user_id, is_active=True).all()
    
    # 2. 결과 구조화: {doc_type: [field_key, ...]}
    result = {}
    for rule in rules:
        if rule.doc_type not in result:
            result[rule.doc_type] = []
        if rule.field:
            result[rule.doc_type].append(rule.field.field_key)
            
    return result


@router.put("/metadata-v3/masking-rules")
def upsert_masking_rule(
    body: MaskingRuleUpsert,
    user_id: str = Query(...),
    db: Session = Depends(get_db),
):
    """특정 문서 유형의 추출 대상 필드 저장 (신규 테이블 기반)"""
    _ensure_default_fields(user_id, db)
    
    # 1. 기존 해당 doc_type의 모든 규칙 삭제 (단순화를 위해)
    db.query(ExtractionRule).filter_by(user_id=user_id, doc_type=body.doc_type).delete()
    
    # 2. 새 필드 리스트를 바탕으로 규칙 생성
    for field_key in body.pii_types:
        # 필드 정의가 있는지 확인
        field_def = db.query(MetadataFieldDefinition).filter_by(user_id=user_id, field_key=field_key).first()
        if not field_def:
            # 커스텀 필드일 가능성 있음 -> 새로 정의
            field_def = MetadataFieldDefinition(user_id=user_id, field_key=field_key, label=field_key)
            db.add(field_def)
            db.commit()
            db.refresh(field_def)
        
        # 규칙 추가
        new_rule = ExtractionRule(
            user_id=user_id,
            doc_type=body.doc_type,
            field_id=field_def.id
        )
        db.add(new_rule)
    
    db.commit()
    logger.info(f"[ExtractionRule-Structured] {user_id}/{body.doc_type} → {body.pii_types}")
    return {"doc_type": body.doc_type, "pii_types": body.pii_types}


# ============================================================
# 커스텀 카테고리 및 필드 API
# ============================================================

class CategoryCreate(BaseModel):
    name: str

class CustomFieldCreate(BaseModel):
    label: str
    pattern: Optional[str] = None
    description: Optional[str] = None

@router.get("/metadata-v3/categories")
def get_categories(user_id: str = Query(...), db: Session = Depends(get_db)):
    """사용자가 추가한 커스텀 카테고리 목록 조회"""
    _ensure_default_categories(user_id, db)
    cats = db.query(DocumentCategory).filter_by(user_id=user_id).order_by(DocumentCategory.created_at).all()
    cats = [c for c in cats if _is_korean_doc_category(c.name)]
    return [{"id": c.id, "name": c.name} for c in cats]

@router.post("/metadata-v3/categories")
def create_category(body: CategoryCreate, user_id: str = Query(...), db: Session = Depends(get_db)):
    """커스텀 카테고리 추가"""
    normalized_name = (body.name or "").strip()
    if not _is_korean_doc_category(normalized_name):
        raise HTTPException(status_code=400, detail="문서 카테고리는 한글로 입력해주세요.")
    cat = DocumentCategory(user_id=user_id, name=normalized_name)
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return {"id": cat.id, "name": cat.name}

@router.delete("/metadata-v3/categories/{cat_id}")
def delete_category(cat_id: int, user_id: str = Query(...), db: Session = Depends(get_db)):
    """커스텀 카테고리 삭제"""
    cat = db.query(DocumentCategory).filter_by(id=cat_id, user_id=user_id).first()
    if cat:
        db.delete(cat)
        db.commit()
    return {"ok": True}

@router.get("/metadata-v3/custom-fields")
def get_custom_fields(user_id: str = Query(...), db: Session = Depends(get_db)):
    """사용자가 추가한 커스텀 마스킹 필드 목록 조회"""
    fields = db.query(CustomMaskingField).filter_by(user_id=user_id).order_by(CustomMaskingField.created_at).all()
    return [
        {
            "id": f.id,
            "field_key": f.field_key,
            "label": f.label,
            "pattern": f.pattern,
            "description": f.description
        }
        for f in fields
    ]

@router.post("/metadata-v3/custom-fields")
def create_custom_field(body: CustomFieldCreate, user_id: str = Query(...), db: Session = Depends(get_db)):
    """커스텀 마스킹 필드 추가"""
    import uuid
    field_key = f"custom_{uuid.uuid4().hex[:8]}"
    cf = CustomMaskingField(
        user_id=user_id,
        field_key=field_key,
        label=body.label,
        pattern=body.pattern,
        description=body.description
    )
    db.add(cf)
    db.commit()
    db.refresh(cf)
    return {
        "id": cf.id,
        "field_key": cf.field_key,
        "label": cf.label,
        "pattern": cf.pattern,
        "description": cf.description
    }

@router.delete("/metadata-v3/custom-fields/{field_id}")
def delete_custom_field(field_id: int, user_id: str = Query(...), db: Session = Depends(get_db)):
    """커스텀 마스킹 필드 삭제"""
    cf = db.query(CustomMaskingField).filter_by(id=field_id, user_id=user_id).first()
    if cf:
        db.delete(cf)
        db.commit()
    return {"ok": True}
