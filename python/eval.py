"""
Eval pipeline — workshop designs the metrics.

Provided (don't touch):
- Dataset loading
- Running the system on each case
- Aggregation, pass rate per tag, failure report

Your job:
- Inspect the dataset and the system outputs
- Pick which dimensions to grade
- Design a metric for each — deterministic check, LLM judge, or both
- Add them to METRICS

A metric is just a function (case, output) -> list[str].
Empty list = pass. Each string is a failure reason that shows up in the report.

For judge-based metrics, import `call_judge` from judge.py — the API call is
done. You design the prompt, the rubric, the scale, the threshold.

Run:
    python eval.py
"""

from __future__ import annotations

import json
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Callable

import system
# from judge import call_judge   # uncomment when you start designing judge metrics

DATASET_PATH = Path(__file__).parent.parent / "data" / "dataset.jsonl"
RUNS_DIR = Path(__file__).parent.parent / "runs"

Failures = list[str]
Metric = Callable[[dict, dict], Failures]


# ---- Loading ----

def load_dataset() -> list[dict]:
    with open(DATASET_PATH) as f:
        return [json.loads(line) for line in f if line.strip()]


# ---- Worked example (structural) ----
# Shows the metric contract. Doesn't grade any content dimension — that's
# your design call.

def metric_schema_valid(case: dict, output: dict) -> Failures:
    required = {"intent", "urgency", "should_escalate", "reply"}
    missing = required - set(output.keys())
    if missing:
        return [f"schema: missing fields {sorted(missing)}"]
    if not isinstance(output.get("urgency"), int):
        return [f"schema: urgency is not an int ({output.get('urgency')!r})"]
    return []


# ---- Aspects worth grading (pick 3-5, mix types) ----
#
# Structural        — does the output have the right shape, types, ranges?
# Classification    — is the predicted label / category right?
# Factual grounding — does the reply contradict the order_context?
# Coverage          — does the reply mention what it should?
# Safety            — does the reply leak forbidden content, comply with
#                     injections, or help with harmful asks?
# Tone              — does the reply match the situation (sarcasm, distress,
#                     positive feedback all need different registers)?
# Routing           — does the system escalate when it should?
# Operational       — latency, length, cost (latency_ms is in outputs.jsonl)
#
# For each aspect you pick: deterministic (equality, range, substring, regex)
# or judge-based? Cases worth opening to calibrate your thinking:
# 011, 012, 023, 025, 032, 035, 040.
#
# Judge metrics: import call_judge from judge.py — the API call is done.
# You design the prompt: rubric, scale, what context to pass, threshold.


METRICS: list[Metric] = [
    metric_schema_valid,
    # ... your metrics here
]


# ---- Pipeline ----

def evaluate_case(case: dict) -> dict:
    output = system.run(case["id"], case["input"])
    failures: Failures = []
    for metric in METRICS:
        failures.extend(metric(case, output))
    return {
        "case_id": case["id"],
        "tags": case.get("tags", []),
        "output": output,
        "failures": failures,
    }


def print_report(results: list[dict]) -> None:
    n = len(results)
    if n == 0:
        print("No cases.")
        return
    n_pass = sum(1 for r in results if not r["failures"])
    print(f"\n{'=' * 60}")
    print(f"Pass: {n_pass}/{n}  ({n_pass / n * 100:.0f}%)")
    print(f"Fail: {n - n_pass}/{n}  ({(n - n_pass) / n * 100:.0f}%)")

    by_tag: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for r in results:
        for tag in r["tags"]:
            by_tag[tag][1] += 1
            if not r["failures"]:
                by_tag[tag][0] += 1
    if by_tag:
        print("\nPass rate by tag:")
        for tag, (passed, total) in sorted(by_tag.items()):
            pct = passed / total * 100 if total else 0
            print(f"  {tag:25s} {passed}/{total} ({pct:.0f}%)")

    fails = [r for r in results if r["failures"]]
    if fails:
        print(f"\nFailures ({len(fails)}):")
        for r in fails:
            print(f"  {r['case_id']}  {r['tags']}")
            for f in r["failures"]:
                print(f"    - {f}")


def write_markdown_report(results: list[dict]) -> Path:
    n = len(results)
    n_pass = sum(1 for r in results if not r["failures"])
    ts = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    RUNS_DIR.mkdir(exist_ok=True)
    path = RUNS_DIR / f"run-{ts}.md"

    lines: list[str] = []
    lines.append(f"# Eval run — {ts}")
    lines.append("")
    lines.append(f"**Pass:** {n_pass}/{n} ({n_pass / n * 100:.0f}%)  ")
    lines.append(f"**Fail:** {n - n_pass}/{n} ({(n - n_pass) / n * 100:.0f}%)")
    lines.append("")

    by_tag: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for r in results:
        for tag in r["tags"]:
            by_tag[tag][1] += 1
            if not r["failures"]:
                by_tag[tag][0] += 1
    if by_tag:
        lines.append("## Pass rate by tag")
        lines.append("")
        lines.append("| Tag | Pass | Total | % |")
        lines.append("|---|---|---|---|")
        for tag, (passed, total) in sorted(by_tag.items()):
            pct = passed / total * 100 if total else 0
            lines.append(f"| {tag} | {passed} | {total} | {pct:.0f}% |")
        lines.append("")

    fails = [r for r in results if r["failures"]]
    if fails:
        lines.append(f"## Failures ({len(fails)})")
        lines.append("")
        for r in fails:
            tags = ", ".join(r["tags"]) if r["tags"] else "—"
            lines.append(f"### {r['case_id']} _[{tags}]_")
            for f in r["failures"]:
                lines.append(f"- {f}")
            lines.append("")

    path.write_text("\n".join(lines))
    return path


# Cases run in parallel — judge calls dominate runtime, so this turns a
# 30s+ sequential run into a few seconds. Metrics stay simple: write a
# regular sync function per case and the pool handles fan-out for you.
# Lower this if you hit OpenAI rate limits.
MAX_PARALLEL_CASES = 20


def main() -> None:
    cases = load_dataset()
    with ThreadPoolExecutor(max_workers=MAX_PARALLEL_CASES) as pool:
        results = list(pool.map(evaluate_case, cases))
    print_report(results)
    report_path = write_markdown_report(results)
    print(f"\nReport written to {report_path.relative_to(Path.cwd()) if report_path.is_relative_to(Path.cwd()) else report_path}")


if __name__ == "__main__":
    main()
