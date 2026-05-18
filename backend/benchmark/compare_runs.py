"""
벤치마크 결과 비교

사용법:
  cd backend
  python -m benchmark.compare_runs results/A.json results/B.json
  python -m benchmark.compare_runs results/*.json        # 여러 결과 비교

두 파일을 비교하면 타입별 F1 변화량(▲/▼)도 표시됩니다.
"""

import sys
import json
import re
from pathlib import Path
from typing import Dict, List


def _load(path: str) -> Dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _delta_str(a: float, b: float) -> str:
    d = b - a
    if abs(d) < 0.001:
        return "  ="
    return f"▲+{d:.3f}" if d > 0 else f"▼{d:.3f}"


def _bar(f1: float, width: int = 8) -> str:
    filled = int(f1 * width)
    return "█" * filled + "░" * (width - filled)


def compare(results: List[Dict]):
    col = 10   # 각 결과 열 너비
    n   = len(results)
    labels = [r["label"] for r in results]

    # ── 헤더 ─────────────────────────────────────────────────
    sep_w = 26 + (col + 2) * n + (10 if n == 2 else 0)
    sep   = "=" * sep_w
    dash  = "─" * sep_w

    print(f"\n{sep}")
    print("  벤치마크 비교")
    for i, r in enumerate(results):
        print(f"  [{i+1}] {r['label']}  ({r['timestamp'][:16]})")
    print(sep)

    def row(label, vals, delta=False):
        line = f"  {label:<24}"
        float_vals = []
        for v in vals:
            if isinstance(v, float):
                line += f"{v:>{col+2}.3f}"
                float_vals.append(v)
            else:
                line += f"{str(v):>{col+2}}"
        if delta and n == 2 and len(float_vals) == 2:
            line += f"  {_delta_str(float_vals[0], float_vals[1]):>8}"
        print(line)

    # ── 전체 메트릭 ────────────────────────────────────────────
    row("[전체] F1",        [r["overall"]["f1"]        for r in results], delta=True)
    row("[전체] Precision", [r["overall"]["precision"] for r in results], delta=True)
    row("[전체] Recall",    [r["overall"]["recall"]    for r in results], delta=True)

    def tp_fp_fn(r):
        o = r["overall"]
        return f"{o['tp']}/{o['fp']}/{o['fn']}"
    row("[전체] TP/FP/FN",  [tp_fp_fn(r) for r in results])
    print(dash)

    # ── 타입별 F1 ─────────────────────────────────────────────
    print(f"  {'타입':<24}" + "".join(f"{'F1':>{col+2}}" for _ in results)
          + ("     변화" if n == 2 else ""))
    print(f"  {'─'*22}" + "─" * ((col + 2) * n + (10 if n == 2 else 0)))

    all_types = sorted(set(t for r in results for t in r.get("by_type", {})))
    for t in all_types:
        vals = []
        for r in results:
            m = r.get("by_type", {}).get(t)
            vals.append(m["f1"] if m else None)

        line = f"  {t:<24}"
        for v in vals:
            line += f"{v:>{col+2}.3f}" if v is not None else f"{'N/A':>{col+2}}"

        if n == 2 and all(v is not None for v in vals):
            line += f"  {_delta_str(vals[0], vals[1]):>8}"

        # 두 번째 결과 기준 막대 추가 (비교 시)
        if n >= 2 and vals[-1] is not None:
            line += f"  {_bar(vals[-1])}"
        print(line)

    print(sep)

    # ── 케이스별 요약 ─────────────────────────────────────────
    if n == 2:
        print("\n  케이스별 F1 변화")
        print(f"  {'케이스':<38} {'이전':>7} {'이후':>7}  변화")
        print("  " + "─" * 60)

        # case_id → 결과 인덱싱
        def _case_map(r):
            return {c["case_id"]: c["metrics"]["f1"] for c in r.get("by_case", [])}

        m0, m1 = _case_map(results[0]), _case_map(results[1])
        all_cases = sorted(set(m0) | set(m1))
        for cid in all_cases:
            v0 = m0.get(cid)
            v1 = m1.get(cid)
            s0 = f"{v0:.3f}" if v0 is not None else "  N/A"
            s1 = f"{v1:.3f}" if v1 is not None else "  N/A"
            delta = _delta_str(v0, v1) if (v0 is not None and v1 is not None) else ""
            arrow = ""
            if v0 is not None and v1 is not None:
                arrow = "▲" if v1 > v0 + 0.001 else ("▼" if v1 < v0 - 0.001 else " ")
            print(f"  {cid:<38} {s0:>7} {s1:>7}  {arrow}{delta}")
        print()


def main():
    paths = []
    for arg in sys.argv[1:]:
        if "*" in arg:
            paths.extend(sorted(Path(".").glob(arg)))
        else:
            paths.append(Path(arg))

    if not paths:
        print("사용법: python -m benchmark.compare_runs <result1.json> [result2.json ...]")
        sys.exit(1)

    results = [_load(str(p)) for p in paths]
    compare(results)


if __name__ == "__main__":
    main()
