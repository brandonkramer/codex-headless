import { createInterface } from "node:readline";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import spawn from "cross-spawn";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatCodexFailure, type KillReason } from "./errors.ts";
import { resolveHangLimits, shouldKillHang, type HangLimits } from "./hang.ts";
import {
  consumeJsonlLine,
  createJsonlParseState,
  formatUsageLine,
  type CodexUsage,
} from "./jsonl.ts";
import {
  isRetrySafe,
  updateRetrySafetyFromEvent,
  type RetrySafetyState,
} from "./retry-policy.ts";
import { resolveStructuredSchema } from "./schema.ts";

export type HeadlessProfile = "review" | "implement" | "engineer" | "probe";

export type ImplementProfile = "implement" | "engineer";

export type ContentSource = "output-file" | "jsonl-agent-message" | "empty";

const DEFAULT_HEARTBEAT_MS = 15_000;
const HANG_POLL_MS = 250;
const KILL_GRACE_MS = 2_000;

/** Windows Codex sandbox often crashes on apply_patch; force full-file writes. */
const WIN32_NO_APPLY_PATCH =
  "Windows sandbox note: do NOT use apply_patch. Write complete file contents " +
  "with the normal file tools instead. Prefer small, complete file rewrites.\n\n";

function killProcessTree(child: ChildProcessWithoutNullStreams): void {
  const pid = child.pid;
  if (!pid) return;
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      try {
        child.kill();
      } catch {
        // ignore
      }
    }
    return;
  }
  try {
    child.kill("SIGTERM");
  } catch {
    // ignore
  }
}

function withWindowsImplementGuard(
  profile: HeadlessProfile,
  prompt: string | undefined,
): string | undefined {
  if (!prompt) return prompt;
  if (process.platform !== "win32") return prompt;
  if (profile !== "implement" && profile !== "engineer") return prompt;
  if (prompt.includes("do NOT use apply_patch") || prompt.includes("do not use apply_patch")) {
    return prompt;
  }
  return `${WIN32_NO_APPLY_PATCH}${prompt}`;
}

export interface RunCodexOptions {
  profile: HeadlessProfile;
  prompt?: string;
  cwd?: string;
  structured?: boolean;
  reviewUncommitted?: boolean;
  reviewBase?: string;
  reviewCommit?: string;
  outputPath?: string;
  /** Capture JSONL + durable agent_message fallback + usage. Default true. */
  json?: boolean;
  /** Persist full JSONL stream (implies json). */
  jsonlPath?: string;
  /** Heartbeat interval while Codex runs (0 disables). Default 15000. */
  heartbeatMs?: number;
  /** Kill if no progress for this many ms. Default 10 minutes. 0 disables. */
  maxQuietMs?: number;
  /** Kill if wall clock exceeds this many ms. Default 0 (disabled). */
  maxWallMs?: number;
  /** Progress callback (JSONL events + heartbeats). Default: stderr. */
  onProgress?: (line: string) => void;
  /** Test seam: override spawn (defaults to `codex`). */
  spawnCodex?: (
    args: string[],
    cwd: string,
  ) => ChildProcessWithoutNullStreams;
  /**
   * Pass `--skip-git-repo-check` (default true). Headless workers often run in
   * non-git cwd / untrusted trees; without this Codex exits "Not inside a trusted directory".
   */
  skipGitRepoCheck?: boolean;
  /**
   * One-shot runs pass `--ephemeral` (default true). Set false to persist session files
   * for later `codex exec resume`.
   */
  ephemeral?: boolean;
  /**
   * Resume a persistent session by thread/session id. Omits profile/model flags (frozen from
   * the initial run); `profile` on this call is retained only for result reporting.
   */
  resumeThreadId?: string;
}

export interface RunCodexResult {
  ok: boolean;
  exitCode: number;
  content: string;
  profile: HeadlessProfile;
  command: string;
  outputPath?: string;
  contentSource: ContentSource;
  usage?: CodexUsage;
  /** True when JSONL reported a usage object (zeros are valid). */
  usageReported: boolean;
  turnError?: string;
  threadId?: string;
  parseErrors: number;
  killReason?: KillReason;
  /** False after thread.started / item activity — do not auto-retry. */
  retrySafe: boolean;
  jsonlPath?: string;
}

function defaultProgress(line: string): void {
  process.stderr.write(`${line}\n`);
}

