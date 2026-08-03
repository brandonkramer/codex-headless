import { buildAbBaSchedule, flattenSchedule } from "./lib/order.ts";
import { collectEnvironment } from "./lib/env.ts";
import { evaluateClaim, summarizeReport } from "./lib/gates.ts";
import { CLAIM_RUNNERS, setClaim1Protocol } from "./lib/live/claims.ts";
import { writeReport } from "./lib/report.ts";
import { runStructuralProofs, REPO_ROOT } from "./lib/structural.ts";
import type { BenchmarkProtocol, BenchmarkReport, ClaimId, ClaimResult } from "./lib/types.ts";
import { COOLDOWN_MS } from "./lib/workloads.ts";
import { sleep } from "./lib/live/exec-helper.ts";

export interface BenchmarkCliOptions {
  trialsPerArm: number;
  dryRun: boolean;
  structuralOnly: boolean;
  liveOnly: boolean;
  claims: ClaimId[];
  outputDir: string;
  protocol: BenchmarkProtocol;
}

export function parseClaimsArg(raw: string | undefined): ClaimId[] {
  if (!raw || raw === "all") return ["1", "2", "3", "4"];
  const ids = raw.split(",").map((s) => s.trim()) as ClaimId[];
  for (const id of ids) {
    if (!["1", "2", "3", "4"].includes(id)) {
      throw new Error(`invalid claim id: ${id}`);
    }
  }
  return ids;
}

export function parseArgv(argv: string[]): BenchmarkCliOptions {
  let trialsPerArm = 5;
  let dryRun = false;
  let structuralOnly = false;
  let liveOnly = false;
  let claims: ClaimId[] = ["1", "2", "3", "4"];
  let outputDir = `${REPO_ROOT}/benchmarks/out`;
  let protocol: BenchmarkProtocol = "v2";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--trials") {
      trialsPerArm = Number(argv[++i]);
      if (!Number.isFinite(trialsPerArm) || trialsPerArm < 1) {
        throw new Error("--trials must be >= 1");
      }
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--structural-only") {
      structuralOnly = true;
    } else if (arg === "--live-only") {
      liveOnly = true;
    } else if (arg === "--claims") {
      claims = parseClaimsArg(argv[++i]);
    } else if (arg === "--output") {
      outputDir = argv[++i] ?? outputDir;
    } else if (arg === "--protocol") {
      const raw = argv[++i];
      if (raw !== "v1" && raw !== "v2") {
        throw new Error("--protocol must be v1 or v2");
      }
      protocol = raw;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`unknown arg: ${arg}`);
    }
  }

  if (structuralOnly && liveOnly) {
    throw new Error("--structural-only and --live-only are mutually exclusive");
  }

  return { trialsPerArm, dryRun, structuralOnly, liveOnly, claims, outputDir, protocol };
}

function printHelp(): void {
  process.stdout.write(`Usage: pnpm run benchmark -- [options]

Options:
  --trials N           Repeats per arm (default 5; claim-1 v2 recommends 21)
  --dry-run            Plan schedule only; no live Codex calls
  --structural-only    Deterministic proofs only
  --live-only          Skip structural proofs
  --claims 1,2,3,4|all  Subset of claims (default all)
  --protocol v1|v2     Claim-1 live protocol (default v2; see benchmarks/PLAN-v2.md)
  --output DIR         Report directory (default benchmarks/out)
`);
}

export async function runBenchmark(opts: BenchmarkCliOptions): Promise<BenchmarkReport> {
  setClaim1Protocol(opts.protocol);

  const env = await collectEnvironment({
    repoRoot: REPO_ROOT,
    trialsPerArm: opts.trialsPerArm,
    dryRun: opts.dryRun,
    claims: opts.claims,
    protocol: opts.protocol,
  });

  const structural = runStructuralProofs();
  const seedMaterial = `${env.gitSha}:${env.timestamp}`;
  const claimResults: ClaimResult[] = [];

  for (const claimId of opts.claims) {
    const struct = structural[claimId];
    const structuralPassed = struct.passed;
    const structuralNotes = struct.notes;

    if (opts.dryRun) {
      const schedule = buildAbBaSchedule(opts.trialsPerArm, `${seedMaterial}:${claimId}`);
      const flat = flattenSchedule(schedule);
      process.stderr.write(
        `\n[benchmark] claim ${claimId} dry-run schedule (protocol=${opts.protocol}, seed=${schedule.seed}):\n`,
      );
      for (const step of flat) {
        process.stderr.write(
          `  repeat=${step.repeatIndex} arm=${step.arm} order=${step.order} seq=${step.sequenceInBlock}\n`,
        );
      }
      claimResults.push(
        evaluateClaim(claimId, {
          structuralPassed,
          structuralNotes,
          liveTrials: [],
          seedMaterial,
          skipped: true,
        }),
      );
      continue;
    }

    if (opts.structuralOnly) {
      claimResults.push(
        evaluateClaim(claimId, {
          structuralPassed,
          structuralNotes,
          liveTrials: [],
          seedMaterial,
          skipped: true,
        }),
      );
      continue;
    }

    const liveTrials = [];
    const schedule = buildAbBaSchedule(opts.trialsPerArm, `${seedMaterial}:${claimId}`);
    const runner = CLAIM_RUNNERS[claimId];

    process.stderr.write(
      `\n[benchmark] claim ${claimId} live trials (sequential, n=${opts.trialsPerArm}/arm, protocol=${opts.protocol})\n`,
    );

    // Warmup once per arm before timed repeats (PLAN / PLAN-v2).
    for (const arm of ["control", "treatment"] as const) {
      process.stderr.write(`[benchmark] warmup claim=${claimId} arm=${arm} (once)\n`);
      await runner.warmup(arm);
      await sleep(COOLDOWN_MS);
    }

    for (const repeat of schedule.repeats) {
      for (let seq = 0; seq < repeat.sequence.length; seq++) {
        const arm = repeat.sequence[seq]!;
        process.stderr.write(
          `[benchmark] trial claim=${claimId} arm=${arm} repeat=${repeat.repeatIndex} order=${repeat.order}\n`,
        );
        const trial = await runner.run(repeat.repeatIndex, arm, repeat.order, seq);
        liveTrials.push(trial);
        await sleep(COOLDOWN_MS);
      }
    }

    claimResults.push(
      evaluateClaim(claimId, {
        structuralPassed: opts.liveOnly ? true : structuralPassed,
        structuralNotes: opts.liveOnly ? ["live-only: structural checks skipped"] : structuralNotes,
        liveTrials,
        seedMaterial,
      }),
    );
  }

  const report: BenchmarkReport = {
    schemaVersion: 1,
    environment: env,
    claims: claimResults,
    summary: summarizeReport(claimResults),
  };

  if (!opts.dryRun) {
    const paths = await writeReport(report, opts.outputDir);
    process.stderr.write(`\n[benchmark] wrote ${paths.jsonPath}\n[benchmark] wrote ${paths.mdPath}\n`);
  }

  return report;
}

async function main(): Promise<void> {
  const opts = parseArgv(process.argv.slice(2));
  const report = await runBenchmark(opts);
  if (opts.dryRun) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("benchmarks/run.ts") || process.argv[1].endsWith("benchmarks/run.js"));

if (isDirectRun) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
