"""
LayoutLMv3 기반 문서 유형 분류 테스트
- BBOCR이 이미 처리한 OCR 결과(DB + JSON)를 재활용
- PDF는 이미지 렌더링에만 사용 (PaddleOCR 재실행 없음)
- Leave-one-out cross-validation으로 정확도 측정
"""
import sys
import json
import logging
import numpy as np
from pathlib import Path
from typing import List, Dict, Tuple, Optional
from collections import Counter

import fitz  # pymupdf
import torch
from PIL import Image
from transformers import LayoutLMv3Processor, LayoutLMv3Model

# DB 접근을 위해 backend 경로 추가
sys.path.insert(0, str(Path(__file__).parent))
from database import SessionLocal, Job

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

# ─── 설정 ─────────────────────────────────────────────────────────────────────
TEST_DATA_DIR = Path(__file__).parent / "test_data"
MODEL_NAME = "microsoft/layoutlmv3-base"
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
DPI = 150      # PDF 이미지 렌더링 해상도
MAX_PAGES = 3  # 문서당 처리할 최대 페이지 수


# ─── DB에서 OCR 결과 조회 ──────────────────────────────────────────────────────

def find_job_by_filename(filename: str) -> Optional[Job]:
    """파일명으로 DB에서 완료된 job 찾기"""
    db = SessionLocal()
    try:
        job = (
            db.query(Job)
            .filter(Job.original_filename == filename, Job.status == "completed")
            .order_by(Job.created_at.desc())
            .first()
        )
        return job
    finally:
        db.close()


def load_ocr_json(ocr_json_path: str) -> Optional[Dict]:
    """BBOCR이 저장한 OCR JSON 로드"""
    path = Path(ocr_json_path)
    if not path.exists():
        logger.warning(f"OCR JSON 파일 없음: {ocr_json_path}")
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def extract_words_and_boxes(ocr_data: Dict, page_idx: int) -> Tuple[List[str], List[List[int]]]:
    """
    OCR JSON의 특정 페이지에서 텍스트와 bbox 추출
    bbox는 LayoutLMv3 형식(0~1000 정규화)으로 변환
    """
    pages = ocr_data.get("pages", [])
    if page_idx >= len(pages):
        return [], []

    page = pages[page_idx]
    w = page.get("width", 1)
    h = page.get("height", 1)

    words, boxes = [], []
    for line in page.get("lines", []):
        text = line.get("text", "").strip()
        bbox = line.get("bbox", None)  # [x0, y0, x1, y1]
        conf = line.get("confidence", 1.0)

        if not text or bbox is None or conf < 0.5:
            continue

        x0, y0, x1, y1 = bbox
        # 0~1000 정규화 (LayoutLMv3 표준 형식)
        norm_box = [
            max(0, min(1000, int(x0 / w * 1000))),
            max(0, min(1000, int(y0 / h * 1000))),
            max(0, min(1000, int(x1 / w * 1000))),
            max(0, min(1000, int(y1 / h * 1000))),
        ]
        words.append(text)
        boxes.append(norm_box)

    return words, boxes


# ─── PDF 이미지 렌더링 ─────────────────────────────────────────────────────────

def pdf_to_images(pdf_path: str, dpi: int = DPI, max_pages: int = MAX_PAGES) -> List[Image.Image]:
    """PDF를 PIL Image 리스트로 변환 (LayoutLMv3의 시각적 입력용)"""
    doc = fitz.open(pdf_path)
    images = []
    for page_num in range(min(len(doc), max_pages)):
        page = doc[page_num]
        mat = fitz.Matrix(dpi / 72, dpi / 72)
        pix = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        images.append(img)
    doc.close()
    return images


# ─── LayoutLMv3 임베딩 추출 ───────────────────────────────────────────────────

