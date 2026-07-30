import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { sanitizeErrorBody } from "./errors.ts";
import { hangWasteMs, shouldKillHang } from "./hang.ts";
import { parseJsonl } from "./jsonl.ts";
import {
  isRetrySafe,
  updateRetrySafetyFromEvent,
  type RetrySafetyState,
} from "./retry-policy.ts";
import { runCodexExec } from "./run-codex.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIX = join(ROOT, "fixtures", "jsonl");

describe("usage_reported (zeros ≠ missing)", () => {
  it("keeps zero usage when turn.completed reports usage object", async () => {
    const text = await readFile(join(FIX, "zero-usage-turn.jsonl"), "utf8");
    const parsed = parseJsonl(text);
    assert.equal(parsed.usageReported, true);
    assert.ok(parsed.usage);
    assert.equal(parsed.usage?.input_tokens, 0);
    assert.equal(parsed.usage?.output_tokens, 0);
    // Old bug: treating all-zero as missing hid cache hits / free turns.
    assert.notEqual(parsed.usage, undefined);
  });

  it("leaves usage unset when no usage object appeared", () => {
    const parsed = parseJsonl(
      '{"type":"thread.started","thread_id":"t1"}\n{"type":"turn.started"}\n',
    );
    assert.equal(parsed.usageReported, false);
    assert.equal(parsed.usage, undefined);
  });
});

describe("retry safety (no double-apply after commit)", () => {
  it("allows retry before thread.started", () => {
    const state: RetrySafetyState = {
      spawned: true,
      sawThreadStarted: false,
      sawItemActivity: false,
    };
    assert.equal(isRetrySafe(state), true);
  });

  it("blocks retry after thread.started (proves stability)", async () => {
    const text = await readFile(join(FIX, "committed-turn.jsonl"), "utf8");
    const parsed = parseJsonl(text);
    const state: RetrySafetyState = {
      spawned: true,
      sawThreadStarted: false,
      sawItemActivity: false,
    };
    for (const ev of parsed.events) {
      updateRetrySafetyFromEvent(state, ev.kind);
    }
    assert.equal(state.sawThreadStarted, true);
    assert.equal(state.sawItemActivity, true);
    assert.equal(isRetrySafe(state), false);
  });

  it("blocks retry after item activity even without thread event", () => {
    const state: RetrySafetyState = {
      spawned: true,
      sawThreadStarted: false,
      sawItemActivity: false,
    };
    updateRetrySafetyFromEvent(state, "item.started");
    assert.equal(isRetrySafe(state), false);
  });
});

describe("hang kill (performance: free stuck slots)", () => {
  it("shouldKillHang triggers on quiet and wall", () => {
    const started = 1_000_000;
    assert.equal(
      shouldKillHang(started + 100, started, started, {
        maxQuietMs: 1_000,
        maxWallMs: 0,
      }),
      null,
    );
    assert.equal(
      shouldKillHang(started + 1_000, started, started, {
        maxQuietMs: 1_000,
        maxWallMs: 0,
      }),
      "quiet",
    );
    assert.equal(
      shouldKillHang(started + 5_000, started, started + 4_900, {
        maxQuietMs: 10_000,
        maxWallMs: 5_000,
      }),
      "wall",
    );
  });

  it("hangWasteMs proves quiet kill saves wall time", () => {
    // Hung agent would sit 30 min; quiet kill at 10 min saves 20 min.
    const waste = hangWasteMs({
      hungForMs: 30 * 60_000,
      maxQuietMs: 10 * 60_000,
    });
    assert.equal(waste.withKillMs, 10 * 60_000);
    assert.equal(waste.withoutKillMs, 30 * 60_000);
    assert.equal(waste.savedMs, 20 * 60_000);
  });

  it("live spawn: hung child is killed under maxQuietMs", async () => {
    const quietMs = 400;
    const t0 = Date.now();
    let progress = "";
    const result = await runCodexExec({
      profile: "probe",
      prompt: "hang",
      json: false,
      heartbeatMs: 0,
      maxQuietMs: quietMs,
      maxWallMs: 0,
      onProgress: (line) => {
        progress += `${line}\n`;
      },
      spawnCodex: () =>
        spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
          stdio: ["pipe", "pipe", "pipe"],
        }),
    });
    const elapsed = Date.now() - t0;
    assert.equal(result.ok, false);
    assert.equal(result.killReason, "quiet");
    assert.equal(result.exitCode, 124);
    assert.match(result.content, /hang: no progress/);
    // Must finish near quiet timeout, not hang forever.
    assert.ok(
      elapsed < quietMs + 2_500,
      `expected kill under ~${quietMs + 2500}ms, took ${elapsed}ms`,
    );
    assert.ok(
      elapsed >= quietMs,
      `killed too early (${elapsed}ms < ${quietMs}ms)`,
    );
    assert.match(progress, /hang-kill reason=quiet/);
  });
});

describe("error sanitize + turn.failed", () => {
  it("redacts tokens from stderr", async () => {
    const raw = await readFile(join(FIX, "secret-stderr.txt"), "utf8");
    const cleaned = sanitizeErrorBody(raw);
    assert.doesNotMatch(cleaned, /eyJhbGciOiJIUzI1NiJ9/);
    assert.doesNotMatch(cleaned, /sk-abcdefghijklmnopqrstuvwxyz123456/);
    assert.match(cleaned, /\[redacted\]/);
    assert.match(cleaned, /rate limits/);
  });

  it("captures turn.failed message", async () => {
    const text = await readFile(join(FIX, "turn-failed.jsonl"), "utf8");
    const parsed = parseJsonl(text);
    assert.match(parsed.turnError ?? "", /model overloaded/);
  });
});