function applyStructuredSchema(args: string[], profile: HeadlessProfile): void {
  if (profile === "review") {
    args.push("--output-schema", resolveStructuredSchema("review"));
  } else if (profile === "implement" || profile === "engineer") {
    args.push("--output-schema", resolveStructuredSchema("implement"));
  } else {
    throw new Error("structured output is not supported for probe profile");
  }
}

function applyHermeticReviewFlags(args: string[]): void {
  // Skip ~/.codex/config.toml so global MCP/plugins are not loaded.
  // Workaround: -c 'mcp_servers={}' does not clear servers (Codex merge bug).
  // Pair with --ignore-rules so project/user execpolicy .rules stay out of CI/orchestration.
  args.push("--ignore-user-config", "--ignore-rules");
}

function validateRunOptions(opts: RunCodexOptions): void {
  if (!opts.resumeThreadId) return;

  if (opts.ephemeral === true) {
    throw new Error("resume is incompatible with ephemeral=true");
  }
  if (opts.reviewUncommitted || opts.reviewBase || opts.reviewCommit) {
    throw new Error(
      "resume is incompatible with built-in diff review (review_uncommitted, review_base, review_commit)",
    );
  }
  if (opts.structured) {
    throw new Error(
      "resume is incompatible with structured output (settings frozen from the initial run)",
    );
  }
}

function appendSkipGitRepoCheck(args: string[], skipGitRepoCheck: boolean | undefined): void {
  if (skipGitRepoCheck !== false) {
    args.push("--skip-git-repo-check");
  }
}

function buildFreshExecArgs(
  opts: RunCodexOptions,
  outFile: string,
  json: boolean,
): string[] {
  const args = ["exec", "--profile", opts.profile, "-o", outFile];

  if (opts.ephemeral !== false) {
    args.push("--ephemeral");
  }

  appendSkipGitRepoCheck(args, opts.skipGitRepoCheck);

  if (opts.profile === "review") {
    applyHermeticReviewFlags(args);
  }

  if (json) {
    args.push("--json");
  }

  if (opts.structured) {
    applyStructuredSchema(args, opts.profile);
  }

  return args;
}

/** Resume argv: `codex exec resume <SESSION_ID> …` — no profile/model (frozen). */
function buildResumeExecArgs(
  resumeThreadId: string,
  outFile: string,
  json: boolean,
  skipGitRepoCheck: boolean | undefined,
): string[] {
  const args = ["exec", "resume", resumeThreadId, "-o", outFile];
  appendSkipGitRepoCheck(args, skipGitRepoCheck);
  if (json) {
    args.push("--json");
  }
  return args;
}

interface ProcessResult {
  exitCode: number;
  stderr: string;
  jsonl: string;
  lastAgentMessage: string;
  usage: CodexUsage | undefined;
  usageReported: boolean;
  turnError?: string;
  threadId?: string;
  parseErrors: number;
  killReason?: KillReason;
  retrySafe: boolean;
}

