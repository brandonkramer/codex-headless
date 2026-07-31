---
tags:
  - ssot
  - codex
  - mcp
  - orchestration
version: 1.1.0
updated: 2026-07-19
skip:
---

## CODEX HEADLESS MCP

Cursor plugin MCP tools that wrap `codex exec --profile … --ephemeral` for multi-agent orchestration (worker subagents + codex-reviewer agent).

---

#### ▸ What I Use It For

- Foolproof headless review, implement, and probe without reconstructing shell flags
- Structured JSON output for orchestrator parsing (`structured: true`)
- Built-in diff review shortcuts (`review_uncommitted`, `review_base`)
- Durable JSONL capture + usage telemetry for long Sol reviews / CI

---

#### ▸ MCP tools

| Tool | Maps to | Profile | Sandbox |
|------|---------|---------|---------|
| `codex_headless_review` | `codex exec --profile review --ephemeral --ignore-user-config --ignore-rules --json` | review | read-only |
| `codex_headless_implement` | `codex exec --profile implement --ephemeral --json` | implement | workspace-write |
| `codex_headless_probe` | `codex exec --profile probe --ephemeral --json` | probe | read-only |

All tools always pass `--ephemeral` and `--skip-git-repo-check`. JSONL (`--json`) is on by default. For `codex exec resume`, use shell or built-in `codex` + `codex-reply` MCP.

### codex_headless_review

| Param | Effect |
|-------|--------|
| `review_uncommitted: true` | `codex exec review --uncommitted` |
| `review_base: "origin/main"` | `codex exec review --base …` |
| `prompt` | Custom scope (embed diff/context) |
| `structured: true` | `--output-schema reviewer-verdict.schema.json` |
| `cwd` | Working directory override |
| `json` (default true) | JSONL stream; fallback last `agent_message`; `usage` |
| `jsonl_path` | Persist full JSONL |

### codex_headless_implement

| Param | Effect |
|-------|--------|
| `prompt` (required) | Implementation task |
| `structured: true` | `--output-schema implement-report.schema.json` |
| `cwd` | Working directory override |
| `json` / `jsonl_path` | Same as review |

### codex_headless_probe

| Param | Effect |
|-------|--------|
| `prompt` (required) | Exploratory read-only task |
| `cwd` | Working directory override |
| `json` / `jsonl_path` | Same as review |

---

#### ▸ Orchestration routing

| Step | Tool |
|------|------|
| Implementation worker | `codex_headless_implement` |
| Final verification | `codex_headless_review` (`structured: true` for codex-reviewer agent) |
| Cheap exploration | `codex_headless_probe` → escalate |

Shell fallback: sibling skills `codex-review` and `codex-implementation`.

**Gap:** No `codex_headless_engineer` tool — Sol-based edits use shell `--profile engineer` or built-in `codex` MCP inline config.

---

#### ▸ Underlying Codex behavior

Plugin shells out to `codex exec` per [non-interactive mode](https://developers.openai.com/codex/noninteractive):

- Profiles: `~/.codex/<name>.config.toml` via `--profile` ([config-advanced](https://developers.openai.com/codex/config-advanced))
- `--ephemeral`: no session rollout files on disk
- Review hermetic: `--ignore-user-config` + `--ignore-rules`
- `--json`: stdout JSONL; wrapper extracts last `agent_message` if `-o` empty; sums `turn.completed.usage`
- Progress: `[codex-headless] …` on stderr (events + 15s heartbeats)
- Prompt-as-argument runs redirect stdin (`< /dev/null`) to avoid exit 144 in background
- CI without Cursor: `examples/github-actions/codex-pr-review.yml`

Built-in `codex mcp-server` is separate — only `codex` + `codex-reply` tools, no `--profile` passthrough. See `codex-mcp` skill.

---

#### ▸ Gotchas

- `codex_headless_implement` is always Luna — not the default `engineer` profile
- Ephemeral tool runs cannot resume prior context
- Large diffs on `review_uncommitted` with high reasoning can take minutes — prefer MCP. Wrapper enforces soft hang kill at `maxQuietMs` (default 10m) via SIGTERM; result includes `killReason` / `retrySafe` (never auto-retry after `thread.started`). Map hang → `verdict: "inconclusive"`. Do not fail at 60–90s; do not busy-wait / resume-while-running.
- `usageReported` distinguishes real zero-token turns from missing usage; failure bodies are sanitized (tokens redacted).
- Never Background-shell Codex review (Cursor turn abort kills it); never use `~/.claude/plugins/cache/codex-headless-local/...`
- Never fake `codex-reviewer` as `generalPurpose`; if Task lacks the agent type, call `codex_headless_review` from the parent
- MCP server requires Node ≥ 22, local `tsx` (`pnpm install`), and `codex` on PATH — launch via `node --import tsx` from `~/.cursor/plugins/local/codex-headless`
- Track cost across `/codex-review-loop` via `structuredContent.usage` (or stderr `usage input=…`)

---

#### ▸ Links

Canonical list: `docs/sources.json`. Primary index: [Non-interactive mode](https://developers.openai.com/codex/noninteractive).

| Topic | Link |
|-------|------|
| Non-interactive mode | [developers.openai.com/codex/noninteractive](https://developers.openai.com/codex/noninteractive) |
| CLI / `codex mcp-server` | [developers.openai.com/codex/cli/slash-commands](https://developers.openai.com/codex/cli/slash-commands) |
| Profiles | [developers.openai.com/codex/config-advanced](https://developers.openai.com/codex/config-advanced) |
| Config keys | [developers.openai.com/codex/config-sample](https://developers.openai.com/codex/config-sample) |
| MCP specification | [modelcontextprotocol.io/specification/latest](https://modelcontextprotocol.io/specification/latest) |
| MCP TypeScript SDK | [github.com/modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) |
| Codex releases | [github.com/openai/codex/releases](https://github.com/openai/codex/releases) |
| MCP SDK releases | [github.com/modelcontextprotocol/typescript-sdk/releases](https://github.com/modelcontextprotocol/typescript-sdk/releases) |
