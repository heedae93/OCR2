"""
PP-Structure Engine for advanced layout analysis, reading order, and tables.
"""
import logging
import math
import os
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from paddleocr import PPStructureV3
    PPSTRUCTURE_AVAILABLE = True
except ImportError:
    PPSTRUCTURE_AVAILABLE = False
    logging.warning("PPStructureV3 not available")

try:
    from core.table_transformer_engine import (
        TableTransformerEngine,
        TABLE_TRANSFORMER_AVAILABLE,
    )
except ImportError:
    TableTransformerEngine = None  # type: ignore[assignment,misc]
    TABLE_TRANSFORMER_AVAILABLE = False

from config import Config

logger = logging.getLogger(__name__)
_PADDLEX_LAYOUT_PATCHED = False


def _iou(box1: List[float], box2: List[float]) -> float:
    """Intersection-over-Union for two [x1, y1, x2, y2] boxes."""
    ix1 = max(box1[0], box2[0])
    iy1 = max(box1[1], box2[1])
    ix2 = min(box1[2], box2[2])
    iy2 = min(box1[3], box2[3])
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    if inter == 0.0:
        return 0.0
    area1 = (box1[2] - box1[0]) * (box1[3] - box1[1])
    area2 = (box2[2] - box2[0]) * (box2[3] - box2[1])
    union = area1 + area2 - inter
    return inter / union if union > 0 else 0.0


def _nms_text_blocks(
    blocks: List[Dict], iou_threshold: float = 0.3
) -> List[Dict]:
    """
    Non-Maximum Suppression for OCR text bounding boxes.

    When two detected blocks overlap more than `iou_threshold`, the one with
    the lower confidence score is discarded.  Blocks with equal scores keep
    the first one encountered (sorted by descending score).
    """
    if len(blocks) <= 1:
        return blocks

    # Sort descending by confidence so the best detections are kept first.
    sorted_blocks = sorted(blocks, key=lambda b: b.get("score", 0.0), reverse=True)

    kept: List[Dict] = []
    suppressed = [False] * len(sorted_blocks)

    for i, blk in enumerate(sorted_blocks):
        if suppressed[i]:
            continue
        kept.append(blk)
        for j in range(i + 1, len(sorted_blocks)):
            if suppressed[j]:
                continue
            if _iou(blk["bbox"], sorted_blocks[j]["bbox"]) > iou_threshold:
                suppressed[j] = True

    return kept


