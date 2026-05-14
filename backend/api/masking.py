"""
Masking api - PII 감지 및 마스킹 pdf 다운로드
"""
import json
import logging
import io
import os as _os

from pathlib import Path
from typing import Optional, Dict

import re as _re
import fitz
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session as DBSession
from database import get_db
from config import Config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/masking", tags=["Masking"])

_KOREAN_FONT_PATH = str(Path(__file__).parent.parent / "assets" / "fonts" / "NanumGothic.ttf")

# 한글 폰트 탐색: 번들 폰트 → 시스템 폰트 순으로 시도
_KOREAN_FONT_CANDIDATES = [
    _KOREAN_FONT_PATH,
    r"C:\Windows\Fonts\malgun.ttf",   # Malgun Gothic (Windows 기본)
    r"C:\Windows\Fonts\malgunbd.ttf",
    r"C:\Windows\Fonts\gulim.ttc",
    "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",   # Linux
]
_RESOLVED_FONT_PATH: str | None = next(
    (p for p in _KOREAN_FONT_CANDIDATES if _os.path.exists(p)), None
)

def _sanitize_for_pdf(text: str) -> str:
    """한글 폰트 없을 때 CJK 문자를 * 로 치환해 .notdef 렌더링 방지."""
    return _re.sub(r'[가-힣ᄀ-ᇿ㄰-㆏]', '*', text)

def _load_ocr(job_id: str) -> Optional[Dict]:
    """OCR 결과 JSON 로드"""
    json_path = Config.PROCESSED_DIR / f"{job_id}_ocr.json"
    if not json_path.exists():
        return None
    with open(json_path, "r", encoding="utf-8") as f:
        return json.load(f)

def _extract_span_font(doc, page, rect: fitz.Rect):
    """지정된 영역(rect) 내에서 가장 지배적인 텍스트 스팬의 폰트 정보를 추출한다."""
    try:
        dict_page = page.get_text("dict", clip=rect)
        for block in dict_page.get("blocks", []):
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    # 폰트 데이터 추출 시도
                    font_name = span.get("font")
                    font_size = span.get("size")
                    color_int = span.get("color")
                    
                    # 정수 색상을 RGB로 변환
                    r = ((color_int >> 16) & 0xFF) / 255.0
                    g = ((color_int >> 8) & 0xFF) / 255.0
                    b = (color_int & 0xFF) / 255.0
                    
                    # 폰트 바이너리 추출
                    font_bytes = None
                    try:
                        for f in doc.get_page_fonts(page.number):
                            if f[3] == font_name:
                                font_bytes = doc.extract_font(f[0])[3]
                                break
                    except: pass
                    
                    return font_bytes, font_size, (r, g, b)
    except: pass
    return None, None, None


