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

#         for item in page_boxes:
#             x1, y1, x2, y2 = item["bbox"]
            
#             # PDF 좌표 변환 및 여유값(Padding) 부여
#             rect = fitz.Rect(
#                 x1 * scale_x - 2, 
#                 y1 * scale_y - 2, 
#                 x2 * scale_x + 2, 
#                 y2 * scale_y + 2
#             )
            
#             # 교정 영역 지정 (흰색 박스)
#             pdf_page.add_redact_annot(rect, fill=(1, 1, 1))

#         # 페이지별 즉시 적용
#         pdf_page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE)

#     # [수정] 문제가 된 linear=True 옵션을 제거하고 안정적인 옵션만 사용
#     pdf_bytes = doc.tobytes(
#         garbage=3, 
#         deflate=True, 
#         clean=True
#     )
#     doc.close()
#     return pdf_bytes

import fitz
from pathlib import Path



def _sample_background_color(pdf_page, rect: fitz.Rect) -> tuple:
    """
    rect 주변(상하좌우) 픽셀을 샘플링해 배경색을 추정한다.
    밝은 픽셀 상위 10%만 평균 내어 텍스트(어두운 픽셀)의 오염을 완전히 차단한다.
    반환값: fitz fill 용 (r, g, b) — 각 0.0~1.0 범위.
    """
    pad = 15  # 샘플링 여백 (pt) — 조금 더 넓게 잡아 텍스트 간섭 최소화
    pr = pdf_page.rect

    zones = [
        fitz.Rect(rect.x0, max(pr.y0, rect.y0 - pad), rect.x1, rect.y0),
        fitz.Rect(rect.x0, rect.y1, rect.x1, min(pr.y1, rect.y1 + pad)),
        fitz.Rect(max(pr.x0, rect.x0 - pad), rect.y0, rect.x0, rect.y1),
        fitz.Rect(rect.x1, rect.y0, min(pr.x1, rect.x1 + pad), rect.y1),
    ]

    pixels = []
    for zone in zones:
        if zone.is_empty or zone.width < 1 or zone.height < 1:
            continue
        try:
            pix = pdf_page.get_pixmap(clip=zone, matrix=fitz.Matrix(1, 1))
            data = pix.samples
            n = pix.n
            for i in range(0, len(data) - 2, n):
                pixels.append((data[i], data[i + 1], data[i + 2]))
        except Exception:
            pass

    if not pixels:
        return (1.0, 1.0, 1.0)

    # 밝기 내림차순으로 정렬 후 상위 10% (배경 픽셀)만 평균 (텍스트 안티앨리어싱 회색 픽셀 완전 배제)
    pixels.sort(key=lambda p: p[0] + p[1] + p[2], reverse=True)
    top_n = max(1, len(pixels) * 1 // 10)
    top = pixels[:top_n]
    avg_r = sum(p[0] for p in top) / top_n
    avg_g = sum(p[1] for p in top) / top_n
    avg_b = sum(p[2] for p in top) / top_n
    return (avg_r / 255, avg_g / 255, avg_b / 255)


# 한글 지원 폰트 경로 (없으면 None — 기본 폰트로 fallback)
import os as _os
import tempfile as _tempfile
_KOREAN_FONT_PATH = next(
    (p for p in [
        r"C:\Windows\Fonts\malgun.ttf",      # Windows Malgun Gothic
        r"C:\Windows\Fonts\gulim.ttc",
        "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",  # Linux NanumGothic
    ] if _os.path.exists(p)),
    None
)


def _extract_span_font(doc: fitz.Document, page: fitz.Page, rect: fitz.Rect):
    """
    rect와 가장 많이 겹치는 텍스트 span의 폰트 바이트·크기·색상 반환.
    Returns: (font_bytes_or_none, font_size_or_none, font_color_or_none)
    """
    try:
        best_span = None
        best_area = 0.0
        for block in page.get_text("dict")["blocks"]:
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    sr = fitz.Rect(span["bbox"])
                    overlap = sr & rect
                    if overlap.is_empty:
                        continue
                    area = overlap.width * overlap.height
                    if area > best_area:
                        best_area = area
                        best_span = span

        if best_span is None:
            return None, None, None

        raw_font_name = best_span.get("font", "")
        font_size = best_span.get("size") or None
        c = best_span.get("color", 0)
        font_color = ((c >> 16 & 0xFF) / 255, (c >> 8 & 0xFF) / 255, (c & 0xFF) / 255)

        # PDF에 내장된 폰트 바이트 추출 (subset prefix "ABCDEF+" 제거 후 매칭)
        clean_name = raw_font_name.split("+")[-1].lower()
        font_bytes = None
        for fi in page.get_fonts(full=True):
            # fi: (xref, ext, type, basefont, name, encoding, referencer)
            xref = fi[0]
            basefont = fi[3].split("+")[-1].lower()
            if basefont == clean_name or clean_name in basefont or basefont in clean_name:
                extracted = doc.extract_font(xref)
                if extracted and extracted[3]:  # index 3 = raw bytes
                    font_bytes = extracted[3]
                    break

        return font_bytes, font_size, font_color
    except Exception:
        return None, None, None


def _apply_masking(pdf_path: Path, boxes: list, ocr_data: dict) -> bytes:
    """
    마스킹 영역 주변 픽셀을 샘플링해 배경색으로 채우고,
    그 위에 마스킹된 * 텍스트를 덧씌운다.
    (예: 박채연 → "채연" 영역을 배경색으로 덮고 "**" 표시)
    """
    try:
        doc = fitz.open(str(pdf_path))
        pages_list = ocr_data.get("pages", [])
        ocr_pages = {p.get("page_number") or p.get("page"): p for p in pages_list}

        for page_index in range(len(doc)):
            page_num = page_index + 1
            page_boxes = [b for b in boxes if str(b.get("page")) == str(page_num)]
            if not page_boxes:
                continue

            pdf_page = doc[page_index]
            ocr_p = ocr_pages.get(page_num, {})
            ocr_w = ocr_p.get("width") or pdf_page.rect.width
            ocr_h = ocr_p.get("height") or pdf_page.rect.height
            scale_x = pdf_page.rect.width / ocr_w
            scale_y = pdf_page.rect.height / ocr_h

            # ── 1단계: redaction 등록 + 배경색·폰트 정보 샘플링 (삭제 전에 해야 함) ──
            pending: list[tuple[fitz.Rect, str, bytes | None, float | None, tuple | None]] = []

            for item in page_boxes:
                bbox = item.get("bbox")
                if not bbox:
                    continue

                masked_value = item.get("masked_value", "")

                x1, y1, x2, y2 = bbox
                # redact_rect: 여백을 너무 크게 주면 인접한 마스킹 박스가 겹쳐서 가려지는 문제 발생
                # 좌우 여백을 ±2px로 줄여서 겹침 현상을 최소화합니다.
                redact_rect = fitz.Rect(
                    max(0, x1 * scale_x - 2),
                    max(0, y1 * scale_y - 3),
                    x2 * scale_x + 2,
                    y2 * scale_y + 3,
                )
                # text_rect: 긴 텍스트(주소 등)가 영역 부족으로 잘리는(Truncation) 현상을 방지하기 위해 
                # 우측과 하단에 충분한 가상 공간(+100px)을 확보합니다.
                text_rect = fitz.Rect(
                    x1 * scale_x - 1,
                    y1 * scale_y,
                    x2 * scale_x + 100,
                    y2 * scale_y + 20,
                )

                # 원본 폰트 정보 추출 (삭제 전에 해야 함)
                orig_font_bytes, orig_font_size, orig_font_color = _extract_span_font(doc, pdf_page, redact_rect)

                fill_color = _sample_background_color(pdf_page, redact_rect)
                pdf_page.add_redact_annot(redact_rect, fill=fill_color)

                pending.append((text_rect, masked_value, orig_font_bytes, orig_font_size, orig_font_color))

            # ── 2단계: redaction 적용 (텍스트 물리적 제거) ────────────────────
            pdf_page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE)

            # ── 3단계: * 텍스트 덧씌우기 (원본 폰트 우선) ───────────────────────
            tmp_font_files: list[str] = []
            for rect, masked_text, font_bytes, orig_size, orig_color in pending:
                if not masked_text:
                    continue
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