"""
Masking api - PII 감지 및 마스킹 pdf 다운로드
"""
import json
import logging
import io
import os as _os
import tempfile as _tempfile
from pathlib import Path
from typing import Optional, Dict

import fitz 
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from config import Config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/masking", tags=["Masking"])

_KOREAN_FONT_PATH = str(Path(__file__).parent.parent / "assets" / "fonts" / "NanumGothic.ttf")

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

def _sample_background_color(pdf_page, rect: fitz.Rect) -> tuple:
    """rect 주변 픽셀을 샘플링해 배경색을 추정한다."""
    pad = 5
    pr = pdf_page.rect
    zones = [
        fitz.Rect(rect.x0, max(pr.y0, rect.y0 - pad), rect.x1, rect.y0),
        fitz.Rect(rect.x0, rect.y1, rect.x1, min(pr.y1, rect.y1 + pad)),
    ]
    pixels = []
    for zone in zones:
        if zone.is_empty or zone.width < 1 or zone.height < 1: continue
        try:
            pix = pdf_page.get_pixmap(clip=zone, matrix=fitz.Matrix(1, 1))
            data = pix.samples
            for i in range(0, len(data) - 2, pix.n):
                pixels.append((data[i], data[i + 1], data[i + 2]))
        except: pass
    if not pixels: return (1.0, 1.0, 1.0)
    pixels.sort(key=lambda p: p[0] + p[1] + p[2], reverse=True)
    top_n = max(1, len(pixels) // 10)
    top = pixels[:top_n]
    return (sum(p[0] for p in top)/top_n/255, sum(p[1] for p in top)/top_n/255, sum(p[2] for p in top)/top_n/255)

def _apply_masking(pdf_path: Path, boxes: list, ocr_data: dict) -> bytes:
    """물리적 삭제 + 자연스러운 덧씌우기"""
    try:
        import numpy as np
        from PIL import Image
    except ImportError:
        np = None

    try:
        doc = fitz.open(str(pdf_path))
        ocr_pages = {p.get("page_number") or p.get("page"): p for p in ocr_data.get("pages", [])}

        for page_index in range(len(doc)):
            page_num = page_index + 1
            page_boxes = [b for b in boxes if str(b.get("page")) == str(page_num)]
            if not page_boxes: continue

            pdf_page = doc[page_index]
            ocr_p = ocr_pages.get(page_num, {})
            scale_x = pdf_page.rect.width / (ocr_p.get("width") or pdf_page.rect.width)
            scale_y = pdf_page.rect.height / (ocr_p.get("height") or pdf_page.rect.height)

            pending = []
            for item in page_boxes:
                bbox = item.get("bbox")
                if not bbox: continue
                x1, y1, x2, y2 = bbox
                rect = fitz.Rect(x1*scale_x, y1*scale_y, x2*scale_x, y2*scale_y)
                
                # bg_color = _sample_background_color(pdf_page, rect)
                bg_color = (1.0, 0.0, 0.0) # 임시로 빨간색 적용
                f_bytes, f_size, f_color = _extract_span_font(doc, pdf_page, rect)
                
                pdf_page.add_redact_annot(rect, fill=bg_color)
                pending.append({
                    "rect": rect,
                    "text": item.get("masked_value", ""),
                    "bg_color": bg_color,
                    "font_bytes": f_bytes,
                    "font_size": f_size,
                    "font_color": f_color
                })

            pdf_page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE)

            for p in pending:
                if not p["text"]: continue
                # 질감 추가 (노이즈)
                if np:
                    try:
                        w, h = int(p["rect"].width * 2), int(p["rect"].height * 2)
                        noise = np.random.randint(-2, 3, (h, w, 3), dtype='int16')
                        base = np.array([p["bg_color"][0]*255, p["bg_color"][1]*255, p["bg_color"][2]*255])
                        arr = np.clip(base + noise, 0, 255).astype('uint8')
                        img = Image.fromarray(arr)
                        img_buf = io.BytesIO()
                        img.save(img_buf, format='PNG')
                        pdf_page.insert_image(p["rect"], stream=img_buf.getvalue(), overlay=True)
                    except: pass

                # 텍스트 복원
                f_size = p["font_size"] if p["font_size"] and p["font_size"] > 0 else max(7.0, p["rect"].height * 0.65)
                f_color = p["font_color"] if p["font_color"] else (0.2, 0.2, 0.2)
                try:
                    kwargs = {"rect": p["rect"], "text": p["text"], "fontsize": f_size, "color": f_color, "align": fitz.TEXT_ALIGN_LEFT}
                    if p["font_bytes"]:
                        with _tempfile.NamedTemporaryFile(suffix=".ttf", delete=False) as tmp:
                            tmp.write(p["font_bytes"])
                            tmp_name = tmp.name
                        pdf_page.insert_textbox(**kwargs, fontfile=tmp_name, fontname="orig")
                        try: _os.unlink(tmp_name)
                        except: pass
                    elif _os.path.exists(_KOREAN_FONT_PATH):
                        pdf_page.insert_textbox(**kwargs, fontfile=_KOREAN_FONT_PATH, fontname="kor")
                    else:
                        pdf_page.insert_textbox(**kwargs)
                except: pass

        pdf_bytes = doc.tobytes(garbage=3, deflate=True)
        doc.close()
        return pdf_bytes
    except Exception as e:
        logger.error(f"Masking failed: {e}")
        with open(pdf_path, "rb") as f: return f.read()

def _ensure_masked_pdf(job_id: str, pii_data: dict) -> None:
    masked_pdf_path = Config.PROCESSED_DIR / f"{job_id}_masked.pdf"
    if masked_pdf_path.exists(): return
    pdf_path = Config.PROCESSED_DIR / f"{job_id}.pdf"
    if not pdf_path.exists(): return
    boxes = [b for b in pii_data.get("masked_boxes", []) if b.get("bbox") and b.get("masked_value") != b.get("value")]
    ocr_data = _load_ocr(job_id) or {}
    try:
        pdf_bytes = _apply_masking(pdf_path, boxes, ocr_data)
        with open(masked_pdf_path, "wb") as f: f.write(pdf_bytes)
    except: pass

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

@router.get("/{job_id}/detect")
async def detect_pii(job_id: str):
    pii_path = Config.PROCESSED_DIR / f"{job_id}_pii.json"
    if pii_path.exists():
        with open(pii_path, "r", encoding="utf-8") as f: cached = json.load(f)
        cached["masked_boxes"] = [b for b in cached.get("masked_boxes", []) if b.get("masked_value") != b.get("value")]
        cached["pii_items"] = [item for item in cached.get("pii_items", []) if item.get("masked_value") != item.get("value")]
        _ensure_masked_pdf(job_id, cached)
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