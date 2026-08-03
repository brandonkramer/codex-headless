import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, it } from "node:test";
import { ChildProcessAppServerTransport } from "./app-server-transport.ts";
import { APP_SERVER_METHODS, type JsonRpcRequest } from "./persistent-runner.ts";

/** Fake app-server child: NDJSON JSON-RPC over stdio. */
function fakeAppServerChild(): ChildProcessWithoutNullStreams {
  const script = `
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.method === 'initialize') {
      process.stdout.write(JSON.stringify({ id: msg.id, result: { userAgent: 'fake' } }) + '\\n');
    } else if (msg.method === 'initialized') {
      // notification — no response
    } else if (msg.method === 'thread/start') {
      process.stdout.write(JSON.stringify({ id: msg.id, result: { thread: { id: 'th-1' } } }) + '\\n');
    } else if (msg.method === 'turn/start') {
      const turnId = 'tu-1';
      process.stdout.write(JSON.stringify({ id: msg.id, result: { turn: { id: turnId } } }) + '\\n');
      process.stdout.write(JSON.stringify({
        method: 'item/agentMessage/delta',
        params: { delta: 'hello-from-fake' }
      }) + '\\n');
      process.stdout.write(JSON.stringify({
        method: 'turn/completed',
        params: { threadId: 'th-1', turn: { id: turnId, status: 'completed' } }
      }) + '\\n');
    }
  }
});
`;
  return spawn(process.execPath, ["-e", script], {
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;
}

describe("ChildProcessAppServerTransport (fake child)", () => {
  it("handshake + request/response over NDJSON stdio", async () => {
    const transport = new ChildProcessAppServerTransport({
      spawnProcess: fakeAppServerChild,
    });

    const responses: unknown[] = [];
    const notes: string[] = [];
    const unsub = transport.subscribe((msg) => {
      if ("id" in msg && ("result" in msg || "error" in msg)) {
        responses.push(msg);
      } else if ("method" in msg) {
        notes.push(msg.method);
      }
    });

    transport.send({
      jsonrpc: "2.0",
      id: 1,
      method: APP_SERVER_METHODS.initialize,
      params: { clientInfo: { name: "t", title: "t", version: "0" } },
    });

    await waitFor(() => responses.length >= 1, 2_000);
    assert.equal((responses[0] as { id: number }).id, 1);

    transport.send({
      jsonrpc: "2.0",
      method: APP_SERVER_METHODS.initialized,
    });

    transport.send({
      jsonrpc: "2.0",
      id: 2,
      method: APP_SERVER_METHODS.threadStart,
      params: { ephemeral: true, approvalPolicy: "never" },
    } satisfies JsonRpcRequest);

    await waitFor(() => responses.length >= 2, 2_000);

    transport.send({
      jsonrpc: "2.0",
      id: 3,
      method: APP_SERVER_METHODS.turnStart,
      params: {
        threadId: "th-1",
        input: [{ type: "text", text: "hi" }],
      },
    });

    await waitFor(
      () =>
        responses.length >= 3 && notes.includes("turn/completed"),
      2_000,
    );
    assert.ok(notes.includes("item/agentMessage/delta"));

    unsub();
    transport.close();
    assert.equal(transport.closed, true);
  });

  it("rejects send after close", () => {
    const transport = new ChildProcessAppServerTransport({
      spawnProcess: fakeAppServerChild,
    });
    transport.close();
    assert.throws(() => transport.send({ method: "x" }), /closed/);
  });
});

async function waitFor(pred: () => boolean, ms: number): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 20));
  }
}
