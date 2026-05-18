"""
실제 문서의 OCR/PII 결과로 벤치마크 케이스 초안 생성

사용법:
  cd backend
  python -m benchmark.create_case_from_job --list-jobs
  python -m benchmark.create_case_from_job --file "계약서.pdf" --name 계약서_001
  python -m benchmark.create_case_from_job --file "계약서.pdf" --name 계약서_001 --description "3자 계약서"

  # 같은 파일을 여러 번 올렸을 때 특정 버전 선택:
  python -m benchmark.create_case_from_job --file "계약서.pdf" --pick

흐름:
  1. 파일명으로 가장 최근 job의 OCR 결과 자동 선택
  2. _ocr.json → ocr_pages 추출
  3. _pii.json → 자동 탐지 PII를 ground_truth 초안으로 배치
  4. benchmark/cases/case_real_{name}.json 생성

생성 후 할 일:
  - 원본 PDF 보면서 ground_truth 항목 검토
  - 잘못 탐지된 항목 삭제 (FP 제거)
  - 빠진 항목 추가 (FN 보완)
  - python -m benchmark.run_benchmark --case case_real_{name} 실행
"""

import sys
import json
import argparse
from pathlib import Path
from datetime import datetime

sys.path.insert(0, str(Path(__file__).parent.parent))

from config import Config

CASES_DIR = Path(__file__).parent / "cases"
PROCESSED_DIR = Path(Config.PROCESSED_DIR)


# ── DB 조회 ────────────────────────────────────────────────────

def _query_jobs() -> list:
    """DB에서 completed job 목록 반환 (최신순). OCR 파일이 존재하는 것만."""
    try:
        from database import SessionLocal, Job
        db = SessionLocal()
        try:
            rows = (
                db.query(Job.job_id, Job.original_filename, Job.created_at, Job.total_pages)
                .filter(Job.status == "completed")
                .order_by(Job.created_at.desc())
                .all()
            )
            # OCR 파일이 실제로 있는 것만
            result = []
            for r in rows:
                if (PROCESSED_DIR / f"{r.job_id}_ocr.json").exists():
                    result.append({
                        "job_id":    r.job_id,
                        "filename":  r.original_filename,
                        "created_at": r.created_at,
                        "pages":     r.total_pages or "?",
                    })
            return result
        finally:
            db.close()
    except Exception as e:
        print(f"[경고] DB 조회 실패: {e}")
        return _query_jobs_from_files()


