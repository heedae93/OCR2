from fastapi import APIRouter, HTTPException

from database import SessionLocal, TikaRun, TikaRunPage

router = APIRouter()


@router.get("/tika/{job_id}")
def get_tika_pages(job_id: str):
    """
    Tika 트랙 결과 조회.
    """
    db = SessionLocal()
    try:
        run = (
            db.query(TikaRun)
            .filter(TikaRun.job_id == job_id)
            .order_by(TikaRun.created_at.desc())
            .first()
        )
        if not run:
            raise HTTPException(status_code=404, detail="Tika 결과가 없습니다.")

        rows = (
            db.query(TikaRunPage)
            .filter(TikaRunPage.run_id == run.run_id)
            .order_by(TikaRunPage.page_number.asc(), TikaRunPage.id.asc())
            .all()
        )
        return {
            "job_id": job_id,
            "run": {
                "run_id": run.run_id,
                "source_pdf_path": run.source_pdf_path,
                "tika_server_url": run.tika_server_url,
                "page_count": run.page_count,
                "combined_text": run.combined_text,
                "status": run.status,
                "skip_reason": run.skip_reason,
                "created_at": run.created_at,
            },
            "pages": [
                {
                    "page_number": r.page_number,
                    "has_text_layer": r.has_text_layer,
                    "tika_text": r.tika_text,
                    "skipped_reason": r.skipped_reason,
                    "created_at": r.created_at,
                }
                for r in rows
            ],
        }
    finally:
        db.close()

