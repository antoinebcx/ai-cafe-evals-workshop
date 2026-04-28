"""
LLM judge primitive — fully implemented OpenAI Responses API call.

Use it from eval.py to build judge-based metrics:

    from judge import call_judge
    result = call_judge("...your prompt...")
    # result == {"reasoning": "...", "score": 1..4}

What you design (in eval.py):
- The prompt: rubric, scale meanings, how much context to include, whether
  reasoning comes before or after the score
- The threshold: at what score is a case a fail?
- Whether to use one judge for many dimensions or a separate judge per dimension

Tips for a useful judge prompt:
- Specific rubric beats vague ("empathetic, NOT cheerful" beats "good tone")
- Small integer scale (1-4 or 1-5) beats continuous floats
- Ask for reasoning BEFORE the score so the model thinks before committing
- Include the full input + the reply + the rubric — leaving any out makes the judge guess
- Calibrate against ~10 hand-graded examples before trusting it at scale

Setup:
    pip install openai
    export OPENAI_API_KEY=sk-...
"""

from __future__ import annotations

import json
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

# Load OPENAI_API_KEY from the repo-root .env if present
load_dotenv(Path(__file__).parent.parent / ".env")

JUDGE_MODEL = "gpt-4o-mini"

_SCORE_SCHEMA = {
    "type": "object",
    "properties": {
        "reasoning": {"type": "string"},
        "score": {"type": "integer", "minimum": 1, "maximum": 4},
    },
    "required": ["reasoning", "score"],
    "additionalProperties": False,
}

_client: OpenAI | None = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI()
    return _client


def call_judge(prompt: str) -> dict:
    """Run the judge prompt through the Responses API with a fixed schema.

    Returns: {"reasoning": str, "score": int in 1..4}
    """
    response = _get_client().responses.create(
        model=JUDGE_MODEL,
        input=prompt,
        text={
            "format": {
                "type": "json_schema",
                "name": "judgment",
                "schema": _SCORE_SCHEMA,
                "strict": True,
            }
        },
    )
    return json.loads(response.output_text)


if __name__ == "__main__":
    # Smoke test — replace with whatever you're designing
    sample = call_judge(
        "Rate this customer support reply 1-4 (1 worst, 4 best). "
        "Reason first, then score.\n\n"
        "Customer: 'Wow, another wonderful delivery delay.'\n"
        "Reply: 'Glad to help! Have a great day!'"
    )
    print(json.dumps(sample, indent=2))
