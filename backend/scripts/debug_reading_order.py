"""
Debug script to verify reading order sorting

Usage:
    python debug_reading_order.py <ocr_json_file>

This will print the reading order of all text blocks in the JSON file.
"""
import sys
import json
from pathlib import Path


def debug_reading_order(json_path):
    """Print reading order from OCR JSON result"""
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    for page in data.get('pages', []):
        page_num = page.get('page_number', 0)
        print(f"\n{'='*60}")
        print(f"Page {page_num}")
        print(f"{'='*60}")

        lines = page.get('lines', [])
        print(f"Total blocks: {len(lines)}\n")

        for i, line in enumerate(lines, 1):
            text = line.get('text', '')[:50]  # First 50 chars
            bbox = line.get('bbox', [])
            layout_type = line.get('layout_type', 'N/A')
            column = line.get('column', 'N/A')

            if bbox and len(bbox) == 4:
                x1, y1, x2, y2 = bbox
                print(f"{i:3d}. Y={y1:6.1f} X={x1:6.1f} "
                      f"[{layout_type:8s}] [{column:5s}] {text}")
            else:
                print(f"{i:3d}. [No bbox] [{layout_type:8s}] {text}")

        # Check if Y-coordinates are monotonically increasing (within columns)
        left_blocks = [l for l in lines if l.get('column') == 'left']
        right_blocks = [l for l in lines if l.get('column') == 'right']

        def check_monotonic(blocks, column_name):
            if len(blocks) < 2:
                return True
            prev_y = blocks[0].get('bbox', [0, 0, 0, 0])[1]
            for block in blocks[1:]:
                curr_y = block.get('bbox', [0, 0, 0, 0])[1]
                if curr_y < prev_y - 5:  # Allow 5px tolerance
                    print(f"\n⚠️  WARNING: Non-monotonic Y in {column_name} column!")
                    print(f"   prev_y={prev_y:.1f}, curr_y={curr_y:.1f}")
                    return False
                prev_y = curr_y
            return True

        print(f"\n{'─'*60}")
        if left_blocks:
            left_ok = check_monotonic(left_blocks, "left")
            print(f"Left column:  {'✅ OK' if left_ok else '❌ FAIL'}")
        if right_blocks:
            right_ok = check_monotonic(right_blocks, "right")
            print(f"Right column: {'✅ OK' if right_ok else '❌ FAIL'}")

        if not left_blocks and not right_blocks:
            # Single column
            all_ok = check_monotonic(lines, "single")
            print(f"Single column: {'✅ OK' if all_ok else '❌ FAIL'}")


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python debug_reading_order.py <ocr_json_file>")
        sys.exit(1)

    json_path = Path(sys.argv[1])
    if not json_path.exists():
        print(f"Error: File not found: {json_path}")
        sys.exit(1)

    debug_reading_order(json_path)
