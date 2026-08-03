import type { ChildProcessWithoutNullStreams } from "node:child_process";
import spawn from "cross-spawn";
import { readFile } from "node:fs/promises";
import { createJsonlParseState } from "../../../../src/jsonl.ts";
import { runCodexExec, type RunCodexOptions, type RunCodexResult } from "../../../../src/run-codex.ts";
import {
  createLiveRunCounters,
  metricsFromRun,
  trackJsonlLine,
  type LiveRunCounters,
} from "../metrics.ts";
import { MAX_WALL_MS, WORKLOAD_CWD } from "../workloads.ts";

function defaultSpawn(
  args: string[],
  cwd: string,
): ChildProcessWithoutNullStreams {
  return spawn("codex", args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;
}

export interface InstrumentedRunResult {
  result: RunCodexResult;
  wallMs: number;
  counters: LiveRunCounters;
  jsonlText: string;
}

export async function instrumentedExec(
  opts: RunCodexOptions,
  counters?: LiveRunCounters,
): Promise<InstrumentedRunResult> {
  const c = counters ?? createLiveRunCounters();
  const startedAt = Date.now();
  const parseState = createJsonlParseState();
  let capturedJsonl = "";

  const result = await runCodexExec({
    ...opts,
    cwd: opts.cwd ?? WORKLOAD_CWD,
    profile: opts.profile ?? "probe",
    json: opts.json !== false,
    heartbeatMs: 0,
    maxWallMs: opts.maxWallMs ?? MAX_WALL_MS,
    spawnCodex: (args, cwd) => {
      c.spawnCount += 1;
      return (opts.spawnCodex ?? defaultSpawn)(args, cwd);
    },
    onProgress: (line) => {
      if (line.startsWith("[codex-headless] usage") || line.startsWith("[codex-headless] done")) {
        process.stderr.write(`${line}\n`);
      }
    },
    jsonlPath: undefined,
  });

  if (result.jsonlPath) {
    capturedJsonl = await readFile(result.jsonlPath, "utf8").catch(() => "");
    for (const line of capturedJsonl.split(/\r?\n/)) {
      if (line.trim()) trackJsonlLine(line, parseState, startedAt, c);
    }
  }

  return {
    result,
    wallMs: Date.now() - startedAt,
    counters: c,
    jsonlText: capturedJsonl,
  };
}

export function scoreJsonQuality(content: string, requiredKeys: string[]): { score: number; notes: string[] } {
  const notes: string[] = [];
  try {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start < 0 || end <= start) {
      notes.push("no JSON object found");
      return { score: 0, notes };
    }
    const parsed = JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>;
    let hits = 0;
    for (const key of requiredKeys) {
      if (key in parsed) hits += 1;
      else notes.push(`missing key: ${key}`);
    }
    return { score: hits / requiredKeys.length, notes };
  } catch (err) {
    notes.push(`parse error: ${err instanceof Error ? err.message : String(err)}`);
    return { score: 0, notes };
  }
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}
