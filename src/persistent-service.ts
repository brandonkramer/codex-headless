/**
 * Process-level singleton for PersistentCodexRunner + real app-server transport.
 * Opt-in only via MCP `persistentSessionKey` / dedicated app-server tool.
 */

import { createAppServerTransport } from "./app-server-transport.ts";
import {
  DEFAULT_IDLE_LEASE_MS,
  PersistentCodexRunner,
  type FallbackReason,
  type PersistentRunnerOptions,
  type RunTurnParams,
  type RunTurnResult,
} from "./persistent-runner.ts";

export type PersistentServiceOptions = {
  createTransport?: PersistentRunnerOptions["createTransport"];
  idleLeaseMs?: number;
  onFallback?: (reason: FallbackReason, detail?: string) => void;
  clientInfo?: PersistentRunnerOptions["clientInfo"];
};

let singleton: PersistentCodexRunner | null = null;

function defaultCreateTransport(): ReturnType<typeof createAppServerTransport> {
  return createAppServerTransport({
    onStderr: (line) => {
      process.stderr.write(`[codex-headless:app-server] ${line}\n`);
    },
  });
}

/** Get or create the process-wide persistent runner. */
export function getPersistentRunner(
  opts?: PersistentServiceOptions,
): PersistentCodexRunner {
  if (singleton) return singleton;
  singleton = new PersistentCodexRunner({
    createTransport: opts?.createTransport ?? defaultCreateTransport,
    idleLeaseMs: opts?.idleLeaseMs ?? DEFAULT_IDLE_LEASE_MS,
    onFallback: opts?.onFallback,
    clientInfo: opts?.clientInfo ?? {
      name: "codex-headless",
      title: "codex-headless MCP persistent",
      version: "0.2.14",
    },
  });
  return singleton;
}

/** Test seam: replace or clear the singleton. */
export function setPersistentRunnerForTests(
  runner: PersistentCodexRunner | null,
): void {
  if (singleton && singleton !== runner) {
    singleton.dispose();
  }
  singleton = runner;
}

export function disposePersistentRunner(): void {
  if (!singleton) return;
  singleton.dispose();
  singleton = null;
}

export async function runPersistentTurn(
  params: RunTurnParams,
  opts?: PersistentServiceOptions,
): Promise<RunTurnResult> {
  return getPersistentRunner(opts).runTurn(params);
}

/**
 * Auto-fallback to `codex exec` is safe only when no mutating turn can have started.
 * Mid-turn / approval / busy failures must surface explicitly.
 */
export function canSafelyFallbackToExec(
  reason: FallbackReason | undefined,
  detail?: { turnId?: string },
): boolean {
  if (!reason) return false;
  if (reason === "initialize_failed") return true;
  if (reason === "reconnect_failed") return true;
  // Crash before turn id assigned → no model turn / mutation yet.
  if (reason === "transport_crash" && !detail?.turnId) return true;
  return false;
}
