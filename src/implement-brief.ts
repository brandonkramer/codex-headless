/**
 * Implementation-ready worker brief: typed contract, prompt preamble, budgets,
 * and post-run write-scope validation. Suitable for MCP wiring (see module exports).
 *
 * Budget semantics:
 * - `timeoutMs` → enforceable by the headless wrapper via `runCodexExec({ maxWallMs })`.
 * - `maxTurns` / `maxToolCalls` → advisory only (included in prompt; Codex exec does not cap them).
 */

import { z } from "zod";

/** Input caps — values above these are clamped; arrays are truncated. */
export const BRIEF_LIMITS = {
  maxChangeChars: 12_000,
  maxFileEntries: 32,
  maxCheckEntries: 16,
  maxWriteScopeEntries: 64,
  maxEntryChars: 512,
  maxTurnsCap: 50,
  maxToolCallsCap: 200,
  defaultMaxTurns: 12,
  defaultMaxToolCalls: 40,
  minTimeoutMs: 30_000,
  maxTimeoutMs: 3_600_000,
  /** 0 = no wrapper wall timeout (quiet-hang kill still applies separately). */
  defaultTimeoutMs: 0,
} as const;

export interface ImplementBriefInput {
  /** What to implement or change (required). */
  change: string;
  /** Paths to open first; smallest edit from here. */
  files?: string[];
  /** Focused verification commands to run before stopping. */
  checks?: string[];
  /** Allowed write paths; default = `files` when omitted. */
  writeScope?: string[];
  /** Advisory turn budget (prompt only). */
  maxTurns?: number;
  /** Advisory tool-call budget (prompt only). */
  maxToolCalls?: number;
  /** Wrapper wall-clock timeout in ms (`maxWallMs`); 0 disables wall kill. */
  timeoutMs?: number;
}

export interface BriefBudgets {
  enforceable: {
    /** Maps to `runCodexExec({ maxWallMs: timeoutMs })` when > 0. */
    timeoutMs: number;
  };
  advisory: {
    /** Prompt-only; not enforced by the wrapper. */
    maxTurns: number;
    /** Prompt-only; not enforced by the wrapper. */
    maxToolCalls: number;
  };
}

export interface ResolvedImplementBrief {
  change: string;
  files: string[];
  checks: string[];
  writeScope: string[];
  maxTurns: number;
  maxToolCalls: number;
  timeoutMs: number;
  budgets: BriefBudgets;
}

export interface WriteScopeValidation {
  withinScope: boolean;
  violations: string[];
  allowed: readonly string[];
  changed: readonly string[];
}

export class BriefValidationError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = "BriefValidationError";
    this.field = field;
  }
}

const pathEntrySchema = z
  .string()
  .trim()
  .min(1, "path must be non-empty")
  .max(BRIEF_LIMITS.maxEntryChars);

const rawBriefSchema = z.object({
  change: z.string().trim().min(1, "change is required"),
  files: z.array(pathEntrySchema).optional(),
  checks: z.array(z.string().trim().min(1).max(BRIEF_LIMITS.maxEntryChars)).optional(),
  writeScope: z.array(pathEntrySchema).optional(),
  maxTurns: z.number().finite().optional(),
  maxToolCalls: z.number().finite().optional(),
  timeoutMs: z.number().finite().optional(),
});

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function truncateList<T>(items: T[] | undefined, max: number): T[] {
  if (!items?.length) return [];
  return items.slice(0, max);
}

function truncateChange(change: string): string {
  if (change.length <= BRIEF_LIMITS.maxChangeChars) return change;
  return `${change.slice(0, BRIEF_LIMITS.maxChangeChars)}…[truncated]`;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+/g, "/");
}

function dedupePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    const n = normalizePath(p);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function resolveTimeoutMs(raw: number | undefined): number {
  if (raw === undefined || raw === 0) return BRIEF_LIMITS.defaultTimeoutMs;
  if (raw < 0 || !Number.isFinite(raw)) {
    throw new BriefValidationError("timeoutMs", "timeoutMs must be a non-negative finite number");
  }
  const ms = Math.floor(raw);
  if (ms > 0 && ms < BRIEF_LIMITS.minTimeoutMs) {
    throw new BriefValidationError(
      "timeoutMs",
      `timeoutMs must be 0 (disabled) or >= ${BRIEF_LIMITS.minTimeoutMs}`,
    );
  }
  if (ms > BRIEF_LIMITS.maxTimeoutMs) {
    return BRIEF_LIMITS.maxTimeoutMs;
  }
  return ms;
}

function resolveAdvisoryTurns(raw: number | undefined): number {
  if (raw === undefined) return BRIEF_LIMITS.defaultMaxTurns;
  if (raw < 1 || !Number.isFinite(raw)) {
    throw new BriefValidationError("maxTurns", "maxTurns must be a finite integer >= 1");
  }
  return clampInt(raw, 1, BRIEF_LIMITS.maxTurnsCap);
}

function resolveAdvisoryToolCalls(raw: number | undefined): number {
  if (raw === undefined) return BRIEF_LIMITS.defaultMaxToolCalls;
  if (raw < 1 || !Number.isFinite(raw)) {
    throw new BriefValidationError("maxToolCalls", "maxToolCalls must be a finite integer >= 1");
  }
  return clampInt(raw, 1, BRIEF_LIMITS.maxToolCallsCap);
}

