"""
My Dashboard API — single endpoint returning all stats for the logged-in user.
"""
import json
from datetime import datetime, timezone, date
from collections import defaultdict
from typing import Optional

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session

from database import SessionLocal, Job, PIIRecord, Session as DBSession

router = APIRouter()

PII_LABEL = {
    "RRN": "주민등록번호",
    "PHONE": "전화번호",
    "EMAIL": "이메일",
    "NAME": "이름",
    "ENGLISH_NAME": "영문이름",
    "ROAD_ADDRESS": "도로명주소",
    "ACCOUNT_NO": "계좌번호",
    "CREDIT_CARD": "신용카드",
    "PASSPORT_NO": "여권번호",
    "DRIVERS_LICENSE": "운전면허",
    "CAR_NO": "차량번호",
    "BUSINESS_REG_NO": "사업자번호",
    "IP_ADDRESS": "IP주소",
    "MAC_ADDRESS": "MAC주소",
    "FOREIGNER_REG_NO": "외국인등록번호",
    "HEALTH_INSURANCE_NO": "건강보험번호",
}

DOC_TYPE_LABEL = {
    "계약서": "계약서",
    "공문서": "공문서",
    "보고서": "보고서",
    "영수증": "영수증",
    "학술논문": "학술논문",
    "기타": "기타",
}


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _parse_tags(tags_str: Optional[str]) -> list:
    if not tags_str:
        return []
    try:
        parsed = json.loads(tags_str)
        if isinstance(parsed, list):
            return parsed
    except Exception:
        pass
    return []


@router.get("/api/my-dashboard")
def get_my_dashboard(user_id: str = Query(..., description="로그인한 사용자 ID"), db: Session = Depends(get_db)):
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id is required")

    # 1. 해당 유저의 모든 Job 조회
    jobs = db.query(Job).filter(Job.user_id == user_id).all()
    job_ids = [j.job_id for j in jobs]

    # 2. 세션 수
    session_count = db.query(DBSession).filter(DBSession.user_id == user_id).count()

    # 3. PII 레코드 일괄 조회
    pii_records = []
    if job_ids:
        pii_records = db.query(PIIRecord).filter(PIIRecord.job_id.in_(job_ids)).all()

    # job_id → PIIRecord 매핑
    pii_by_job: dict[str, PIIRecord] = {r.job_id: r for r in pii_records}

    # 4. 위젯 통계 계산
    total_documents = len(jobs)
    completed_documents = sum(1 for j in jobs if j.status == "completed")

    detected_pii = 0
    pii_type_counter: dict[str, int] = defaultdict(int)
    extracted_tags = 0

    for j in jobs:
        # 태그 수 합산
        extracted_tags += len(_parse_tags(j.tags))

        pii_rec = pii_by_job.get(j.job_id)
        if pii_rec:
            boxes = pii_rec.masked_boxes or []
            detected_pii += len(boxes)
            for box in boxes:
                ptype = box.get("type", "UNKNOWN") if isinstance(box, dict) else "UNKNOWN"
                pii_type_counter[ptype] += 1

    masked_items = detected_pii  # 마스킹 항목 = 검출된 PII와 동일

    # 4-b. 처리 시간 통계 (completed 문서 기준)
    times = [j.processing_time_seconds for j in jobs if j.processing_time_seconds is not None and j.status == "completed"]
    avg_seconds = round(sum(times) / len(times), 1) if times else None
    failed_count = sum(1 for j in jobs if j.status == "failed")
    success_rate = round(completed_documents / total_documents * 100, 1) if total_documents > 0 else None

    # 5. 문서 유형 분포
    doc_type_counter: dict[str, int] = defaultdict(int)
    for j in jobs:
        dt = j.doc_type or "기타"
        doc_type_counter[dt] += 1

    total_for_pct = sum(doc_type_counter.values()) or 1
    doc_type_dist = [
        {
            "label": dt,
            "count": cnt,
            "pct": round(cnt / total_for_pct * 100, 1),
        }
        for dt, cnt in sorted(doc_type_counter.items(), key=lambda x: -x[1])
    ]

    # 6. PII 유형 분포 (상위 내림차순)
    pii_type_dist = [
        {
            "type": ptype,
            "label": PII_LABEL.get(ptype, ptype),
            "count": cnt,
        }
        for ptype, cnt in sorted(pii_type_counter.items(), key=lambda x: -x[1])
    ]

    # 7. 문서별 상세 목록
    documents = []
    for j in jobs:
        pii_rec = pii_by_job.get(j.job_id)
        pii_total = 0
        pii_by_type_for_doc: dict[str, int] = defaultdict(int)
        if pii_rec:
            boxes = pii_rec.masked_boxes or []
            pii_total = len(boxes)
            for box in boxes:
                ptype = box.get("type", "UNKNOWN") if isinstance(box, dict) else "UNKNOWN"
                pii_by_type_for_doc[ptype] += 1

        tag_count = len(_parse_tags(j.tags))

        documents.append({
            "job_id": j.job_id,
            "filename": j.original_filename,
            "status": j.status,
            "doc_type": j.doc_type or "기타",
            "created_at": j.created_at.isoformat() if j.created_at else None,
            "pii_total": pii_total,
            "pii_by_type": [
                {"type": pt, "label": PII_LABEL.get(pt, pt), "count": c}
                for pt, c in sorted(pii_by_type_for_doc.items(), key=lambda x: -x[1])
            ],
            "tag_count": tag_count,
        })

    # 최신순 정렬
    documents.sort(key=lambda d: d["created_at"] or "", reverse=True)

    # 8. 오늘 상태 (UTC 기준)
    today_start = datetime.now(tz=timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

    def _created_today(j: Job) -> bool:
        if not j.created_at:
            return False
        ct = j.created_at
        # DB datetime may be naive (UTC) or aware
        if ct.tzinfo is None:
            from datetime import timezone as _tz
            ct = ct.replace(tzinfo=_tz.utc)
        return ct >= today_start

    today_jobs = [j for j in jobs if _created_today(j)]
    today_status = {
        "completed": sum(1 for j in today_jobs if j.status == "completed"),
        "failed": sum(1 for j in today_jobs if j.status == "failed"),
        "processing": sum(1 for j in today_jobs if j.status == "processing"),
        "queued": sum(1 for j in today_jobs if j.status == "queued"),
        "total": len(today_jobs),
    }

    return {
        "processing_stats": {
            "avg_seconds": avg_seconds,
            "success_rate": success_rate,
            "completed": completed_documents,
            "failed": failed_count,
            "total": total_documents,
        },
        "widgets": {
            "total_sessions": session_count,
            "total_documents": total_documents,
            "completed_documents": completed_documents,
            "detected_pii": detected_pii,
            "masked_items": masked_items,
            "extracted_tags": extracted_tags,
        },
        "doc_type_dist": doc_type_dist,
        "pii_type_dist": pii_type_dist,
        "documents": documents,
        "today_status": today_status,
    }
