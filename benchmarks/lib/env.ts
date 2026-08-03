import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { platform, release, arch } from "node:os";
import type { EnvironmentMeta, ClaimId, BenchmarkProtocol } from "./types.ts";

const execFileAsync = promisify(execFile);

export async function resolveGitMeta(cwd: string): Promise<{ sha: string; branch: string }> {
  try {
    const { stdout: sha } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd });
    const { stdout: branch } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
    });
    return { sha: sha.trim(), branch: branch.trim() };
  } catch {
    return { sha: "unknown", branch: "unknown" };
  }
}

export async function resolveCodexVersion(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("codex", ["--version"], { timeout: 5000 });
    return stdout.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

export async function collectEnvironment(opts: {
  repoRoot: string;
  trialsPerArm: number;
  dryRun: boolean;
  claims: ClaimId[];
  profile?: string;
  protocol?: BenchmarkProtocol;
}): Promise<EnvironmentMeta> {
  const git = await resolveGitMeta(opts.repoRoot);
  const codexVersion = await resolveCodexVersion();

  return {
    timestamp: new Date().toISOString(),
    os: `${platform()} ${release()} ${arch()}`,
    nodeVersion: process.version,
    codexVersion,
    gitSha: git.sha,
    gitBranch: git.branch,
    profile: opts.profile ?? "probe (live benchmarks)",
    trialsPerArm: opts.trialsPerArm,
    dryRun: opts.dryRun,
    claims: opts.claims,
    protocol: opts.protocol,
  };
}
