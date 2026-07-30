#!/usr/bin/env node
/**
 * Unified CLI for headless codex exec — same behavior as MCP runCodexExec.
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { type ImplementProfile, runCodexExec } from "./run-codex.ts";
import { formatUsageLine } from "./jsonl.ts";

function usage(): string {
  return `codex-headless — headless codex exec wrapper

Usage:
  codex-headless review [--uncommitted | --base REF | --commit SHA] [-f prompt-file] [-p prompt] [--structured] [-o file] [-C cwd]
  codex-headless implement [--profile engineer|implement] [-f prompt-file | -p prompt] [--structured] [-o file] [-C cwd]
  codex-headless probe [-f prompt-file | -p prompt] [-o file] [-C cwd]

Options:
  -f, --file          Prompt file (mutually exclusive with -p for implement/probe)
  -p, --prompt        Inline prompt string
  -o, --output        Write Codex output to file (also prints to stdout unless --quiet)
  -C, --cwd           Working directory
  --structured        Emit JSON via output schema (review / implement only)
  --quiet             Do not print content to stdout (requires -o for implement/probe)
  --profile           implement subcommand only: engineer (default) or implement
  --json              Capture JSONL (default); durable agent_message + usage telemetry
  --no-json           Disable --json (legacy -o / stderr progress only)
  --jsonl PATH        Write full JSONL event stream to PATH (implies --json)
  --no-heartbeat      Disable periodic liveness lines on stderr
  --max-quiet-ms MS   Kill if no progress for MS (default 600000; 0 disables)
  --max-wall-ms MS    Kill if wall clock exceeds MS (default 0 = disabled)

Hermetic review flags (always): --ignore-user-config --ignore-rules

Examples:
  codex-headless review --uncommitted
  codex-headless review --base origin/main -o review.md
  codex-headless review --structured -f prompt.md -o verdict.json
  codex-headless implement -p "Add foo to bar.ts" 
  codex-headless implement --profile implement --structured -f task.md -o report.json
  codex-headless probe -p "Survey auth module; do not edit"
`;
}

async function loadPrompt(
  file: string | undefined,
  inline: string | undefined,
  required: boolean,
): Promise<string | undefined> {
  if (file && inline) {
    throw new Error("use only one of -f/--file or -p/--prompt");
  }
  if (file) return readFile(file, "utf8");
  if (inline) return inline;
  if (required) throw new Error("prompt required: use -f or -p");
  return undefined;
}

const sharedRunOptions = {
  json: { type: "boolean" as const, default: true },
  "no-json": { type: "boolean" as const, default: false },
  jsonl: { type: "string" as const },
  "no-heartbeat": { type: "boolean" as const, default: false },
  "max-quiet-ms": { type: "string" as const },
  "max-wall-ms": { type: "string" as const },
};

function resolveHangFlags(values: {
  "max-quiet-ms"?: string;
  "max-wall-ms"?: string;
}): { maxQuietMs?: number; maxWallMs?: number } {
  const out: { maxQuietMs?: number; maxWallMs?: number } = {};
  if (values["max-quiet-ms"] !== undefined) {
    const n = Number(values["max-quiet-ms"]);
    if (!Number.isFinite(n) || n < 0) throw new Error("--max-quiet-ms must be >= 0");
    out.maxQuietMs = n;
  }
  if (values["max-wall-ms"] !== undefined) {
    const n = Number(values["max-wall-ms"]);
    if (!Number.isFinite(n) || n < 0) throw new Error("--max-wall-ms must be >= 0");
    out.maxWallMs = n;
  }
  return out;
}

function resolveJsonFlags(values: {
  json?: boolean;
  "no-json"?: boolean;
  jsonl?: string;
}): { json: boolean; jsonlPath?: string } {
  if (values["no-json"] && values.jsonl) {
    throw new Error("--jsonl requires JSONL capture; omit --no-json");
  }
  const json = values["no-json"] ? false : true;
  return { json, jsonlPath: values.jsonl };
}

async function runReview(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      uncommitted: { type: "boolean", default: false },
      base: { type: "string" },
      commit: { type: "string" },
      file: { type: "string", short: "f" },
      prompt: { type: "string", short: "p" },
      output: { type: "string", short: "o" },
      cwd: { type: "string", short: "C" },
      structured: { type: "boolean", default: false },
      quiet: { type: "boolean", default: false },
      ...sharedRunOptions,
    },
    allowPositionals: false,
  });

  const targets = [values.uncommitted, values.base, values.commit, values.file, values.prompt].filter(
    Boolean,
  );
  if (targets.length === 0) {
    throw new Error("review requires one of: --uncommitted, --base, --commit, -f, -p");
  }
  if (values.uncommitted && (values.base || values.commit || values.file || values.prompt)) {
    throw new Error("--uncommitted conflicts with --base, --commit, and custom prompts");
  }
  if (values.base && (values.commit || values.file || values.prompt)) {
    throw new Error("--base conflicts with --commit and custom prompts");
  }
  if (values.commit && (values.file || values.prompt)) {
    throw new Error("--commit conflicts with custom prompts");
  }

  const prompt = await loadPrompt(values.file, values.prompt, false);
  const { json, jsonlPath } = resolveJsonFlags(values);
  const hang = resolveHangFlags(values);

  const result = await runCodexExec({
    profile: "review",
    cwd: values.cwd,
    structured: values.structured,
    reviewUncommitted: values.uncommitted,
    reviewBase: values.base,
    reviewCommit: values.commit,
    prompt,
    outputPath: values.output,
    json,
    jsonlPath,
    heartbeatMs: values["no-heartbeat"] ? 0 : undefined,
    ...hang,
  });

  if (!values.quiet) {
    process.stdout.write(result.content);
    if (!result.content.endsWith("\n")) process.stdout.write("\n");
  }
  if (values.output) {
    process.stderr.write(`wrote ${values.output}\n`);
  }
  if (result.usage) {
    process.stderr.write(`${formatUsageLine(result.usage)}\n`);
  }
  return result.ok ? 0 : result.exitCode;
}

async function runImplement(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      profile: { type: "string", default: "engineer" },
      file: { type: "string", short: "f" },
      prompt: { type: "string", short: "p" },
      output: { type: "string", short: "o" },
      cwd: { type: "string", short: "C" },
      structured: { type: "boolean", default: false },
      quiet: { type: "boolean", default: false },
      ...sharedRunOptions,
    },
    allowPositionals: false,
  });

  const profile = values.profile as ImplementProfile;
  if (profile !== "engineer" && profile !== "implement") {
    throw new Error("--profile must be engineer or implement");
  }

  const prompt = await loadPrompt(values.file, values.prompt, true);
  const { json, jsonlPath } = resolveJsonFlags(values);
  const hang = resolveHangFlags(values);

  const result = await runCodexExec({
    profile,
    cwd: values.cwd,
    structured: values.structured,
    prompt,
    outputPath: values.output,
    json,
    jsonlPath,
    heartbeatMs: values["no-heartbeat"] ? 0 : undefined,
    ...hang,
  });

  if (!values.quiet) {
    process.stdout.write(result.content);
    if (!result.content.endsWith("\n")) process.stdout.write("\n");
  }
  if (values.output) {
    process.stderr.write(`wrote ${values.output}\n`);
  }
  if (result.usage) {
    process.stderr.write(`${formatUsageLine(result.usage)}\n`);
  }
  return result.ok ? 0 : result.exitCode;
}

async function runProbe(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      file: { type: "string", short: "f" },
      prompt: { type: "string", short: "p" },
      output: { type: "string", short: "o" },
      cwd: { type: "string", short: "C" },
      quiet: { type: "boolean", default: false },
      ...sharedRunOptions,
    },
    allowPositionals: false,
  });

  const prompt = await loadPrompt(values.file, values.prompt, true);
  const { json, jsonlPath } = resolveJsonFlags(values);
  const hang = resolveHangFlags(values);

  const result = await runCodexExec({
    profile: "probe",
    cwd: values.cwd,
    prompt,
    outputPath: values.output,
    json,
    jsonlPath,
    heartbeatMs: values["no-heartbeat"] ? 0 : undefined,
    ...hang,
  });

  if (!values.quiet) {
    process.stdout.write(result.content);
    if (!result.content.endsWith("\n")) process.stdout.write("\n");
  }
  if (values.output) {
    process.stderr.write(`wrote ${values.output}\n`);
  }
  if (result.usage) {
    process.stderr.write(`${formatUsageLine(result.usage)}\n`);
  }
  return result.ok ? 0 : result.exitCode;
}

async function main(): Promise<void> {
  const [sub, ...rest] = process.argv.slice(2);
  if (!sub || sub === "-h" || sub === "--help") {
    process.stdout.write(usage());
    process.exit(0);
  }

  try {
    let code: number;
    switch (sub) {
      case "review":
        code = await runReview(rest);
        break;
      case "implement":
        code = await runImplement(rest);
        break;
      case "probe":
        code = await runProbe(rest);
        break;
      default:
        throw new Error(`unknown subcommand: ${sub}`);
    }
    process.exit(code);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`codex-headless: ${msg}\n`);
    process.stderr.write("\n");
    process.stderr.write(usage());
    process.exit(1);
  }
}

await main();
