"""
Masking api - PII 감지 및 마스킹 pdf 다운로드
"""
import json
import logging
import io
from pathlib import Path
from typing import Optional, Dict

import fitz 
from fastapi import APIRouter,HTTPException
from fastapi.responses import StreamingResponse
from config import Config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/masking", tags=["Masking"])

def _load_ocr(job_id:str) -> Optional[Dict]:
    """OCR 결과 JSON 로드"""
    json_path = Config.PROCESSED_DIR / f"{job_id}_ocr.json"
    if not json_path.exists():
        return None
    with open(json_path,"r",encoding="utf-8") as f:
        return json.load(f)
    

# ============================================================
# 1. PII 감지 엔드포인트
# ============================================================

def _ensure_masked_pdf(job_id: str, pii_data: dict) -> None:
    """마스킹 PDF 파일이 없으면 생성해서 저장한다."""
    masked_pdf_path = Config.PROCESSED_DIR / f"{job_id}_masked.pdf"
    if masked_pdf_path.exists():
        return

    pdf_path = Config.PROCESSED_DIR / f"{job_id}.pdf"
    if not pdf_path.exists():
        logger.warning(f"원본 PDF 없음, 마스킹 PDF 생성 스킵: {job_id}")
        return

    boxes_with_bbox = [
        b for b in pii_data.get("masked_boxes", [])
        if b.get("bbox") and b.get("masked_value", b.get("value")) != b.get("value")
    ]

    ocr_data = _load_ocr(job_id) or {}
    try:
        pdf_bytes = _apply_masking(pdf_path, boxes_with_bbox, ocr_data)
        with open(masked_pdf_path, "wb") as f:
            f.write(pdf_bytes)
        logger.info(f"마스킹 PDF 저장 완료: {masked_pdf_path}")
    except Exception as e:
        logger.error(f"마스킹 PDF 생성 실패 ({job_id}): {e}")


def _enrich_boxes_with_font_info(pdf_path: Path, boxes: list, ocr_data: dict) -> None:
    """각 마스킹 박스에 원본 PDF 폰트 크기·색상 정보를 추가한다 (네이티브 PDF 전용)."""
    if not pdf_path.exists():
        return
    try:
        doc = fitz.open(str(pdf_path))
        ocr_pages = {p.get("page_number") or p.get("page"): p for p in ocr_data.get("pages", [])}

        for box in boxes:
            page_num = box.get("page")
            bbox = box.get("bbox")
            if not page_num or not bbox:
                continue
            try:
                pdf_page = doc[int(page_num) - 1]
            except Exception:
                continue

            ocr_p = ocr_pages.get(page_num, {})
            ocr_w = ocr_p.get("width") or pdf_page.rect.width
            ocr_h = ocr_p.get("height") or pdf_page.rect.height
            scale_x = pdf_page.rect.width / ocr_w
            scale_y = pdf_page.rect.height / ocr_h

            x1, y1, x2, y2 = bbox
            rect = fitz.Rect(x1 * scale_x, y1 * scale_y, x2 * scale_x, y2 * scale_y)

            _, font_size_pt, font_color = _extract_span_font(doc, pdf_page, rect)

            if font_size_pt and font_size_pt > 0:
                # PDF 포인트 → OCR 픽셀 좌표로 변환 (프론트엔드가 scaleY 곱하면 화면 픽셀이 됨)
                box["font_size"] = font_size_pt / scale_y
            if font_color:
                box["font_color"] = list(font_color)

        doc.close()
    except Exception as e:
        logger.debug(f"폰트 정보 추출 실패 (무시): {e}")


