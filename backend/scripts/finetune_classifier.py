"""
LayoutLMv3 파인튜닝 - 문서 유형 분류
- LayoutLMv3ForSequenceClassification: CLS 토큰 위에 분류 레이어 추가
- Leave-one-out cross-validation으로 정확도 평가
- 최종 모델은 전체 데이터로 학습 후 저장
"""
import sys
import json
import logging
import numpy as np
from pathlib import Path
from typing import List, Dict, Tuple
from collections import Counter

import fitz
import torch
import torch.nn as nn
from torch.optim import AdamW
from torch.utils.data import Dataset, DataLoader
from PIL import Image
from transformers import (
    LayoutLMv3Processor,
    LayoutLMv3ForSequenceClassification,
    get_linear_schedule_with_warmup,
)

sys.path.insert(0, str(Path(__file__).parent))
from database import SessionLocal, Job

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

# ─── 설정 ─────────────────────────────────────────────────────────────────────
TEST_DATA_DIR = Path(__file__).parent / "test_data"
MODEL_NAME = "microsoft/layoutlmv3-base"
SAVE_DIR = Path(__file__).parent / "models" / "doc_classifier"
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# 학습 하이퍼파라미터
LEARNING_RATE = 2e-5   # 사전학습 모델 파인튜닝엔 작은 lr 사용
EPOCHS = 5             # 데이터가 적으니 epoch을 많이
MAX_PAGES = 3          # 문서당 최대 페이지
DPI = 150


# ─── 데이터 로드 (test_doc_classifier.py와 동일) ──────────────────────────────

def find_job_by_filename(filename: str):
    db = SessionLocal()
    try:
        return (
            db.query(Job)
            .filter(Job.original_filename == filename, Job.status == "completed")
            .order_by(Job.created_at.desc())
            .first()
        )
    finally:
        db.close()


def load_ocr_json(path: str):
    p = Path(path)
    if not p.exists():
        return None
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)


def pdf_to_images(pdf_path: str, max_pages: int = MAX_PAGES) -> List[Image.Image]:
    doc = fitz.open(pdf_path)
    images = []
    for i in range(min(len(doc), max_pages)):
        page = doc[i]
        mat = fitz.Matrix(DPI / 72, DPI / 72)
        pix = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB)
        images.append(Image.frombytes("RGB", [pix.width, pix.height], pix.samples))
    doc.close()
    return images


def extract_words_and_boxes(ocr_data: Dict, page_idx: int) -> Tuple[List[str], List[List[int]]]:
    pages = ocr_data.get("pages", [])
    if page_idx >= len(pages):
        return [], []
    page = pages[page_idx]
    w, h = page.get("width", 1), page.get("height", 1)
    words, boxes = [], []
    for line in page.get("lines", []):
        text = line.get("text", "").strip()
        bbox = line.get("bbox")
        if not text or bbox is None or line.get("confidence", 1.0) < 0.5:
            continue
        x0, y0, x1, y1 = bbox
        boxes.append([
            max(0, min(1000, int(x0 / w * 1000))),
            max(0, min(1000, int(y0 / h * 1000))),
            max(0, min(1000, int(x1 / w * 1000))),
            max(0, min(1000, int(y1 / h * 1000))),
        ])
        words.append(text)
    return words, boxes


def load_dataset() -> List[Dict]:
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
        for pdf_path in sorted(pdfs):
            job = find_job_by_filename(pdf_path.name)
            if job is None or not job.ocr_json_path:
                continue
            dataset.append({
                "pdf_path": str(pdf_path),
                "label": label,
                "ocr_json_path": job.ocr_json_path,
                "job_id": job.job_id,
            })
        logger.info(f"  '{label}': {len([d for d in dataset if d['label']==label])}개")
    return dataset


# ─── Dataset 클래스 ────────────────────────────────────────────────────────────
# PyTorch의 Dataset: 모델에 넣을 데이터를 하나씩 꺼내주는 인터페이스

