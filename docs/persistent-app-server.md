# Persistent app-server (optimization #3)

Status: **wired (opt-in)**. Default MCP/CLI path remains `codex exec`.  
CLI probe: **codex-cli 0.146.0** (2026-08-03).

## Surfaces

| Module | Role |
| --- | --- |
| `src/app-server-transport.ts` | Real `codex app-server --listen stdio://` NDJSON JSON-RPC transport |
| `src/persistent-runner.ts` | Session lease (60s), one in-flight/session, resume after crash |
| `src/persistent-service.ts` | Process singleton + `canSafelyFallbackToExec` |
| `src/profile-thread-config.ts` | Profile → `thread/start` model/sandbox/approval (no invented `-p`) |
| MCP `persistentSessionKey` | Opt-in on implement/probe |
| MCP `codex_headless_app_server_turn` | Dedicated opt-in tool (honest incomplete RunCodexResult parity) |

## Verified handshake

```text
→ initialize { clientInfo, capabilities: { experimentalApi: true } }
→ initialized (notification)
→ thread/start { cwd, ephemeral, approvalPolicy, sandbox, model, config? }
→ turn/start { threadId, input: [{type:"text",text}] }
← item/agentMessage/delta …
← turn/completed
```

Framing: **newline-delimited JSON**. Resume: `thread/resume { threadId, excludeTurns?: true }`.

## Fallback policy

Auto-fallback to `codex exec` **only** when provably safe (no turn started):

- `initialize_failed`, `reconnect_failed`
- `transport_crash` **without** `turnId`

Otherwise return explicit failure (`session_busy`, `turn_failed`, mid-turn crash, unsupported server→client requests).

## Limitations

1. Usage / JSONL / `retrySafe` / hang-kill not fully aggregated from app-server events.
2. Server→client approval requests → `unsupported_server_request` (no auto-approve).
3. Hermetic review flags (`--ignore-user-config/--ignore-rules`) are exec-only; app-server review profile uses sandbox/model overlay only.
4. `resumeThreadId` (exec) **cannot** combine with `persistentSessionKey`.
