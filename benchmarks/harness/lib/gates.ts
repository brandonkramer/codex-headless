import {
  bootstrapMedianDiffCi,
  medianImprovement,
  okRate,
  relativeImprovementFromDiffCi,
  seedFromString,
  summarizeDistribution,
} from "./stats.ts";
import type {
  ArmLabel,
  ArmSummary,
  BenchmarkReport,
  BootstrapCi,
  ClaimGate,
  ClaimId,
  ClaimResult,
  ClaimVerdict,
  TrialRecord,
} from "./types.ts";

export const PRE_REGISTERED_GATES: Record<ClaimId, ClaimGate> = {
  "1": {
    claimId: "1",
    speedMetric: "total_wall_ms",
    minMedianImprovement: 0.1,
    qualityRule:
      "both turns ok in each trial; v2 also requires turn-2 content rubric (≥3 JSONL event kinds)",
  },
  "2": {
    claimId: "2",
    speedMetric: "total_wall_ms_or_input_tokens",
    minMedianImprovement: 0.15,
    qualityRule: "parseable lens JSON; ok rate within 20pp",
  },
  "3": {
    claimId: "3",
    speedMetric: "turn2_wall_ms",
    minMedianImprovement: 0.2,
    qualityRule: "both turns ok; treatment turn2 spawns <= control",
  },
  "4": {
    claimId: "4",
    speedMetric: "tool_calls_or_input_tokens",
    minMedianImprovement: 0.1,
    qualityRule: "treatment JSON rubric >= control",
  },
};

export const CLAIM_TITLES: Record<ClaimId, string> = {
  "1": "Persistent exec + resume vs two ephemeral execs",
  "2": "Shared-evidence review fan-out vs independent rediscovery",
  "3": "Persistent app-server warm turn vs fresh ephemeral exec",
  "4": "Structured implementation brief vs equivalent loose prompt",
};

function summarizeArm(trials: TrialRecord[], arm: ArmLabel): ArmSummary {
  // Sort by repeatIndex so paired bootstrap aligns control[i] with treatment[i].
  const rows = trials.filter((t) => t.arm === arm).sort((a, b) => a.repeatIndex - b.repeatIndex);
  const wallMs = rows.map((r) => r.metrics.wallMs);
  const toolCallCount = rows.map((r) => r.metrics.toolCallCount);
  const inputTokens = rows.map((r) => r.metrics.inputTokens);
  const spawnCount = rows.map((r) => r.metrics.spawnCount);

  return {
    arm,
    n: rows.length,
    wallMs,
    toolCallCount,
    inputTokens,
    spawnCount,
    okRate: okRate(rows.map((r) => r.metrics.ok)),
    distribution: {
      wallMs: summarizeDistribution(wallMs),
      toolCallCount: summarizeDistribution(toolCallCount),
      inputTokens: summarizeDistribution(inputTokens),
    },
  };
}

function speedImprovementForClaim(
  claimId: ClaimId,
  control: ArmSummary,
  treatment: ArmSummary,
): number {
  switch (claimId) {
    case "2": {
      const wall = medianImprovement(control.wallMs, treatment.wallMs);
      const tok = medianImprovement(control.inputTokens, treatment.inputTokens);
      return Math.max(wall, tok);
    }
    case "4": {
      const tools = medianImprovement(control.toolCallCount, treatment.toolCallCount);
      const tok = medianImprovement(control.inputTokens, treatment.inputTokens);
      return Math.max(tools, tok);
    }
    default:
      return medianImprovement(control.wallMs, treatment.wallMs);
  }
}

function qualityRegressionForClaim(
  claimId: ClaimId,
  control: ArmSummary,
  treatment: ArmSummary,
  trials: TrialRecord[],
): boolean {
  const threshold = 0.2;
  if (treatment.okRate < control.okRate - threshold) return true;

  if (claimId === "4") {
    const tScores = trials
      .filter((t) => t.arm === "treatment")
      .map((t) => t.metrics.qualityScore ?? 0);
    const cScores = trials
      .filter((t) => t.arm === "control")
      .map((t) => t.metrics.qualityScore ?? 0);
    if (tScores.length && cScores.length) {
      const tMed = tScores.sort((a, b) => a - b)[Math.floor(tScores.length / 2)]!;
      const cMed = cScores.sort((a, b) => a - b)[Math.floor(cScores.length / 2)]!;
      if (tMed < cMed - 0.25) return true;
    }
  }

  if (claimId === "3") {
    const cSpawn = trials.filter((t) => t.arm === "control").map((t) => t.metrics.spawnCount);
    const tSpawn = trials.filter((t) => t.arm === "treatment").map((t) => t.metrics.spawnCount);
    if (cSpawn.length && tSpawn.length) {
      const cMed = cSpawn.sort((a, b) => a - b)[Math.floor(cSpawn.length / 2)]!;
      const tMed = tSpawn.sort((a, b) => a - b)[Math.floor(tSpawn.length / 2)]!;
      if (tMed > cMed) return true;
    }
  }

  return false;
}

