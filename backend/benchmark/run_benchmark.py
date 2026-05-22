"""
벤치마크 실행기 
PII 추출 정확도 벤치마크

사용법:
  cd backend
  python -m benchmark.run_benchmark                         # 전체 케이스
  python -m benchmark.run_benchmark --label "정규식+NER"    # 레이블 지정
  python -m benchmark.run_benchmark --no-ner               # NER 비활성화 (정규식만)
  python -m benchmark.run_benchmark --case case_001        # 특정 케이스만

결과는 benchmark/results/ 에 JSON으로 저장됩니다.
compare_runs.py 로 두 결과를 비교할 수 있습니다.
"""

import sys
import io
import json
import re
import time
import logging
import argparse
import contextlib
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple

sys.path.insert(0, str(Path(__file__).parent.parent))

CASES_DIR = Path(__file__).parent / "cases"
RESULTS_DIR = Path(__file__).parent / "results"
RESULTS_DIR.mkdir(exist_ok=True)


# ── 매칭 / 메트릭 ────────────────────────────────────────────


def _normalize(v: str) -> str:
    """비교용 정규화: 구분자·공백 제거 후 소문자"""
    return re.sub(r"[\s\-–—\.\/\(\)]", "", v).lower()


def _is_match(pred_type: str, pred_val: str, gt_type: str, gt_val: str) -> bool:
    """같은 타입이고 값이 부분 포함 관계이면 매칭"""
    if pred_type != gt_type:
        return False
    pn, gn = _normalize(pred_val), _normalize(gt_val)
    return pn == gn or pn in gn or gn in pn


def _compute_metrics(tp: int, fp: int, fn: int) -> Dict:
    precision = tp / (tp + fp) if (tp + fp) > 0 else 1.0
    recall    = tp / (tp + fn) if (tp + fn) > 0 else 1.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0
    return {
        "precision": round(precision, 4),
        "recall":    round(recall, 4),
        "f1":        round(f1, 4),
        "tp": tp, "fp": fp, "fn": fn,
    }


# ── 케이스 평가 ────────────────────────────────────────────────


def _run_extractor(ocr_pages: list, suppress: bool) -> list:
    from core.pii_extractor import extract_pii_from_pages
    if suppress:
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            logging.disable(logging.CRITICAL)
            try:
                return extract_pii_from_pages(ocr_pages)
            finally:
                logging.disable(logging.NOTSET)
    return extract_pii_from_pages(ocr_pages)


def evaluate_case(case: Dict, suppress: bool = True) -> Dict:
    ground_truth = case["ground_truth"]
    t0 = time.perf_counter()
    predictions  = _run_extractor(case["ocr_pages"], suppress)
    elapsed = time.perf_counter() - t0

    # type+value 기준으로 중복 제거 (같은 PII가 여러 페이지에 있어도 "찾았냐"만 판단)
    def _dedup(items):
        seen, out = set(), {}
        for item in items:
            k = (item["type"], _normalize(item["value"]))
            if k not in seen:
                seen.add(k)
                out[k] = item
        return out

    pred_map = _dedup(predictions)
    gt_map   = _dedup(ground_truth)

    # 탐욕적 매칭: GT 기준으로 가장 먼저 매칭되는 예측 확정
    matched_pred_keys: set = set()
    matched_gt_keys:   set = set()

    for gk, gv in gt_map.items():
        for pk, pv in pred_map.items():
            if pk in matched_pred_keys:
                continue
            if _is_match(pk[0], pk[1], gk[0], gk[1]):
                matched_pred_keys.add(pk)
                matched_gt_keys.add(gk)
                break

    tp = len(matched_gt_keys)
    fp_items = [v for k, v in pred_map.items() if k not in matched_pred_keys]
    fn_items = [v for k, v in gt_map.items()   if k not in matched_gt_keys]

    # 타입별 분해
    all_types = set(k[0] for k in gt_map) | set(k[0] for k in pred_map)
    by_type: Dict[str, Dict] = {}
    for t in all_types:
        t_gt   = {k: v for k, v in gt_map.items()   if k[0] == t}
        t_pred = {k: v for k, v in pred_map.items() if k[0] == t}
        t_matched_gt   = {k for k in matched_gt_keys   if k[0] == t}
        t_matched_pred = {k for k in matched_pred_keys if k[0] == t}
        tp_t = len(t_matched_gt)
        fp_t = len(t_pred) - len(t_matched_pred)
        fn_t = len(t_gt)   - len(t_matched_gt)
        by_type[t] = _compute_metrics(tp_t, max(fp_t, 0), max(fn_t, 0))

    return {
        "case_id":     case["id"],
        "description": case.get("description", ""),
        "tags":        case.get("tags", []),
        "metrics":     _compute_metrics(tp, len(fp_items), len(fn_items)),
        "by_type":     by_type,
        "elapsed_seconds": round(elapsed, 3),
        "false_positives": [{"type": x["type"], "value": x["value"]} for x in fp_items],
        "false_negatives": [{"type": x.get("type"), "value": x.get("value")} for x in fn_items],
    }


