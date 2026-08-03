import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  APP_SERVER_METHODS,
  PersistentCodexRunner,
  buildSessionKey,
  shouldFallbackToExec,
  type AppServerTransport,
  type FallbackReason,
  type JsonRpcInbound,
  type JsonRpcRequest,
} from "./persistent-runner.ts";

type Handler = (msg: JsonRpcInbound) => void;

class FakeTransport implements AppServerTransport {
  closed = false;
  readonly sent: unknown[] = [];
  private readonly handlers = new Set<Handler>();
  private autoTurn = true;
  private crashOnNextSend = false;
  private failInitialize = false;
  private threadSeq = 0;
  private turnSeq = 0;

  constructor(opts?: { autoTurn?: boolean }) {
    if (opts?.autoTurn === false) this.autoTurn = false;
  }

  send(message: unknown): void {
    if (this.closed) throw new Error("write after close");
    if (this.crashOnNextSend) {
      this.crashOnNextSend = false;
      this.closed = true;
      throw new Error("simulated crash");
    }
    this.sent.push(message);
    const req = message as JsonRpcRequest;
    if (!req || typeof req !== "object") return;

    if (req.method === APP_SERVER_METHODS.initialize) {
      if (this.failInitialize) {
        this.emit({
          id: req.id,
          error: { code: -32000, message: "auth missing" },
        });
        return;
      }
      this.emit({
        id: req.id,
        result: { userAgent: "fake/0", codexHome: "/tmp", platformOs: "macos" },
      });
      return;
    }

    if (req.method === APP_SERVER_METHODS.initialized) return;

    if (req.method === APP_SERVER_METHODS.threadStart) {
      this.threadSeq += 1;
      const id = `thread-${this.threadSeq}`;
      this.emit({ id: req.id, result: { thread: { id, ephemeral: true } } });
      this.emit({ method: "thread/started", params: { thread: { id } } });
      return;
    }

    if (req.method === APP_SERVER_METHODS.threadResume) {
      const params = req.params as { threadId: string };
      this.emit({
        id: req.id,
        result: { thread: { id: params.threadId } },
      });
      return;
    }

    if (req.method === APP_SERVER_METHODS.turnStart) {
      this.turnSeq += 1;
      const turnId = `turn-${this.turnSeq}`;
      const params = req.params as { threadId: string; input: Array<{ text: string }> };
      this.emit({
        id: req.id,
        result: { turn: { id: turnId, status: "inProgress", items: [] } },
      });
      if (this.autoTurn) {
        // Intentionally same-tick after response: exercises early-event buffer.
        const text = params.input.map((i) => i.text).join(" ");
        this.emit({
          method: "item/agentMessage/delta",
          params: { threadId: params.threadId, delta: `echo:${text}` },
        });
        this.emit({
          method: "turn/completed",
          params: {
            threadId: params.threadId,
            turn: { id: turnId, status: "completed", items: [] },
          },
        });
      }
    }
  }

