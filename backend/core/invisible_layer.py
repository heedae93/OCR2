"""
Create searchable PDFs with invisible text layers
"""
import logging
from pathlib import Path
from typing import List, Dict, Optional
import os
import tempfile
import re

try:
    from reportlab.pdfgen import canvas
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.colors import Color
    REPORTLAB_AVAILABLE = True
except ImportError:
    REPORTLAB_AVAILABLE = False

from PIL import Image

from config import Config
from core.text_scaler import PrecisionTextScaler

logger = logging.getLogger(__name__)


class SearchablePDFGenerator:
    """Generate searchable PDFs with invisible text layers"""

    def __init__(self):
        if not REPORTLAB_AVAILABLE:
            raise RuntimeError("reportlab is not installed")

        self.config = Config
        self.korean_font = self._setup_korean_font()
        self.text_scaler = PrecisionTextScaler()

        # Configuration
        self.low_confidence_threshold = 0.3
        self.text_alpha = 0.01  # Nearly invisible
        self.max_font_size = 90
        self.korean_min_size = 7
        self.english_min_size = 6

        logger.info("SearchablePDFGenerator initialized with PrecisionTextScaler")

    def _setup_korean_font(self) -> str:
        """Setup Korean font for PDF generation"""
        # Font candidates with their names
        font_candidates = [
            ("/usr/share/fonts/truetype/nanum/NanumGothic.ttf", "NanumGothic"),
            ("/usr/share/fonts/truetype/nanum/NanumBarunGothic.ttf", "NanumBarunGothic"),
            ("/System/Library/Fonts/AppleGothic.ttf", "AppleGothic"),
            ("C:/Windows/Fonts/malgun.ttf", "MalgunGothic"),
            ("C:/Windows/Fonts/gulim.ttc", "Gulim"),
        ]

        for font_path, font_name in font_candidates:
            if os.path.exists(font_path):
                try:
                    pdfmetrics.registerFont(TTFont(font_name, font_path))
                    logger.info(f"Korean font registered: {font_name}")
                    return font_name
                except Exception as e:
                    logger.warning(f"Failed to register font {font_name}: {e}")

        logger.warning("No Korean font found, using default Helvetica")
        return "Helvetica"

    def create_searchable_pdf(
        self,
        image_path: str,
        ocr_results: List[Dict],
        output_path: str,
        column_info: Optional[Dict] = None
    ) -> str:
        """
        Create a searchable PDF with invisible text layer

        Args:
            image_path: Path to the image
            ocr_results: List of OCR results with bbox, text, score
            output_path: Output PDF path
            column_info: Column detection information

        Returns:
            Path to the created PDF
        """
        try:
            # Load image to get dimensions
            with Image.open(image_path) as img:
                img_width, img_height = img.size

            logger.info(f"Creating searchable PDF: {Path(image_path).name}")
            logger.info(f"Image size: {img_width}x{img_height}")
            logger.info(f"OCR blocks: {len(ocr_results) if ocr_results else 0}")

            # Create PDF canvas
            c = canvas.Canvas(output_path, pagesize=(img_width, img_height))

            # Draw background image
            c.drawImage(image_path, 0, 0, width=img_width, height=img_height)

            if ocr_results:
                # OCR results are already sorted by ReadingOrderSorter
                # DO NOT re-sort to preserve the correct reading order
                # Just add text layer in the order received
                self._add_text_layer(c, ocr_results, img_width, img_height, column_info)

            # Save PDF
            c.save()

            logger.info(f"Searchable PDF created: {output_path}")
            return output_path

        except Exception as e:
            logger.error(f"Failed to create searchable PDF: {e}")
            raise

    def _sort_ocr_results(
        self,
        ocr_results: List[Dict],
        column_info: Optional[Dict],
        img_height: float
    ) -> List[Dict]:
        """Sort OCR results in reading order"""
        if not column_info or not column_info.get('is_double_column'):
            # Single column: sort by Y then X
            return sorted(ocr_results, key=lambda x: (x['bbox'][1], x['bbox'][0]))

        # Double column: sort by column, then Y within each column
        boundary = column_info['column_boundary']

        left_blocks = []
        right_blocks = []

        for block in ocr_results:
            bbox = block['bbox']
            center_x = (bbox[0] + bbox[2]) / 2.0

            if center_x < boundary:
                left_blocks.append(block)
            else:
                right_blocks.append(block)

        # Sort each column by Y
        left_blocks.sort(key=lambda x: x['bbox'][1])
        right_blocks.sort(key=lambda x: x['bbox'][1])

        # Combine: left column first, then right column
        return left_blocks + right_blocks

    def _add_text_layer(
        self,
        c: canvas.Canvas,
        ocr_results: List[Dict],
        img_width: float,
        img_height: float,
        column_info: Optional[Dict] = None
    ):
        """Render PDF.js style invisible text layer with column awareness"""
        column_info = column_info or {}
        is_multi_column = bool(column_info.get('is_multi_column') or column_info.get('is_double_column'))

        expand_px = 0
        if getattr(self.config, "EXPAND_CLICK_AREA", False):
            expand_px = max(0, int(getattr(self.config, "BBOX_EXPANSION_PIXELS", 0)))

        def _expand_and_clamp_bbox(bbox: List[float]) -> List[float]:
            if not expand_px:
                return bbox
            x1, y1, x2, y2 = bbox
            x1 = max(0, x1 - expand_px)
            y1 = max(0, y1 - expand_px)
            x2 = min(img_width, x2 + expand_px)
            y2 = min(img_height, y2 + expand_px)
            return [x1, y1, x2, y2]

        def _is_vertical_text(clean_text: str, width: float, height: float, block: Dict, korean_chars: int) -> bool:
            if block.get('is_vertical_text') or block.get('is_vertical_line'):
                return True

            aspect_ratio = height / width if width > 0 else float('inf')
            text_len = len(clean_text)

            if aspect_ratio > 3.0:
                return True
            if aspect_ratio > 1.5 and text_len <= 10:
                return True
            if aspect_ratio > 1.2 and text_len <= 3:
                return True
            if korean_chars >= 2 and aspect_ratio > 1.1:
                return True

            return False

        coverage_ratio = getattr(self.config, "COVERAGE_FILL_RATIO", 0.98)
        width_overshoot_ratio = getattr(self.config, "WIDTH_OVERSHOOT_RATIO", 1.02)

        def _draw_vertical_text(text: str, bbox: List[float], font_name: str):
            """Render vertical text by stacking glyphs inside bbox."""
            x1, y1, x2, y2 = bbox
            width = x2 - x1
            height = y2 - y1
            if height <= 0 or width <= 0:
                return

            base_font_size = max(self.english_min_size, min(height, self.max_font_size))
            char_spacing = height / max(1, len(text))
            pdf_bottom = img_height - y2

            c.setFillAlpha(self.text_alpha)
            c.setFillColor(Color(0, 0, 0, alpha=self.text_alpha))

            try:
                escaped = text.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
                c._doc.stream.write(f"/Span << /ActualText ({escaped}) >> BDC\n".encode('utf-8'))
            except Exception:
                pass

            for idx, char in enumerate(text):
                if not char.strip():
                    continue
                pdf_x = x1 + width / 2.0
                pdf_y = pdf_bottom + height - (idx + 1) * char_spacing
                c.saveState()
                c.setFont(font_name, base_font_size)
                char_width = c.stringWidth(char, font_name, base_font_size)
                c.drawString(pdf_x - char_width / 2.0, pdf_y, char)
                c.restoreState()

            try:
                c._doc.stream.write("EMC\n".encode('utf-8'))
            except Exception:
                pass

        def _draw_horizontal_text(text: str, bbox: List[float], font_name: str,
                                   has_korean: bool):
            """Use PrecisionTextScaler to fill bbox just like the frontend overlay."""
            font_min = self.korean_min_size if has_korean else self.english_min_size
            font_size = self.text_scaler.calculate_font_size(
                text,
                bbox,
                font_name=font_name,
                min_size=font_min,
                max_size=self.max_font_size,
                target_fill_ratio=coverage_ratio,
                width_overshoot_ratio=width_overshoot_ratio
            )

            draw_x, draw_y = self.text_scaler.calculate_text_position(
                text,
                bbox,
                font_size,
                font_name,
                img_height
            )

            text_width, _ = self.text_scaler.get_metrics(text, font_size, font_name)
            bbox_width = max(1.0, bbox[2] - bbox[0])
            target_width = bbox_width * coverage_ratio
            max_width = bbox_width * width_overshoot_ratio
            scale_x = 1.0
            if text_width > 0:
                if text_width < target_width:
                    scale_x = min(target_width / text_width, max_width / text_width)
                elif text_width > max_width:
                    scale_x = max_width / text_width

            scale_x = max(0.2, min(scale_x, width_overshoot_ratio))

            c.saveState()
            c.setFillAlpha(self.text_alpha)
            c.setFillColor(Color(0, 0, 0, alpha=self.text_alpha))
            c.translate(draw_x, draw_y)
            c.scale(scale_x, 1.0)
            c.setFont(font_name, font_size)
            c.drawString(0, 0, text)
            c.restoreState()

        column_boundary = None
        is_multi_column = False
        if column_info:
            boundary_candidate = column_info.get('column_boundary') or column_info.get('boundary')
            if boundary_candidate is not None:
                column_boundary = float(boundary_candidate)
            is_multi_column = bool(column_info.get('is_multi_column') or column_info.get('is_double_column'))

        def _base_order_key(block: Dict, idx: int):
            reading_order = block.get('reading_order')
            if reading_order is not None:
                return (0, reading_order)
            bbox = block.get('bbox', [0, 0, 0, 0])
            return (1, bbox[1], bbox[0], idx)

        indexed_results = list(enumerate(ocr_results))
        ordered_results = [
            block for _, block in
            sorted(indexed_results, key=lambda pair: _base_order_key(pair[1], pair[0]))
        ]

        # Reorder columns if boundary or explicit labels suggest multi-column layout
        prefix_blocks = []
        suffix_blocks = []
        left_blocks = []
        right_blocks = []
        seen_column_content = False

        def _assign_column(block: Dict) -> Optional[str]:
            bbox = block.get('bbox')
            if not bbox or len(bbox) != 4:
                return None
            if column_boundary is not None:
                center_x = (bbox[0] + bbox[2]) / 2.0
                return 'left' if center_x < column_boundary else 'right'
            column_label = str(block.get('column', '')).lower()
            if column_label in ('left', 'right'):
                return column_label
            return None

        if ordered_results:
            for block in ordered_results:
                assignment = _assign_column(block) if (column_boundary is not None or is_multi_column) else None
                if assignment == 'left':
                    left_blocks.append(block)
                    seen_column_content = True
                elif assignment == 'right':
                    right_blocks.append(block)
                    seen_column_content = True
                else:
                    if not seen_column_content:
                        prefix_blocks.append(block)
                    else:
                        suffix_blocks.append(block)

            if seen_column_content and left_blocks and right_blocks:
                ordered_results = prefix_blocks + left_blocks + right_blocks + suffix_blocks

        for i, block in enumerate(ordered_results):
            raw_text = block.get('text', '')
            text = raw_text.strip()
            if not text:
                continue

            score = block.get('score', 1.0)
            if score is not None and score < self.low_confidence_threshold:
                continue

            if len(text) < 2 and not text.isdigit():
                continue

            if re.match(r'^[^\w가-힣]+$', text):
                continue

            bbox = block.get('bbox')
            if not bbox or len(bbox) != 4:
                continue

            bbox = _expand_and_clamp_bbox(bbox)
            x1, y1, x2, y2 = [float(v) for v in bbox]
            width = x2 - x1
            height = y2 - y1

            if width <= 0 or height <= 0:
                continue

            if width < 6 or height < 6:
                continue

            if column_boundary is not None:
                center_x = (x1 + x2) / 2.0
                if center_x < column_boundary and x2 > column_boundary:
                    x2 = column_boundary
                elif center_x >= column_boundary and x1 < column_boundary:
                    x1 = column_boundary
                width = x2 - x1
                if width <= 1:
                    continue

            korean_chars = sum(1 for ch in text if '가' <= ch <= '힣')
            has_korean = korean_chars > 0
            font_name = self.korean_font if (has_korean and self.korean_font != "Helvetica") else "Helvetica"
            is_vertical = _is_vertical_text(text, width, height, block, korean_chars)

            try:
                if is_vertical:
                    _draw_vertical_text(text, [x1, y1, x2, y2], font_name)
                else:
                    _draw_horizontal_text(text, [x1, y1, x2, y2], font_name, has_korean)
            except Exception as e:
                logger.warning(f"Failed to add text '{text[:20]}...': {e}")
                continue

    def create_pdf_from_pages(
        self,
        pages_data: List[Dict],
        output_path: str
    ) -> str:
        """
        Create a multi-page searchable PDF

        Args:
            pages_data: List of dicts with 'image_path', 'ocr_results', 'column_info'
            output_path: Output PDF path

        Returns:
            Path to the created PDF
        """
        try:
            if not pages_data:
                raise ValueError("No pages provided")

            logger.info(f"Creating multi-page searchable PDF with {len(pages_data)} pages")

            # Create first page to initialize canvas
            first_page = pages_data[0]
            with Image.open(first_page['image_path']) as img:
                page_size = img.size

            c = canvas.Canvas(output_path, pagesize=page_size)

            # Process each page
            for page_num, page_data in enumerate(pages_data, 1):
                logger.info(f"Processing page {page_num}/{len(pages_data)}")

                image_path = page_data['image_path']
                ocr_results = page_data.get('ocr_results', [])
                column_info = page_data.get('column_info')

                # Load image
                with Image.open(image_path) as img:
                    img_width, img_height = img.size

                # Update page size if different
                if (img_width, img_height) != page_size:
                    c.setPageSize((img_width, img_height))
                    page_size = (img_width, img_height)

                # Draw image
                c.drawImage(image_path, 0, 0, width=img_width, height=img_height)

                # Add text layer if OCR results exist
                # OCR results are already sorted by ReadingOrderSorter
                if ocr_results:
                    self._add_text_layer(c, ocr_results, img_width, img_height, column_info)

                # Add new page (except for the last page)
                if page_num < len(pages_data):
                    c.showPage()

            # Save PDF
            c.save()

            logger.info(f"Multi-page searchable PDF created: {output_path}")
            return output_path

        except Exception as e:
            logger.error(f"Failed to create multi-page PDF: {e}")
            raise