function defaultSpawn(
  args: string[],
  cwd: string,
): ChildProcessWithoutNullStreams {
  // cross-spawn: Windows resolves Scoop's codex.cmd without shell:true (argv-safe).
  // Bare node:child_process.spawn("codex") → ENOENT; spawn("codex.cmd") → EINVAL on Node 26.
  return spawn("codex", args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;
}

function armHangWatch(
  child: ChildProcessWithoutNullStreams,
  started: number,
  getLastEventAt: () => number,
  limits: HangLimits,
  onKill: (reason: KillReason) => void,
): { stop: () => void } {
  let killReason: KillReason | undefined;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;

  const poll = setInterval(() => {
    if (killReason) return;
    const reason = shouldKillHang(
      Date.now(),
      started,
      getLastEventAt(),
      limits,
    );
    if (!reason) return;
    killReason = reason;
    onKill(reason);
    killProcessTree(child);
    graceTimer = setTimeout(() => {
      if (!child.killed) {
        killProcessTree(child);
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
    }, KILL_GRACE_MS);
  }, HANG_POLL_MS);

  return {
    stop: () => {
      clearInterval(poll);
      if (graceTimer) clearTimeout(graceTimer);
    },
  };
}

async function runProcess(
  args: string[],
  cwd: string,
  stdin: string | null,
  opts: {
    json: boolean;
    heartbeatMs: number;
    hang: HangLimits;
    onProgress: (line: string) => void;
    spawnCodex: (
      args: string[],
      cwd: string,
    ) => ChildProcessWithoutNullStreams;
  },
): Promise<ProcessResult> {
  const started = Date.now();
  let lastEventAt = started;
  let lastSummary = "starting";
  let stderr = "";
  let jsonl = "";
  let killReason: KillReason | undefined;
  const parseState = createJsonlParseState();
  const retryState: RetrySafetyState = {
    spawned: false,
    sawThreadStarted: false,
    sawItemActivity: false,
  };

  const emit = (msg: string) => {
    opts.onProgress(`[codex-headless] ${msg}`);
  };

  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = opts.spawnCodex(args, cwd);
      retryState.spawned = true;
    } catch (err) {
      reject(err);
      return;
    }

    const heartbeat =
      opts.heartbeatMs > 0
        ? setInterval(() => {
            const elapsedSec = Math.round((Date.now() - started) / 1000);
            const quietSec = Math.round((Date.now() - lastEventAt) / 1000);
            emit(`+${elapsedSec}s alive last=${lastSummary} quiet=${quietSec}s`);
          }, opts.heartbeatMs)
        : null;

    const hangWatch = armHangWatch(
      child,
      started,
      () => lastEventAt,
      opts.hang,
      (reason) => {
        killReason = reason;
        emit(`hang-kill reason=${reason}`);
      },
    );

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      // Forward non-empty stderr lines as soft progress (non-json mode / Codex chatter).
      if (!opts.json) {
        for (const line of text.split(/\r?\n/)) {
          const t = line.trim();
          if (t) {
            lastEventAt = Date.now();
            lastSummary = t.slice(0, 120);
            emit(`stderr ${lastSummary}`);
          }
        }
      }
    });

    if (opts.json) {
      const rl = createInterface({ input: child.stdout });
      rl.on("line", (line) => {
        jsonl += `${line}\n`;
        const event = consumeJsonlLine(line, parseState);
        if (event) {
          lastEventAt = Date.now();
          lastSummary = event.summary;
          updateRetrySafetyFromEvent(retryState, event.kind);
          emit(`+${Math.round((lastEventAt - started) / 1000)}s ${event.summary}`);
        }
      });
    } else {
      child.stdout.resume();
    }

    child.on("error", (err) => {
      if (heartbeat) clearInterval(heartbeat);
      hangWatch.stop();
      // spawn-time errors → retry-safe
      retryState.spawned = false;
      reject(err);
    });

    child.on("close", (code) => {
      if (heartbeat) clearInterval(heartbeat);
      hangWatch.stop();
      // Reap orphans (Windows sandbox often leaves node/vitest children).
      if (killReason || code !== 0) {
        killProcessTree(child);
      }
      const exitCode =
        killReason && (code === null || code === 0) ? 124 : (code ?? 1);
      resolve({
        exitCode,
        stderr,
        jsonl,
        lastAgentMessage: parseState.lastAgentMessage,
        usage: parseState.usageReported ? parseState.usage : undefined,
        usageReported: parseState.usageReported,
        turnError: parseState.turnError,
        threadId: parseState.threadId,
        parseErrors: parseState.parseErrors,
        killReason,
        retrySafe: isRetrySafe(retryState),
      });
    });

    if (stdin === null) {
      child.stdin.end();
    } else {
      child.stdin.write(stdin);
      child.stdin.end();
    }
  });
}

async function finishRun(
  outFile: string,
  outputPath: string | undefined,
  proc: ProcessResult,
  profile: HeadlessProfile,
  command: string,
  opts: {
    json: boolean;
    jsonlPath?: string;
    onProgress: (line: string) => void;
  },
): Promise<RunCodexResult> {
  const fileContent = await readFile(outFile, "utf8").catch(() => "");
  let content = fileContent;
  let contentSource: ContentSource = fileContent.trim()
    ? "output-file"
    : "empty";

  if (!content.trim() && proc.lastAgentMessage.trim()) {
    content = proc.lastAgentMessage;
    contentSource = "jsonl-agent-message";
  }

  // Structured failure (don't throw): hang kill, turn.failed, non-zero exit with empty body.
  // Orchestrators need killReason / retrySafe / turnError without losing the result object.
  if (!content.trim() && (proc.exitCode !== 0 || proc.killReason || proc.turnError)) {
    content = formatCodexFailure({
      exitCode: proc.exitCode,
      stderr: proc.stderr,
      turnError: proc.turnError,
      killReason: proc.killReason,
    });
    contentSource = "empty";
  }

  if (opts.jsonlPath && opts.json) {
    await writeFile(opts.jsonlPath, proc.jsonl);
  }

  if (outputPath) {
    await writeFile(outputPath, content);
  }

  if (proc.usageReported && proc.usage) {
    opts.onProgress(`[codex-headless] ${formatUsageLine(proc.usage)}`);
  }
  opts.onProgress(
    `[codex-headless] done exit=${proc.exitCode} source=${contentSource}` +
      ` retrySafe=${proc.retrySafe}` +
      (proc.killReason ? ` kill=${proc.killReason}` : "") +
      (content.trim() ? "" : " (empty content)"),
  );

  return {
    ok: proc.exitCode === 0 && !proc.killReason && !proc.turnError,
    exitCode: proc.exitCode,
    content,
    profile,
    command,
    outputPath,
    contentSource,
    usage: proc.usage,
    usageReported: proc.usageReported,
    turnError: proc.turnError,
    threadId: proc.threadId,
    parseErrors: proc.parseErrors,
    killReason: proc.killReason,
    retrySafe: proc.retrySafe,
    jsonlPath: opts.jsonlPath,
  };
}

