import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAbBaSchedule, flattenSchedule } from "./order.ts";
import { bootstrapMedianDiffCi, median, medianImprovement, seedFromString, summarizeDistribution } from "./stats.ts";
import { evaluateClaim, PRE_REGISTERED_GATES } from "./gates.ts";
import { createLiveRunCounters, mergeTrialMetrics, metricsFromRunSnapshot } from "./metrics.ts";
import { renderMarkdownReport } from "./report.ts";
import type { BenchmarkReport, TrialRecord } from "./types.ts";
import {
  CLAIM1_TURN2_MIN_KIND_HITS,
  probeTurn2PromptV2Control,
  probeTurn2PromptV2Treatment,
  scoreClaim1Turn2Quality,
} from "./workloads.ts";
import { parseArgv } from "../run.ts";

describe("order AB/BA", () => {
  it("randomizes first arm per repeat deterministically from seed", () => {
    const a = buildAbBaSchedule(5, "seed-a");
    const b = buildAbBaSchedule(5, "seed-a");
    assert.deepEqual(a.repeats.map((r) => r.order), b.repeats.map((r) => r.order));
    assert.equal(a.repeats.length, 5);
    assert.ok(a.repeats.some((r) => r.order === "AB"));
    assert.ok(a.repeats.some((r) => r.order === "BA"));
  });

  it("flattenSchedule preserves both arms per repeat", () => {
    const schedule = buildAbBaSchedule(3, "flat");
    const flat = flattenSchedule(schedule);
    assert.equal(flat.length, 6);
    assert.equal(new Set(flat.map((f) => f.repeatIndex)).size, 3);
  });
});

describe("stats", () => {
  it("computes median and improvement", () => {
    assert.equal(median([10, 20, 100]), 20);
    assert.equal(medianImprovement([100, 120], [80, 90]), (110 - 85) / 110);
  });

  it("summarizes distribution with quartiles", () => {
    const d = summarizeDistribution([1, 2, 3, 4, 5]);
    assert.equal(d.median, 3);
    assert.equal(d.min, 1);
    assert.equal(d.max, 5);
  });

  it("bootstrap CI is reproducible for fixed seed", () => {
    const seed = seedFromString("bench");
    const c1 = bootstrapMedianDiffCi({
      control: [100, 110, 120, 130, 140],
      treatment: [70, 80, 85, 90, 95],
      seed,
    });
    const c2 = bootstrapMedianDiffCi({
      control: [100, 110, 120, 130, 140],
      treatment: [70, 80, 85, 90, 95],
      seed,
    });
    assert.equal(c1.lower, c2.lower);
    assert.equal(c1.upper, c2.upper);
    assert.ok(c1.pointEstimate > 0);
  });
});

describe("claim1 v2 workloads", () => {
  it("matches turn-2 question across arms without fake prior context on control", () => {
    const c = probeTurn2PromptV2Control();
    const t = probeTurn2PromptV2Treatment();
    assert.match(c, /consumeJsonlLine/);
    assert.match(t, /consumeJsonlLine/);
    assert.match(c, /no prior thread/i);
    assert.doesNotMatch(c, /Using your prior context/);
    assert.match(t, /prior thread context/i);
  });

  it("scores turn-2 rubric by named JSONL kinds", () => {
    const pass = scoreClaim1Turn2Quality(
      "kinds: thread.started, turn.started, turn.completed, item.completed",
    );
    assert.ok(pass.hits.length >= CLAIM1_TURN2_MIN_KIND_HITS);
    const fail = scoreClaim1Turn2Quality("no kinds listed");
    assert.ok(fail.hits.length < CLAIM1_TURN2_MIN_KIND_HITS);
    assert.ok(fail.notes.length > 0);
  });
});

describe("spawn snapshot merge", () => {
  it("does not double-count spawns when merging per-turn snapshots", () => {
    const fakeResult = {
      ok: true,
      exitCode: 0,
      content: "",
      profile: "probe" as const,
      command: "codex",
      outputPath: "",
      contentSource: "output-file" as const,
      usage: undefined,
      usageReported: false,
      parseErrors: 0,
      retrySafe: false,
    };
    const c1 = createLiveRunCounters();
    c1.spawnCount = 1;
    const c2 = createLiveRunCounters();
    c2.spawnCount = 1;
    const merged = mergeTrialMetrics([
      metricsFromRunSnapshot(fakeResult, 1000, c1, 1),
      metricsFromRunSnapshot(fakeResult, 2000, c2, 1),
    ]);
    assert.equal(merged.spawnCount, 2);
    assert.equal(merged.wallMs, 3000);
  });
});

describe("cli protocol", () => {
  it("defaults protocol to v2 and accepts v1", () => {
    assert.equal(parseArgv([]).protocol, "v2");
    assert.equal(parseArgv(["--protocol", "v1"]).protocol, "v1");
  });
});

