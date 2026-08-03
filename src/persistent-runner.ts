/**
 * Persistent Codex app-server session manager.
 *
 * Protocol (codex-cli 0.146.0, verified locally):
 *   `codex app-server --listen stdio://`  — NDJSON JSON-RPC (not Content-Length)
 *   client: initialize → notify initialized → thread/start → turn/start
 *   wait: turn/completed (and optional item/* deltas)
 *   resume: thread/resume { threadId }
 *   schemas: `codex app-server generate-json-schema --out DIR [--experimental]`
 *
 * Production transport: `src/app-server-transport.ts`
 * MCP opt-in: `persistentSessionKey` / `codex_headless_app_server_turn`
 * Default path remains `runCodexExec` (codex exec).
 */

export const DEFAULT_IDLE_LEASE_MS = 60_000;

/** Methods used by this runner (subset of app-server ClientRequest). */
export const APP_SERVER_METHODS = {
  initialize: "initialize",
  initialized: "initialized",
  threadStart: "thread/start",
  threadResume: "thread/resume",
  turnStart: "turn/start",
  turnInterrupt: "turn/interrupt",
} as const;

export type FallbackReason =
  | "transport_crash"
  | "reconnect_failed"
  | "initialize_failed"
  | "unsupported_server_request"
  | "session_busy"
  | "turn_failed";

export type JsonRpcId = string | number;

export type JsonRpcRequest = {
  jsonrpc?: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
};

export type JsonRpcNotification = {
  jsonrpc?: "2.0";
  method: string;
  params?: unknown;
};