# ── 집계 ───────────────────────────────────────────────────────


def _aggregate(case_results: List[Dict]) -> Tuple[Dict, Dict]:
    """전체 메트릭 + 타입별 메트릭 집계"""
    total_tp = sum(c["metrics"]["tp"] for c in case_results)
    total_fp = sum(c["metrics"]["fp"] for c in case_results)
    total_fn = sum(c["metrics"]["fn"] for c in case_results)

    type_acc: Dict[str, Dict[str, int]] = {}
    for cr in case_results:
        for t, m in cr["by_type"].items():
            if t not in type_acc:
                type_acc[t] = {"tp": 0, "fp": 0, "fn": 0}
            type_acc[t]["tp"] += m["tp"]
            type_acc[t]["fp"] += m["fp"]
            type_acc[t]["fn"] += m["fn"]

    by_type = {t: _compute_metrics(s["tp"], s["fp"], s["fn"]) for t, s in type_acc.items()}
    overall  = _compute_metrics(total_tp, total_fp, total_fn)
    return overall, by_type


# ── 출력 ───────────────────────────────────────────────────────


def _fmt_time(seconds: float) -> str:
    if seconds < 60:
        return f"{seconds:.1f}s"
    m, s = divmod(seconds, 60)
    return f"{int(m)}m {s:.1f}s"


def _print_summary(result: Dict):
    o = result["overall"]
    t = result.get("timing", {})
    sep  = "=" * 65
    dash = "─" * 65
    print(f"\n{sep}")
    print(f"  벤치마크 결과: {result['label']}")
    print(f"  일시: {result['timestamp']}")
    if t:
        print(f"  소요시간: 총 {_fmt_time(t['total_elapsed_seconds'])}"
              f"  (케이스당 평균 {_fmt_time(t['avg_elapsed_seconds'])})")
    print(f"{sep}")
    print(f"  전체  P={o['precision']:.3f}  R={o['recall']:.3f}  F1={o['f1']:.3f}"
          f"  (TP={o['tp']} FP={o['fp']} FN={o['fn']})")
    print(dash)
    print(f"  {'타입':<22} {'P':>6} {'R':>6} {'F1':>6}  {'TP':>3} {'FP':>3} {'FN':>3}")
    print(f"  {'─'*58}")
    for ptype, m in sorted(result["by_type"].items()):
        flag = "  "
        if m["fp"] > 0 and m["fn"] == 0:
            flag = "!"   # 오탐만 있음
        elif m["fn"] > 0 and m["fp"] == 0:
            flag = "?"   # 누락만 있음
        elif m["fp"] > 0 and m["fn"] > 0:
            flag = "x"   # 둘 다
        print(f"{flag} {ptype:<22} {m['precision']:>6.3f} {m['recall']:>6.3f} {m['f1']:>6.3f}"
              f"  {m['tp']:>3} {m['fp']:>3} {m['fn']:>3}")
    print(dash)
    for c in result["by_case"]:
        m   = c["metrics"]
        tag = " ".join(f"[{t}]" for t in c.get("tags", []))
        f1_bar = "█" * int(m["f1"] * 10) + "░" * (10 - int(m["f1"] * 10))
        elapsed_str = f"  {_fmt_time(c['elapsed_seconds'])}" if "elapsed_seconds" in c else ""
        print(f"  {c['case_id']:<35} F1={m['f1']:.3f} {f1_bar}{elapsed_str}  {tag}")
        for fp_item in c["false_positives"]:
            print(f"       오탐(FP): [{fp_item['type']}] '{fp_item['value']}'")
        for fn_item in c["false_negatives"]:
            print(f"       누락(FN): [{fn_item['type']}] '{fn_item['value']}'")
    print(sep)
    print(f"  저장 경로: {result['result_path']}")
    print(f"{sep}\n")
    print("  범례: ! 오탐(FP)만 있음   ? 누락(FN)만 있음   x 둘 다\n")