export async function runCodexExec(opts: RunCodexOptions): Promise<RunCodexResult> {
  validateRunOptions(opts);

  const workDir = opts.cwd ?? process.cwd();
  const tmp = await mkdtemp(join(tmpdir(), "codex-headless-"));
  const outFile = join(tmp, "out.txt");
  const json = opts.json !== false;
  const heartbeatMs = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const hang = resolveHangLimits(opts);
  const onProgress = opts.onProgress ?? defaultProgress;
  const spawnCodex = opts.spawnCodex ?? defaultSpawn;
  // Persist JSONL outside the ephemeral out-dir so callers can inspect hangs/orphans.
  const jsonlPath =
    opts.jsonlPath ??
    (json
      ? join(
          tmpdir(),
          `codex-headless-${opts.profile}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.jsonl`,
        )
      : undefined);

  const runOpts = { json, heartbeatMs, hang, onProgress, spawnCodex };
  const finishOpts = { json, jsonlPath, onProgress };

  let command: string;

  try {
    if (opts.resumeThreadId) {
      const args = buildResumeExecArgs(
        opts.resumeThreadId,
        outFile,
        json,
        opts.skipGitRepoCheck,
      );
      const prompt = withWindowsImplementGuard(opts.profile, opts.prompt?.trim());
      if (!prompt) {
        throw new Error("prompt is required when resumeThreadId is set");
      }
      command = `codex ${args.join(" ")} - < prompt.txt`;
      const proc = await runProcess(args, workDir, prompt, runOpts);
      return finishRun(outFile, opts.outputPath, proc, opts.profile, command, finishOpts);
    }

    const args = buildFreshExecArgs(opts, outFile, json);

    if (opts.reviewUncommitted) {
      args.push("review", "--uncommitted");
      command = `codex ${args.join(" ")} < /dev/null`;
      const proc = await runProcess(args, workDir, null, runOpts);
      return finishRun(outFile, opts.outputPath, proc, opts.profile, command, finishOpts);
    }

    if (opts.reviewBase) {
      args.push("review", "--base", opts.reviewBase);
      command = `codex ${args.join(" ")} < /dev/null`;
      const proc = await runProcess(args, workDir, null, runOpts);
      return finishRun(outFile, opts.outputPath, proc, opts.profile, command, finishOpts);
    }

    if (opts.reviewCommit) {
      args.push("review", "--commit", opts.reviewCommit);
      command = `codex ${args.join(" ")} < /dev/null`;
      const proc = await runProcess(args, workDir, null, runOpts);
      return finishRun(outFile, opts.outputPath, proc, opts.profile, command, finishOpts);
    }

    const prompt = withWindowsImplementGuard(opts.profile, opts.prompt?.trim());
    if (!prompt) {
      throw new Error(
        "prompt is required unless review_uncommitted, review_base, or review_commit is set",
      );
    }

    command = `codex ${args.join(" ")} - < prompt.txt`;
    const proc = await runProcess(args, workDir, prompt, runOpts);
    return finishRun(outFile, opts.outputPath, proc, opts.profile, command, finishOpts);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

export async function readPromptFile(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export type { CodexUsage };
export { isRetrySafe } from "./retry-policy.ts";
export { shouldKillHang, hangWasteMs } from "./hang.ts";
export { sanitizeErrorBody } from "./errors.ts";
