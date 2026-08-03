import {
  buildEvidencePacket,
  buildLensReviewPrompt,
  buildPrepPrompt,
} from "../../../workflows/lib/review-panel-core.js";
import { assembleImplementPrompt, parseImplementBrief } from "../../../src/implement-brief.ts";
import {
  disposePersistentRunner,
  runPersistentTurn,
} from "../../../src/persistent-service.ts";
import { threadStartParamsForProfile } from "../../../src/profile-thread-config.ts";
import {
  createLiveRunCounters,
  mergeTrialMetrics,
  metricsFromRun,
  metricsFromRunSnapshot,
} from "../metrics.ts";
import type { ArmLabel, BenchmarkProtocol, ClaimId, TrialOrder, TrialRecord } from "../types.ts";
import {
  CLAIM1_TURN2_MIN_KIND_HITS,
  COOLDOWN_MS,
  independentLensPrompt,
  LENS_SUBSET,
  looseAnalysisPrompt,
  probeTurn1Prompt,
  probeTurn2Prompt,
  probeTurn2PromptV1,
  probeTurn2PromptV2Control,
  probeTurn2PromptV2Treatment,
  scoreClaim1Turn2Quality,
  structuredAnalysisBrief,
  syntheticEvidenceSections,
  WORKLOAD_CWD,
  WORKLOAD_FILE,
} from "../workloads.ts";
import { instrumentedExec, scoreJsonQuality, sleep } from "./exec-helper.ts";

/** Active claim-1 live protocol (set by benchmark runner). Default v2. */
let claim1Protocol: BenchmarkProtocol = "v2";

export function setClaim1Protocol(protocol: BenchmarkProtocol): void {
  claim1Protocol = protocol;
}

export function getClaim1Protocol(): BenchmarkProtocol {
  return claim1Protocol;
}

function turn2PromptForArm(arm: ArmLabel): string {
  if (claim1Protocol === "v1") return probeTurn2PromptV1();
  return arm === "control" ? probeTurn2PromptV2Control() : probeTurn2PromptV2Treatment();
}

async function runTwoTurnClaim1(
  repeatIndex: number,
  arm: ArmLabel,
  order: TrialOrder,
  sequenceInBlock: number,
  opts: { ephemeralStart: boolean; resume: boolean },
): Promise<TrialRecord> {
  const t1Counters = createLiveRunCounters();
  const t1 = await instrumentedExec(
    { profile: "probe", prompt: probeTurn1Prompt(), ephemeral: opts.ephemeralStart },
    t1Counters,
  );
  const t1Metrics = metricsFromRunSnapshot(
    t1.result,
    t1.wallMs,
    t1.counters,
    t1.counters.spawnCount,
    t1.jsonlText,
  );

  await sleep(COOLDOWN_MS);

  const t2Counters = createLiveRunCounters();
  const t2 = await instrumentedExec(
    {
      profile: "probe",
      prompt: turn2PromptForArm(arm),
      ...(opts.resume && t1.result.threadId
        ? { resumeThreadId: t1.result.threadId }
        : { ephemeral: true }),
    },
    t2Counters,
  );

  let quality: { score: number; notes: string[] } | undefined;
  let turn2RubricPass = true;
  if (claim1Protocol === "v2") {
    const q = scoreClaim1Turn2Quality(t2.result.content ?? "");
    quality = { score: q.score, notes: q.notes };
    turn2RubricPass = q.hits.length >= CLAIM1_TURN2_MIN_KIND_HITS;
  }

  const t2Metrics = metricsFromRunSnapshot(
    t2.result,
    t2.wallMs,
    t2.counters,
    t2.counters.spawnCount,
    t2.jsonlText,
    quality,
  );

  if (!turn2RubricPass) {
    t2Metrics.ok = false;
  }

  const metrics = mergeTrialMetrics([t1Metrics, t2Metrics]);

  return {
    claimId: "1",
    repeatIndex,
    arm,
    order,
    sequenceInBlock,
    metrics,
    notes: JSON.stringify({
      protocol: claim1Protocol,
      thread: t1.result.threadId ?? null,
      t1: {
        wallMs: t1Metrics.wallMs,
        inputTokens: t1Metrics.inputTokens,
        spawnCount: t1Metrics.spawnCount,
        ok: t1Metrics.ok,
      },
      t2: {
        wallMs: t2Metrics.wallMs,
        inputTokens: t2Metrics.inputTokens,
        spawnCount: t2Metrics.spawnCount,
        ok: t2Metrics.ok,
        qualityScore: t2Metrics.qualityScore,
      },
    }),
  };
}

export async function warmupClaim1(arm: ArmLabel): Promise<void> {
  if (arm === "control") {
    await instrumentedExec({ profile: "probe", prompt: probeTurn1Prompt(), ephemeral: true });
  } else {
    const t1 = await instrumentedExec({
      profile: "probe",
      prompt: probeTurn1Prompt(),
      ephemeral: false,
    });
    if (t1.result.threadId) {
      await instrumentedExec({
        profile: "probe",
        prompt: turn2PromptForArm("treatment"),
        resumeThreadId: t1.result.threadId,
      });
    }
  }
}

