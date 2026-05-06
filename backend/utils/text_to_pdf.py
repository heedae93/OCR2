"""
Plain text (.txt) → PDF for the OCR pipeline.

업로드된 원본 .txt는 그대로 보존하고, `ocr_input.pdf`를 생성해
`_resolve_job_ocr_input` / PDF 페이지 렌더링 경로와 맞춘다.
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path
from xml.sax.saxutils import escape

logger = logging.getLogger(__name__)


class TextToPdfError(Exception):
    """텍스트 → PDF 변환 실패."""


def _font_candidates() -> list[tuple[Path, str]]:
    import os

    cands: list[tuple[Path, str]] = []
    if os.name == "nt":
        windir = Path(os.environ.get("WINDIR", r"C:\Windows"))
        fdir = windir / "Fonts"
        cands += [
            (fdir / "malgun.ttf", "TxtMalgun"),
            (fdir / "malgunsl.ttf", "TxtMalgunSL"),
        ]
    if sys.platform == "darwin":
        cands += [
            (Path("/Library/Fonts/Arial Unicode.ttf"), "TxtArialUni"),
            (Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf"), "TxtArialUniSys"),
        ]
    cands += [
        (Path("/usr/share/fonts/truetype/nanum/NanumGothic.ttf"), "TxtNanum"),
        (Path("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"), "TxtNotoCJK"),
        (Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"), "TxtDejaVu"),
    ]
    return cands


def _register_body_font() -> str:
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    for font_path, internal_name in _font_candidates():
        if not font_path.is_file():
            continue
        try:
            pdfmetrics.registerFont(TTFont(internal_name, str(font_path)))
            logger.info("text_to_pdf: using font %s (%s)", internal_name, font_path)
            return internal_name
        except Exception as exc:
            logger.warning("text_to_pdf: skip font %s: %s", font_path, exc)
    logger.warning("text_to_pdf: no TTF found; Helvetica (limited CJK)")
    return "Helvetica"


def convert_plain_text_to_pdf(txt_path: Path, out_pdf: Path) -> None:
    """
    UTF-8(선행 BOM 허용)로 디코딩 후 A4 PDF로 저장.
    """
    try:
        raw = txt_path.read_bytes()
    except OSError as exc:
        raise TextToPdfError(f"텍스트 파일을 읽을 수 없습니다: {exc}") from exc

    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("utf-8", errors="replace")

    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle
        from reportlab.lib.units import mm
        from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
    except ImportError as exc:
        raise TextToPdfError("reportlab 이 필요합니다.") from exc

    font_name = _register_body_font()
    out_pdf.parent.mkdir(parents=True, exist_ok=True)

    doc = SimpleDocTemplate(
        str(out_pdf),
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
    )
    style = ParagraphStyle(
        "TxtBody",
        fontName=font_name,
        fontSize=10,
        leading=14,
        spaceAfter=4,
    )

    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    blocks = normalized.split("\n\n")
    story: list = []

    if not normalized.strip():
        story.append(Paragraph(escape("(빈 텍스트 파일)"), style))
    else:
        for i, block in enumerate(blocks):
            if not block.strip():
                story.append(Spacer(1, 6))
                continue
            safe = escape(block).replace("\n", "<br/>")
            story.append(Paragraph(safe, style))
            if i < len(blocks) - 1:
                story.append(Spacer(1, 8))

    try:
        doc.build(story)
    except Exception as exc:
        raise TextToPdfError(f"PDF 생성 실패: {exc}") from exc

    if not out_pdf.is_file() or out_pdf.stat().st_size == 0:
        raise TextToPdfError("PDF 파일이 생성되지 않았습니다.")


def convert_plain_page_texts_to_pdf(page_texts: list[str], out_pdf: Path) -> None:
    """페이지별 텍스트를 A4 PDF로 묶는다 (텍스트 추출 전용 경로)."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer

    font_name = _register_body_font()
    out_pdf.parent.mkdir(parents=True, exist_ok=True)

    doc = SimpleDocTemplate(
        str(out_pdf),
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
    )
    style = ParagraphStyle(
        "TxtBodyPage",
        fontName=font_name,
        fontSize=10,
        leading=14,
        spaceAfter=4,
    )
    story: list = []
    for pi, page_raw in enumerate(page_texts):
        normalized = (page_raw or "").replace("\r\n", "\n").replace("\r", "\n")
        blocks = normalized.split("\n\n")
        if not normalized.strip():
            story.append(Paragraph(escape("(빈 페이지)"), style))
        else:
            for i, block in enumerate(blocks):
                if not block.strip():
                    story.append(Spacer(1, 6))
                    continue
                safe = escape(block).replace("\n", "<br/>")
                story.append(Paragraph(safe, style))
                if i < len(blocks) - 1:
                    story.append(Spacer(1, 8))
        if pi < len(page_texts) - 1:
            story.append(PageBreak())

    try:
        doc.build(story)
    except Exception as exc:
        raise TextToPdfError(f"PDF 생성 실패: {exc}") from exc

    if not out_pdf.is_file() or out_pdf.stat().st_size == 0:
        raise TextToPdfError("PDF 파일이 생성되지 않았습니다.")
