"""
검색 API - OpenSearch를 통한 문서 전문 검색
"""
import logging
from fastapi import APIRouter, HTTPException, Query

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/search", tags=["Search"])


@router.get("")
def search_documents(
    q: str = Query(..., min_length=1, description="검색어"),
    page: int = Query(1, ge=1, description="페이지 번호 (1부터 시작)"),
    size: int = Query(10, ge=1, le=50, description="페이지당 결과 수"),
):
    """
    업로드된 문서를 전문 검색합니다.

    - **q**: 검색어 (OCR 텍스트, 요약, 키워드에서 검색)
    - **page**: 페이지 번호
    - **size**: 페이지당 결과 수 (최대 50)
    """
    from core.search_engine import search_engine

    from_ = (page - 1) * size
    raw = search_engine.search(q, size=size, from_=from_)

    if not raw:
        raise HTTPException(status_code=503, detail="OpenSearch에 연결할 수 없습니다.")

    result = search_engine.format_results(raw)
    result["page"] = page
    result["size"] = size
    result["query"] = q

    return result