class DocumentDataset(Dataset):
    """
    문서 1개 = 여러 페이지 → 대표 페이지 1개만 사용 (첫 번째 유효 페이지)
    데이터가 적으니 페이지를 각각 독립 샘플로 쓰면 데이터 증강 효과
    """
    def __init__(self, items: List[Dict], label2id: Dict[str, int], processor: LayoutLMv3Processor):
        self.samples = []
        self.processor = processor

        for item in items:
            ocr_data = load_ocr_json(item["ocr_json_path"])
            if ocr_data is None:
                continue
            images = pdf_to_images(item["pdf_path"])
            num_pages = min(len(images), len(ocr_data.get("pages", [])))

            for page_idx in range(num_pages):
                words, boxes = extract_words_and_boxes(ocr_data, page_idx)
                if not words:
                    continue
                self.samples.append({
                    "image": images[page_idx],
                    "words": words,
                    "boxes": boxes,
                    "label": label2id[item["label"]],
                    "filename": Path(item["pdf_path"]).name,
                })

        logger.info(f"  Dataset: {len(self.samples)}개 샘플 (페이지 단위)")

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        s = self.samples[idx]
        # processor: 이미지 + 텍스트 + bbox → 모델 입력 텐서
        encoding = self.processor(
            s["image"],
            s["words"],
            boxes=s["boxes"],
            return_tensors="pt",
            truncation=True,
            max_length=512,
            padding="max_length",
        )
        # 배치 차원 제거 (DataLoader가 다시 쌓아줌)
        item = {k: v.squeeze(0) for k, v in encoding.items()}
        item["labels"] = torch.tensor(s["label"], dtype=torch.long)
        return item


# ─── 학습 함수 ─────────────────────────────────────────────────────────────────

def train_one_epoch(model, dataloader, optimizer, scheduler):
    model.train()
    total_loss, correct, total = 0, 0, 0

    for batch in dataloader:
        batch = {k: v.to(DEVICE) for k, v in batch.items()}
        outputs = model(**batch)

        # outputs.loss: 모델이 자동으로 cross-entropy loss 계산
        loss = outputs.loss
        logits = outputs.logits  # 각 클래스에 대한 점수

        loss.backward()           # 역전파: 그래디언트 계산
        optimizer.step()          # 가중치 업데이트
        scheduler.step()          # learning rate 스케줄
        optimizer.zero_grad()     # 그래디언트 초기화

        total_loss += loss.item()
        preds = logits.argmax(dim=-1)
        correct += (preds == batch["labels"]).sum().item()
        total += len(batch["labels"])

    return total_loss / len(dataloader), correct / total


def evaluate(model, dataloader):
    model.eval()
    correct, total = 0, 0

    with torch.no_grad():
        for batch in dataloader:
            batch = {k: v.to(DEVICE) for k, v in batch.items()}
            outputs = model(**batch)
            preds = outputs.logits.argmax(dim=-1)
            correct += (preds == batch["labels"]).sum().item()
            total += len(batch["labels"])

    return correct / total if total > 0 else 0


# ─── 메인 ─────────────────────────────────────────────────────────────────────

