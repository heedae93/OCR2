"""
OCR result models
"""
from typing import List, Optional, Dict, Any
from pydantic import BaseModel


class OCRWord(BaseModel):
    """Original OCR line preserved as a word-level unit inside a sentence block."""
    text: str
    bbox: List[float]  # [x1, y1, x2, y2]
    confidence: Optional[float] = None


class OCRLine(BaseModel):
    """Single OCR text line (or sentence group when words is populated)."""
    text: str
    bbox: Optional[List[float]] = None  # [x1, y1, x2, y2]
    confidence: Optional[float] = None
    char_confidences: Optional[List[float]] = None  # 문자별 CTC confidence
    column: Optional[str] = None  # "left", "right", or None
    layout_type: Optional[str] = None  # "title", "text", "list", "table", etc.
    reading_order: Optional[int] = None
    words: Optional[List[OCRWord]] = None  # 문장 그룹 내 원본 라인들


class OCRPage(BaseModel):
    """OCR results for a single page"""
    page_number: int
    width: int
    height: int
    lines: List[OCRLine]
    is_multi_column: bool = False
    column_boundary: Optional[float] = None


class OCRResult(BaseModel):
    """Complete OCR results for a document"""
    job_id: str
    has_bbox: bool = True
    page_count: int
    total_bboxes: int
    pages: List[OCRPage]
    layout_summary: Optional[Dict[str, Any]] = None


class SmartToolElement(BaseModel):
    """User-authored Smart Tool element to overlay on PDF"""
    id: str
    type: str  # text, image, signature, draw, shape, sticker 등
    page_number: int
    bbox: List[float]
    data: Dict[str, Any] = {}


class PDFExportRequest(BaseModel):
    """Payload for final export with Smart Tools"""
    ocr_results: OCRResult
    smart_layers: List[SmartToolElement] = []