def get_document_embedding(
    pdf_path: str,
    ocr_data: Dict,
    processor: LayoutLMv3Processor,
    model: LayoutLMv3Model,
) -> np.ndarray:
    """
    문서 임베딩 추출
    - 이미지: PDF에서 직접 렌더링
    - 텍스트+bbox: BBOCR이 저장한 OCR JSON에서 로드
    - 두 입력을 합쳐서 LayoutLMv3에 입력 → CLS 임베딩 반환
    """
    images = pdf_to_images(pdf_path)
    if not images:
        raise ValueError(f"이미지 변환 실패: {pdf_path}")

    page_embeddings = []
    num_pages = min(len(images), len(ocr_data.get("pages", [])))

    for page_idx in range(num_pages):
        image = images[page_idx]
        words, boxes = extract_words_and_boxes(ocr_data, page_idx)

        if not words:
            logger.warning(f"  페이지 {page_idx + 1}: OCR 텍스트 없음, 건너뜀")
            continue

        logger.info(f"  페이지 {page_idx + 1}: {len(words)}개 텍스트 블록")

        # LayoutLMv3 입력 준비
        # processor가 이미지 + 텍스트 + bbox를 모델 입력 형식으로 변환
        encoding = processor(
            image,
            words,
            boxes=boxes,
            return_tensors="pt",
            truncation=True,
            max_length=512,
            padding="max_length",
        )
        encoding = {k: v.to(DEVICE) for k, v in encoding.items()}

        with torch.no_grad():
            outputs = model(**encoding)

        # CLS 토큰 = 문서 전체를 요약하는 임베딩 (768차원 벡터)
        cls_embedding = outputs.last_hidden_state[:, 0, :].squeeze().cpu().numpy()
        page_embeddings.append(cls_embedding)

    if not page_embeddings:
        raise ValueError(f"임베딩 추출 실패: {pdf_path}")

    # 여러 페이지 임베딩을 평균내서 문서 하나의 임베딩으로
    return np.mean(page_embeddings, axis=0)


# ─── 분류 ─────────────────────────────────────────────────────────────────────

def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """두 벡터의 cosine similarity (-1 ~ 1, 높을수록 유사)"""
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-8))


def classify_knn(
    query_emb: np.ndarray,
    reference_embeddings: List[np.ndarray],
    reference_labels: List[str],
    k: int = 3,
) -> str:
    """
    k-NN 분류: 가장 유사한 k개 문서의 라벨 다수결
    파인튜닝 없이도 동작하는 방식
    """
    sims = [
        (cosine_similarity(query_emb, ref), label)
        for ref, label in zip(reference_embeddings, reference_labels)
    ]
    sims.sort(reverse=True)
    top_k_labels = [label for _, label in sims[:k]]
    return Counter(top_k_labels).most_common(1)[0][0]


# ─── 데이터셋 로드 ─────────────────────────────────────────────────────────────

def load_dataset() -> List[Dict]:
    """
    test_data/ 하위 폴더를 클래스로 사용
    각 PDF에 대해 DB에서 job 찾아서 OCR JSON 경로 연결
    """
    dataset = []
    for class_dir in sorted(TEST_DATA_DIR.iterdir()):
        if not class_dir.is_dir() or class_dir.name.startswith("."):
            continue
        label = class_dir.name

        seen, pdfs = set(), []
        for p in class_dir.iterdir():
            if p.suffix.lower() == ".pdf" and p.name.lower() not in seen:
                seen.add(p.name.lower())
                pdfs.append(p)

        if not pdfs:
            logger.warning(f"'{label}' 폴더에 PDF 없음")
            continue

        matched = 0
        for pdf_path in sorted(pdfs):
            # DB에서 이 파일명으로 처리된 job 찾기
            job = find_job_by_filename(pdf_path.name)
            if job is None:
                logger.warning(f"  DB에 없음 (아직 업로드 안 됨): {pdf_path.name}")
                continue
            if not job.ocr_json_path:
                logger.warning(f"  OCR JSON 경로 없음: {pdf_path.name}")
                continue

            dataset.append({
                "pdf_path": str(pdf_path),
                "label": label,
                "ocr_json_path": job.ocr_json_path,
                "job_id": job.job_id,
            })
            matched += 1

        logger.info(f"  '{label}': {len(pdfs)}개 중 {matched}개 DB 매칭됨")

    return dataset