/**
 * Validate, cap, and normalize a brief. Throws {@link BriefValidationError} on invalid input.
 */
export function parseImplementBrief(input: unknown): ResolvedImplementBrief {
  const parsed = rawBriefSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join(".") || "brief";
    throw new BriefValidationError(field, issue?.message ?? "invalid brief");
  }

  const raw = parsed.data;
  const files = dedupePaths(truncateList(raw.files, BRIEF_LIMITS.maxFileEntries));
  const checks = truncateList(
    raw.checks?.map((c) => c.trim()).filter(Boolean),
    BRIEF_LIMITS.maxCheckEntries,
  );
  const writeScope = dedupePaths(
    truncateList(raw.writeScope ?? files, BRIEF_LIMITS.maxWriteScopeEntries),
  );

  if (writeScope.length === 0) {
    throw new BriefValidationError(
      "writeScope",
      "writeScope is empty; provide writeScope or at least one file",
    );
  }

  const timeoutMs = resolveTimeoutMs(raw.timeoutMs);
  const maxTurns = resolveAdvisoryTurns(raw.maxTurns);
  const maxToolCalls = resolveAdvisoryToolCalls(raw.maxToolCalls);

  return {
    change: truncateChange(raw.change),
    files,
    checks,
    writeScope,
    maxTurns,
    maxToolCalls,
    timeoutMs,
    budgets: {
      enforceable: { timeoutMs },
      advisory: { maxTurns, maxToolCalls },
    },
  };
}

function formatList(label: string, items: readonly string[]): string {
  if (!items.length) return `${label}: (none)`;
  return `${label}:\n${items.map((i) => `  - ${i}`).join("\n")}`;
}

/**
 * Compact deterministic preamble prepended to the worker prompt.
 */
export function assembleBriefPreamble(brief: ResolvedImplementBrief): string {
  const timeoutLine =
    brief.timeoutMs > 0
      ? `Wrapper wall timeout: ${brief.timeoutMs}ms (enforceable — run killed at limit).`
      : "Wrapper wall timeout: none (quiet-hang kill may still apply).";

  const advisoryLine =
    `Advisory budgets (prompt only — not enforced by wrapper): ` +
    `~${brief.maxTurns} turns, ~${brief.maxToolCalls} tool calls.`;

  const lines = [
    "IMPLEMENTATION BRIEF (bounded worker)",
    "",
    formatList("Start files", brief.files),
    formatList("Write scope", brief.writeScope),
    formatList("Checks", brief.checks),
    "",
    timeoutLine,
    advisoryLine,
    "",
    "Rules:",
    "1. Open start files first; smallest change that satisfies the task.",
    "2. Broaden scope ONLY on direct evidence from those files (imports, types, callers).",
    "3. No repo-wide search or discovery unless a start file requires it.",
    "4. Do NOT write outside write scope.",
    "5. Run listed checks before finishing; stop when change and checks pass.",
    "6. Stop when done; no unrelated refactors.",
    "",
    "Change:",
    brief.change,
  ];

  return lines.join("\n");
}

/** Full implement prompt: preamble plus optional orchestrator context. */
export function assembleImplementPrompt(
  brief: ResolvedImplementBrief,
  extraContext?: string,
): string {
  const preamble = assembleBriefPreamble(brief);
  const extra = extraContext?.trim();
  if (!extra) return preamble;
  return `${preamble}\n\nAdditional context:\n${extra}`;
}

/** Whether a changed path is allowed by at least one write-scope entry. */
export function pathMatchesWriteScope(changedPath: string, scopeEntry: string): boolean {
  const changed = normalizePath(changedPath);
  const scope = normalizePath(scopeEntry);
  if (!changed || !scope) return false;
  if (changed === scope) return true;

  if (scope.endsWith("/**")) {
    const prefix = scope.slice(0, -3);
    return changed === prefix || changed.startsWith(`${prefix}/`);
  }
  if (scope.endsWith("/*")) {
    const dir = scope.slice(0, -2);
    const changedDir = changed.includes("/") ? changed.slice(0, changed.lastIndexOf("/")) : "";
    return changedDir === dir;
  }
  if (scope.endsWith("/")) {
    const prefix = scope.slice(0, -1);
    return changed === prefix || changed.startsWith(`${scope}`);
  }
  return changed.startsWith(`${scope}/`);
}

/**
 * Post-run write-scope check. Compare caller-supplied changed paths (from git status,
 * implement-report.changed_files, etc.) against the brief write scope. Does not mutate disk.
 */
export function validateWriteScope(
  changedFiles: readonly string[],
  writeScope: readonly string[],
): WriteScopeValidation {
  const changed = dedupePaths(changedFiles);
  const allowed = dedupePaths(writeScope);
  const violations: string[] = [];

  for (const file of changed) {
    const ok = allowed.some((scope) => pathMatchesWriteScope(file, scope));
    if (!ok) violations.push(file);
  }

  return {
    withinScope: violations.length === 0,
    violations,
    allowed,
    changed,
  };
}

/** Zod shape for future MCP `brief` object wiring. */
export const implementBriefInputSchema = rawBriefSchema;
