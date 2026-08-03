/** Shared benchmark types. */

export type ClaimId = "1" | "2" | "3" | "4";

export type ArmLabel = "control" | "treatment";

export type TrialOrder = "AB" | "BA";

export interface TrialMetrics {
  wallMs: number;
  timeToFirstEventMs?: number;
  timeToFirstAgentMessageMs?: number;
  spawnCount: number;
  toolCallCount: number;
  providerTurnCount: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  ok: boolean;
  exitCode: number;
  turnError?: string;
  threadId?: string;
  qualityScore?: number;
  qualityNotes?: string[];
}

export interface TrialRecord {
  claimId: ClaimId;
  repeatIndex: number;
  arm: ArmLabel;
  order: TrialOrder;
  sequenceInBlock: number;
  metrics: TrialMetrics;
  jsonlPath?: string;
  notes?: string;
}

export interface ArmSummary {
  arm: ArmLabel;
  n: number;
  wallMs: number[];
  toolCallCount: number[];
  inputTokens: number[];
  spawnCount: number[];
  okRate: number;
  distribution: {
    wallMs: DistributionSummary;
    toolCallCount: DistributionSummary;
    inputTokens: DistributionSummary;
  };
}

export interface DistributionSummary {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  mean: number;
}

export interface BootstrapCi {
  pointEstimate: number;
  lower: number;
  upper: number;
  resamples: number;
  metric: string;
  description: string;
}

export type ClaimVerdict =
  | "proven"
  | "falsified"
  | "inconclusive"
  | "quality_regression"
  | "skipped";

export interface ClaimGate {
  claimId: ClaimId;
  speedMetric: string;
  minMedianImprovement: number;
  qualityRule: string;
}

export interface ClaimResult {
  claimId: ClaimId;
  title: string;
  structuralPassed: boolean;
  structuralNotes: string[];
  liveTrials: TrialRecord[];
  control: ArmSummary;
  treatment: ArmSummary;
  medianImprovement: number;
  bootstrapCi?: BootstrapCi;
  qualityRegression: boolean;
  verdict: ClaimVerdict;
  gate: ClaimGate;
}

/** Benchmark live protocol revision (claim-1 prompt/warmup/metrics). */
export type BenchmarkProtocol = "v1" | "v2";

export interface EnvironmentMeta {
  timestamp: string;
  os: string;
  nodeVersion: string;
  codexVersion: string;
  gitSha: string;
  gitBranch: string;
  profile: string;
  trialsPerArm: number;
  dryRun: boolean;
  claims: ClaimId[];
  protocol?: BenchmarkProtocol;
}

export interface BenchmarkReport {
  schemaVersion: 1;
  environment: EnvironmentMeta;
  claims: ClaimResult[];
  summary: {
    proven: number;
    falsified: number;
    inconclusive: number;
    qualityRegression: number;
    skipped: number;
  };
}