@router.get("/{job_id}/detect")
async def detect_pii(job_id: str):
    pii_path = Config.PROCESSED_DIR / f"{job_id}_pii.json"

    # 저장된 파일 있으면 필터링 후 반환
    if pii_path.exists():
        with open(pii_path, "r", encoding="utf-8") as f:
            cached = json.load(f)
        # 마스킹이 실제로 변경되지 않은 항목(라벨 단어 등) 제외
        cached["masked_boxes"] = [
            b for b in cached.get("masked_boxes", [])
            if b.get("masked_value") != b.get("value")
        ]
        cached["pii_items"] = [
            item for item in cached.get("pii_items", [])
            if item.get("masked_value") != item.get("value")
        ]
        # 마스킹 PDF가 없으면 생성
        _ensure_masked_pdf(job_id, cached)
        return cached

    # 없으면 실시간 추출 (fallback)
    from core.pii_extractor import extract_pii_from_pages, mask_value
    ocr_data = _load_ocr(job_id)
    if not ocr_data:
        raise HTTPException(status_code=404, detail="OCR 결과를 찾을 수 없습니다. OCR을 먼저 실행하세요.")

    pages = ocr_data.get("pages", [])

    # 라인별 bbox와 함께 PII 추출 (1차 정규식 → 2차 병합 → 3차 LLM 보조)
    pii_boxes = extract_pii_from_pages(pages)

    for box in pii_boxes:
        box["masked_value"] = mask_value(box["type"], box["value"])

    # 실제 마스킹이 일어나지 않은 항목 제거
    pii_boxes = [b for b in pii_boxes if b.get("masked_value") != b.get("value")]

    pii_items = [
        {"type": b["type"], "value": b["value"], "masked_value": b["masked_value"]}
        for b in pii_boxes
    ]

    # PDF 원본 폰트 정보를 각 박스에 추가 (네이티브 PDF인 경우)
    pdf_path_for_font = Config.PROCESSED_DIR / f"{job_id}.pdf"
    ocr_data_for_font = _load_ocr(job_id) or {}
    _enrich_boxes_with_font_info(pdf_path_for_font, pii_boxes, ocr_data_for_font)

    result = {"job_id": job_id, "pii_items": pii_items, "masked_boxes": pii_boxes}

    # 결과 저장
    with open(pii_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    # 마스킹 PDF 생성 및 저장
    _ensure_masked_pdf(job_id, result)

    return result


# ============================================================
# 2. 마스킹 PDF 다운로드 엔드포인트
# ============================================================

@router.get("/{job_id}/download")
async def download_masked_pdf(job_id:str):
    # 저장된 PII 결과 로드
    pii_path = Config.PROCESSED_DIR / f"{job_id}_pii.json"
    if not pii_path.exists():
        raise HTTPException(status_code=404, detail="PII 결과를 찾을 수 없습니다. OCR을 먼저 실행하세요.")
    with open(pii_path, "r", encoding="utf-8") as f:
        pii_data = json.load(f)

    # 원본 PDF 경로 확인
    pdf_path = Config.PROCESSED_DIR / f"{job_id}.pdf"
    if not pdf_path.exists():
        raise HTTPException(status_code=404, detail="PDF 파일을 찾을 수 없습니다.")
    
    # bbox 있고 실제 마스킹이 적용된 항목만 추출
    # (masked_value == value 이면 마스킹이 안 된 것 → 흰박스 제외)
    boxes_with_bbox = [
        b for b in pii_data.get("masked_boxes", [])
        if b.get("bbox") and b.get("masked_value", b.get("value")) != b.get("value")
    ]

    # OCR 데이터(좌표 변환용)
    ocr_data = _load_ocr(job_id)

    masked_pdf_bytes = _apply_masking(pdf_path, boxes_with_bbox, ocr_data)

    return StreamingResponse(
        io.BytesIO(masked_pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="masked_{job_id}.pdf"'}
    )


# def _apply_masking(pdf_path: Path, boxes: list, ocr_data: dict) -> bytes:
#     """
#     텍스트를 물리적으로 파괴하고 안전하게 저장합니다.
#     """
#     doc = fitz.open(str(pdf_path))
#     # ocr_data 구조에 따라 page_number 혹은 page 키를 유연하게 처리
#     ocr_pages = {p.get("page_number") or p.get("page"): p for p in ocr_data.get("pages", [])}

#     for page_index in range(len(doc)):
#         page_num = page_index + 1
#         page_boxes = [b for b in boxes if b.get("page") == page_num]
#         if not page_boxes:
#             continue

#         pdf_page = doc[page_index]
#         ocr_p = ocr_pages.get(page_num, {})
        
#         # 스케일 계산
#         ocr_w = ocr_p.get("width") or pdf_page.rect.width
#         ocr_h = ocr_p.get("height") or pdf_page.rect.height
        
#         scale_x = pdf_page.rect.width / ocr_w
#         scale_y = pdf_page.rect.height / ocr_h

#   def _sample_background_color(pdf_page, rect: fitz.Rect) -> tuple:
    """
    rect 주변(상하좌우) 픽셀을 샘플링해 배경색을 추정한다.
    """
    pad = 12
    pr = pdf_page.rect
    zones = [
        fitz.Rect(rect.x0, max(pr.y0, rect.y0 - pad), rect.x1, rect.y0),
        fitz.Rect(rect.x0, rect.y1, rect.x1, min(pr.y1, rect.y1 + pad)),
        fitz.Rect(max(pr.x0, rect.x0 - pad), rect.y0, rect.x0, rect.y1),
        fitz.Rect(rect.x1, rect.y0, min(pr.x1, rect.x1 + pad), rect.y1),
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
    """
    보안과 심미성을 동시에 잡은 프리미엄 마스킹 구현.
    1. 원본 데이터를 물리적으로 삭제 (Redaction)
    2. 주변 배경색 + 미세한 노이즈(질감)를 합성하여 이질감 제거
    3. 마스킹 문자(*)를 원본 선명도에 맞춰 부드럽게 렌더링
    """
    try:
        import numpy as np
        from PIL import Image, ImageDraw, ImageFilter
    except ImportError:
        # Fallback if numpy/PIL not available (though they should be)
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
                # 마스킹 영역을 조금 더 정교하게 잡음 (상하 여백 최적화)
                redact_rect = fitz.Rect(x1*scale_x-1, y1*scale_y-2, x2*scale_x+1, y2*scale_y+2)
                
                # 배경색 샘플링 및 물리적 삭제 등록
                bg_color = _sample_background_color(pdf_page, redact_rect)
                
                # 원본 폰트 정보 추출 시도
                f_bytes, f_size, f_color = _extract_span_font(doc, pdf_page, redact_rect)
                
                # Redaction 적용 (데이터 완전 삭제)
                pdf_page.add_redact_annot(redact_rect, fill=bg_color)
                
                pending.append({
                    "rect": redact_rect,
                    "text": item.get("masked_value", ""),
                    "bg_color": bg_color,
                    "font_bytes": f_bytes,
                    "font_size": f_size,
                    "font_color": f_color
                })

            # 물리적 삭제 실행
            pdf_page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE)

            # 덧씌우기 (자연스러운 질감 + 부드러운 텍스트)
            for p in pending:
                if not p["text"]: continue
                
                # 1. 질감 합성 (단색 박스의 이질감 제거를 위해 미세한 노이즈 추가)
                if np:
                    try:
                        # 박스 크기에 맞는 아주 작은 노이즈 이미지 생성
                        w, h = int(p["rect"].width * 2), int(p["rect"].height * 2)
                        noise = np.random.randint(-3, 4, (h, w, 3), dtype='int16')
                        base_rgb = np.array([p["bg_color"][0]*255, p["bg_color"][1]*255, p["bg_color"][2]*255])
                        tex_arr = np.clip(base_rgb + noise, 0, 255).astype('uint8')
                        tex_img = Image.fromarray(tex_arr)
                        
                        # PDF에 노이즈 이미지 삽입 (질감 부여)
                        img_byte_arr = io.BytesIO()
                        tex_img.save(img_byte_arr, format='PNG')
                        pdf_page.insert_image(p["rect"], stream=img_byte_arr.getvalue(), overlay=True)
                    except: pass

                # 2. 텍스트 렌더링
                f_size = p["font_size"] if p["font_size"] and p["font_size"] > 0 else max(7.0, p["rect"].height * 0.65)
                f_color = p["font_color"] if p["font_color"] else (0.15, 0.15, 0.15)
                
                try:
                    kwargs = {
                        "rect": p["rect"],
                        "text": p["text"],
                        "fontsize": f_size,
                        "color": f_color,
                        "align": fitz.TEXT_ALIGN_LEFT
                    }
                    
                    if p["font_bytes"]:
                        with _tempfile.NamedTemporaryFile(suffix=".ttf", delete=False) as tmp:
                            tmp.write(p["font_bytes"])
                            tmp_name = tmp.name
                        pdf_page.insert_textbox(**kwargs, fontfile=tmp_name, fontname="orig")
                        try: _os.unlink(tmp_name)
                        except: pass
                    elif _KOREAN_FONT_PATH:
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
 font_size = orig_size if orig_size and orig_size > 0 else max(6.0, rect.height * 0.62)
                text_color = orig_color if orig_color else (0.2, 0.2, 0.2)
                try:
                    kwargs = dict(
                        rect=rect,
                        text=masked_text,
                        fontsize=font_size,
                        color=text_color,
                        align=fitz.TEXT_ALIGN_LEFT,
                    )
                    if font_bytes:
                        # 원본 PDF 내장 폰트를 임시 파일로 저장해서 사용
                        tmp = _tempfile.NamedTemporaryFile(suffix=".ttf", delete=False)
                        tmp.write(font_bytes)
                        tmp.close()
                        tmp_font_files.append(tmp.name)
                        kwargs["fontfile"] = tmp.name
                        kwargs["fontname"] = f"origfont_{len(tmp_font_files)}"
                    elif _KOREAN_FONT_PATH:
                        kwargs["fontfile"] = _KOREAN_FONT_PATH
                        kwargs["fontname"] = "korean"
                    pdf_page.insert_textbox(**kwargs)
                except Exception as te:
                    logger.debug(f"텍스트 삽입 실패 (무시): {te}")

            # 임시 폰트 파일 정리
            for p in tmp_font_files:
                try:
                    _os.unlink(p)
                except Exception:
                    pass

        pdf_bytes = doc.tobytes(garbage=3, deflate=True)
        doc.close()

        if not pdf_bytes:
            raise ValueError("생성된 PDF 데이터가 비어있습니다.")
        return pdf_bytes

    except Exception as e:
        logger.error(f"CRITICAL ERROR in _apply_masking: {e}")
        with open(pdf_path, "rb") as f:
            return f.read()