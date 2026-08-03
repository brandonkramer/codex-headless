import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assembleBriefPreamble,
  assembleImplementPrompt,
  BRIEF_LIMITS,
  BriefValidationError,
  parseImplementBrief,
  pathMatchesWriteScope,
  validateWriteScope,
} from "./implement-brief.ts";

describe("parseImplementBrief", () => {
  it("applies defaults and derives writeScope from files", () => {
    const brief = parseImplementBrief({
      change: "Fix handler",
      files: ["src/a.ts", "src/b.ts"],
    });
    assert.deepEqual(brief.files, ["src/a.ts", "src/b.ts"]);
    assert.deepEqual(brief.writeScope, ["src/a.ts", "src/b.ts"]);
    assert.deepEqual(brief.checks, []);
    assert.equal(brief.maxTurns, BRIEF_LIMITS.defaultMaxTurns);
    assert.equal(brief.maxToolCalls, BRIEF_LIMITS.defaultMaxToolCalls);
    assert.equal(brief.timeoutMs, 0);
    assert.equal(brief.budgets.enforceable.timeoutMs, 0);
  });

  it("caps advisory budgets and clamps timeout", () => {
    const brief = parseImplementBrief({
      change: "x",
      files: ["a.ts"],
      maxTurns: 999,
      maxToolCalls: 999,
      timeoutMs: 9_999_999,
    });
    assert.equal(brief.maxTurns, BRIEF_LIMITS.maxTurnsCap);
    assert.equal(brief.maxToolCalls, BRIEF_LIMITS.maxToolCallsCap);
    assert.equal(brief.timeoutMs, BRIEF_LIMITS.maxTimeoutMs);
  });

  it("rejects empty change", () => {
    assert.throws(
      () => parseImplementBrief({ change: "  " }),
      (err: unknown) => err instanceof BriefValidationError && err.field === "change",
    );
  });

  it("rejects timeout below minimum when non-zero", () => {
    assert.throws(
      () =>
        parseImplementBrief({
          change: "x",
          files: ["a.ts"],
          timeoutMs: 1000,
        }),
      (err: unknown) => err instanceof BriefValidationError && err.field === "timeoutMs",
    );
  });

  it("rejects empty write scope when no files", () => {
    assert.throws(
      () => parseImplementBrief({ change: "x", writeScope: [] }),
      (err: unknown) => err instanceof BriefValidationError && err.field === "writeScope",
    );
  });

  it("truncates long file lists", () => {
    const files = Array.from({ length: 50 }, (_, i) => `f${i}.ts`);
    const brief = parseImplementBrief({ change: "x", files });
    assert.equal(brief.files.length, BRIEF_LIMITS.maxFileEntries);
  });
});

describe("assembleBriefPreamble", () => {
  it("includes deterministic sections and distinguishes budgets", () => {
    const brief = parseImplementBrief({
      change: "Add export",
      files: ["src/x.ts"],
      checks: ["pnpm run typecheck"],
      writeScope: ["src/"],
      maxTurns: 5,
      maxToolCalls: 10,
      timeoutMs: 120_000,
    });
    const preamble = assembleBriefPreamble(brief);

    assert.match(preamble, /^IMPLEMENTATION BRIEF \(bounded worker\)/);
    assert.match(preamble, /Start files:\n  - src\/x\.ts/);
    assert.match(preamble, /Write scope:\n  - src\//);
    assert.match(preamble, /Checks:\n  - pnpm run typecheck/);
    assert.match(preamble, /Wrapper wall timeout: 120000ms \(enforceable/);
    assert.match(preamble, /Advisory budgets \(prompt only — not enforced/);
    assert.match(preamble, /~5 turns, ~10 tool calls/);
    assert.match(preamble, /smallest change/);
    assert.match(preamble, /Do NOT write outside write scope/);
    assert.match(preamble, /Change:\nAdd export/);
  });

  it("marks disabled wall timeout without claiming turn enforcement", () => {
    const brief = parseImplementBrief({ change: "y", files: ["a.ts"] });
    const preamble = assembleBriefPreamble(brief);
    assert.match(preamble, /Wrapper wall timeout: none/);
    assert.doesNotMatch(preamble, /enforceable.*turns/i);
  });

  it("assembleImplementPrompt appends extra context", () => {
    const brief = parseImplementBrief({ change: "z", files: ["a.ts"] });
    const prompt = assembleImplementPrompt(brief, "Parent note.");
    assert.match(prompt, /Additional context:\nParent note\./);
    assert.ok(prompt.startsWith("IMPLEMENTATION BRIEF"));
  });
});

describe("validateWriteScope", () => {
  it("accepts exact and directory scope", () => {
    const result = validateWriteScope(
      ["src/a.ts", "src/nested/b.ts"],
      ["src/"],
    );
    assert.equal(result.withinScope, true);
    assert.deepEqual(result.violations, []);
  });

  it("accepts glob-style scope entries", () => {
    assert.equal(pathMatchesWriteScope("src/x.ts", "src/**"), true);
    assert.equal(pathMatchesWriteScope("src/x.ts", "lib/**"), false);
    const oneLevel = validateWriteScope(["src/x.ts"], ["src/*"]);
    assert.equal(oneLevel.withinScope, true);
  });

  it("reports violations without claiming confinement when out of scope", () => {
    const result = validateWriteScope(
      ["src/a.ts", "README.md"],
      ["src/a.ts"],
    );
    assert.equal(result.withinScope, false);
    assert.deepEqual(result.violations, ["README.md"]);
    assert.deepEqual(result.changed, ["src/a.ts", "README.md"]);
  });

  it("dedupes changed paths", () => {
    const result = validateWriteScope(
      ["./src/a.ts", "src/a.ts"],
      ["src/a.ts"],
    );
    assert.equal(result.withinScope, true);
    assert.deepEqual(result.changed, ["src/a.ts"]);
  });
});
