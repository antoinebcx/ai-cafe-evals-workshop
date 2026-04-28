/**
 * Naive customer support system — workshop simulation.
 *
 * In production, this module would call an LLM API to generate a structured
 * response (intent, urgency, should_escalate, reply) given a customer message.
 * For the workshop, we read pre-cached outputs from data/outputs.jsonl so the
 * eval pipeline runs instantly and reproducibly.
 *
 * The interface deliberately mirrors what a real system would expose:
 *
 *     const output = run(caseId, input);
 *
 * Engineers writing the eval pipeline call this exactly as they would a real
 * LLM-backed system. The only quirk: we pass caseId alongside input so the
 * cache lookup is unambiguous. In a real system, caseId wouldn't exist —
 * the function would just take input and call the model.
 *
 * To regenerate the cache against a real LLM, write a small script that loops
 * over the dataset, calls the model with a basic prompt, and writes the
 * outputs back to outputs.jsonl. Left as a post-workshop exercise.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface SystemInput {
  message: string;
  order_context: string | null;
}

export interface SystemOutput {
  intent: string;
  urgency: number;
  should_escalate: boolean;
  reply: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Cache lives in the repo's data/ directory.
export const CACHE_PATH = join(__dirname, "..", "data", "outputs.jsonl");

let cache: Record<string, SystemOutput> | null = null;

function loadCache(): Record<string, SystemOutput> {
  if (cache !== null) return cache;
  if (!existsSync(CACHE_PATH)) {
    throw new Error(
      `Cache file not found at ${CACHE_PATH}. ` +
        `Update CACHE_PATH to the location of outputs.jsonl.`,
    );
  }
  const next: Record<string, SystemOutput> = {};
  const content = readFileSync(CACHE_PATH, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const entry = JSON.parse(trimmed) as { id: string; output: SystemOutput };
    next[entry.id] = entry.output;
  }
  cache = next;
  return cache;
}

/**
 * Run the (simulated) system on a given input.
 *
 * Returns the structured output a real LLM would produce. For the workshop,
 * this is a cached lookup keyed by caseId; the `input` argument is accepted
 * for interface symmetry with a real system but isn't used here.
 */
export function run(caseId: string, _input: SystemInput): SystemOutput {
  const c = loadCache();
  const output = c[caseId];
  if (!output) {
    throw new Error(`No cached output for caseId=${caseId}`);
  }
  return output;
}