function bootstrapForClaim(
  claimId: ClaimId,
  control: ArmSummary,
  treatment: ArmSummary,
  seedMaterial: string,
): BootstrapCi | undefined {
  const seed = seedFromString(`${seedMaterial}:${claimId}`);
  let metric = "wallMs";
  let controlVals = control.wallMs;
  let treatmentVals = treatment.wallMs;

  if (claimId === "4") {
    metric = "toolCallCount";
    controlVals = control.toolCallCount;
    treatmentVals = treatment.toolCallCount;
  } else if (claimId === "2") {
    metric = "inputTokens";
    controlVals = control.inputTokens;
    treatmentVals = treatment.inputTokens;
  }

  if (controlVals.length === 0 || treatmentVals.length === 0) return undefined;

  const diffCi = bootstrapMedianDiffCi({
    control: controlVals,
    treatment: treatmentVals,
    seed,
    paired: controlVals.length === treatmentVals.length,
  });

  const controlMedian = [...controlVals].sort((a, b) => a - b)[Math.floor(controlVals.length / 2)]!;
  const rel = relativeImprovementFromDiffCi(controlMedian, diffCi);

  return {
    pointEstimate: rel.point,
    lower: rel.lower,
    upper: rel.upper,
    resamples: diffCi.resamples,
    metric,
    description: "Bootstrap 95% CI on relative median improvement (control−treatment)/control",
  };
}

export function evaluateClaim(
  claimId: ClaimId,
  opts: {
    structuralPassed: boolean;
    structuralNotes: string[];
    liveTrials: TrialRecord[];
    seedMaterial: string;
    skipped?: boolean;
  },
): ClaimResult {
  const gate = PRE_REGISTERED_GATES[claimId];
  if (opts.skipped) {
    return {
      claimId,
      title: CLAIM_TITLES[claimId],
      structuralPassed: opts.structuralPassed,
      structuralNotes: opts.structuralNotes,
      liveTrials: opts.liveTrials,
      control: summarizeArm(opts.liveTrials, "control"),
      treatment: summarizeArm(opts.liveTrials, "treatment"),
      medianImprovement: 0,
      qualityRegression: false,
      verdict: "skipped",
      gate,
    };
  }

  const control = summarizeArm(opts.liveTrials, "control");
  const treatment = summarizeArm(opts.liveTrials, "treatment");
  const improvement = speedImprovementForClaim(claimId, control, treatment);
  const qualityRegression = qualityRegressionForClaim(
    claimId,
    control,
    treatment,
    opts.liveTrials,
  );
  const bootstrapCi = bootstrapForClaim(claimId, control, treatment, opts.seedMaterial);

  let verdict: ClaimVerdict = "inconclusive";

  if (!opts.structuralPassed) {
    verdict = "falsified";
  } else if (qualityRegression) {
    verdict = "quality_regression";
  } else if (improvement >= gate.minMedianImprovement) {
    if (bootstrapCi && bootstrapCi.lower <= 0 && bootstrapCi.upper > 0) {
      verdict = "inconclusive";
    } else {
      verdict = "proven";
    }
  } else if (control.n > 0 && treatment.n > 0) {
    verdict = "falsified";
  }

  return {
    claimId,
    title: CLAIM_TITLES[claimId],
    structuralPassed: opts.structuralPassed,
    structuralNotes: opts.structuralNotes,
    liveTrials: opts.liveTrials,
    control,
    treatment,
    medianImprovement: improvement,
    bootstrapCi,
    qualityRegression,
    verdict,
    gate,
  };
}

export function summarizeReport(claims: ClaimResult[]): BenchmarkReport["summary"] {
  const summary = {
    proven: 0,
    falsified: 0,
    inconclusive: 0,
    qualityRegression: 0,
    skipped: 0,
  };
  for (const c of claims) {
    if (c.verdict === "proven") summary.proven += 1;
    else if (c.verdict === "falsified") summary.falsified += 1;
    else if (c.verdict === "inconclusive") summary.inconclusive += 1;
    else if (c.verdict === "quality_regression") summary.qualityRegression += 1;
    else if (c.verdict === "skipped") summary.skipped += 1;
  }
  return summary;
}