def _apply_masking(pdf_path: Path, boxes: list, ocr_data: dict) -> bytes:
    """이미지 기반 PDF 위에 직접 불투명 사각형을 그려 마스킹 처리"""
    doc = fitz.open(str(pdf_path))
    try:
        ocr_pages = {p.get("page_number") or p.get("page"): p for p in (ocr_data or {}).get("pages", [])}

        for page_index in range(len(doc)):
            page_num = page_index + 1
            page_boxes = [b for b in boxes if str(b.get("page")) == str(page_num)]
            if not page_boxes:
                continue

            pdf_page = doc[page_index]

            ocr_p = ocr_pages.get(page_num, {})
            scale_x = pdf_page.rect.width / (ocr_p.get("width") or pdf_page.rect.width)
            scale_y = pdf_page.rect.height / (ocr_p.get("height") or pdf_page.rect.height)

            for item in page_boxes:
                bbox = item.get("bbox")
                if not bbox:
                    continue
                x1, y1, x2, y2 = bbox
                
                # 웹 PDF 뷰어와 동일한 시각적 효과(여백)를 주기 위해 
                # 좌우로 4pt, 상하로 2pt씩 마스킹 박스 영역을 확장합니다.
                rect = fitz.Rect(
                    x1 * scale_x - 4, 
                    y1 * scale_y - 2, 
                    x2 * scale_x + 4, 
                    y2 * scale_y + 2
                )

                # draw_rect(overlay=True) 는 이미지 배경을 포함한 모든 내용 위에 직접 그림
                pdf_page.draw_rect(rect, color=(1.0, 0.0, 0.0), fill=(1.0, 0.0, 0.0), overlay=True)

                masked_text = item.get("masked_value", "")
                if masked_text:
                    # 박스 크기(높이/너비)에 구애받지 않고 무조건 텍스트를 렌더링하도록 insert_text 사용
                    f_size = max(6.0, rect.height * 0.65)
                    # 박스가 확장된 만큼 텍스트 시작 위치도 조금 더 안쪽으로 이동
                    start_point = fitz.Point(rect.x0 + 4, rect.y1 - (rect.height * 0.2))
                    try:
                        if _RESOLVED_FONT_PATH:
                            pdf_page.insert_text(
                                point=start_point,
                                text=masked_text,
                                fontsize=f_size,
                                fontname="kor",
                                fontfile=_RESOLVED_FONT_PATH,
                                color=(1.0, 1.0, 1.0),
                                overlay=True
                            )
                        else:
                            # 한글 폰트 없음 → CJK 문자를 * 로 치환 후 Latin 폰트로 렌더
                            pdf_page.insert_text(
                                point=start_point,
                                text=_sanitize_for_pdf(masked_text),
                                fontsize=f_size,
                                color=(1.0, 1.0, 1.0),
                                overlay=True
                            )
                    except Exception as e:
                        logger.warning(f"마스킹 텍스트 삽입 실패: {e}")
                        pass

        return doc.tobytes(garbage=3, deflate=True)
    except Exception as e:
        logger.error(f"Masking failed: {e}", exc_info=True)
        raise
    finally:
        doc.close()

def _ensure_masked_pdf(job_id: str, pii_data: dict) -> None:
    masked_pdf_path = Config.PROCESSED_DIR / f"{job_id}_masked.pdf"
    pdf_path = Config.PROCESSED_DIR / f"{job_id}.pdf"
    if not pdf_path.exists(): return
    boxes = [b for b in pii_data.get("masked_boxes", []) if b.get("bbox") and b.get("masked_value") != b.get("value")]
    ocr_data = _load_ocr(job_id) or {}
    try:
        pdf_bytes = _apply_masking(pdf_path, boxes, ocr_data)
        with open(masked_pdf_path, "wb") as f: f.write(pdf_bytes)
    except Exception as e:
        logger.error(f"_ensure_masked_pdf failed for {job_id}: {e}", exc_info=True)

def _enrich_boxes_with_font_info(pdf_path: Path, boxes: list, ocr_data: dict) -> None:
    if not pdf_path.exists(): return
    try:
        doc = fitz.open(str(pdf_path))
        ocr_pages = {p.get("page_number") or p.get("page"): p for p in ocr_data.get("pages", [])}
        for box in boxes:
            page_num = box.get("page")
            bbox = box.get("bbox")
            if not page_num or not bbox: continue
            try:
                pdf_page = doc[int(page_num) - 1]
                ocr_p = ocr_pages.get(page_num, {})
                scale_y = pdf_page.rect.height / (ocr_p.get("height") or pdf_page.rect.height)
                rect = fitz.Rect(bbox[0]*scale_y, bbox[1]*scale_y, bbox[2]*scale_y, bbox[3]*scale_y)
                _, f_size, f_color = _extract_span_font(doc, pdf_page, rect)
                if f_size: box["font_size"] = f_size / scale_y
                if f_color: box["font_color"] = list(f_color)
            except: pass
        doc.close()
    except: pass

