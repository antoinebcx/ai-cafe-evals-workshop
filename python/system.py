"""
Naive customer support system — workshop simulation.

In production, this module would call an LLM API to generate a structured
response (intent, urgency, should_escalate, reply) given a customer message.
For the workshop, we read pre-cached outputs from data/outputs.jsonl so the
eval pipeline runs instantly and reproducibly.

The interface deliberately mirrors what a real system would expose:

    output = system.run(case_id, input)

Engineers writing the eval pipeline call this exactly as they would a real
LLM-backed system. The only quirk: we pass case_id alongside input so the
cache lookup is unambiguous. In a real system, case_id wouldn't exist —
the function would just take input and call the model.

To regenerate the cache against a real LLM, write a small script that loops
over the dataset, calls the model with a basic prompt, and writes the
outputs back to outputs.jsonl. Left as a post-workshop exercise.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import TypedDict


class SystemInput(TypedDict):
    message: str
    order_context: str | None


class SystemOutput(TypedDict):
    intent: str
    urgency: int
    should_escalate: bool
    reply: str


# Cache lives in the repo's data/ directory.
CACHE_PATH = Path(__file__).parent.parent / "data" / "outputs.jsonl"

_cache: dict[str, SystemOutput] = {}
_cache_loaded = False


def _load_cache() -> None:
    global _cache_loaded
    if _cache_loaded:
        return
    if not CACHE_PATH.exists():
        raise FileNotFoundError(
            f"Cache file not found at {CACHE_PATH}. "
            f"Set CACHE_PATH to the location of outputs.jsonl."
        )
    with CACHE_PATH.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            entry = json.loads(line)
            _cache[entry["id"]] = entry["output"]
    _cache_loaded = True


def run(case_id: str, input: SystemInput) -> SystemOutput:
    """Run the (simulated) system on a given input.

    Returns the structured output a real LLM would produce. For the workshop,
    this is a cached lookup keyed by case_id; the `input` argument is accepted
    for interface symmetry with a real system but isn't used here.
    """
    _load_cache()
    if case_id not in _cache:
        raise KeyError(f"No cached output for case_id={case_id!r}")
    return _cache[case_id]
