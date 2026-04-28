/**
 * LLM judge primitive — fully implemented OpenAI Responses API call.
 *
 * Use it from eval.ts to build judge-based metrics:
 *
 *     import { callJudge } from "./judge.js";
 *     const result = await callJudge("...your prompt...");
 *     // result == { reasoning: "...", score: 1..4 }
 *
 * What you design (in eval.ts):
 * - The prompt: rubric, scale meanings, how much context to include, whether
 *   reasoning comes before or after the score
 * - The threshold: at what score is a case a fail?
 * - Whether to use one judge for many dimensions or a separate judge per dimension
 *
 * Tips for a useful judge prompt:
 * - Specific rubric beats vague ("empathetic, NOT cheerful" beats "good tone")
 * - Small integer scale (1-4 or 1-5) beats continuous floats
 * - Ask for reasoning BEFORE the score so the model thinks before committing
 * - Include the full input + the reply + the rubric — leaving any out makes the judge guess
 * - Calibrate against ~10 hand-graded examples before trusting it at scale
 *
 * Setup:
 *     npm install openai
 *     export OPENAI_API_KEY=sk-...
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import OpenAI from "openai";

// Load OPENAI_API_KEY from the repo-root .env if present
loadEnv({ path: join(dirname(fileURLToPath(import.meta.url)), "..", ".env") });

const JUDGE_MODEL = "gpt-4o-mini";

const SCORE_SCHEMA = {
  type: "object",
  properties: {
    reasoning: { type: "string" },
    score: { type: "integer", minimum: 1, maximum: 4 },
  },
  required: ["reasoning", "score"],
  additionalProperties: false,
} as const;

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (client === null) client = new OpenAI();
  return client;
}

export interface JudgeResult {
  reasoning: string;
  score: number;
}

export async function callJudge(prompt: string): Promise<JudgeResult> {
  const response = await getClient().responses.create({
    model: JUDGE_MODEL,
    input: prompt,
    text: {
      format: {
        type: "json_schema",
        name: "judgment",
        schema: SCORE_SCHEMA,
        strict: true,
      },
    },
  });
  return JSON.parse(response.output_text) as JudgeResult;
}


// Smoke test — replace with whatever you're designing
if (import.meta.url === `file://${process.argv[1]}`) {
  callJudge(
    "Rate this customer support reply 1-4 (1 worst, 4 best). " +
      "Reason first, then score.\n\n" +
      "Customer: 'Wow, another wonderful delivery delay.'\n" +
      "Reply: 'Glad to help! Have a great day!'",
  ).then((r) => console.log(JSON.stringify(r, null, 2)));
}