export type JsonRpcResponse = {
  jsonrpc?: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export type JsonRpcInbound = JsonRpcResponse | JsonRpcNotification | JsonRpcRequest;

export interface AppServerTransport {
  send(message: unknown): void;
  subscribe(handler: (msg: JsonRpcInbound) => void): () => void;
  close(): void;
  /** True after close or unexpected death. */
  readonly closed: boolean;
}

export type SessionKey = string;

export type ThreadStartParamsLite = {
  cwd?: string | null;
  ephemeral?: boolean | null;
  approvalPolicy?: string | null;
  sandbox?: string | null;
  model?: string | null;
  config?: Record<string, unknown> | null;
};

export type TurnInputText = { type: "text"; text: string };

export type RunTurnParams = {
  sessionKey: SessionKey;
  input: TurnInputText[];
  /** Optional overrides forwarded to turn/start. */
  cwd?: string | null;
  model?: string | null;
  outputSchema?: unknown;
  threadStart?: ThreadStartParamsLite;
};

export type RunTurnResult = {
  ok: boolean;
  threadId: string;
  turnId?: string;
  /** Agent text collected from item/agentMessage/delta + turn/completed items when present. */
  content: string;
  fallback?: FallbackReason;
  error?: string;
  reusedProcess: boolean;
  reusedThread: boolean;
};

export type PersistentRunnerOptions = {
  createTransport: () => AppServerTransport;
  idleLeaseMs?: number;
  now?: () => number;
  clientInfo?: { name: string; title: string; version: string };
  /** Max reconnect attempts after crash before fallback. */
  maxReconnectAttempts?: number;
  onFallback?: (reason: FallbackReason, detail?: string) => void;
};

type Pending = {
  resolve: (value: JsonRpcResponse) => void;
  reject: (err: Error) => void;
};

type SessionState = {
  key: SessionKey;
  threadId: string;
  lastUsedAt: number;
  inFlight: boolean;
  /** True when process died and thread must be resumed after reconnect. */
  needsResume: boolean;
};

function isResponse(msg: JsonRpcInbound): msg is JsonRpcResponse {
  return "id" in msg && ("result" in msg || "error" in msg);
}

function isNotificationOrServerRequest(
  msg: JsonRpcInbound,
): msg is JsonRpcNotification | JsonRpcRequest {
  return typeof (msg as JsonRpcNotification).method === "string";
}

function extractAgentText(params: unknown): string {
  if (!params || typeof params !== "object") return "";
  const p = params as Record<string, unknown>;
  if (typeof p.delta === "string") return p.delta;
  if (typeof p.text === "string") return p.text;
  const item = p.item;
  if (item && typeof item === "object") {
    const content = (item as { text?: unknown; content?: unknown }).text;
    if (typeof content === "string") return content;
  }
  return "";
}

/**
 * Session-keyed app-server process lease.
 * One transport process; many logical sessions (threads); one in-flight turn per session.
 */
export class PersistentCodexRunner {
  private readonly createTransport: () => AppServerTransport;
  private readonly idleLeaseMs: number;
  private readonly now: () => number;
  private readonly clientInfo: { name: string; title: string; version: string };
  private readonly maxReconnectAttempts: number;
  private readonly onFallback?: (reason: FallbackReason, detail?: string) => void;

  private transport: AppServerTransport | null = null;
  private unsubscribe: (() => void) | null = null;
  private initialized = false;
  private nextId = 1;
  private readonly pending = new Map<string, Pending>();
  private readonly turnWaitRejects = new Set<(err: Error) => void>();
  /** Early turn notifications before waitTurnCompleted subscribes. */
  private readonly turnEventBuffer: Array<{ method: string; params?: unknown }> =
    [];
  private readonly sessions = new Map<SessionKey, SessionState>();
  private lastActivityAt = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private processGeneration = 0;

  constructor(opts: PersistentRunnerOptions) {
    this.createTransport = opts.createTransport;
    this.idleLeaseMs = opts.idleLeaseMs ?? DEFAULT_IDLE_LEASE_MS;
    this.now = opts.now ?? Date.now;
    this.clientInfo = opts.clientInfo ?? {
      name: "codex-headless",
      title: "codex-headless persistent-runner",
      version: "0.0.0-prototype",
    };
    this.maxReconnectAttempts = opts.maxReconnectAttempts ?? 1;
    this.onFallback = opts.onFallback;
  }

  /** Test/inspection helpers. */
  getSession(key: SessionKey): SessionState | undefined {
    return this.sessions.get(key);
  }

  sessionCount(): number {
    return this.sessions.size;
  }

  hasLiveProcess(): boolean {
    return this.transport !== null && !this.transport.closed && this.initialized;
  }

  async runTurn(params: RunTurnParams): Promise<RunTurnResult> {
    const existing = this.sessions.get(params.sessionKey);
    if (existing?.inFlight) {
      this.fallback("session_busy", params.sessionKey);
      return {
        ok: false,
        threadId: existing.threadId,
        content: "",
        fallback: "session_busy",
        error: `session ${params.sessionKey} already has an in-flight turn`,
        reusedProcess: this.hasLiveProcess(),
        reusedThread: true,
      };
    }

    // Reserve in-flight before any await so concurrent runTurn cannot race.
    let session: SessionState =
      existing ??
      ({
        key: params.sessionKey,
        threadId: "",
        lastUsedAt: this.now(),
        inFlight: true,
        needsResume: false,
      } satisfies SessionState);
    session.inFlight = true;
    session.lastUsedAt = this.now();
    this.sessions.set(params.sessionKey, session);

    let reusedProcess = this.hasLiveProcess();
    let reusedThread = Boolean(existing?.threadId) && !existing?.needsResume;

    try {
      await this.ensureProcess();
    } catch (err) {
      session.inFlight = false;
      if (!session.threadId) this.sessions.delete(params.sessionKey);
      const reason: FallbackReason =
        this.reconnectAttempts > 0 ? "reconnect_failed" : "initialize_failed";
      this.fallback(reason, err instanceof Error ? err.message : String(err));
      return {
        ok: false,
        threadId: session.threadId,
        content: "",
        fallback: reason,
        error: err instanceof Error ? err.message : String(err),
        reusedProcess: false,
        reusedThread: false,
      };
    }

    reusedProcess = reusedProcess && this.hasLiveProcess();

    try {
      if (!session.threadId) {
        const started = await this.rpc(APP_SERVER_METHODS.threadStart, {
          ephemeral: true,
          approvalPolicy: "never",
          ...params.threadStart,
        });
        if (started.error) {
          throw new Error(started.error.message);
        }
        session.threadId = readThreadId(started.result);
        session.needsResume = false;
        reusedThread = false;
      } else if (session.needsResume) {
        const resumed = await this.rpc(APP_SERVER_METHODS.threadResume, {
          threadId: session.threadId,
          excludeTurns: true,
        });
        if (resumed.error) {
          const started = await this.rpc(APP_SERVER_METHODS.threadStart, {
            ephemeral: true,
            approvalPolicy: "never",
            ...params.threadStart,
          });
          if (started.error) throw new Error(started.error.message);
          session.threadId = readThreadId(started.result);
          session.needsResume = false;
          reusedThread = false;
        } else {
          session.needsResume = false;
          reusedThread = true;
        }
      } else {
        reusedThread = true;
      }

      this.touchLease();

      const turnResult = await this.rpc(APP_SERVER_METHODS.turnStart, {
        threadId: session.threadId,
        input: params.input,
        ...(params.cwd !== undefined ? { cwd: params.cwd } : {}),
        ...(params.model !== undefined ? { model: params.model } : {}),
        ...(params.outputSchema !== undefined
          ? { outputSchema: params.outputSchema }
          : {}),
      });

      if (turnResult.error) {
        session.inFlight = false;
        this.fallback("turn_failed", turnResult.error.message);
        return {
          ok: false,
          threadId: session.threadId,
          content: "",
          fallback: "turn_failed",
          error: turnResult.error.message,
          reusedProcess,
          reusedThread,
        };
      }

      const turnId = readTurnId(turnResult.result);
      const content = await this.waitTurnCompleted(session.threadId, turnId);

      session.inFlight = false;
      session.lastUsedAt = this.now();
      this.touchLease();
      this.reconnectAttempts = 0;

      return {
        ok: true,
        threadId: session.threadId,
        turnId,
        content,
        reusedProcess,
        reusedThread,
      };
    } catch (err) {
      if (session) session.inFlight = false;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("transport_crash") || this.transport?.closed) {
        this.markAllNeedsResume();
        this.teardownTransport();
        this.fallback("transport_crash", msg);
        return {
          ok: false,
          threadId: session?.threadId ?? "",
          content: "",
          fallback: "transport_crash",
          error: msg,
          reusedProcess,
          reusedThread,
        };
      }
      this.fallback("turn_failed", msg);
      return {
        ok: false,
        threadId: session?.threadId ?? "",
        content: "",
        fallback: "turn_failed",
        error: msg,
        reusedProcess,
        reusedThread,
      };
    }
  }

  /** Force idle reaping (also invoked by lease timer). */
  reapIdle(now = this.now()): SessionKey[] {
    const dropped: SessionKey[] = [];
    for (const [key, session] of this.sessions) {
      if (session.inFlight) continue;
      if (now - session.lastUsedAt >= this.idleLeaseMs) {
        this.sessions.delete(key);
        dropped.push(key);
      }
    }
    if (this.sessions.size === 0 && this.hasLiveProcess()) {
      if (now - this.lastActivityAt >= this.idleLeaseMs) {
        this.teardownTransport();
      }
    }
    return dropped;
  }

  dispose(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.teardownTransport();
    this.sessions.clear();
  }

  /** Simulate / handle transport death (tests + subscriber). */
  handleTransportCrash(detail = "transport closed"): void {
    const err = new Error(`transport_crash: ${detail}`);
    for (const [, p] of this.pending) {
      p.reject(err);
    }
    this.pending.clear();
    for (const reject of this.turnWaitRejects) {
      reject(err);
    }
    this.turnWaitRejects.clear();
    this.markAllNeedsResume();
    this.teardownTransport();
  }

  private async ensureProcess(): Promise<void> {
    if (this.hasLiveProcess()) return;

    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      throw new Error("reconnect_failed: max attempts exceeded");
    }

    if (this.transport && this.transport.closed) {
      this.reconnectAttempts += 1;
      this.teardownTransport();
    } else if (!this.transport && this.processGeneration > 0) {
      this.reconnectAttempts += 1;
    }

    const transport = this.createTransport();
    this.transport = transport;
    this.initialized = false;
    this.processGeneration += 1;
    this.unsubscribe = transport.subscribe((msg) => this.onInbound(msg));

    const init = await this.rpc(APP_SERVER_METHODS.initialize, {
      clientInfo: this.clientInfo,
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
      },
    });
    if (init.error) {
      this.teardownTransport();
      throw new Error(`initialize_failed: ${init.error.message}`);
    }

    transport.send({
      jsonrpc: "2.0",
      method: APP_SERVER_METHODS.initialized,
    });
    this.initialized = true;
    this.lastActivityAt = this.now();
    this.touchLease();

    for (const session of this.sessions.values()) {
      session.needsResume = true;
    }
  }

  private onInbound(msg: JsonRpcInbound): void {
    this.lastActivityAt = this.now();

    if (isResponse(msg)) {
      const pending = this.pending.get(String(msg.id));
      if (pending) {
        this.pending.delete(String(msg.id));
        pending.resolve(msg);
      }
      return;
    }

    if (!isNotificationOrServerRequest(msg)) return;

    // Buffer turn stream events so waitTurnCompleted cannot miss a race where
    // turn/completed arrives in the same tick as turn/start's response.
    if (
      msg.method === "turn/completed" ||
      msg.method === "item/agentMessage/delta" ||
      msg.method === "error"
    ) {
      this.turnEventBuffer.push({ method: msg.method, params: msg.params });
      // Cap buffer — production turns stream many deltas.
      if (this.turnEventBuffer.length > 500) {
        this.turnEventBuffer.splice(0, this.turnEventBuffer.length - 500);
      }
    }

    // Server → client requests (approvals, tool calls) are not handled here.
    // Surface as fallback boundary for production wiring.
    if ("id" in msg && (msg as JsonRpcRequest).id !== undefined) {
      this.onFallback?.("unsupported_server_request", msg.method);
    }
  }

  private rpc(method: string, params?: unknown): Promise<JsonRpcResponse> {
    const transport = this.transport;
    if (!transport || transport.closed) {
      return Promise.reject(new Error("transport_crash: no live transport"));
    }
    const id = this.nextId++;
    const idKey = String(id);
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      this.pending.set(idKey, { resolve, reject });
      try {
        transport.send({ jsonrpc: "2.0", id, method, params });
      } catch (err) {
        this.pending.delete(idKey);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private waitTurnCompleted(threadId: string, turnId: string): Promise<string> {
    const transport = this.transport;
    if (!transport) {
      return Promise.reject(new Error("transport_crash: no live transport"));
    }

    return new Promise<string>((resolve, reject) => {
      let content = "";
      let settled = false;
      let unsub = (): void => {};

      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        this.turnWaitRejects.delete(fail);
        unsub();
        // Drop consumed turn stream buffer entries for this wait.
        this.turnEventBuffer.length = 0;
        fn();
      };

      const fail = (err: Error): void => {
        finish(() => reject(err));
      };
      this.turnWaitRejects.add(fail);

      const handleEvent = (method: string, params: unknown): void => {
        if (method === "item/agentMessage/delta") {
          content += extractAgentText(params);
          return;
        }

        if (method === "turn/completed") {
          const p = (params ?? {}) as Record<string, unknown>;
          const tid = typeof p.threadId === "string" ? p.threadId : undefined;
          const turn = p.turn as { id?: string; error?: { message?: string } } | undefined;
          if (tid && tid !== threadId) return;
          if (turn?.id && turn.id !== turnId) return;
          if (turn?.error?.message) {
            fail(new Error(turn.error.message));
            return;
          }
          finish(() => resolve(content || extractAgentText(params)));
          return;
        }

        if (method === "error") {
          fail(new Error(extractAgentText(params) || "app-server error"));
        }
      };

      // Replay anything that raced ahead of this waiter.
      for (const ev of [...this.turnEventBuffer]) {
        handleEvent(ev.method, ev.params);
        if (settled) return;
      }

      unsub = transport.subscribe((msg) => {
        if (!isNotificationOrServerRequest(msg)) return;
        handleEvent(msg.method, msg.params);
      });
    });
  }

  private touchLease(): void {
    this.lastActivityAt = this.now();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const delay = this.idleLeaseMs;
    this.idleTimer = setTimeout(() => {
      this.reapIdle(this.now());
      if (this.sessions.size > 0 || this.hasLiveProcess()) {
        this.touchLease();
      }
    }, Math.min(delay, 1_000));
    // Unref so tests/process can exit; ignore if unavailable.
    const t = this.idleTimer as { unref?: () => void };
    t.unref?.();
  }

  private markAllNeedsResume(): void {
    for (const session of this.sessions.values()) {
      session.needsResume = true;
      session.inFlight = false;
    }
  }

  private teardownTransport(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.transport && !this.transport.closed) {
      try {
        this.transport.close();
      } catch {
        // ignore
      }
    }
    this.transport = null;
    this.initialized = false;
  }

  private fallback(reason: FallbackReason, detail?: string): void {
    this.onFallback?.(reason, detail);
  }
}