export async function runClaim1Trial(
  repeatIndex: number,
  arm: ArmLabel,
  order: TrialOrder,
  sequenceInBlock: number,
): Promise<TrialRecord> {
  if (arm === "control") {
    return runTwoTurnClaim1(repeatIndex, arm, order, sequenceInBlock, {
      ephemeralStart: true,
      resume: false,
    });
  }
  return runTwoTurnClaim1(repeatIndex, arm, order, sequenceInBlock, {
    ephemeralStart: false,
    resume: true,
  });
}

async function runSharedEvidenceArm(
  repeatIndex: number,
  arm: ArmLabel,
  order: TrialOrder,
  sequenceInBlock: number,
): Promise<TrialRecord> {
  const counters = createLiveRunCounters();
  const scope = `read-only review of ${WORKLOAD_FILE} exports`;
  const prepPrompt = buildPrepPrompt(scope, WORKLOAD_CWD);

  const prep = await instrumentedExec({ profile: "probe", prompt: prepPrompt, ephemeral: true }, counters);
  const sections = syntheticEvidenceSections();
  const packet = buildEvidencePacket(sections);

  let totalWall = prep.wallMs;
  let lensOk = prep.result.ok;
  const lensMetrics = [metricsFromRun(prep.result, prep.wallMs, prep.counters, prep.jsonlText)];

  for (const lens of LENS_SUBSET) {
    await sleep(COOLDOWN_MS);
    const lensPrompt = buildLensReviewPrompt(lens, scope, WORKLOAD_CWD, packet);
    const lr = await instrumentedExec(
      { profile: "probe", prompt: lensPrompt, ephemeral: true },
      counters,
    );
    totalWall += lr.wallMs;
    lensOk = lensOk && lr.result.ok;
    const q = scoreJsonQuality(lr.result.content, ["lens", "verdict", "findings"]);
    lensMetrics.push(
      metricsFromRun(lr.result, lr.wallMs, lr.counters, lr.jsonlText, q),
    );
  }

  const merged = mergeTrialMetrics(lensMetrics);
  merged.wallMs = totalWall;
  merged.ok = lensOk;

  return {
    claimId: "2",
    repeatIndex,
    arm,
    order,
    sequenceInBlock,
    metrics: merged,
    notes: `shared packet digest=${packet.digest}`,
  };
}

async function runIndependentRediscoveryArm(
  repeatIndex: number,
  arm: ArmLabel,
  order: TrialOrder,
  sequenceInBlock: number,
): Promise<TrialRecord> {
  const counters = createLiveRunCounters();
  let totalWall = 0;
  let ok = true;
  const parts = [];

  for (const lens of LENS_SUBSET) {
    const prompt = independentLensPrompt(lens.id, lens.focus);
    const run = await instrumentedExec({ profile: "probe", prompt, ephemeral: true }, counters);
    totalWall += run.wallMs;
    ok = ok && run.result.ok;
    const q = scoreJsonQuality(run.result.content, ["lens", "verdict", "findings"]);
    parts.push(metricsFromRun(run.result, run.wallMs, run.counters, run.jsonlText, q));
    await sleep(COOLDOWN_MS);
  }

  const merged = mergeTrialMetrics(parts);
  merged.wallMs = totalWall;
  merged.ok = ok;

  return {
    claimId: "2",
    repeatIndex,
    arm,
    order,
    sequenceInBlock,
    metrics: merged,
    notes: "independent lens prep per lens",
  };
}

export async function warmupClaim2(): Promise<void> {
  await instrumentedExec({
    profile: "probe",
    prompt: buildPrepPrompt(`warmup ${WORKLOAD_FILE}`, WORKLOAD_CWD),
    ephemeral: true,
  });
}

export async function runClaim2Trial(
  repeatIndex: number,
  arm: ArmLabel,
  order: TrialOrder,
  sequenceInBlock: number,
): Promise<TrialRecord> {
  if (arm === "treatment") {
    return runSharedEvidenceArm(repeatIndex, arm, order, sequenceInBlock);
  }
  return runIndependentRediscoveryArm(repeatIndex, arm, order, sequenceInBlock);
}

export async function warmupClaim3(arm: ArmLabel): Promise<void> {
  disposePersistentRunner();
  if (arm === "control") {
    await instrumentedExec({ profile: "probe", prompt: probeTurn1Prompt(), ephemeral: true });
  } else {
    const key = `bench-warm-${Date.now()}`;
    await runPersistentTurn({
      sessionKey: key,
      cwd: WORKLOAD_CWD,
      input: [{ type: "text", text: probeTurn1Prompt() }],
      threadStart: threadStartParamsForProfile("probe", { ephemeral: true }),
    });
    disposePersistentRunner();
  }
}