describe("gates + report", () => {
  function syntheticTrials(claimId: TrialRecord["claimId"], controlWall: number[], treatmentWall: number[]): TrialRecord[] {
    const trials: TrialRecord[] = [];
    for (let i = 0; i < controlWall.length; i++) {
      trials.push({
        claimId,
        repeatIndex: i,
        arm: "control",
        order: "AB",
        sequenceInBlock: 0,
        metrics: {
          wallMs: controlWall[i]!,
          spawnCount: 2,
          toolCallCount: 5,
          providerTurnCount: 2,
          inputTokens: 1000,
          cachedInputTokens: 0,
          outputTokens: 200,
          reasoningOutputTokens: 0,
          ok: true,
          exitCode: 0,
        },
      });
    }
    for (let i = 0; i < treatmentWall.length; i++) {
      trials.push({
        claimId,
        repeatIndex: i,
        arm: "treatment",
        order: "AB",
        sequenceInBlock: 1,
        metrics: {
          wallMs: treatmentWall[i]!,
          spawnCount: 1,
          toolCallCount: 3,
          providerTurnCount: 2,
          inputTokens: 700,
          cachedInputTokens: 100,
          outputTokens: 180,
          reasoningOutputTokens: 0,
          ok: true,
          exitCode: 0,
        },
      });
    }
    return trials;
  }

  it("pre-registered gates exist for all claims", () => {
    assert.ok(PRE_REGISTERED_GATES["1"].minMedianImprovement > 0);
    assert.equal(Object.keys(PRE_REGISTERED_GATES).length, 4);
  });

  it("evaluates proven when improvement exceeds gate", () => {
    const result = evaluateClaim("1", {
      structuralPassed: true,
      structuralNotes: ["ok"],
      liveTrials: syntheticTrials("1", [100, 100, 100, 100, 100], [70, 70, 70, 70, 70]),
      seedMaterial: "synthetic",
    });
    assert.equal(result.verdict, "proven");
    assert.ok(result.medianImprovement >= PRE_REGISTERED_GATES["1"].minMedianImprovement);
  });

  it("pairs bootstrap arms by repeatIndex even when push order is interleaved", () => {
    const trials: TrialRecord[] = [
      {
        claimId: "1",
        repeatIndex: 0,
        arm: "treatment",
        order: "BA",
        sequenceInBlock: 0,
        metrics: {
          wallMs: 70,
          spawnCount: 2,
          toolCallCount: 0,
          providerTurnCount: 2,
          inputTokens: 1,
          cachedInputTokens: 0,
          outputTokens: 1,
          reasoningOutputTokens: 0,
          ok: true,
          exitCode: 0,
        },
      },
      {
        claimId: "1",
        repeatIndex: 0,
        arm: "control",
        order: "BA",
        sequenceInBlock: 1,
        metrics: {
          wallMs: 100,
          spawnCount: 2,
          toolCallCount: 0,
          providerTurnCount: 2,
          inputTokens: 1,
          cachedInputTokens: 0,
          outputTokens: 1,
          reasoningOutputTokens: 0,
          ok: true,
          exitCode: 0,
        },
      },
      {
        claimId: "1",
        repeatIndex: 1,
        arm: "control",
        order: "AB",
        sequenceInBlock: 0,
        metrics: {
          wallMs: 110,
          spawnCount: 2,
          toolCallCount: 0,
          providerTurnCount: 2,
          inputTokens: 1,
          cachedInputTokens: 0,
          outputTokens: 1,
          reasoningOutputTokens: 0,
          ok: true,
          exitCode: 0,
        },
      },
      {
        claimId: "1",
        repeatIndex: 1,
        arm: "treatment",
        order: "AB",
        sequenceInBlock: 1,
        metrics: {
          wallMs: 80,
          spawnCount: 2,
          toolCallCount: 0,
          providerTurnCount: 2,
          inputTokens: 1,
          cachedInputTokens: 0,
          outputTokens: 1,
          reasoningOutputTokens: 0,
          ok: true,
          exitCode: 0,
        },
      },
    ];
    const result = evaluateClaim("1", {
      structuralPassed: true,
      structuralNotes: ["ok"],
      liveTrials: trials,
      seedMaterial: "pair-order",
    });
    assert.deepEqual(result.control.wallMs, [100, 110]);
    assert.deepEqual(result.treatment.wallMs, [70, 80]);
  });

  it("evaluates falsified when improvement below gate", () => {
    const result = evaluateClaim("1", {
      structuralPassed: true,
      structuralNotes: ["ok"],
      liveTrials: syntheticTrials("1", [100, 100, 100, 100, 100], [98, 99, 97, 96, 95]),
      seedMaterial: "synthetic",
    });
    assert.equal(result.verdict, "falsified");
  });

  it("renders markdown report with environment block", () => {
    const report: BenchmarkReport = {
      schemaVersion: 1,
      environment: {
        timestamp: "2026-08-03T00:00:00.000Z",
        os: "test",
        nodeVersion: "v22",
        codexVersion: "0.0.0",
        gitSha: "abc",
        gitBranch: "main",
        profile: "probe",
        trialsPerArm: 5,
        dryRun: false,
        claims: ["1"],
      },
      claims: [
        evaluateClaim("1", {
          structuralPassed: true,
          structuralNotes: ["PASS"],
          liveTrials: syntheticTrials("1", [100, 100, 100, 100, 100], [70, 70, 70, 70, 70]),
          seedMaterial: "synthetic",
        }),
      ],
      summary: { proven: 1, falsified: 0, inconclusive: 0, qualityRegression: 0, skipped: 0 },
    };
    const md = renderMarkdownReport(report);
    assert.match(md, /Codex-headless optimization benchmark report/);
    assert.match(md, /Claim 1/);
    assert.match(md, /Raw trials/);
  });
});
