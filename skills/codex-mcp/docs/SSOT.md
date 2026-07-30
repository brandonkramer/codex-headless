---
tags:
  - ssot
  - codex
  - mcp
version: 1.0.0
updated: 2026-07-10
skip:
---

## CODEX MCP (BUILT-IN SERVER)

Ad-hoc Codex via Cursor's built-in `codex mcp-server` — MCP tools **`codex`** and **`codex-reply`**. For multi-agent orchestration one-shot work, prefer `codex_headless_*` plugin tools or shell `codex exec --profile … --ephemeral`.

---

#### ▸ What I Use It For

- Multi-turn Codex sessions from any Cursor chat (`codex` → `codex-reply`)
- Ad-hoc tasks where thread persistence is useful
- Inline config when `--profile` is not available on the MCP tool surface

---

#### ▸ Tools

| Tool | What |
|------|------|
| `codex` | Start a Codex run; returns `threadId` for follow-ups |
| `codex-reply` | Continue with `threadId` from prior response |

Run server: `codex mcp-server` (stdio). Inherits global Codex config overrides.

**Not on MCP tool surface:** `--profile`, `--ephemeral`, `--output-schema`. Mirror profile settings via inline `config` object and top-level `model`, `sandbox`, `approval-policy`.

---

#### ▸ Inline config presets

`config.profile` is rejected — pass equivalent keys inline:

| Preset | model | config.model_reasoning_effort | sandbox |
|--------|-------|-------------------------------|---------|
| Review | gpt-5.6-sol | high | read-only |
| Implement | gpt-5.6-luna | xhigh | workspace-write |
| Probe | gpt-5.6-luna | medium | read-only |

Common top-level fields: `prompt`, `approval-policy: never`, `sandbox`, `model`, nested `config` for `model_reasoning_effort`, `service_tier` (`default` unless latency needs `fast` — ~2× cost).

Field names align with `config.toml` keys documented in [config-sample](https://developers.openai.com/codex/config-sample).

---

#### ▸ When to use which

| Need | Use |
|------|-----|
| Ad-hoc multi-turn | `codex` + `codex-reply` (this skill) |
| Multi-agent orchestration one-shot review/implement/probe | `codex_headless_*` plugin tools |
| Profiles + schemas + `--ephemeral` | Shell `codex exec --profile … --ephemeral` |
| PR GitHub comment | `codex-review/scripts/pr-review.sh` |

Built-in MCP threads **persist** (no `--ephemeral`) — avoid for orchestration workers that must be one-shot.

---

#### ▸ Gotchas

- `--profile` flag does not work on MCP tool — duplicate profile file values inline
- `config.profile` key errors — use flat inline keys
- Threads persist across turns — not suitable for codex-reviewer one-shot pattern
- For structured orchestration JSON, use shell `--output-schema` or `codex_headless_*` with `structured: true`

---

#### ▸ Links

Canonical list: `docs/sources.json`. Primary index: [CLI commands](https://developers.openai.com/codex/cli/slash-commands).

| Topic | Link |
|-------|------|
| CLI / `codex mcp-server` | [developers.openai.com/codex/cli/slash-commands](https://developers.openai.com/codex/cli/slash-commands) |
| Inline config / profiles | [developers.openai.com/codex/config-advanced](https://developers.openai.com/codex/config-advanced) |
| Config keys | [developers.openai.com/codex/config-sample](https://developers.openai.com/codex/config-sample) |
| Non-interactive alternative | [developers.openai.com/codex/noninteractive](https://developers.openai.com/codex/noninteractive) |
| MCP specification | [modelcontextprotocol.io/specification/latest](https://modelcontextprotocol.io/specification/latest) |
| Codex releases | [github.com/openai/codex/releases](https://github.com/openai/codex/releases) |