# ─── 메인 ─────────────────────────────────────────────────────────────────────

def run_test():
    logger.info(f"디바이스: {DEVICE}")
    logger.info(f"모델 로드 중: {MODEL_NAME}")

    processor = LayoutLMv3Processor.from_pretrained(MODEL_NAME, apply_ocr=False)
    model = LayoutLMv3Model.from_pretrained(MODEL_NAME).to(DEVICE)
    model.eval()

    logger.info("데이터셋 로드 중...")
    dataset = load_dataset()

    if len(dataset) < 2:
        logger.error("테스트하려면 최소 2개 이상의 문서가 필요합니다. 먼저 BBOCR로 업로드하세요.")
        sys.exit(1)

    logger.info(f"총 {len(dataset)}개 문서 (DB 매칭 완료)")

    # 임베딩 캐시 (재실행 시 중복 계산 방지)
    cache_path = TEST_DATA_DIR / "embeddings_cache.json"
    cache: Dict[str, List[float]] = {}
    if cache_path.exists():
        with open(cache_path, "r", encoding="utf-8") as f:
            cache = json.load(f)
        logger.info(f"캐시 로드: {len(cache)}개")

    # 임베딩 추출
    embeddings, labels, items = [], [], []
    for i, item in enumerate(dataset):
        filename = Path(item["pdf_path"]).name
        label = item["label"]
        cache_key = item["job_id"]  # job_id로 캐시 (파일명보다 안정적)

        logger.info(f"[{i+1}/{len(dataset)}] {filename} ({label})")

        if cache_key in cache:
            emb = np.array(cache[cache_key])
            logger.info(f"  캐시에서 로드")
        else:
            ocr_data = load_ocr_json(item["ocr_json_path"])
            if ocr_data is None:
                logger.error(f"  OCR JSON 로드 실패, 건너뜀")
                continue
            try:
                emb = get_document_embedding(item["pdf_path"], ocr_data, processor, model)
                cache[cache_key] = emb.tolist()
                with open(cache_path, "w", encoding="utf-8") as f:
                    json.dump(cache, f)
            except Exception as e:
                logger.error(f"  임베딩 실패: {e}")
                continue

        embeddings.append(emb)
        labels.append(label)
        items.append(item)

    if len(embeddings) < 2:
        logger.error("임베딩 추출 성공한 문서가 부족합니다.")
        sys.exit(1)

    # Leave-One-Out Cross-Validation
    logger.info("\n─── Leave-One-Out 분류 테스트 ───")
    correct = 0
    results = []

    for i in range(len(embeddings)):
        query_emb = embeddings[i]
        true_label = labels[i]
        filename = Path(items[i]["pdf_path"]).name

        ref_embs = [e for j, e in enumerate(embeddings) if j != i]
        ref_labels = [l for j, l in enumerate(labels) if j != i]

        predicted = classify_knn(query_emb, ref_embs, ref_labels, k=min(3, len(ref_embs)))
        is_correct = predicted == true_label
        if is_correct:
            correct += 1

        status = "✓" if is_correct else "✗"
        results.append((filename, true_label, predicted, is_correct))
        logger.info(f"  {status} {filename}: 정답={true_label}, 예측={predicted}")

    accuracy = correct / len(embeddings) * 100
    logger.info(f"\n─── 결과 ───")
    logger.info(f"정확도: {correct}/{len(embeddings)} = {accuracy:.1f}%")

    wrong = [(f, t, p) for f, t, p, ok in results if not ok]
    if wrong:
        logger.info("\n오답 목록:")
        for filename, true_label, predicted in wrong:
            logger.info(f"  {filename}: {true_label} → {predicted} (오분류)")
    else:
        logger.info("오답 없음!")

    return accuracy


if __name__ == "__main__":
    run_test()
