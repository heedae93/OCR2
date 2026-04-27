"""
Smart Reading Order Sorter - Lightweight layout-aware text ordering
No additional models, <5ms overhead, handles multi-column layouts
"""
import logging
from typing import List, Dict, Tuple
import numpy as np
from collections import defaultdict

logger = logging.getLogger(__name__)


class ReadingOrderSorter:
    """
    Intelligent reading order detection without heavy ML models

    Algorithm:
    1. Cluster bboxes by Y-coordinate (find text rows)
    2. Detect column layout (gap analysis + spatial distribution)
    3. Sort within each row by X-coordinate
    4. Handle multi-column by processing left column first, then right

    Performance: <5ms per page
    Coverage: Single column, double column, news layouts
    """

    def __init__(
        self,
        row_overlap_threshold: float = 0.4,  # How much Y-overlap = same row
        column_gap_ratio: float = 0.08,      # Minimum gap for column detection
        column_balance_ratio: float = 0.25    # Min blocks per column
    ):
        self.row_overlap_threshold = row_overlap_threshold
        self.column_gap_ratio = column_gap_ratio
        self.column_balance_ratio = column_balance_ratio

    def sort_reading_order(
        self,
        ocr_blocks: List[Dict],
        page_width: float,
        page_height: float,
        use_layout_priority: bool = False
    ) -> Tuple[List[Dict], Dict]:
        """
        Sort OCR blocks in natural reading order with layout-aware ordering

        Args:
            ocr_blocks: List of blocks with 'bbox' [x1, y1, x2, y2]
            page_width: Page width for layout analysis
            page_height: Page height
            use_layout_priority: Use semantic layout priorities (if available)

        Returns:
            (sorted_blocks, layout_info)
        """
        if not ocr_blocks or len(ocr_blocks) < 2:
            return ocr_blocks, {'layout_type': 'empty'}

        # Check if layout information is available
        has_layout_info = any('layout_type' in block for block in ocr_blocks)

        # Detect column layout first
        column_info = self._detect_columns(ocr_blocks, page_width)

        if column_info.get('is_double_column'):
            # 명확한 2단 컬럼: 왼쪽 컬럼 위→아래, 오른쪽 컬럼 위→아래
            boundary = column_info['boundary']
            left_blocks = [b for b in ocr_blocks if (b['bbox'][0] + b['bbox'][2]) / 2.0 < boundary]
            right_blocks = [b for b in ocr_blocks if (b['bbox'][0] + b['bbox'][2]) / 2.0 >= boundary]
            left_blocks.sort(key=lambda b: (b['bbox'][1], b['bbox'][0]))
            right_blocks.sort(key=lambda b: (b['bbox'][1], b['bbox'][0]))
            sorted_blocks = left_blocks + right_blocks
            column_info['sorting_method'] = 'double_column_y'
        else:
            # 단일/복합 레이아웃: 행(row) 클러스터링 후 각 행 내에서 왼→오른 정렬
            # 단순 Y 정렬보다 정확 — 같은 높이의 블록들이 왼→오른 순으로 묶임
            rows = self._cluster_into_rows(ocr_blocks)
            sorted_blocks = self._sort_single_column(rows)
            column_info['sorting_method'] = 'row_cluster_ltr'

        logger.info(
            f"Reading order sorted: {len(sorted_blocks)} blocks, "
            f"method={column_info.get('sorting_method', 'unknown')}, "
            f"layout={column_info.get('layout_type', 'unknown')}"
        )

        return sorted_blocks, column_info

    def _detect_titles(
        self,
        blocks: List[Dict],
        page_width: float,
        page_height: float
    ) -> Tuple[List[Dict], List[Dict]]:
        """
        Detect title blocks vs body text blocks

        Title characteristics:
        1. Larger font size (taller bbox height)
        2. Top position (small Y coordinate)
        3. Often centered or wide (spanning across columns)

        Returns:
            (title_blocks, body_blocks)
        """
        if not blocks:
            return [], []

        # Calculate average bbox height for body text detection
        heights = [b['bbox'][3] - b['bbox'][1] for b in blocks]
        avg_height = sum(heights) / len(heights)
        median_height = sorted(heights)[len(heights) // 2]

        # Threshold: blocks significantly taller than average might be titles
        title_height_threshold = max(avg_height * 1.3, median_height * 1.5)

        # Top 30% of page is likely to contain titles (increased from 20%)
        title_y_threshold = page_height * 0.3

        titles = []
        body = []

        for block in blocks:
            bbox = block['bbox']
            height = bbox[3] - bbox[1]
            width = bbox[2] - bbox[0]
            y_pos = bbox[1]

            # Title criteria (more relaxed):
            # 1. Taller than threshold AND in top portion
            # 2. OR very tall (>2x average) anywhere on page
            # 3. OR very wide (>60% page width) in top portion
            is_title = (
                (height > title_height_threshold and y_pos < title_y_threshold) or
                (height > avg_height * 2.0) or
                (width > page_width * 0.6 and y_pos < title_y_threshold)
            )

            if is_title:
                titles.append(block)
            else:
                body.append(block)

        logger.info(f"Title detection: {len(titles)} titles, {len(body)} body blocks "
                   f"(avg_height={avg_height:.1f}, threshold={title_height_threshold:.1f}, "
                   f"y_threshold={title_y_threshold:.1f})")
        return titles, body

    def _detect_columns(self, blocks: List[Dict], page_width: float) -> Dict:
        """Detect if layout has multiple columns"""
        if len(blocks) < 6:
            return {
                'is_double_column': False,
                'layout_type': 'single',
                'boundary': None,
                'confidence': 0.0
            }

        # Get center X coordinates
        centers_x = []
        for block in blocks:
            bbox = block['bbox']
            if len(bbox) == 4:
                center_x = (bbox[0] + bbox[2]) / 2.0
                width = bbox[2] - bbox[0]
                # Filter out very wide blocks (titles spanning columns)
                if width < page_width * 0.75:
                    centers_x.append(center_x)

        if len(centers_x) < 6:
            return {
                'is_double_column': False,
                'layout_type': 'single',
                'boundary': None,
                'confidence': 0.0
            }

        # Find largest gap in X coordinates
        centers_x_sorted = sorted(centers_x)
        gaps = []
        for i in range(len(centers_x_sorted) - 1):
            gap = centers_x_sorted[i + 1] - centers_x_sorted[i]
            gaps.append((gap, (centers_x_sorted[i] + centers_x_sorted[i + 1]) / 2.0))

        max_gap, boundary = max(gaps, key=lambda x: x[0])
        gap_ratio = max_gap / page_width

        # Check if gap is significant
        if gap_ratio < self.column_gap_ratio:
            return {
                'is_double_column': False,
                'layout_type': 'single',
                'boundary': None,
                'confidence': 0.0
            }

        # Check balance (both sides should have substantial blocks)
        left_count = sum(1 for x in centers_x if x < boundary)
        right_count = sum(1 for x in centers_x if x >= boundary)
        total = left_count + right_count

        left_ratio = left_count / total if total > 0 else 0
        right_ratio = right_count / total if total > 0 else 0

        if left_ratio < self.column_balance_ratio or right_ratio < self.column_balance_ratio:
            return {
                'is_double_column': False,
                'layout_type': 'single',
                'boundary': None,
                'confidence': 0.0
            }

        # Calculate confidence
        balance_score = 1.0 - abs(left_ratio - right_ratio)
        confidence = min(0.95, gap_ratio * 0.6 + min(left_ratio, right_ratio) * 0.4 + balance_score * 0.2)

        return {
            'is_double_column': True,
            'is_multi_column': True,
            'layout_type': 'double_column',
            'column_count': 2,
            'boundary': boundary,
            'column_boundary': boundary,
            'confidence': confidence,
            'method': 'gap_analysis_smart',
            'details': {
                'gap_ratio': gap_ratio,
                'left_blocks': left_count,
                'right_blocks': right_count
            }
        }

    def _cluster_into_rows(self, blocks: List[Dict]) -> List[List[Dict]]:
        """
        Cluster blocks into horizontal rows using Y-coordinate overlap

        Two blocks are in same row if their Y-ranges overlap significantly
        """
        if not blocks:
            return []

        # Sort by Y position first
        sorted_blocks = sorted(blocks, key=lambda b: b['bbox'][1])

        rows = []
        current_row = [sorted_blocks[0]]
        current_y_min = sorted_blocks[0]['bbox'][1]
        current_y_max = sorted_blocks[0]['bbox'][3]

        for block in sorted_blocks[1:]:
            bbox = block['bbox']
            block_y_min = bbox[1]
            block_y_max = bbox[3]

            # Check overlap with current row
            overlap = self._calculate_y_overlap(
                current_y_min, current_y_max,
                block_y_min, block_y_max
            )

            if overlap > self.row_overlap_threshold:
                # Add to current row
                current_row.append(block)
                # Expand row bounds
                current_y_min = min(current_y_min, block_y_min)
                current_y_max = max(current_y_max, block_y_max)
            else:
                # Start new row
                rows.append(current_row)
                current_row = [block]
                current_y_min = block_y_min
                current_y_max = block_y_max

        # Add last row
        if current_row:
            rows.append(current_row)

        return rows

    def _calculate_y_overlap(
        self,
        y1_min: float, y1_max: float,
        y2_min: float, y2_max: float
    ) -> float:
        """
        Calculate vertical overlap ratio between two Y-ranges

        Returns: overlap / min_height (0.0 to 1.0+)
        """
        overlap_start = max(y1_min, y2_min)
        overlap_end = min(y1_max, y2_max)
        overlap = max(0, overlap_end - overlap_start)

        height1 = y1_max - y1_min
        height2 = y2_max - y2_min
        min_height = min(height1, height2)

        if min_height == 0:
            return 0.0

        return overlap / min_height

    def _sort_single_column(self, rows: List[List[Dict]]) -> List[Dict]:
        """Sort single column layout: top to bottom, left to right within each row"""
        sorted_blocks = []

        for row in rows:
            # Sort row by X coordinate
            row_sorted = sorted(row, key=lambda b: b['bbox'][0])
            sorted_blocks.extend(row_sorted)

        return sorted_blocks

    def _sort_double_column(
        self,
        rows: List[List[Dict]],
        boundary: float
    ) -> List[Dict]:
        """
        Sort double column layout

        Strategy:
        1. Split ALL blocks into left and right columns FIRST
        2. Sort each column independently top-to-bottom
        3. Concatenate left column + right column

        This ensures proper reading order: entire left column, then entire right column
        """
        left_blocks = []
        right_blocks = []

        # Step 1: Split all blocks into left and right columns
        for row in rows:
            for block in row:
                center_x = (block['bbox'][0] + block['bbox'][2]) / 2.0
                if center_x < boundary:
                    left_blocks.append(block)
                else:
                    right_blocks.append(block)

        # Step 2: Sort each column by Y coordinate (top to bottom), then X (left to right)
        left_blocks.sort(key=lambda b: (b['bbox'][1], b['bbox'][0]))
        right_blocks.sort(key=lambda b: (b['bbox'][1], b['bbox'][0]))

        # Step 3: Left column first, then right column
        return left_blocks + right_blocks

    def _sort_by_layout_priority(
        self,
        blocks: List[Dict],
        page_width: float,
        page_height: float
    ) -> List[Dict]:
        """
        Sort blocks by Y-position (top to bottom) to match visual reading order.

        **Fix for text layer insertion issues**:
        Previous approach sorted by layout_priority first, causing tables (priority=30)
        to appear after text (priority=50) in PDF content stream, even if the table
        was visually above the text. This broke text selection in PDF viewers.

        **New approach**:
        - Primary sort: Y-coordinate (top to bottom) - matches visual position
        - Secondary sort: Column (for multi-column layouts)
        - Tertiary sort: X-coordinate (left to right)
        - Layout metadata (layout_type, layout_priority) is preserved but NOT used for sorting

        This ensures PDF text layer order matches visual document order, fixing:
        - Text appearing to be "unselectable" at page bottom
        - Text selection jumping to wrong locations
        - Tables/figures disrupting reading order
        """
        # Detect columns for the entire page
        column_info = self._detect_columns(blocks, page_width)

        if column_info.get('is_double_column'):
            # Multi-column layout: split by column first
            boundary = column_info['boundary']
            left_blocks = []
            right_blocks = []

            for block in blocks:
                center_x = (block['bbox'][0] + block['bbox'][2]) / 2.0
                if center_x < boundary:
                    left_blocks.append(block)
                else:
                    right_blocks.append(block)

            # Sort each column by Y-position (top to bottom), then X-position
            # Layout priority is ignored to preserve visual order
            left_blocks.sort(key=lambda b: (b['bbox'][1], b['bbox'][0]))
            right_blocks.sort(key=lambda b: (b['bbox'][1], b['bbox'][0]))

            # Left column first, then right column (standard reading order)
            return left_blocks + right_blocks
        else:
            # Single column: simple Y → X sorting
            # Layout priority is ignored to preserve visual order
            return sorted(blocks, key=lambda b: (b['bbox'][1], b['bbox'][0]))

    def add_column_labels(
        self,
        blocks: List[Dict],
        column_info: Dict,
        page_width: float
    ) -> List[Dict]:
        """Add column labels to blocks for UI/debugging (excludes titles)"""
        if not column_info.get('is_double_column'):
            for block in blocks:
                block['column'] = None
            return blocks

        boundary = column_info['boundary']

        for block in blocks:
            bbox = block['bbox']
            center_x = (bbox[0] + bbox[2]) / 2.0
            width = bbox[2] - bbox[0]

            # Titles (wide blocks spanning columns) should not have column labels
            if width > page_width * 0.6:
                block['column'] = None
            else:
                block['column'] = 'left' if center_x < boundary else 'right'

        return blocks

    def sort_visual_left_to_right_top_to_bottom(self, blocks: List[Dict]) -> List[Dict]:
        """
        Sort blocks in visual order:
        1. Top-to-bottom by clustered rows
        2. Left-to-right within each row

        This is used when the UI/text-layer numbering should follow
        the visible page flow rather than semantic multi-column reading order.
        """
        if not blocks or len(blocks) < 2:
            return blocks

        rows = self._cluster_into_rows(blocks)
        return self._sort_single_column(rows)