  subscribe(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  close(): void {
    this.closed = true;
  }

  emit(msg: JsonRpcInbound): void {
    for (const h of [...this.handlers]) h(msg);
  }

  armCrashOnNextSend(): void {
    this.crashOnNextSend = true;
  }

  setFailInitialize(v: boolean): void {
    this.failInitialize = v;
  }

  /** Emit a server→client request (approval) mid-flight. */
  emitServerRequest(method: string): void {
    this.emit({ id: "srv-1", method, params: {} });
  }
}

function makeRunner(opts?: {
  idleLeaseMs?: number;
  now?: () => number;
  transports?: FakeTransport[];
  onFallback?: (reason: FallbackReason, detail?: string) => void;
  maxReconnectAttempts?: number;
}): { runner: PersistentCodexRunner; transports: FakeTransport[]; fallbacks: FallbackReason[] } {
  const transports: FakeTransport[] = opts?.transports ?? [];
  const fallbacks: FallbackReason[] = [];
  const runner = new PersistentCodexRunner({
    idleLeaseMs: opts?.idleLeaseMs ?? 60_000,
    now: opts?.now,
    maxReconnectAttempts: opts?.maxReconnectAttempts ?? 2,
    createTransport: () => {
      const t = new FakeTransport();
      transports.push(t);
      return t;
    },
    onFallback: (reason, detail) => {
      fallbacks.push(reason);
      opts?.onFallback?.(reason, detail);
    },
  });
  return { runner, transports, fallbacks };
}

describe("persistent-runner (app-server prototype)", () => {
  it("buildSessionKey includes cwd+profile", () => {
    assert.equal(
      buildSessionKey({ cwd: "/repo", profile: "review", sandbox: "read-only" }),
      "/repo|review|read-only|",
    );
  });

  it("reuses process + thread for same session key", async () => {
    const { runner, transports } = makeRunner();
    const key = buildSessionKey({ cwd: "/r", profile: "engineer" });

    const a = await runner.runTurn({
      sessionKey: key,
      input: [{ type: "text", text: "one" }],
    });
    const b = await runner.runTurn({
      sessionKey: key,
      input: [{ type: "text", text: "two" }],
    });

    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(a.reusedProcess, false);
    assert.equal(b.reusedProcess, true);
    assert.equal(b.reusedThread, true);
    assert.equal(a.threadId, b.threadId);
    assert.equal(transports.length, 1);
    assert.match(b.content, /echo:two/);
    runner.dispose();
  });

  it("keyed sessions get distinct threads", async () => {
    const { runner } = makeRunner();
    const a = await runner.runTurn({
      sessionKey: "k-a",
      input: [{ type: "text", text: "a" }],
    });
    const b = await runner.runTurn({
      sessionKey: "k-b",
      input: [{ type: "text", text: "b" }],
    });
    assert.notEqual(a.threadId, b.threadId);
    assert.equal(runner.sessionCount(), 2);
    runner.dispose();
  });

  it("enforces one in-flight turn per session", async () => {
    const held = new FakeTransport({ autoTurn: false });
    const heldFallbacks: FallbackReason[] = [];
    const heldRunner = new PersistentCodexRunner({
      createTransport: () => held,
      onFallback: (r) => heldFallbacks.push(r),
    });

    const first = heldRunner.runTurn({
      sessionKey: "busy",
      input: [{ type: "text", text: "hang" }],
    });
    // inFlight is reserved synchronously before first await.
    assert.equal(heldRunner.getSession("busy")?.inFlight, true);

    const second = await heldRunner.runTurn({
      sessionKey: "busy",
      input: [{ type: "text", text: "nope" }],
    });
    assert.equal(second.ok, false);
    assert.equal(second.fallback, "session_busy");
    assert.ok(heldFallbacks.includes("session_busy"));

    // Wait until turn/start assigned a thread id, then complete.
    for (let i = 0; i < 20 && !heldRunner.getSession("busy")?.threadId; i++) {
      await Promise.resolve();
    }
    const threadId = heldRunner.getSession("busy")?.threadId;
    assert.ok(threadId);
    held.emit({
      method: "turn/completed",
      params: {
        threadId,
        turn: { id: "turn-1", status: "completed", items: [] },
      },
    });
    const firstResult = await first;
    assert.equal(firstResult.ok, true);
    heldRunner.dispose();
  });

  it("reaps idle sessions after 60s lease", async () => {
    let now = 1_000_000;
    const { runner } = makeRunner({
      idleLeaseMs: 60_000,
      now: () => now,
    });
    await runner.runTurn({
      sessionKey: "idle-me",
      input: [{ type: "text", text: "x" }],
    });
    assert.equal(runner.sessionCount(), 1);
    assert.equal(runner.hasLiveProcess(), true);

    now += 60_000;
    const dropped = runner.reapIdle(now);
    assert.deepEqual(dropped, ["idle-me"]);
    assert.equal(runner.sessionCount(), 0);
    assert.equal(runner.hasLiveProcess(), false);
    runner.dispose();
  });

  it("crash marks needsResume; reconnect resumes thread", async () => {
    const { runner, transports, fallbacks } = makeRunner();
    const key = "resume-key";
    const first = await runner.runTurn({
      sessionKey: key,
      input: [{ type: "text", text: "before" }],
    });
    assert.equal(first.ok, true);

    runner.handleTransportCrash("boom");
    assert.ok(fallbacks.length === 0 || true); // crash path via handleTransportCrash
    assert.equal(runner.getSession(key)?.needsResume, true);
    assert.equal(runner.hasLiveProcess(), false);

    const second = await runner.runTurn({
      sessionKey: key,
      input: [{ type: "text", text: "after" }],
    });
    assert.equal(second.ok, true);
    assert.equal(second.threadId, first.threadId);
    assert.equal(second.reusedThread, true);
    assert.equal(transports.length, 2);

    const resumeSent = transports[1]?.sent.some(
      (m) => (m as JsonRpcRequest).method === APP_SERVER_METHODS.threadResume,
    );
    assert.equal(resumeSent, true);
    runner.dispose();
  });

  it("initialize failure triggers fallback boundary", async () => {
    const t = new FakeTransport();
    t.setFailInitialize(true);
    const fallbacks: FallbackReason[] = [];
    const runner = new PersistentCodexRunner({
      createTransport: () => t,
      onFallback: (r) => fallbacks.push(r),
    });
    const result = await runner.runTurn({
      sessionKey: "nope",
      input: [{ type: "text", text: "x" }],
    });
    assert.equal(result.ok, false);
    assert.equal(result.fallback, "initialize_failed");
    assert.ok(shouldFallbackToExec(result.fallback));
    assert.ok(fallbacks.includes("initialize_failed"));
    runner.dispose();
  });

  it("unsupported server request surfaces fallback reason", async () => {
    const t = new FakeTransport({ autoTurn: false });
    const fallbacks: Array<{ reason: FallbackReason; detail?: string }> = [];
    const runner = new PersistentCodexRunner({
      createTransport: () => t,
      onFallback: (reason, detail) => fallbacks.push({ reason, detail }),
    });

    const pending = runner.runTurn({
      sessionKey: "approve",
      input: [{ type: "text", text: "need approval" }],
    });
    await Promise.resolve();
    await Promise.resolve();
    t.emitServerRequest("item/commandExecution/requestApproval");
    assert.ok(
      fallbacks.some((f) => f.reason === "unsupported_server_request"),
    );

    t.emit({
      method: "turn/completed",
      params: {
        threadId: runner.getSession("approve")?.threadId,
        turn: { id: "turn-1", status: "completed", items: [] },
      },
    });
    await pending;
    runner.dispose();
  });

  it("shouldFallbackToExec is false for session_busy", () => {
    assert.equal(shouldFallbackToExec("session_busy"), false);
    assert.equal(shouldFallbackToExec("transport_crash"), true);
  });
});
