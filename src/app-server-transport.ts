/**
 * Real stdio NDJSON JSON-RPC transport for `codex app-server --listen stdio://`.
 * Framing is newline-delimited JSON (Content-Length is rejected by app-server).
 */

import { createInterface } from "node:readline";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import spawn from "cross-spawn";
import type {
  AppServerTransport,
  JsonRpcInbound,
} from "./persistent-runner.ts";

export type AppServerTransportOptions = {
  /** Override spawn (tests). Defaults to `codex app-server --listen stdio://`. */
  spawnProcess?: () => ChildProcessWithoutNullStreams;
  /** Working directory for the app-server process. */
  cwd?: string;
  /** Extra CLI args after `app-server` (no `-p`; use `-c` overlays). */
  extraArgs?: string[];
  onStderr?: (line: string) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
};

type Handler = (msg: JsonRpcInbound) => void;

function defaultSpawn(
  cwd: string | undefined,
  extraArgs: string[],
): ChildProcessWithoutNullStreams {
  return spawn(
    "codex",
    ["app-server", "--listen", "stdio://", ...extraArgs],
    {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    },
  ) as ChildProcessWithoutNullStreams;
}

function parseInboundLine(line: string): JsonRpcInbound | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const msg = JSON.parse(trimmed) as unknown;
    if (!msg || typeof msg !== "object") return null;
    return msg as JsonRpcInbound;
  } catch {
    return null;
  }
}

/**
 * ChildProcess-backed NDJSON transport. One process; many RPC calls.
 */
export class ChildProcessAppServerTransport implements AppServerTransport {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly handlers = new Set<Handler>();
  private readonly onStderr?: (line: string) => void;
  private readonly onExit?: (
    code: number | null,
    signal: NodeJS.Signals | null,
  ) => void;
  private stdoutClosed = false;
  #closed = false;

  constructor(opts: AppServerTransportOptions = {}) {
    this.onStderr = opts.onStderr;
    this.onExit = opts.onExit;
    this.child =
      opts.spawnProcess?.() ??
      defaultSpawn(opts.cwd, opts.extraArgs ?? []);

    const rl = createInterface({ input: this.child.stdout });
    rl.on("line", (line) => {
      const msg = parseInboundLine(line);
      if (!msg) return;
      for (const h of [...this.handlers]) h(msg);
    });
    rl.on("close", () => {
      this.stdoutClosed = true;
      if (!this.#closed) this.markClosed("stdout closed");
    });

    this.child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      if (!this.onStderr) return;
      for (const line of text.split(/\r?\n/)) {
        const t = line.trim();
        if (t) this.onStderr(t);
      }
    });

    this.child.on("error", (err) => {
      this.markClosed(err.message);
    });

    this.child.on("close", (code, signal) => {
      this.onExit?.(code, signal);
      if (!this.#closed) {
        this.markClosed(
          `process exit code=${code ?? "null"} signal=${signal ?? "null"}`,
        );
      }
    });
  }

  get closed(): boolean {
    return this.#closed;
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  send(message: unknown): void {
    if (this.#closed || this.stdoutClosed) {
      throw new Error("app-server transport closed");
    }
    const line = `${JSON.stringify(message)}\n`;
    const ok = this.child.stdin.write(line);
    if (!ok) {
      // Backpressure: still accepted into buffer; no wait required for headless turns.
    }
  }

  subscribe(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    try {
      this.child.stdin.end();
    } catch {
      // ignore
    }
    try {
      this.child.kill("SIGTERM");
    } catch {
      // ignore
    }
    // Best-effort SIGKILL if still alive shortly after.
    setTimeout(() => {
      if (!this.child.killed) {
        try {
          this.child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
    }, 2_000).unref?.();
  }

  private markClosed(detail: string): void {
    if (this.#closed) return;
    this.#closed = true;
    // Notify subscribers with a synthetic error notification so waiters can fail.
    const errNotify: JsonRpcInbound = {
      method: "error",
      params: { message: `transport_crash: ${detail}` },
    };
    for (const h of [...this.handlers]) {
      try {
        h(errNotify);
      } catch {
        // ignore subscriber errors
      }
    }
    this.handlers.clear();
  }
}

/** Factory matching PersistentCodexRunner.createTransport. */
export function createAppServerTransport(
  opts: AppServerTransportOptions = {},
): AppServerTransport {
  return new ChildProcessAppServerTransport(opts);
}