def _query_jobs_from_files() -> list:
    """DB 없을 때 파일 기반으로 job 목록 구성"""
    result = []
    for f in sorted(PROCESSED_DIR.glob("*_ocr.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        job_id = f.stem.replace("_ocr", "")
        with open(f, encoding="utf-8") as fp:
            ocr_data = json.load(fp)
        result.append({
            "job_id":    job_id,
            "filename":  ocr_data.get("job_id", job_id),  # fallback
            "created_at": None,
            "pages":     ocr_data.get("page_count", "?"),
        })
    return result


def _find_job_by_filename(filename: str, jobs: list, pick: bool = False) -> dict:
    """파일명으로 job 찾기. 여러 개면 최신 것 선택 (pick=True면 대화식 선택)."""
    matched = [j for j in jobs if j["filename"] == filename]
    if not matched:
        # 부분 일치 시도
        matched = [j for j in jobs if filename.lower() in j["filename"].lower()]
    if not matched:
        print(f"오류: '{filename}' 파일을 찾을 수 없습니다.")
        print("  python -m benchmark.create_case_from_job --list-jobs  로 목록을 확인하세요.")
        sys.exit(1)

    if len(matched) == 1:
        return matched[0]

    # 여러 개 있을 때
    if not pick:
        chosen = matched[0]  # 가장 최신
        ts = chosen["created_at"].strftime("%Y-%m-%d %H:%M") if chosen["created_at"] else "시각 불명"
        print(f"  '{filename}' 업로드 이력 {len(matched)}건 → 가장 최근 ({ts}) 자동 선택")
        print(f"  다른 버전을 쓰려면 --pick 옵션을 추가하세요.")
        return chosen

    # --pick: 사용자가 선택
    print(f"\n'{filename}' 업로드 이력 {len(matched)}건:")
    for i, j in enumerate(matched):
        ts = j["created_at"].strftime("%Y-%m-%d %H:%M") if j["created_at"] else "시각 불명"
        pii_path = PROCESSED_DIR / f"{j['job_id']}_pii.json"
        pii_count = "PII 없음"
        if pii_path.exists():
            with open(pii_path, encoding="utf-8") as fp:
                pii_count = f"PII {len(json.load(fp).get('pii_items', []))}건"
        print(f"  [{i+1}] {ts}  {j['pages']}페이지  {pii_count}  ({j['job_id'][:8]}...)")
    while True:
        try:
            choice = int(input("\n번호 선택: ")) - 1
            if 0 <= choice < len(matched):
                return matched[choice]
        except (ValueError, KeyboardInterrupt):
            pass
        print("올바른 번호를 입력하세요.")


# ── 목록 출력 ──────────────────────────────────────────────────

def _list_jobs():
    jobs = _query_jobs()
    if not jobs:
        print(f"처리 완료된 OCR 결과 없음: {PROCESSED_DIR}")
        return

    # 파일명별로 그룹화 (최신 job만 대표로)
    seen_files: dict = {}
    for j in jobs:
        fn = j["filename"]
        if fn not in seen_files:
            seen_files[fn] = {"latest": j, "count": 1}
        else:
            seen_files[fn]["count"] += 1

    print(f"\n업로드된 파일 (총 {len(seen_files)}종):")
    print(f"  {'파일명':<38} {'PII 탐지':<10} {'페이지':<8} {'최근 업로드':<17} 중복")
    print("  " + "─" * 85)
    for fn, info in seen_files.items():
        j = info["latest"]
        pii_path = PROCESSED_DIR / f"{j['job_id']}_pii.json"
        pii_count = "없음"
        if pii_path.exists():
            with open(pii_path, encoding="utf-8") as fp:
                pii_count = f"{len(json.load(fp).get('pii_items', []))}건"
        ts = j["created_at"].strftime("%Y-%m-%d %H:%M") if j["created_at"] else "-"
        dup = f"({info['count']}회)" if info["count"] > 1 else ""
        print(f"  {fn:<38} {pii_count:<10} {j['pages']}페이지    {ts:<17} {dup}")
    print()


# ── OCR/PII 로드 ───────────────────────────────────────────────

def _load_ocr_pages(job_id: str) -> list:
    ocr_path = PROCESSED_DIR / f"{job_id}_ocr.json"
    if not ocr_path.exists():
        print(f"오류: OCR 파일 없음 → {ocr_path}")
        sys.exit(1)
    with open(ocr_path, encoding="utf-8") as f:
        ocr_data = json.load(f)
    pages = []
    for page in ocr_data.get("pages", []):
        lines = []
        for line in page.get("lines", []):
            entry = {"text": line["text"]}
            if line.get("bbox"):
                entry["bbox"] = line["bbox"]
            if line.get("confidence") is not None:
                entry["confidence"] = line["confidence"]
            lines.append(entry)
        pages.append({
            "page_number": page["page_number"],
            "width":  page.get("width", 0),
            "height": page.get("height", 0),
            "lines":  lines,
        })
    return pages


def _load_pii_as_ground_truth(job_id: str) -> list:
    pii_path = PROCESSED_DIR / f"{job_id}_pii.json"
    if not pii_path.exists():
        print("  (PII 파일 없음 — ground_truth는 빈 상태로 생성됩니다)")
        return []
    with open(pii_path, encoding="utf-8") as f:
        pii_data = json.load(f)
    seen, ground_truth = set(), []
    for item in pii_data.get("pii_items", []):
        key = (item["type"], item["value"])
        if key not in seen:
            seen.add(key)
            ground_truth.append({"type": item["type"], "value": item["value"]})
    return ground_truth


# ── 케이스 생성 ────────────────────────────────────────────────

def create_case(job: dict, name: str, description: str = "") -> Path:
    job_id   = job["job_id"]
    filename = job["filename"]

    print(f"\n파일명: {filename}")
    print(f"job_id: {job_id[:8]}...")
    print("OCR 결과 로드 중...")
    ocr_pages = _load_ocr_pages(job_id)
    total_lines = sum(len(p["lines"]) for p in ocr_pages)
    print(f"  → {len(ocr_pages)}페이지, 텍스트 라인 {total_lines}개")

    print("PII 탐지 결과 로드 중...")
    ground_truth = _load_pii_as_ground_truth(job_id)
    print(f"  → 자동 탐지 {len(ground_truth)}건 (초안으로 배치)")

    case_id = f"case_real_{name}"
    case = {
        "id":              case_id,
        "description":     description or f"실제 문서 벤치마크 — {name}",
        "tags":            ["real", "labeled"],
        "source_filename": filename,
        "source_job_id":   job_id,
        "created_at":      datetime.now().strftime("%Y-%m-%d"),
        "notes": (
            "【라벨링 필요】 ground_truth는 자동 탐지 결과 초안입니다. "
            "원본 PDF를 보면서 잘못 탐지된 항목 삭제(FP 제거), 빠진 항목 추가(FN 보완) 후 사용하세요."
        ),
        "ocr_pages":    ocr_pages,
        "ground_truth": ground_truth,
    }

    out_path = CASES_DIR / f"{case_id}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(case, f, ensure_ascii=False, indent=2)

    return out_path


# ── 메인 ───────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="실제 문서 → 벤치마크 케이스 초안 생성")
    parser.add_argument("--file",        help="대상 파일명 (예: '계약서.pdf')")
    parser.add_argument("--name",        help="케이스 이름 (예: 계약서_001)")
    parser.add_argument("--description", default="", help="케이스 설명")
    parser.add_argument("--list-jobs",   action="store_true", help="업로드된 파일 목록 출력")
    parser.add_argument("--pick",        action="store_true", help="같은 파일 여러 버전 중 직접 선택")
    args = parser.parse_args()

    if args.list_jobs:
        _list_jobs()
        if not args.file:
            return

    if not args.file:
        print("사용법: python -m benchmark.create_case_from_job --file <파일명> --name <이름>")
        print("       python -m benchmark.create_case_from_job --list-jobs")
        sys.exit(1)

    if not args.name:
        print("오류: --name 이 필요합니다 (예: --name 계약서_001)")
        sys.exit(1)

    jobs = _query_jobs()
    job  = _find_job_by_filename(args.file, jobs, pick=args.pick)

    out_path = create_case(job, args.name, args.description)

    print(f"\n케이스 초안 생성 완료: {out_path}")
    print("\n─── 다음 단계 ───────────────────────────────────────────────────")
    print(f"1. 원본 PDF 열기: {job['filename']}")
    print(f"2. {out_path.name} 의 ground_truth 항목 검토")
    print("   - 잘못 탐지된 항목 삭제  ← FP 제거")
    print("   - 빠진 개인정보 추가      ← FN 보완")
    print(f"3. python -m benchmark.run_benchmark --case {out_path.stem}")
    print("─────────────────────────────────────────────────────────────────\n")


if __name__ == "__main__":
    main()