def main():
    logger.info(f"디바이스: {DEVICE}")

    # 1. 데이터 로드
    logger.info("데이터 로드 중...")
    dataset = load_dataset()
    if len(dataset) < 2:
        logger.error("데이터 부족")
        sys.exit(1)

    # 라벨 → 숫자 매핑
    labels = sorted(set(d["label"] for d in dataset))
    label2id = {l: i for i, l in enumerate(labels)}
    id2label = {i: l for l, i in label2id.items()}
    num_labels = len(labels)
    logger.info(f"클래스: {label2id}")

    # 2. 모델 & 프로세서 로드
    logger.info(f"모델 로드 중: {MODEL_NAME}")
    processor = LayoutLMv3Processor.from_pretrained(MODEL_NAME, apply_ocr=False)

    # LayoutLMv3ForSequenceClassification:
    # LayoutLMv3 + CLS 토큰 위에 Linear(768 → num_labels) 레이어 추가
    model = LayoutLMv3ForSequenceClassification.from_pretrained(
        MODEL_NAME,
        num_labels=num_labels,
        id2label=id2label,
        label2id=label2id,
    ).to(DEVICE)

    # 3. Leave-One-Out 파인튜닝 평가
    # 문서 단위로 LOO (페이지 단위 아님)
    logger.info("\n─── Leave-One-Out 파인튜닝 평가 ───")
    loo_results = []

    for held_out_idx in range(len(dataset)):
        held_out = dataset[held_out_idx]
        train_items = [d for i, d in enumerate(dataset) if i != held_out_idx]

        logger.info(f"\n[{held_out_idx+1}/{len(dataset)}] 테스트: {Path(held_out['pdf_path']).name} ({held_out['label']})")

        # 새 모델 초기화 (매번 사전학습 모델부터 시작)
        fold_model = LayoutLMv3ForSequenceClassification.from_pretrained(
            MODEL_NAME,
            num_labels=num_labels,
            id2label=id2label,
            label2id=label2id,
        ).to(DEVICE)

        # 학습 데이터셋
        train_dataset = DocumentDataset(train_items, label2id, processor)
        if len(train_dataset) == 0:
            logger.warning("  학습 샘플 없음, 건너뜀")
            continue

        train_loader = DataLoader(train_dataset, batch_size=2, shuffle=True)

        # 옵티마이저 & 스케줄러
        optimizer = AdamW(fold_model.parameters(), lr=LEARNING_RATE)
        total_steps = len(train_loader) * EPOCHS
        scheduler = get_linear_schedule_with_warmup(
            optimizer,
            num_warmup_steps=total_steps // 10,
            num_training_steps=total_steps,
        )

        # 학습
        for epoch in range(EPOCHS):
            loss, acc = train_one_epoch(fold_model, train_loader, optimizer, scheduler)
            logger.info(f"  Epoch {epoch+1}/{EPOCHS} - loss: {loss:.4f}, train_acc: {acc:.2%}")

        # 테스트 (held-out 문서)
        test_dataset = DocumentDataset([held_out], label2id, processor)
        test_loader = DataLoader(test_dataset, batch_size=2)
        test_acc = evaluate(fold_model, test_loader)

        # 예측 라벨 (다수결)
        fold_model.eval()
        preds = []
        with torch.no_grad():
            for batch in test_loader:
                batch = {k: v.to(DEVICE) for k, v in batch.items()}
                logits = fold_model(**batch).logits
                preds.extend(logits.argmax(dim=-1).cpu().tolist())

        pred_label = id2label[Counter(preds).most_common(1)[0][0]]
        true_label = held_out["label"]
        is_correct = pred_label == true_label
        status = "✓" if is_correct else "✗"
        logger.info(f"  {status} 예측={pred_label}, 정답={true_label}")
        loo_results.append(is_correct)

    # LOO 결과
    accuracy = sum(loo_results) / len(loo_results) * 100
    logger.info(f"\n─── LOO 파인튜닝 정확도: {sum(loo_results)}/{len(loo_results)} = {accuracy:.1f}% ───")

    # 4. 전체 데이터로 최종 모델 학습 & 저장
    logger.info("\n─── 전체 데이터로 최종 모델 학습 ───")
    final_model = LayoutLMv3ForSequenceClassification.from_pretrained(
        MODEL_NAME,
        num_labels=num_labels,
        id2label=id2label,
        label2id=label2id,
    ).to(DEVICE)

    full_dataset = DocumentDataset(dataset, label2id, processor)
    full_loader = DataLoader(full_dataset, batch_size=2, shuffle=True)
    optimizer = AdamW(final_model.parameters(), lr=LEARNING_RATE)
    total_steps = len(full_loader) * EPOCHS
    scheduler = get_linear_schedule_with_warmup(optimizer, total_steps // 10, total_steps)

    for epoch in range(EPOCHS):
        loss, acc = train_one_epoch(final_model, full_loader, optimizer, scheduler)
        logger.info(f"  Epoch {epoch+1}/{EPOCHS} - loss: {loss:.4f}, acc: {acc:.2%}")

    # 저장
    SAVE_DIR.mkdir(parents=True, exist_ok=True)
    final_model.save_pretrained(str(SAVE_DIR))
    processor.save_pretrained(str(SAVE_DIR))

    # 라벨 매핑 저장
    with open(SAVE_DIR / "label_map.json", "w", encoding="utf-8") as f:
        json.dump({"label2id": label2id, "id2label": id2label}, f, ensure_ascii=False, indent=2)

    logger.info(f"\n모델 저장 완료: {SAVE_DIR}")
    logger.info(f"최종 LOO 정확도: {accuracy:.1f}%")


if __name__ == "__main__":
    main()
