import { join } from "node:path";
import { REPO_ROOT } from "./structural.ts";

/** Pinned read-only analysis target (no workspace mutation). */
export const WORKLOAD_FILE = "src/jsonl.ts";

export const WORKLOAD_CWD = REPO_ROOT;

export function probeTurn1Prompt(): string {
  return `Read-only probe benchmark turn 1.

Open ${WORKLOAD_FILE} only. Do NOT edit any files. Do NOT run destructive commands.

Task: List exported function names and one-line purpose for each.

Reply in plain text, max 400 words. Stop after answering.`;
}

export function probeTurn2Prompt(): string {
  return probeTurn2PromptV1();
}

/** v1 turn-2 (context-asymmetric; kept for protocol=v1 only). */
export function probeTurn2PromptV1(): string {
  return `Read-only probe benchmark turn 2 (follow-up).

Using your prior context about ${WORKLOAD_FILE}, answer without re-reading the whole repo:

What JSONL event kinds does consumeJsonlLine handle? List them.

Do NOT edit files. Plain text, max 200 words.`;
}

/** Canonical turn-2 question shared by claim-1 v2 arms. */
export const CLAIM1_TURN2_EVENT_KINDS = [
  "thread.started",
  "turn.started",
  "turn.completed",
  "turn.failed",
  "item.started",
  "item.completed",
  "error",
] as const;

export const CLAIM1_TURN2_MIN_KIND_HITS = 3;

/** v2 control: self-contained; may re-read file; no fake prior context. */
export function probeTurn2PromptV2Control(): string {
  return `Read-only probe benchmark turn 2 (standalone ephemeral).

You have no prior thread. Open ${WORKLOAD_FILE} only if needed.

Question: What JSONL event kinds does consumeJsonlLine handle? List the kind strings.

Do NOT edit files. Plain text, max 200 words. Stop after answering.`;
}

/** v2 treatment: resume follow-up; same question; prefer thread context. */
export function probeTurn2PromptV2Treatment(): string {
  return `Read-only probe benchmark turn 2 (resume follow-up).

Using your prior thread context about ${WORKLOAD_FILE}, answer the same question.
Prefer not re-reading the whole file; skim only if needed.

Question: What JSONL event kinds does consumeJsonlLine handle? List the kind strings.

Do NOT edit files. Plain text, max 200 words. Stop after answering.`;
}

/** Content rubric for claim-1 turn-2 (v2). */
export function scoreClaim1Turn2Quality(content: string): { score: number; notes: string[]; hits: string[] } {
  const lower = content.toLowerCase();
  const hits = CLAIM1_TURN2_EVENT_KINDS.filter((k) => lower.includes(k.toLowerCase()));
  const score = hits.length / CLAIM1_TURN2_EVENT_KINDS.length;
  const notes: string[] = [];
  if (hits.length < CLAIM1_TURN2_MIN_KIND_HITS) {
    notes.push(
      `turn2 rubric: named ${hits.length}/${CLAIM1_TURN2_EVENT_KINDS.length} kinds (need ≥${CLAIM1_TURN2_MIN_KIND_HITS})`,
    );
  }
  return { score, notes, hits: [...hits] };
}

export function independentLensPrompt(lensId: string, focus: string): string {
  return `Read-only review lens (${lensId}) — INDEPENDENT rediscovery arm.

You may use read-only tools to inspect ${WORKLOAD_FILE} and directly imported local modules only.
Do NOT edit files.

Lens focus: ${focus}

Return JSON:
{"lens":"${lensId}","verdict":"pass|pass-with-notes|fail|inconclusive","findings":[]}`;
}

export function looseAnalysisPrompt(): string {
  return (
    `Read ${WORKLOAD_FILE} and summarize its exports and invariants. ` +
    `Run pnpm run typecheck if helpful. Read-only; do not edit files. ` +
    `Reply as JSON: {"exports":["..."],"invariants":["..."],"notes":"..."}`
  );
}

export function structuredAnalysisBrief() {
  return {
    change:
      `Summarize exported functions and parsing invariants in ${WORKLOAD_FILE}. Read-only.`,
    files: [WORKLOAD_FILE],
    checks: ["pnpm run typecheck"],
    maxTurns: 6,
    maxToolCalls: 8,
  };
}

export function syntheticEvidenceSections(): { diff: string; context: string; tests: string } {
  const samplePath = join(WORKLOAD_CWD, WORKLOAD_FILE);
  return {
    diff: `# read-only snapshot\n--- a/${WORKLOAD_FILE}\n+++ b/${WORKLOAD_FILE}\n@@\n+// benchmark fixture`,
    context: `File under test: ${samplePath}. Exports parseJsonl, consumeJsonlLine, formatUsageLine.`,
    tests: "not run (benchmark packet fixture)",
  };
}

export const LENS_SUBSET = [
  {
    id: "correctness",
    title: "Correctness",
    focus: "logic bugs, edge cases, error handling",
  },
  {
    id: "security",
    title: "Security",
    focus: "injection, unsafe parsing, trust boundaries",
  },
] as const;

export const COOLDOWN_MS = 2000;

export const MAX_WALL_MS = 180_000;
