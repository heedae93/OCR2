"""
테스트 문서를 BBOCR API로 업로드하고 OCR 처리까지 완료시키는 스크립트
- test_data/제안서/, test_data/계약서/ 폴더의 PDF를 업로드
- 각 파일의 doc_type 라벨을 DB에 기록 (나중에 LayoutLMv3 학습에 사용)
"""
import os
import sys
import time
import json
import requests
from pathlib import Path

API_BASE = "http://localhost:6015/api"
TEST_DATA_DIR = Path(__file__).parent / "test_data"
USER_ID = "test_classifier"   # 테스트용 유저 ID (기존 데이터와 분리)
POLL_INTERVAL = 5             # 처리 완료 확인 주기 (초)
POLL_TIMEOUT = 300            # 최대 대기 시간 (초)


def upload_file(pdf_path: Path, label: str) -> str | None:
    """PDF 업로드 → job_id 반환"""
    with open(pdf_path, "rb") as f:
        resp = requests.post(
            f"{API_BASE}/upload",
            params={"user_id": USER_ID},
            files={"file": (pdf_path.name, f, "application/pdf")},
            timeout=30,
        )

    if resp.status_code != 200:
        print(f"  [업로드 실패] {resp.status_code}: {resp.text[:200]}")
        return None

    data = resp.json()
    job_id = data.get("job_id")
    print(f"  업로드 완료 → job_id: {job_id}")
    return job_id


def start_processing(job_id: str) -> bool:
    """OCR 처리 시작"""
    resp = requests.post(f"{API_BASE}/process/{job_id}", timeout=10)
    if resp.status_code != 200:
        print(f"  [처리 시작 실패] {resp.status_code}: {resp.text[:200]}")
        return False
    return True


def wait_for_completion(job_id: str) -> str:
    """처리 완료까지 폴링 → 최종 상태 반환"""
    elapsed = 0
    while elapsed < POLL_TIMEOUT:
        resp = requests.get(f"{API_BASE}/jobs/{job_id}", timeout=10)
        if resp.status_code == 200:
            status = resp.json().get("status", "unknown")
            if status in ("completed", "failed"):
                return status
            print(f"  처리 중... ({elapsed}초 경과, 상태: {status})")
        time.sleep(POLL_INTERVAL)
        elapsed += POLL_INTERVAL

    return "timeout"


def load_results() -> dict:
    """기존 결과 파일 로드"""
    results_path = TEST_DATA_DIR / "upload_results.json"
    if results_path.exists():
        with open(results_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_results(results: dict):
    """결과 저장 (job_id ↔ label 매핑)"""
    results_path = TEST_DATA_DIR / "upload_results.json"
    with open(results_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)


def main():
    # 기존 결과 로드 (재실행 시 이미 처리된 파일 건너뜀)
    results = load_results()
    already_done = {v["filename"] for v in results.values()}

    print(f"이미 처리된 파일: {len(already_done)}개")

    for class_dir in sorted(TEST_DATA_DIR.iterdir()):
        if not class_dir.is_dir() or class_dir.name.startswith("."):
            continue
        label = class_dir.name

        # PDF 목록 (중복 제거)
        seen, pdfs = set(), []
        for p in class_dir.iterdir():
            if p.suffix.lower() == ".pdf" and p.name.lower() not in seen:
                seen.add(p.name.lower())
                pdfs.append(p)

        print(f"\n[{label}] {len(pdfs)}개 파일")

        for pdf_path in sorted(pdfs):
            if pdf_path.name in already_done:
                print(f"  건너뜀 (이미 처리됨): {pdf_path.name}")
                continue

            print(f"\n  처리 중: {pdf_path.name}")

            # 1. 업로드
            job_id = upload_file(pdf_path, label)
            if not job_id:
                continue

            # 2. OCR 처리 시작
            if not start_processing(job_id):
                continue

            # 3. 완료 대기
            final_status = wait_for_completion(job_id)
            print(f"  최종 상태: {final_status}")

            # 4. 결과 저장 (성공/실패 모두 기록)
            results[job_id] = {
                "filename": pdf_path.name,
                "label": label,
                "status": final_status,
            }
            save_results(results)

    print(f"\n완료! 총 {len(results)}개 처리됨")
    print(f"결과 저장: {TEST_DATA_DIR / 'upload_results.json'}")

    # 요약
    completed = [v for v in results.values() if v["status"] == "completed"]
    failed = [v for v in results.values() if v["status"] != "completed"]
    print(f"  성공: {len(completed)}개")
    print(f"  실패/타임아웃: {len(failed)}개")
    if failed:
        for v in failed:
            print(f"    - {v['filename']} ({v['status']})")


if __name__ == "__main__":
    main()