# ── 메인 ───────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(description="PII 추출 벤치마크")
    parser.add_argument("--label",   default="", help="이 실행의 레이블 (예: '정규식+NER v2')")
    parser.add_argument("--case",    default=None, help="케이스 파일명 필터 (예: case_001)")
    parser.add_argument("--no-ner",  action="store_true", help="KoBERT NER 비활성화")
    parser.add_argument("--verbose", action="store_true", help="추출기 내부 출력 표시")
    args = parser.parse_args()

    if args.no_ner:
        import core.pii_extractor as pe
        pe.KOBERT_NER_AVAILABLE = False
        print("[설정] KoBERT NER 비활성화")

    # 케이스 로드
    case_files = sorted(CASES_DIR.glob("*.json"))
    if args.case:
        case_files = [f for f in case_files if args.case in f.stem]
    if not case_files:
        print(f"케이스 없음: {CASES_DIR}")
        sys.exit(1)

    cases = []
    for f in case_files:
        with open(f, encoding="utf-8") as fp:
            cases.append(json.load(fp))

    # 현재 활성 패턴 정보 수집
    from core.pii_extractor import PII_PATTERNS, KOBERT_NER_AVAILABLE
    active_patterns = {k: len(v) > 0 for k, v in PII_PATTERNS.items()}

    print(f"케이스 {len(cases)}개 로드. 평가 시작...")
    case_results = []
    run_t0 = time.perf_counter()
    for case in cases:
        print(f"  평가 중: {case['id']}  - {case.get('description', '')}")
        case_results.append(evaluate_case(case, suppress=not args.verbose))
    total_elapsed = time.perf_counter() - run_t0

    overall, by_type = _aggregate(case_results)

    ts     = datetime.now()
    run_id = ts.strftime("%Y%m%d_%H%M%S")
    label  = args.label or run_id
    safe_label = re.sub(r"[^\w가-힣]", "_", label)

    case_count = len(case_results)
    result = {
        "run_id":    run_id,
        "timestamp": ts.isoformat(),
        "label":     label,
        "config": {
            "ner_enabled":     not args.no_ner and KOBERT_NER_AVAILABLE,
            "active_patterns": active_patterns,
            "note": "ACCOUNT_NO 정규식 제거됨 (날짜/사업자번호 오탐 방지)" if not active_patterns.get("ACCOUNT_NO") else "",
        },
        "timing": {
            "total_elapsed_seconds": round(total_elapsed, 3),
            "avg_elapsed_seconds":   round(total_elapsed / case_count, 3) if case_count else 0.0,
            "case_count":            case_count,
        },
        "overall":  overall,
        "by_type":  by_type,
        "by_case":  case_results,
    }

    out_path = RESULTS_DIR / f"{run_id}_{safe_label}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    result["result_path"] = str(out_path)

    _print_summary(result)


if __name__ == "__main__":
    main()
