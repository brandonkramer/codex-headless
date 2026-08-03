import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BenchmarkReport, ClaimResult, DistributionSummary } from "./types.ts";

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtDist(label: string, d: DistributionSummary): string {
  return (
    `| ${label} | ${d.min.toFixed(0)} | ${d.q1.toFixed(0)} | ${d.median.toFixed(0)} | ` +
    `${d.q3.toFixed(0)} | ${d.max.toFixed(0)} | ${d.mean.toFixed(0)} |`
  );
}

function claimSection(c: ClaimResult): string {
  const lines: string[] = [
    `## Claim ${c.claimId}: ${c.title}`,
    "",
    `**Verdict:** \`${c.verdict}\``,
    "",
    "### Pre-registered gate",
    "",
    `- Speed metric: ${c.gate.speedMetric}`,
    `- Min median improvement: ${fmtPct(c.gate.minMedianImprovement)}`,
    `- Quality: ${c.gate.qualityRule}`,
    "",
    "### Structural proof",
    "",
    `- Passed: ${c.structuralPassed ? "yes" : "no"}`,
    ...c.structuralNotes.map((n) => `- ${n}`),
    "",
    "### Live summary",
    "",
    `| Arm | n | ok rate | median wall (ms) | median input tokens | median tool calls | median spawns |`,
    `| --- | ---: | ---: | ---: | ---: | ---: | ---: |`,
    `| control | ${c.control.n} | ${fmtPct(c.control.okRate)} | ${c.control.distribution.wallMs.median.toFixed(0)} | ${c.control.distribution.inputTokens.median.toFixed(0)} | ${c.control.distribution.toolCallCount.median.toFixed(0)} | ${summarizeSpawns(c.control.spawnCount)} |`,
    `| treatment | ${c.treatment.n} | ${fmtPct(c.treatment.okRate)} | ${c.treatment.distribution.wallMs.median.toFixed(0)} | ${c.treatment.distribution.inputTokens.median.toFixed(0)} | ${c.treatment.distribution.toolCallCount.median.toFixed(0)} | ${summarizeSpawns(c.treatment.spawnCount)} |`,
    "",
    `Observed median improvement: **${fmtPct(c.medianImprovement)}**`,
  ];

  if (c.bootstrapCi) {
    lines.push(
      "",
      `Bootstrap 95% CI (${c.bootstrapCi.metric}): ${fmtPct(c.bootstrapCi.lower)} … ${fmtPct(c.bootstrapCi.upper)} (point ${fmtPct(c.bootstrapCi.pointEstimate)})`,
    );
  }

  if (c.liveTrials.length > 0) {
    lines.push("", "### Raw trials", "", "| repeat | arm | order | wall ms | tokens in | tools | spawns | ok |", "| ---: | --- | --- | ---: | ---: | ---: | ---: | --- |");
    for (const t of c.liveTrials) {
      lines.push(
        `| ${t.repeatIndex} | ${t.arm} | ${t.order} | ${t.metrics.wallMs.toFixed(0)} | ${t.metrics.inputTokens} | ${t.metrics.toolCallCount} | ${t.metrics.spawnCount} | ${t.metrics.ok ? "yes" : "no"} |`,
      );
    }

    lines.push("", "#### Distributions (wall ms)", "", "| arm | min | q1 | median | q3 | max | mean |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
    lines.push(fmtDist("control", c.control.distribution.wallMs));
    lines.push(fmtDist("treatment", c.treatment.distribution.wallMs));
  }

  return lines.join("\n");
}

function summarizeSpawns(spawns: number[]): string {
  if (spawns.length === 0) return "—";
  const sorted = [...spawns].sort((a, b) => a - b);
  return String(sorted[Math.floor(sorted.length / 2)]!);
}

export function renderMarkdownReport(report: BenchmarkReport): string {
  const env = report.environment;
  const lines = [
    "# Codex-headless optimization benchmark report",
    "",
    "## Environment",
    "",
    `| Field | Value |`,
    `| --- | --- |`,
    `| Timestamp | ${env.timestamp} |`,
    `| OS | ${env.os} |`,
    `| Node | ${env.nodeVersion} |`,
    `| Codex | ${env.codexVersion} |`,
    `| Git SHA | \`${env.gitSha}\` |`,
    `| Git branch | ${env.gitBranch} |`,
    `| Profile | ${env.profile} |`,
    `| Trials / arm | ${env.trialsPerArm} |`,
    `| Dry run | ${env.dryRun} |`,
    `| Claims | ${env.claims.join(", ")} |`,
    `| Protocol | ${env.protocol ?? "v1"} |`,
    "",
    "## Summary",
    "",
    `- Proven: ${report.summary.proven}`,
    `- Falsified: ${report.summary.falsified}`,
    `- Inconclusive: ${report.summary.inconclusive}`,
    `- Quality regression: ${report.summary.qualityRegression}`,
    `- Skipped: ${report.summary.skipped}`,
    "",
    "See [PLAN.md](../docs/PLAN.md) and [PLAN-v2.md](../docs/PLAN-v2.md) for methodology and pre-registered gates.",
    "",
  ];

  for (const c of report.claims) {
    lines.push(claimSection(c), "");
  }

  return lines.join("\n");
}

export async function writeReport(
  report: BenchmarkReport,
  outputDir: string,
): Promise<{ jsonPath: string; mdPath: string }> {
  await mkdir(outputDir, { recursive: true });
  const jsonPath = join(outputDir, "benchmark-report.json");
  const mdPath = join(outputDir, "benchmark-report.md");
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(mdPath, renderMarkdownReport(report), "utf8");
  return { jsonPath, mdPath };
}