async function runFreshEphemeralTurn2(
  repeatIndex: number,
  arm: ArmLabel,
  order: TrialOrder,
  sequenceInBlock: number,
): Promise<TrialRecord> {
  const counters = createLiveRunCounters();
  await instrumentedExec({ profile: "probe", prompt: probeTurn1Prompt(), ephemeral: true }, counters);
  await sleep(COOLDOWN_MS);
  const t2 = await instrumentedExec(
    { profile: "probe", prompt: probeTurn2Prompt(), ephemeral: true },
    counters,
  );
  const metrics = metricsFromRun(t2.result, t2.wallMs, t2.counters, t2.jsonlText);
  metrics.ok = t2.result.ok;

  return {
    claimId: "3",
    repeatIndex,
    arm,
    order,
    sequenceInBlock,
    metrics,
    notes: "turn2 only (cold exec spawn)",
  };
}

async function runWarmAppServerTurn2(
  repeatIndex: number,
  arm: ArmLabel,
  order: TrialOrder,
  sequenceInBlock: number,
): Promise<TrialRecord> {
  disposePersistentRunner();
  const sessionKey = `bench-claim3-${repeatIndex}-${Date.now()}`;
  const counters = createLiveRunCounters();
  counters.spawnCount += 1;

  const t1Started = Date.now();
  const t1 = await runPersistentTurn({
    sessionKey,
    cwd: WORKLOAD_CWD,
    input: [{ type: "text", text: probeTurn1Prompt() }],
    threadStart: threadStartParamsForProfile("probe", { ephemeral: true }),
  });
  const t1Wall = Date.now() - t1Started;

  await sleep(COOLDOWN_MS);

  const t2Started = Date.now();
  const t2 = await runPersistentTurn({
    sessionKey,
    cwd: WORKLOAD_CWD,
    input: [{ type: "text", text: probeTurn2Prompt() }],
  });
  const t2Wall = Date.now() - t2Started;

  disposePersistentRunner();

  const metrics = {
    wallMs: t2Wall,
    spawnCount: counters.spawnCount,
    toolCallCount: 0,
    providerTurnCount: 2,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    ok: t1.ok && t2.ok,
    exitCode: t2.ok ? 0 : 1,
    qualityNotes: [
      `t1Wall=${t1Wall}ms reusedProcess=${String(t2.reusedProcess)} reusedThread=${String(t2.reusedThread)}`,
    ],
  };

  return {
    claimId: "3",
    repeatIndex,
    arm,
    order,
    sequenceInBlock,
    metrics,
    notes: `sessionKey=${sessionKey} turn2 warm`,
  };
}

export async function runClaim3Trial(
  repeatIndex: number,
  arm: ArmLabel,
  order: TrialOrder,
  sequenceInBlock: number,
): Promise<TrialRecord> {
  if (arm === "control") {
    return runFreshEphemeralTurn2(repeatIndex, arm, order, sequenceInBlock);
  }
  return runWarmAppServerTurn2(repeatIndex, arm, order, sequenceInBlock);
}

export async function warmupClaim4(arm: ArmLabel): Promise<void> {
  const prompt =
    arm === "treatment"
      ? assembleImplementPrompt(parseImplementBrief(structuredAnalysisBrief()))
      : looseAnalysisPrompt();
  await instrumentedExec({ profile: "probe", prompt, ephemeral: true });
}

export async function runClaim4Trial(
  repeatIndex: number,
  arm: ArmLabel,
  order: TrialOrder,
  sequenceInBlock: number,
): Promise<TrialRecord> {
  const counters = createLiveRunCounters();
  const prompt =
    arm === "treatment"
      ? assembleImplementPrompt(parseImplementBrief(structuredAnalysisBrief()))
      : looseAnalysisPrompt();

  const run = await instrumentedExec({ profile: "probe", prompt, ephemeral: true }, counters);
  const quality = scoreJsonQuality(run.result.content, ["exports", "invariants", "notes"]);

  return {
    claimId: "4" as ClaimId,
    repeatIndex,
    arm,
    order,
    sequenceInBlock,
    metrics: metricsFromRun(run.result, run.wallMs, counters, run.jsonlText, quality),
  };
}

export type ClaimRunner = (
  repeatIndex: number,
  arm: ArmLabel,
  order: TrialOrder,
  sequenceInBlock: number,
) => Promise<TrialRecord>;

export type WarmupRunner = (arm: ArmLabel) => Promise<void>;

export const CLAIM_RUNNERS: Record<
  ClaimId,
  { run: ClaimRunner; warmup: WarmupRunner }
> = {
  "1": { run: runClaim1Trial, warmup: warmupClaim1 },
  "2": { run: runClaim2Trial, warmup: () => warmupClaim2() },
  "3": { run: runClaim3Trial, warmup: warmupClaim3 },
  "4": { run: runClaim4Trial, warmup: warmupClaim4 },
};
