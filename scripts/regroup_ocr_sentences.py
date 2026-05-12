import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "backend") not in sys.path:
    sys.path.insert(0, str(ROOT / "backend"))

from core.reading_order_sorter import ReadingOrderSorter


def _flatten_line(line):
    words = line.get("words") or []
    flattened = []
    for word in words:
        text = (word.get("text") or "").strip()
        bbox = word.get("bbox")
        if text and bbox and len(bbox) == 4:
            flattened.append({
                "text": text,
                "bbox": bbox,
                "score": word.get("confidence") or line.get("confidence") or line.get("score") or 1.0,
                "confidence": word.get("confidence") or line.get("confidence") or line.get("score") or 1.0,
                "column": line.get("column"),
                "layout_type": line.get("layout_type", "text"),
                "reading_order": line.get("reading_order", 0),
            })
    if flattened:
        return flattened

    text = (line.get("text") or "").strip()
    bbox = line.get("bbox")
    if text and bbox and len(bbox) == 4:
        return [{
            "text": text,
            "bbox": bbox,
            "score": line.get("score") or line.get("confidence") or 1.0,
            "confidence": line.get("confidence") or line.get("score") or 1.0,
            "char_confidences": line.get("char_confidences"),
            "column": line.get("column"),
            "layout_type": line.get("layout_type", "text"),
            "reading_order": line.get("reading_order", 0),
        }]
    return []


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python scripts/regroup_ocr_sentences.py <ocr-json-path>")

    path = Path(sys.argv[1])
    data = json.loads(path.read_text(encoding="utf-8"))
    sorter = ReadingOrderSorter()

    before = 0
    after = 0
    for page in data.get("pages", []):
        blocks = []
        for line in page.get("lines", []):
            blocks.extend(_flatten_line(line))

        before += len(blocks)
        if not blocks:
            page["lines"] = []
            continue

        blocks = sorter.sort_visual_left_to_right_top_to_bottom(blocks)
        for idx, block in enumerate(blocks):
            block["reading_order"] = idx
            block.setdefault("layout_type", "text")

        grouped = sorter.group_into_sentences(blocks)
        for idx, line in enumerate(grouped):
            line["reading_order"] = idx

        page["lines"] = grouped
        after += len(grouped)

    data["total_bboxes"] = after
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"regrouped {path.name}: {before} blocks -> {after} sentences")


if __name__ == "__main__":
    main()