def _save_pii_record_to_db(db: DBSession, job_id: str, pii_data: dict) -> None:
    """PII 마스킹 결과를 DB에 저장하거나 업데이트합니다."""
    try:
        from database import Job, PIIRecord

        job = db.query(Job).filter(Job.job_id == job_id).first()
        if not job:
            logger.warning(f"Job {job_id} not found. Cannot save PII record.")
            return
            
        masked_boxes = pii_data.get("masked_boxes", [])
        total_count = len(masked_boxes)
        # 추출된 마스킹 항목들 중 중복을 제거하여 type값들의 배열 생성
        detected_types = list(set(b.get("type") for b in masked_boxes if b.get("type")))
        
        record = db.query(PIIRecord).filter(PIIRecord.job_id == job_id).first()
        if not record:
            record = PIIRecord(job_id=job_id, file_name=job.original_filename)
            db.add(record)
            
        record.masked_boxes = masked_boxes
        record.total_count = total_count
        record.detected_types = detected_types
        
        db.commit()
    except Exception as e:
        logger.error(f"Failed to save PII record to DB: {e}")
        db.rollback()

@router.get("/{job_id}/detect")
async def detect_pii(job_id: str, db: DBSession = Depends(get_db)):
    pii_path = Config.PROCESSED_DIR / f"{job_id}_pii.json"
    if pii_path.exists():
        with open(pii_path, "r", encoding="utf-8") as f: cached = json.load(f)
        cached["masked_boxes"] = [b for b in cached.get("masked_boxes", []) if b.get("masked_value") != b.get("value")]
        cached["pii_items"] = [item for item in cached.get("pii_items", []) if item.get("masked_value") != item.get("value")]
        _ensure_masked_pdf(job_id, cached)
        # OCR 워커가 이미 저장했을 경우 중복 저장 방지, 미저장 시 fallback
        from database import PIIRecord
        if not db.query(PIIRecord).filter(PIIRecord.job_id == job_id).first():
            _save_pii_record_to_db(db, job_id, cached)
        return cached

    from core.pii_extractor import extract_pii_from_pages, mask_value
    ocr_data = _load_ocr(job_id)
    if not ocr_data: raise HTTPException(status_code=404, detail="OCR not found")
    pii_boxes = extract_pii_from_pages(ocr_data.get("pages", []))
    for box in pii_boxes: box["masked_value"] = mask_value(box["type"], box["value"])
    pii_boxes = [b for b in pii_boxes if b.get("masked_value") != b.get("value")]
    pii_items = [{"type": b["type"], "value": b["value"], "masked_value": b["masked_value"]} for b in pii_boxes]
    _enrich_boxes_with_font_info(Config.PROCESSED_DIR / f"{job_id}.pdf", pii_boxes, ocr_data)
    result = {"job_id": job_id, "pii_items": pii_items, "masked_boxes": pii_boxes}
    with open(pii_path, "w", encoding="utf-8") as f: json.dump(result, f, ensure_ascii=False, indent=2)
    _ensure_masked_pdf(job_id, result)
    _save_pii_record_to_db(db, job_id, result)
    return result

@router.get("/{job_id}/download")
async def download_masked_pdf(job_id: str):
    pii_path = Config.PROCESSED_DIR / f"{job_id}_pii.json"
    if not pii_path.exists(): raise HTTPException(status_code=404, detail="PII not found")
    with open(pii_path, "r", encoding="utf-8") as f: pii_data = json.load(f)
    pdf_path = Config.PROCESSED_DIR / f"{job_id}.pdf"
    if not pdf_path.exists(): raise HTTPException(status_code=404, detail="PDF not found")
    boxes = [b for b in pii_data.get("masked_boxes", []) if b.get("bbox") and b.get("masked_value") != b.get("value")]
    masked_pdf_bytes = _apply_masking(pdf_path, boxes, _load_ocr(job_id))
    return StreamingResponse(io.BytesIO(masked_pdf_bytes), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="masked_{job_id}.pdf"'})