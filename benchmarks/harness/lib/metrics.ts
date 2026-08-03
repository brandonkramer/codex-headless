import {
  consumeJsonlLine,
  createJsonlParseState,
  parseJsonl,
  type JsonlParseState,
} from "../../../src/jsonl.ts";
import type { RunCodexResult } from "../../../src/run-codex.ts";
import type { TrialMetrics } from "./types.ts";

const TOOL_ITEM_TYPES = new Set([
  "command_execution",
  "mcp_tool_call",
  "web_search",
  "file_change",
]);

export interface LiveRunCounters {
  spawnCount: number;
  firstEventAt?: number;
  firstAgentMessageAt?: number;
}

export function createLiveRunCounters(): LiveRunCounters {
  return { spawnCount: 0 };
}

/** Count tool-like items and provider turns from parsed JSONL events. */
export function countJsonlActivity(jsonl: string): {
  toolCallCount: number;
  providerTurnCount: number;
} {
  const parsed = parseJsonl(jsonl);
  let toolCallCount = 0;
  let providerTurnCount = 0;

  for (const ev of parsed.events) {
    if (ev.kind === "turn.started" || ev.kind === "turn.completed" || ev.kind === "turn.failed") {
      providerTurnCount += 1;
    }
    if (ev.kind === "item.completed" && ev.summary) {
      if (
        ev.summary.startsWith("command_execution") ||
        ev.summary.startsWith("mcp_tool_call") ||
        ev.summary.startsWith("file_change")
      ) {
        toolCallCount += 1;
      }
    }
  }

  return { toolCallCount, providerTurnCount };
}

export function trackJsonlLine(
  line: string,
  state: JsonlParseState,
  startedAt: number,
  counters: LiveRunCounters,
): void {
  const beforeEvents = state.events.length;
  consumeJsonlLine(line, state);
  if (state.events.length > beforeEvents && counters.firstEventAt === undefined) {
    counters.firstEventAt = Date.now() - startedAt;
  }
  const ev = state.events[state.events.length - 1];
  if (
    ev?.kind === "item.completed" &&
    ev.summary === "agent_message" &&
    counters.firstAgentMessageAt === undefined
  ) {
    counters.firstAgentMessageAt = Date.now() - startedAt;
  }
}

export function metricsFromRun(
  result: RunCodexResult,
  wallMs: number,
  counters: LiveRunCounters,
  jsonlText?: string,
  quality?: { score: number; notes: string[] },
): TrialMetrics {
  const jsonl = jsonlText ?? "";
  const activity = jsonl ? countJsonlActivity(jsonl) : { toolCallCount: 0, providerTurnCount: 0 };
  const usage = result.usage;

  return {
    wallMs,
    timeToFirstEventMs: counters.firstEventAt,
    timeToFirstAgentMessageMs: counters.firstAgentMessageAt,
    spawnCount: counters.spawnCount,
    toolCallCount: activity.toolCallCount,
    providerTurnCount: activity.providerTurnCount,
    inputTokens: usage?.input_tokens ?? 0,
    cachedInputTokens: usage?.cached_input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    reasoningOutputTokens: usage?.reasoning_output_tokens ?? 0,
    ok: result.ok,
    exitCode: result.exitCode,
    turnError: result.turnError,
    threadId: result.threadId,
    qualityScore: quality?.score,
    qualityNotes: quality?.notes,
  };
}

/**
 * Snapshot counters for one run. Required when the same LiveRunCounters object
 * is reused across turns — otherwise mergeTrialMetrics would double-count spawns.
 */
export function metricsFromRunSnapshot(
  result: RunCodexResult,
  wallMs: number,
  counters: LiveRunCounters,
  spawnCount: number,
  jsonlText?: string,
  quality?: { score: number; notes: string[] },
): TrialMetrics {
  const m = metricsFromRun(result, wallMs, counters, jsonlText, quality);
  m.spawnCount = spawnCount;
  return m;
}

export function mergeTrialMetrics(parts: TrialMetrics[]): TrialMetrics {
  const base = parts[0];
  if (!base) {
    return {
      wallMs: 0,
      spawnCount: 0,
      toolCallCount: 0,
      providerTurnCount: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      ok: false,
      exitCode: 1,
    };
  }

  return parts.slice(1).reduce(
    (acc, p) => ({
      wallMs: acc.wallMs + p.wallMs,
      timeToFirstEventMs: Math.min(acc.timeToFirstEventMs ?? p.wallMs, p.timeToFirstEventMs ?? p.wallMs),
      timeToFirstAgentMessageMs: Math.min(
        acc.timeToFirstAgentMessageMs ?? p.wallMs,
        p.timeToFirstAgentMessageMs ?? p.wallMs,
      ),
      spawnCount: acc.spawnCount + p.spawnCount,
      toolCallCount: acc.toolCallCount + p.toolCallCount,
      providerTurnCount: acc.providerTurnCount + p.providerTurnCount,
      inputTokens: acc.inputTokens + p.inputTokens,
      cachedInputTokens: acc.cachedInputTokens + p.cachedInputTokens,
      outputTokens: acc.outputTokens + p.outputTokens,
      reasoningOutputTokens: acc.reasoningOutputTokens + p.reasoningOutputTokens,
      ok: acc.ok && p.ok,
      exitCode: acc.ok && p.ok ? 0 : p.exitCode || acc.exitCode,
      turnError: acc.turnError ?? p.turnError,
      threadId: p.threadId ?? acc.threadId,
      qualityScore:
        acc.qualityScore !== undefined && p.qualityScore !== undefined
          ? (acc.qualityScore + p.qualityScore) / 2
          : acc.qualityScore ?? p.qualityScore,
      qualityNotes: [...(acc.qualityNotes ?? []), ...(p.qualityNotes ?? [])],
    }),
    { ...base },
  );
}

export function countToolTypesInJsonl(jsonl: string): number {
  let count = 0;
  for (const line of jsonl.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line) as { type?: string; item?: { type?: string } };
      if (obj.type === "item.completed" && obj.item?.type && TOOL_ITEM_TYPES.has(obj.item.type)) {
        count += 1;
      }
    } catch {
      // ignore
    }
  }
  return count;
}