def _safe_to_dict(value: Any) -> Any:
    """Best-effort conversion of PaddleOCR result wrappers into plain Python objects."""
    if value is None:
        return None
    if isinstance(value, dict):
        return {k: _safe_to_dict(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_safe_to_dict(v) for v in value]
    if isinstance(value, tuple):
        return [_safe_to_dict(v) for v in value]
    if hasattr(value, "json"):
        return _safe_to_dict(getattr(value, "json"))
    if hasattr(value, "tolist"):
        try:
            return value.tolist()
        except Exception:
            return value
    return value


def _patch_paddlex_layout_pipeline() -> None:
    """Avoid eager chart model initialization when chart recognition is disabled."""
    global _PADDLEX_LAYOUT_PATCHED
    if _PADDLEX_LAYOUT_PATCHED:
        return

    try:
        from paddlex.inference.pipelines.layout_parsing.pipeline_v2 import _LayoutParsingPipelineV2
    except Exception as exc:
        logger.debug("Failed to import PaddleX layout pipeline for patching: %s", exc)
        return

    def patched_init_predictor(self, config: dict) -> None:
        if (
            config.get("use_doc_preprocessor", True)
            or config.get("use_doc_orientation_classify", True)
            or config.get("use_doc_unwarping", True)
        ):
            self.use_doc_preprocessor = True
        else:
            self.use_doc_preprocessor = False

        self.use_table_recognition = config.get("use_table_recognition", True)
        self.use_seal_recognition = config.get("use_seal_recognition", True)
        self.format_block_content = config.get("format_block_content", False)
        self.use_region_detection = config.get("use_region_detection", True)
        self.use_formula_recognition = config.get("use_formula_recognition", True)
        self.use_chart_recognition = config.get("use_chart_recognition", False)

        if self.use_doc_preprocessor:
            doc_preprocessor_config = config.get("SubPipelines", {}).get(
                "DocPreprocessor",
                {"pipeline_config_error": "config error for doc_preprocessor_pipeline!"},
            )
            self.doc_preprocessor_pipeline = self.create_pipeline(doc_preprocessor_config)

        if self.use_region_detection:
            region_detection_config = config.get("SubModules", {}).get(
                "RegionDetection",
                {"model_config_error": "config error for block_region_detection_model!"},
            )
            self.region_detection_model = self.create_model(region_detection_config)

        layout_det_config = config.get("SubModules", {}).get(
            "LayoutDetection",
            {"model_config_error": "config error for layout_det_model!"},
        )
        layout_kwargs: Dict[str, Any] = {}
        if (threshold := layout_det_config.get("threshold", None)) is not None:
            layout_kwargs["threshold"] = threshold
        if (layout_nms := layout_det_config.get("layout_nms", None)) is not None:
            layout_kwargs["layout_nms"] = layout_nms
        if (layout_unclip_ratio := layout_det_config.get("layout_unclip_ratio", None)) is not None:
            layout_kwargs["layout_unclip_ratio"] = layout_unclip_ratio
        if (
            layout_merge_bboxes_mode := layout_det_config.get("layout_merge_bboxes_mode", None)
        ) is not None:
            layout_kwargs["layout_merge_bboxes_mode"] = layout_merge_bboxes_mode
        self.layout_det_model = self.create_model(layout_det_config, **layout_kwargs)

        general_ocr_config = config.get("SubPipelines", {}).get(
            "GeneralOCR",
            {"pipeline_config_error": "config error for general_ocr_pipeline!"},
        )
        self.general_ocr_pipeline = self.create_pipeline(general_ocr_config)

        if self.use_seal_recognition:
            seal_recognition_config = config.get("SubPipelines", {}).get(
                "SealRecognition",
                {"pipeline_config_error": "config error for seal_recognition_pipeline!"},
            )
            self.seal_recognition_pipeline = self.create_pipeline(seal_recognition_config)

        if self.use_table_recognition:
            table_recognition_config = config.get("SubPipelines", {}).get(
                "TableRecognition",
                {"pipeline_config_error": "config error for table_recognition_pipeline!"},
            )
            self.table_recognition_pipeline = self.create_pipeline(table_recognition_config)

        if self.use_formula_recognition:
            formula_recognition_config = config.get("SubPipelines", {}).get(
                "FormulaRecognition",
                {"pipeline_config_error": "config error for formula_recognition_pipeline!"},
            )
            self.formula_recognition_pipeline = self.create_pipeline(formula_recognition_config)

        if self.use_chart_recognition:
            chart_recognition_config = config.get("SubModules", {}).get(
                "ChartRecognition",
                {"model_config_error": "config error for block_region_detection_model!"},
            )
            self.chart_recognition_model = self.create_model(chart_recognition_config)
        else:
            self.chart_recognition_model = None

        self.markdown_ignore_labels = config.get(
            "markdown_ignore_labels",
            [
                "number",
                "footnote",
                "header",
                "header_image",
                "footer",
                "footer_image",
                "aside_text",
            ],
        )

    _LayoutParsingPipelineV2.inintial_predictor = patched_init_predictor
    _PADDLEX_LAYOUT_PATCHED = True


class PPStructureEngine:
    """
    Advanced OCR engine using PP-StructureV3 for:
    - Accurate layout detection (20+ categories)
    - Multi-column reading order recovery
    - Support for complex layouts (news, vertical text, etc.)
    - Integration with custom recognition models (best_0828)
    """

    def __init__(self, use_custom_recognition: bool = True):
        """
        Initialize PP-Structure engine

        Args:
            use_custom_recognition: Use custom recognition model (best_0828)
        """
        if not PPSTRUCTURE_AVAILABLE:
            raise RuntimeError("PPStructureV3 is not installed")

        self.config = Config
        self.use_custom_recognition = use_custom_recognition
        self.pipeline = self._initialize_pipeline()
        self._table_transformer = self._initialize_table_transformer()
        logger.info("PP-Structure Engine initialized successfully")

    def _initialize_pipeline(self):
        """Initialize PP-StructureV3 pipeline with optimal settings"""
        try:
            _patch_paddlex_layout_pipeline()
            # Pipeline parameters
            pipeline_params = {
                # Layout detection - use high-accuracy model
                "layout_detection_model_name": self.config.OCR_PPSTRUCTURE_LAYOUT_MODEL,
                "layout_threshold": 0.3,  # 0.5 → 0.3: 더 많은 레이아웃 영역 감지

                # Text detection - use server model for better accuracy
                "text_detection_model_name": "PP-OCRv5_server_det",
                "text_det_limit_side_len": self.config.OCR_DETECTION_LIMIT,
                "text_det_thresh": 0.2,       # 0.3 → 0.2: 배경색 영역·작은 글씨 감지 향상
                "text_det_box_thresh": 0.4,   # 0.6 → 0.4: 낮은 신뢰도 박스도 유지

                # Text recognition - use custom model if available
                "text_recognition_batch_size": self.config.OCR_REC_BATCH_NUM,
                "text_rec_score_thresh": 0.5,

                # Feature flags - disable unnecessary modules for speed
                "use_doc_orientation_classify": False,  # Skip if images are pre-oriented
                "use_doc_unwarping": False,  # Skip for clean scans
                "use_textline_orientation": False,  # Skip for horizontal text
                "use_table_recognition": self.config.OCR_PPSTRUCTURE_USE_TABLE_RECOGNITION,
                "use_formula_recognition": False,  # Disable if not needed
                "use_chart_recognition": False,  # Disable if not needed
                "use_seal_recognition": False,  # Disable if not needed

                # Device - use config setting
                "device": "gpu" if self.config.OCR_USE_GPU else "cpu",

                # CPU threads for faster processing
                "cpu_threads": self.config.OCR_CPU_THREADS
            }

            # Use custom recognition model if available
            if self.use_custom_recognition and self.config.OCR_MODEL_DIR.exists():
                pipeline_params["text_recognition_model_dir"] = str(self.config.OCR_MODEL_DIR)
                logger.info(f"Using custom recognition model: {self.config.OCR_MODEL_DIR}")
            else:
                # Use default model with Korean support
                pipeline_params["text_recognition_model_name"] = self.config.OCR_PPSTRUCTURE_REC_MODEL
                logger.info("Using default PP-OCRv5 recognition model")

            if self.config.OCR_PPSTRUCTURE_USE_TABLE_RECOGNITION:
                pipeline_params["wired_table_structure_recognition_model_name"] = self.config.OCR_PPSTRUCTURE_TABLE_MODEL
                pipeline_params["wireless_table_structure_recognition_model_name"] = (
                    self.config.OCR_PPSTRUCTURE_WIRELESS_TABLE_MODEL
                )
                logger.info(
                    "Using table recognition models: wired=%s, wireless=%s",
                    self.config.OCR_PPSTRUCTURE_TABLE_MODEL,
                    self.config.OCR_PPSTRUCTURE_WIRELESS_TABLE_MODEL,
                )

            try:
                pipeline = PPStructureV3(**pipeline_params)
                logger.info("PP-StructureV3 pipeline initialized with primary config")
                return pipeline
            except Exception as inner_e:
                logger.warning(f"PPStructureV3 primary initialization failed: {inner_e}")
                logger.info("Attempting fallback to standard models...")
                
                # Try again with safe defaults (no custom model, valid v5 model names)
                fallback_params = {
                    "device": "gpu" if self.config.OCR_USE_GPU else "cpu",
                    "use_table_recognition": False,
                    "text_detection_model_name": "PP-OCRv5_server_det",
                    "text_recognition_model_name": self.config.OCR_PPSTRUCTURE_REC_MODEL,
                    "cpu_threads": self.config.OCR_CPU_THREADS,
                    "use_doc_orientation_classify": False,
                    "use_doc_unwarping": False,
                    "use_textline_orientation": False,
                    "use_formula_recognition": False,
                    "use_chart_recognition": False,
                    "use_seal_recognition": False,
                }
                
                try:
                    pipeline = PPStructureV3(**fallback_params)
                    logger.info("PP-StructureV3 pipeline initialized with fallback models")
                    return pipeline
                except Exception as final_e:
                    logger.error(f"PPStructureV3 fallback initialization also failed: {final_e}")
                    raise

        except Exception as e:
            import traceback
            logger.error(f"Failed to initialize PP-Structure pipeline: {e}\n{traceback.format_exc()}")
            raise

    def _initialize_table_transformer(self) -> "Optional[TableTransformerEngine]":
        """
        Optionally initialise the Table Transformer engine based on
        OCR_TABLE_BACKEND config value.

        Returns None when:
          - backend is 'slanet' (default PaddleX only)
          - transformers / torch are not installed
          - initialisation fails for any reason
        """
        backend = getattr(self.config, "OCR_TABLE_BACKEND", "slanet")
        if backend == "slanet":
            logger.info("Table Transformer disabled (backend=slanet)")
            return None

        if not TABLE_TRANSFORMER_AVAILABLE or TableTransformerEngine is None:
            logger.warning(
                "Table Transformer requested (backend=%s) but library not available. "
                "Run: pip install transformers timm torch  — falling back to SLANet.",
                backend,
            )
            return None

        try:
            engine = TableTransformerEngine(
                use_gpu=self.config.OCR_USE_GPU,
                detection_model=getattr(
                    self.config,
                    "TABLE_TRANSFORMER_DET_MODEL",
                    TableTransformerEngine.DEFAULT_DETECTION_MODEL,
                ),
                structure_model=getattr(
                    self.config,
                    "TABLE_TRANSFORMER_STR_MODEL",
                    TableTransformerEngine.DEFAULT_STRUCTURE_MODEL,
                ),
                detection_threshold=getattr(
                    self.config, "TABLE_TRANSFORMER_DET_THRESHOLD", 0.9
                ),
                structure_threshold=getattr(
                    self.config, "TABLE_TRANSFORMER_STR_THRESHOLD", 0.6
                ),
            )
            logger.info(
                "Table Transformer engine ready (backend=%s)", backend
            )
            return engine
        except Exception as exc:
            logger.warning(
                "Table Transformer init failed (%s) — falling back to SLANet.", exc
            )
            return None

    def analyze(self, image_path: str) -> Dict:
        """
        Perform complete document analysis with layout and reading order

        Args:
            image_path: Path to image file

        Returns:
            Dictionary with:
            - ocr_blocks: List of text blocks in correct reading order
            - layout_info: Layout detection results
            - page_info: Page dimensions and metadata
        """
        try:
            logger.info(f"Analyzing document with PP-Structure: {Path(image_path).name}")

            # Run PP-Structure pipeline with minimal modules
            # CRITICAL: Disable unnecessary modules in predict() call
            results = self.pipeline.predict(
                image_path,
                use_doc_orientation_classify=False,  # Disable orientation classification
                use_doc_unwarping=False,             # Disable document unwarping
                use_textline_orientation=False,      # Disable textline orientation
                use_seal_recognition=False,          # Disable seal recognition
                use_table_recognition=self.config.OCR_PPSTRUCTURE_USE_TABLE_RECOGNITION,
                use_formula_recognition=False,       # Disable formula recognition
                use_chart_recognition=False,         # Disable chart recognition
                use_region_detection=False           # Disable region detection
            )
            results = list(results) if results else []

            if not results:
                logger.warning("No results from PP-Structure")
                return {
                    "ocr_blocks": [],
                    "layout_info": {},
                    "page_info": {}
                }

            # Process results (layout + full-image OCR blocks)
            processed_data = self._process_results(results, image_path)
            logger.info(f"PP-Structure analysis complete: {len(processed_data['ocr_blocks'])} blocks")

            # Tiled OCR: re-run text detection at native resolution on overlapping tiles
            # and replace/supplement the full-image OCR blocks for better coverage.
            if self._should_use_tiling(image_path):
                tiled_blocks = self._tiled_ocr(image_path)
                if tiled_blocks:
                    logger.info(
                        "Tiled OCR produced %d blocks (was %d). Replacing full-image blocks.",
                        len(tiled_blocks),
                        len(processed_data["ocr_blocks"]),
                    )
                    processed_data["ocr_blocks"] = tiled_blocks

            # Optionally enhance table results with Table Transformer
            if self._table_transformer is not None:
                processed_data = self._enhance_tables_with_transformer(
                    processed_data, image_path
                )

            return processed_data

        except Exception as e:
            logger.error(f"PP-Structure analysis failed: {e}")
            raise

    # ------------------------------------------------------------------
    # Tiled OCR helpers
    # ------------------------------------------------------------------

    def _should_use_tiling(self, image_path: str) -> bool:
        """Return True when the image is large enough to benefit from tiling."""
        if not getattr(self.config, "OCR_TILING_ENABLED", True):
            return False
        tile_size = getattr(self.config, "OCR_TILE_SIZE", 1500)
        try:
            from PIL import Image
            with Image.open(image_path) as img:
                w, h = img.size
            return w > tile_size or h > tile_size
        except Exception:
            return False

    def _tiled_ocr(self, image_path: str) -> List[Dict]:
        """
        Divide the page image into overlapping tiles, run PP-StructureV3 OCR
        on each tile at native resolution, then merge and deduplicate the results.

        Returns a list of OCR blocks in the same format as _process_results().
        Returns an empty list on failure (caller keeps the original blocks).
        """
        tile_size = getattr(self.config, "OCR_TILE_SIZE", 1500)
        overlap = getattr(self.config, "OCR_TILE_OVERLAP", 150)
        nms_iou = getattr(self.config, "OCR_TILE_NMS_IOU", 0.3)
        score_thresh = 0.2  # 0.3 → 0.2: 낮은 신뢰도 텍스트(배경색 영역 등)도 포함

        try:
            from PIL import Image
            image = Image.open(image_path).convert("RGB")
            img_w, img_h = image.size
            logger.info(
                "Tiled OCR: image=%dx%d tile=%d overlap=%d",
                img_w, img_h, tile_size, overlap,
            )

            step = tile_size - overlap
            cols = max(1, math.ceil((img_w - overlap) / step))
            rows = max(1, math.ceil((img_h - overlap) / step))
            total_tiles = cols * rows
            logger.info("Tiled OCR: grid=%dx%d (%d tiles)", cols, rows, total_tiles)

            all_blocks: List[Dict] = []

            for row in range(rows):
                for col in range(cols):
                    ox = col * step
                    oy = row * step
                    x2 = min(img_w, ox + tile_size)
                    y2 = min(img_h, oy + tile_size)
                    # Anchor last tile to right/bottom edge
                    ox = max(0, x2 - tile_size)
                    oy = max(0, y2 - tile_size)

                    tile = image.crop((ox, oy, x2, y2))

                    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".png")
                    os.close(tmp_fd)
                    try:
                        tile.save(tmp_path)
                        blocks = self._ocr_tile(tmp_path, ox, oy, score_thresh)
                        all_blocks.extend(blocks)
                        logger.debug(
                            "Tile (%d,%d) offset=(%d,%d) → %d blocks",
                            col, row, ox, oy, len(blocks),
                        )
                    finally:
                        try:
                            os.unlink(tmp_path)
                        except OSError:
                            pass

            logger.info("Tiled OCR: %d raw blocks before NMS", len(all_blocks))
            merged = _nms_text_blocks(all_blocks, iou_threshold=nms_iou)
            logger.info("Tiled OCR: %d blocks after NMS", len(merged))

            # Re-apply reading order sort
            merged.sort(key=lambda b: (b["bbox"][1], b["bbox"][0]))
            for idx, blk in enumerate(merged):
                blk["reading_order"] = idx

            return merged

        except Exception as exc:
            logger.warning("Tiled OCR failed: %s — keeping full-image results.", exc)
            return []

    def _ocr_tile(
        self, tile_path: str, offset_x: int, offset_y: int, score_thresh: float
    ) -> List[Dict]:
        """Run the PP-Structure pipeline on a single tile and return offset-adjusted blocks."""
        blocks: List[Dict] = []
        try:
            results = list(
                self.pipeline.predict(
                    tile_path,
                    use_doc_orientation_classify=False,
                    use_doc_unwarping=False,
                    use_textline_orientation=False,
                    use_seal_recognition=False,
                    use_table_recognition=False,
                    use_formula_recognition=False,
                    use_chart_recognition=False,
                    use_region_detection=False,
                )
            )
        except Exception as exc:
            logger.debug("Tile OCR prediction failed: %s", exc)
            return blocks

        for page_result in results:
            page_dict = _safe_to_dict(page_result) or {}
            ocr_res = page_dict.get("overall_ocr_res", {})
            if not isinstance(ocr_res, dict):
                continue

            dt_polys = ocr_res.get("dt_polys", [])
            rec_texts = ocr_res.get("rec_texts", [])
            rec_scores = ocr_res.get("rec_scores", [])

            for poly, text, score in zip(dt_polys, rec_texts, rec_scores):
                if not text or not text.strip():
                    continue
                if score < score_thresh:
                    continue
                if poly is None or len(poly) < 4:
                    continue
                xs = [p[0] + offset_x for p in poly]
                ys = [p[1] + offset_y for p in poly]
                blocks.append(
                    {
                        "text": text,
                        "bbox": [min(xs), min(ys), max(xs), max(ys)],
                        "confidence": float(score),
                        "score": float(score),
                        "block_type": "text",
                        "reading_order": 0,
                    }
                )
        return blocks

    def _enhance_tables_with_transformer(
        self, processed_data: Dict, image_path: str
    ) -> Dict:
        """
        Run Table Transformer on already-processed PP-Structure data to produce
        richer table structure (rows / columns / cells / HTML).

        backend=table_transformer : Table Transformer detects tables independently.
        backend=hybrid            : Use bboxes from PP-Structure layout detection,
                                    Table Transformer does structure recognition only.
        """
        backend = getattr(self.config, "OCR_TABLE_BACKEND", "hybrid")
        layout_info: Dict = processed_data.get("layout_info", {})
        ocr_blocks: List[Dict] = processed_data.get("ocr_blocks", [])

        try:
            if backend == "table_transformer":
                # Independent detection + structure by Table Transformer
                tt_tables = self._table_transformer.analyze_image(
                    image_path, ocr_blocks=ocr_blocks
                )
                if tt_tables:
                    layout_info["tables"] = tt_tables
                    logger.info(
                        "Table Transformer found %d table(s) (independent detection)",
                        len(tt_tables),
                    )

            elif backend == "hybrid":
                # Collect table bboxes from PP-Structure layout regions
                table_bboxes: List[List] = [
                    r["bbox"]
                    for r in layout_info.get("regions", [])
                    if r.get("type", "").lower() == "table"
                ]
                # Also include any SLANet results that aren't already listed
                for t in layout_info.get("tables", []):
                    if t.get("bbox") and t["bbox"] not in table_bboxes:
                        table_bboxes.append(t["bbox"])

                tt_tables = self._table_transformer.analyze_image(
                    image_path,
                    existing_table_bboxes=table_bboxes if table_bboxes else None,
                    ocr_blocks=ocr_blocks,
                )
                if tt_tables:
                    layout_info["tables"] = tt_tables
                    logger.info(
                        "Table Transformer enriched %d table(s) (hybrid mode)",
                        len(tt_tables),
                    )

        except Exception as exc:
            logger.warning(
                "Table Transformer enhancement failed: %s — keeping SLANet results.",
                exc,
            )

        processed_data["layout_info"] = layout_info
        return processed_data

    def _process_results(self, results, image_path: str) -> Dict:
        """
        Convert PP-Structure results to our standard format

        PP-Structure automatically handles:
        - Layout detection (text, title, table, figure, etc.)
        - Reading order recovery (multi-column, complex layouts)
        - Coordinate normalization
        """
        try:
            # Get image dimensions
            from PIL import Image
            with Image.open(image_path) as img:
                img_width, img_height = img.size

            logger.info(f"Image dimensions: {img_width}x{img_height}px")

            ocr_blocks = []
            layout_regions = []
            table_regions = []

            results_list = list(results) if results else []
            logger.debug(f"Processing {len(results_list)} pages")

            # Process each result (PP-Structure returns list of page results)
            for page_idx, page_result in enumerate(results_list):

                # PPStructureV3 returns LayoutParsingResultV2 objects
                # Access overall_ocr_res for text detection results
                # LayoutParsingResultV2 is dict-like - access overall_ocr_res as dict key
                page_dict = _safe_to_dict(page_result) or {}
                layout_regions.extend(self._extract_layout_regions(page_dict))
                table_regions.extend(self._extract_table_regions(page_dict))

                if 'overall_ocr_res' in page_dict:
                    ocr_res = page_dict['overall_ocr_res']

                    # OCRResult is dict-like - access data via keys
                    dt_polys = ocr_res.get('dt_polys', [])
                    rec_texts = ocr_res.get('rec_texts', [])
                    rec_scores = ocr_res.get('rec_scores', [])

                    logger.info(f"PPStructure detected {len(dt_polys)} text regions on page {page_idx}")

                    # Log Y coordinates of last few boxes to check if bottom is detected
                    if len(dt_polys) > 0:
                        last_boxes = []
                        for i in range(max(0, len(dt_polys) - 5), len(dt_polys)):
                            if i < len(dt_polys):
                                poly = dt_polys[i]
                                y_coords = [p[1] for p in poly] if poly is not None and len(poly) > 0 else []
                                if y_coords:
                                    max_y = max(y_coords)
                                    last_boxes.append(f"box{i}:y={max_y:.0f}")
                        logger.info(f"Last 5 boxes Y coords: {', '.join(last_boxes)}")

                    filtered_count = 0
                    # Process each detected text region
                    for idx in range(len(dt_polys)):
                        poly = dt_polys[idx]
                        text = rec_texts[idx] if idx < len(rec_texts) else ""
                        score = rec_scores[idx] if idx < len(rec_scores) else 0.0

                        # Skip empty or low-confidence results
                        if not text or not text.strip() or score < 0.2:
                            filtered_count += 1
                            if filtered_count <= 5 or idx >= len(dt_polys) - 5:
                                logger.debug(f"Filtered box {idx}: score={score:.3f}, text='{text[:30]}'")
                            continue

                        # Convert polygon to bbox
                        if poly is not None and len(poly) >= 4:
                            x_coords = [p[0] for p in poly]
                            y_coords = [p[1] for p in poly]
                            x1, y1 = min(x_coords), min(y_coords)
                            x2, y2 = max(x_coords), max(y_coords)

                            # Create OCR block
                            ocr_block = {
                                "text": text,
                                "bbox": [x1, y1, x2, y2],
                                "confidence": float(score),
                                "score": float(score),  # For compatibility with OCREngine interface
                                "block_type": "text",
                                "reading_order": len(ocr_blocks)
                            }
                            ocr_blocks.append(ocr_block)

                    if filtered_count > 0:
                        logger.info(f"Filtered {filtered_count}/{len(dt_polys)} low-confidence boxes (threshold=0.3)")

            # Sort blocks by reading order (top-to-bottom, left-to-right)
            ocr_blocks.sort(key=lambda b: (b['bbox'][1], b['bbox'][0]))

            # Update reading order after sort
            for idx, block in enumerate(ocr_blocks):
                block['reading_order'] = idx

            # Log coverage statistics
            if ocr_blocks:
                max_y = max(b['bbox'][3] for b in ocr_blocks)
                coverage = (max_y / img_height) * 100
                logger.info(f"Final OCR coverage: {max_y:.0f}/{img_height}px ({coverage:.1f}%)")
                if coverage < 95:
                    logger.warning(f"Low coverage detected! Missing bottom {img_height - max_y:.0f}px ({100 - coverage:.1f}%)")
            else:
                logger.warning("No OCR blocks extracted!")

            return {
                "ocr_blocks": ocr_blocks,
                "layout_info": {
                    "regions": layout_regions,
                    "tables": table_regions,
                },
                "page_info": {
                    "width": img_width,
                    "height": img_height
                }
            }

        except Exception as e:
            logger.error(f"Failed to process PP-Structure results: {e}")
            logger.exception(e)
            # Return empty result instead of failing
            return {
                "ocr_blocks": [],
                "layout_info": {},
                "page_info": {}
            }

    def _normalize_bbox(self, bbox) -> List[float]:
        """
        Normalize bbox to [x1, y1, x2, y2] format

        PP-Structure may return:
        - [x1, y1, x2, y2] (already normalized)
        - [[x1, y1], [x2, y2], [x3, y3], [x4, y4]] (4-point polygon)
        """
        if not bbox:
            return [0, 0, 0, 0]

        # Already in [x1, y1, x2, y2] format
        if len(bbox) == 4 and all(isinstance(x, (int, float)) for x in bbox):
            return [float(x) for x in bbox]

        # 4-point polygon format
        if len(bbox) == 4 and all(isinstance(pt, (list, tuple)) for pt in bbox):
            xs = [pt[0] for pt in bbox]
            ys = [pt[1] for pt in bbox]
            return [min(xs), min(ys), max(xs), max(ys)]

        # Fallback
        logger.warning(f"Unexpected bbox format: {bbox}")
        return [0, 0, 0, 0]

    def _extract_layout_regions(self, page_result: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Extract normalized layout metadata from PP-Structure output."""
        candidate_keys = ["layout_parsing_res", "layout_det_res", "layout_res"]
        extracted: List[Dict[str, Any]] = []

        for key in candidate_keys:
            items = page_result.get(key)
            if not isinstance(items, list):
                continue
            for item in items:
                item_dict = _safe_to_dict(item) or {}
                bbox = self._normalize_bbox(
                    item_dict.get("bbox")
                    or item_dict.get("box")
                    or item_dict.get("coordinate")
                )
                label = (
                    item_dict.get("label")
                    or item_dict.get("type")
                    or item_dict.get("category")
                    or item_dict.get("layout_type")
                    or "unknown"
                )
                extracted.append(
                    {
                        "type": label,
                        "bbox": bbox,
                        "score": float(item_dict.get("score", item_dict.get("confidence", 0.0)) or 0.0),
                    }
                )
        return extracted

    def _extract_table_regions(self, page_result: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Extract SLANet/SLANet+ table recognition results when present."""
        table_candidates = []
        for key in ("table_res", "table_result", "table_parsing_res", "table_rec_res"):
            value = page_result.get(key)
            if isinstance(value, list):
                table_candidates.extend(value)

        extracted: List[Dict[str, Any]] = []
        for item in table_candidates:
            item_dict = _safe_to_dict(item) or {}
            bbox = self._normalize_bbox(
                item_dict.get("bbox")
                or item_dict.get("box")
                or item_dict.get("coordinate")
            )
            extracted.append(
                {
                    "bbox": bbox,
                    "structure": item_dict.get("structure"),
                    "html": item_dict.get("html"),
                    "cells": item_dict.get("cells"),
                    "score": float(item_dict.get("score", item_dict.get("confidence", 0.0)) or 0.0),
                    "model": self.config.OCR_PPSTRUCTURE_TABLE_MODEL,
                }
            )
        return extracted

    def _analyze_column_layout(self, layout_regions: List[Dict], page_width: float) -> Dict:
        """
        Analyze column layout from detected regions

        PP-Structure already handles reading order, but we still need
        column info for downstream processing (e.g., UI display)
        """
        if not layout_regions or page_width == 0:
            return {
                'is_multi_column': False,
                'column_count': 1,
                'column_boundary': None
            }

        # Count text regions on left vs right half
        mid_x = page_width / 2
        left_count = 0
        right_count = 0

        for region in layout_regions:
            if region['type'] not in ['text', 'paragraph', 'title']:
                continue

            bbox = region['bbox']
            center_x = (bbox[0] + bbox[2]) / 2

            if center_x < mid_x:
                left_count += 1
            else:
                right_count += 1

        # If both sides have substantial content, it's multi-column
        total = left_count + right_count
        if total > 0:
            left_ratio = left_count / total
            is_multi_column = (0.3 < left_ratio < 0.7) and total >= 6
        else:
            is_multi_column = False

        return {
            'is_multi_column': is_multi_column,
            'is_double_column': is_multi_column,
            'column_count': 2 if is_multi_column else 1,
            'column_boundary': mid_x if is_multi_column else None,
            'method': 'pp_structure_analysis'
        }

    def recognize(self, image_path: str) -> List[Dict]:
        """
        Convenience method matching OCREngine interface

        Returns:
            List of OCR blocks (matching OCREngine interface)
        """
        result = self.analyze(image_path)
        return result.get('ocr_blocks', [])
