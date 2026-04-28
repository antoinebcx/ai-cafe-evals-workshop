/**
 * Eval pipeline — workshop designs the metrics.
 *
 * Provided (don't touch):
 * - Dataset loading
 * - Running the system on each case
 * - Aggregation, pass rate per tag, failure report
 *
 * Your job:
 * - Inspect the dataset and the system outputs
 * - Pick which dimensions to grade
 * - Design a metric for each — deterministic check, LLM judge, or both
 * - Add them to METRICS
 *
 * A metric is just (case, output) -> string[] (or Promise<string[]>).
 * Empty array = pass. Each string is a failure reason in the report.
 *
 * For judge-based metrics, import callJudge from judge.ts — the API call is
 * done. You design the prompt, the rubric, the scale, the threshold.
 *
 * Run: npx tsx eval.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { run as runSystem, SystemOutput } from "./system.js";
// import { callJudge } from "./judge.js";   // uncomment when you build judge metrics

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATASET_PATH = join(__dirname, "..", "data", "dataset.jsonl");
const RUNS_DIR = join(__dirname, "..", "runs");

export interface Case {
  id: string;
  input: { message: string; order_context: string | null };
  expected: {
    intent: string;
    urgency_range: [number, number];
    should_escalate: boolean;
    reply_must_mention: string[];
    reply_must_not_mention: string[];
    tone?: string;
    notes?: string;
  };
  tags?: string[];
}

type Failures = string[];
type Metric = (c: Case, output: SystemOutput) => Failures | Promise<Failures>;


// ---- Loading ----

function loadDataset(): Case[] {
  return readFileSync(DATASET_PATH, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Case);
}


// ---- Worked example (structural) ----

function metricSchemaValid(c: Case, output: SystemOutput): Failures {
  const required = ["intent", "urgency", "should_escalate", "reply"] as const;
  const missing = required.filter((k) => !(k in output));
  if (missing.length > 0) return [`schema: missing fields ${JSON.stringify(missing)}`];
  if (typeof output.urgency !== "number" || !Number.isInteger(output.urgency)) {
    return [`schema: urgency is not an int (${output.urgency})`];
  }
  return [];
}


// ---- Aspects worth grading (pick 3-5, mix types) ----
//
// Structural        — does the output have the right shape, types, ranges?
// Classification    — is the predicted label / category right?
// Factual grounding — does the reply contradict the order_context?
// Coverage          — does the reply mention what it should?
// Safety            — does the reply leak forbidden content, comply with
//                     injections, or help with harmful asks?
// Tone              — does the reply match the situation (sarcasm, distress,
//                     positive feedback all need different registers)?
// Routing           — does the system escalate when it should?
// Operational       — latency, length, cost (latency_ms is in outputs.jsonl)
//
// For each aspect you pick: deterministic (equality, range, substring, regex)
// or judge-based? Cases worth opening to calibrate your thinking:
// 011, 012, 023, 025, 032, 035, 040.
//
// Judge metrics: import callJudge from judge.ts — the API call is done.
// You design the prompt: rubric, scale, what context to pass, threshold.


const METRICS: Metric[] = [
  metricSchemaValid,
  // ... your metrics here
];


// ---- Pipeline ----

interface CaseResult {
  caseId: string;
  tags: string[];
  output: SystemOutput;
  failures: Failures;
}

async function evaluateCase(c: Case): Promise<CaseResult> {
  const output = runSystem(c.id, c.input);
  const failures: Failures = [];
  for (const metric of METRICS) {
    failures.push(...(await metric(c, output)));
  }
  return { caseId: c.id, tags: c.tags ?? [], output, failures };
}

function printReport(results: CaseResult[]): void {
  const n = results.length;
  if (n === 0) {
    console.log("No cases.");
    return;
  }
  const nPass = results.filter((r) => r.failures.length === 0).length;
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Pass: ${nPass}/${n}  (${Math.round((nPass / n) * 100)}%)`);
  console.log(`Fail: ${n - nPass}/${n}  (${Math.round(((n - nPass) / n) * 100)}%)`);

  const byTag = new Map<string, [number, number]>();
  for (const r of results) {
    for (const tag of r.tags) {
      const cur = byTag.get(tag) ?? [0, 0];
      cur[1] += 1;
      if (r.failures.length === 0) cur[0] += 1;
      byTag.set(tag, cur);
    }
  }
  if (byTag.size > 0) {
    console.log("\nPass rate by tag:");
    const sorted = [...byTag.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [tag, [passed, total]] of sorted) {
      const pct = total ? Math.round((passed / total) * 100) : 0;
      console.log(`  ${tag.padEnd(25)} ${passed}/${total} (${pct}%)`);
    }
  }

  const fails = results.filter((r) => r.failures.length > 0);
  if (fails.length > 0) {
    console.log(`\nFailures (${fails.length}):`);
    for (const r of fails) {
      console.log(`  ${r.caseId}  [${r.tags.join(", ")}]`);
      for (const f of r.failures) console.log(`    - ${f}`);
    }
  }
}

function writeMarkdownReport(results: CaseResult[]): string {
  const n = results.length;
  const nPass = results.filter((r) => r.failures.length === 0).length;
  const now = new Date();
  const pad = (x: number) => String(x).padStart(2, "0");
  const ts =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  mkdirSync(RUNS_DIR, { recursive: true });
  const path = join(RUNS_DIR, `run-${ts}.md`);

  const lines: string[] = [];
  lines.push(`# Eval run — ${ts}`);
  lines.push("");
  lines.push(`**Pass:** ${nPass}/${n} (${Math.round((nPass / n) * 100)}%)  `);
  lines.push(`**Fail:** ${n - nPass}/${n} (${Math.round(((n - nPass) / n) * 100)}%)`);
  lines.push("");

  const byTag = new Map<string, [number, number]>();
  for (const r of results) {
    for (const tag of r.tags) {
      const cur = byTag.get(tag) ?? [0, 0];
      cur[1] += 1;
      if (r.failures.length === 0) cur[0] += 1;
      byTag.set(tag, cur);
    }
  }
  if (byTag.size > 0) {
    lines.push("## Pass rate by tag");
    lines.push("");
    lines.push("| Tag | Pass | Total | % |");
    lines.push("|---|---|---|---|");
    const sorted = [...byTag.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [tag, [passed, total]] of sorted) {
      const pct = total ? Math.round((passed / total) * 100) : 0;
      lines.push(`| ${tag} | ${passed} | ${total} | ${pct}% |`);
    }
    lines.push("");
  }

  const fails = results.filter((r) => r.failures.length > 0);
  if (fails.length > 0) {
    lines.push(`## Failures (${fails.length})`);
    lines.push("");
    for (const r of fails) {
      const tags = r.tags.length > 0 ? r.tags.join(", ") : "—";
      lines.push(`### ${r.caseId} _[${tags}]_`);
      for (const f of r.failures) lines.push(`- ${f}`);
      lines.push("");
    }
  }

  writeFileSync(path, lines.join("\n"));
  return path;
}

// Cases run in parallel — judge calls dominate runtime, so this turns a
// 30s+ sequential run into a few seconds. Metrics stay simple: write a
// regular per-case function (sync or async) and the pool handles fan-out
// for you. Lower this if you hit OpenAI rate limits.
const MAX_PARALLEL_CASES = 20;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

async function main(): Promise<void> {
  const cases = loadDataset();
  const results = await mapWithConcurrency(cases, MAX_PARALLEL_CASES, evaluateCase);
  printReport(results);
  const reportPath = writeMarkdownReport(results);
  console.log(`\nReport written to ${relative(process.cwd(), reportPath)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
