import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { runCodexExec } from "./run-codex.ts";

const THREAD_JSONL =
  '{"type":"thread.started","thread_id":"thread_abc123"}\n' +
  '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":2,"reasoning_output_tokens":0}}\n';

function mockSpawn(opts?: {
  exitCode?: number;
  stdout?: string;
  outContent?: string;
}): {
  spawnCodex: (args: string[], cwd: string) => ChildProcessWithoutNullStreams;
  getArgs: () => string[];
} {
  let capturedArgs: string[] = [];
  const exitCode = opts?.exitCode ?? 0;
  const stdout = opts?.stdout ?? "";
  const outContent = opts?.outContent ?? "agent output";

  const spawnCodex = (args: string[], _cwd: string) => {
    capturedArgs = args;
    const outIdx = args.indexOf("-o");
    const outFile = outIdx >= 0 ? args[outIdx + 1] : undefined;
    if (outFile) {
      void writeFile(outFile, outContent);
    }
    return spawn(
      process.execPath,
      [
        "-e",
        `process.stdout.write(${JSON.stringify(stdout)}); process.exit(${exitCode});`,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    ) as ChildProcessWithoutNullStreams;
  };

  return { spawnCodex, getArgs: () => capturedArgs };
}

describe("runCodexExec argv (spawnCodex seam)", () => {
  it("defaults to --ephemeral on fresh exec", async () => {
    const mock = mockSpawn();
    await runCodexExec({
      profile: "engineer",
      prompt: "hello",
      heartbeatMs: 0,
      spawnCodex: mock.spawnCodex,
    });
    const args = mock.getArgs();
    assert.equal(args[0], "exec");
    assert.equal(args[1], "--profile");
    assert.equal(args[2], "engineer");
    assert.equal(args[3], "-o");
    assert.equal(args[5], "--ephemeral");
    assert.ok(args.includes("--skip-git-repo-check"));
    assert.ok(args.includes("--json"));
    assert.ok(!args.includes("resume"));
  });

  it("omits --ephemeral when ephemeral=false", async () => {
    const mock = mockSpawn({ stdout: THREAD_JSONL });
    const result = await runCodexExec({
      profile: "engineer",
      prompt: "persist me",
      ephemeral: false,
      heartbeatMs: 0,
      spawnCodex: mock.spawnCodex,
    });
    const args = mock.getArgs();
    assert.ok(!args.includes("--ephemeral"));
    assert.equal(args[1], "--profile");
    assert.equal(result.threadId, "thread_abc123");
  });

  it("resume uses explicit thread id without profile or ephemeral", async () => {
    const mock = mockSpawn({ stdout: THREAD_JSONL });
    const result = await runCodexExec({
      profile: "engineer",
      prompt: "continue",
      resumeThreadId: "thread_abc123",
      heartbeatMs: 0,
      spawnCodex: mock.spawnCodex,
    });
    const args = mock.getArgs();
    assert.equal(args[0], "exec");
    assert.equal(args[1], "resume");
    assert.equal(args[2], "thread_abc123");
    assert.equal(args[3], "-o");
    assert.ok(args.includes("--skip-git-repo-check"));
    assert.ok(args.includes("--json"));
    assert.ok(!args.includes("--profile"));
    assert.ok(!args.includes("--ephemeral"));
    assert.ok(!args.includes("--last"));
    assert.equal(result.profile, "engineer");
    assert.equal(result.threadId, "thread_abc123");
  });

  it("review profile keeps hermetic flags on fresh exec only", async () => {
    const mock = mockSpawn();
    await runCodexExec({
      profile: "review",
      prompt: "review this",
      heartbeatMs: 0,
      spawnCodex: mock.spawnCodex,
    });
    const args = mock.getArgs();
    assert.ok(args.includes("--ignore-user-config"));
    assert.ok(args.includes("--ignore-rules"));
  });

  it("structured review uses bundled schema path by default", async () => {
    const mock = mockSpawn();
    await runCodexExec({
      profile: "review",
      prompt: "review this",
      structured: true,
      heartbeatMs: 0,
      spawnCodex: mock.spawnCodex,
    });
    const args = mock.getArgs();
    const schemaIdx = args.indexOf("--output-schema");
    assert.ok(schemaIdx >= 0);
    const schemaPath = args[schemaIdx + 1];
    assert.match(schemaPath, /schemas[/\\]reviewer-verdict\.schema\.json$/);
    assert.ok(!schemaPath.includes(".codex"));
  });
});

describe("runCodexExec incompatible combinations", () => {
  it("rejects resume with ephemeral=true", async () => {
    await assert.rejects(
      () =>
        runCodexExec({
          profile: "engineer",
          prompt: "nope",
          resumeThreadId: "thread_x",
          ephemeral: true,
        }),
      /resume is incompatible with ephemeral=true/,
    );
  });

  it("rejects resume with review_uncommitted", async () => {
    await assert.rejects(
      () =>
        runCodexExec({
          profile: "review",
          resumeThreadId: "thread_x",
          reviewUncommitted: true,
        }),
      /incompatible with built-in diff review/,
    );
  });

  it("rejects resume with review_base", async () => {
    await assert.rejects(
      () =>
        runCodexExec({
          profile: "review",
          resumeThreadId: "thread_x",
          reviewBase: "main",
        }),
      /incompatible with built-in diff review/,
    );
  });

  it("rejects resume with structured output", async () => {
    await assert.rejects(
      () =>
        runCodexExec({
          profile: "implement",
          prompt: "nope",
          resumeThreadId: "thread_x",
          structured: true,
        }),
      /incompatible with structured output/,
    );
  });

  it("requires prompt for resume", async () => {
    await assert.rejects(
      () =>
        runCodexExec({
          profile: "engineer",
          resumeThreadId: "thread_x",
        }),
      /prompt is required when resumeThreadId is set/,
    );
  });
});
