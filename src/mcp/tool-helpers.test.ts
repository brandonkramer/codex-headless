import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RunCodexResult } from "../run-codex.ts";
import {
  assertSessionFlagsCompatible,
  extractChangedFilesFromContent,
  maybeValidateWriteScope,
  McpInputError,
  resolveImplementPromptInput,
} from "./tool-helpers.ts";
import { parseImplementBrief } from "../implement-brief.ts";
import { canSafelyFallbackToExec } from "../persistent-service.ts";

function baseResult(over: Partial<RunCodexResult> = {}): RunCodexResult {
  return {
    ok: true,
    exitCode: 0,
    content: "",
    profile: "implement",
    command: "codex exec",
    contentSource: "output-file",
    usageReported: false,
    parseErrors: 0,
    retrySafe: true,
    ...over,
  };
}

describe("resolveImplementPromptInput", () => {
  it("accepts legacy prompt-only", () => {
    const r = resolveImplementPromptInput({ prompt: "  do the thing  " });
    assert.equal(r.prompt, "do the thing");
    assert.equal(r.brief, null);
    assert.equal(r.maxWallMs, undefined);
  });

  it("assembles brief and maps timeoutMs → maxWallMs", () => {
    const r = resolveImplementPromptInput({
      brief: {
        change: "Add export",
        files: ["src/a.ts"],
        timeoutMs: 60_000,
      },
    });
    assert.match(r.prompt, /IMPLEMENTATION BRIEF/);
    assert.match(r.prompt, /Add export/);
    assert.equal(r.maxWallMs, 60_000);
    assert.ok(r.brief);
  });

  it("requires prompt or brief", () => {
    assert.throws(
      () => resolveImplementPromptInput({}),
      (err: unknown) => err instanceof McpInputError,
    );
  });
});

describe("assertSessionFlagsCompatible", () => {
  it("rejects resume + persistentSessionKey", () => {
    assert.throws(
      () =>
        assertSessionFlagsCompatible({
          resumeThreadId: "t1",
          persistentSessionKey: "k1",
        }),
      /cannot combine/,
    );
  });

  it("rejects resume + ephemeral=true", () => {
    assert.throws(
      () =>
        assertSessionFlagsCompatible({
          resumeThreadId: "t1",
          ephemeral: true,
        }),
      /incompatible with ephemeral=true/,
    );
  });

  it("allows resume alone", () => {
    assertSessionFlagsCompatible({ resumeThreadId: "t1" });
  });
});

describe("write-scope validation honesty", () => {
  it("extracts changed_files from structured JSON only", () => {
    assert.deepEqual(
      extractChangedFilesFromContent(
        JSON.stringify({
          changed_files: ["src/a.ts"],
          summary: "x",
          risks: [],
          recommended_verification: [],
        }),
      ),
      ["src/a.ts"],
    );
    assert.equal(extractChangedFilesFromContent("not json"), null);
  });

  it("reports validation without enforcement/rollback", () => {
    const brief = parseImplementBrief({
      change: "x",
      files: ["src/a.ts"],
      writeScope: ["src/a.ts"],
    });
    const report = maybeValidateWriteScope(
      baseResult({
        content: JSON.stringify({
          changed_files: ["src/b.ts"],
          summary: "x",
          risks: [],
          recommended_verification: [],
        }),
      }),
      brief,
    );
    assert.equal(report.writeScopeValidation?.withinScope, false);
    assert.deepEqual(report.writeScopeValidation?.violations, ["src/b.ts"]);
    assert.equal(report.writeScopeValidation?.enforced, false);
    assert.equal(report.writeScopeValidation?.rolledBack, false);
  });

  it("skips when changed_files unavailable", () => {
    const brief = parseImplementBrief({ change: "x", files: ["src/a.ts"] });
    const report = maybeValidateWriteScope(
      baseResult({ content: "plain text summary" }),
      brief,
    );
    assert.equal(report.writeScopeValidation, undefined);
    assert.match(report.writeScopeSkippedReason ?? "", /not reliably derived/);
  });
});

describe("canSafelyFallbackToExec", () => {
  it("allows only pre-mutation failures", () => {
    assert.equal(canSafelyFallbackToExec("initialize_failed"), true);
    assert.equal(canSafelyFallbackToExec("reconnect_failed"), true);
    assert.equal(canSafelyFallbackToExec("transport_crash"), true);
    assert.equal(
      canSafelyFallbackToExec("transport_crash", { turnId: "t1" }),
      false,
    );
    assert.equal(canSafelyFallbackToExec("turn_failed"), false);
    assert.equal(canSafelyFallbackToExec("session_busy"), false);
    assert.equal(canSafelyFallbackToExec("unsupported_server_request"), false);
  });
});