function readThreadId(result: unknown): string {
  const r = result as { thread?: { id?: string }; threadId?: string } | null;
  const id = r?.thread?.id ?? r?.threadId;
  if (!id) throw new Error("thread/start missing thread.id");
  return id;
}

function readTurnId(result: unknown): string {
  const r = result as { turn?: { id?: string }; turnId?: string } | null;
  const id = r?.turn?.id ?? r?.turnId;
  if (!id) throw new Error("turn/start missing turn.id");
  return id;
}

/**
 * Build a stable session key for headless reuse.
 * Profile is included even though app-server has no `-p` flag yet — callers must
 * map profile → config overlays at the integration boundary.
 */
export function buildSessionKey(parts: {
  cwd: string;
  profile: string;
  sandbox?: string;
  model?: string;
}): SessionKey {
  return [parts.cwd, parts.profile, parts.sandbox ?? "", parts.model ?? ""].join("|");
}

/**
 * Reasons where exec *might* succeed as an alternate transport.
 * For auto-fallback that is safe before mutation, use
 * `canSafelyFallbackToExec` in `persistent-service.ts` instead.
 */
export function shouldFallbackToExec(reason: FallbackReason | undefined): boolean {
  if (!reason) return false;
  return (
    reason === "transport_crash" ||
    reason === "reconnect_failed" ||
    reason === "initialize_failed" ||
    reason === "unsupported_server_request" ||
    reason === "turn_failed"
  );
}
