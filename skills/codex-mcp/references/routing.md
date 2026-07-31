# Routing: built-in MCP vs headless

| Need | Use |
|------|-----|
| Ad-hoc multi-turn Codex | `codex` + `codex-reply` (this skill) — **only if registered** |
| Multi-agent orchestration review/implement/probe | `codex_headless_*` — [codex-headless](../codex-headless/SKILL.md) |
| Profiles + `--ephemeral` + `--output-schema` | Shell `codex exec --profile … --ephemeral` |
| GitHub PR comment | [codex-review/pr-review-github.md](../codex-review/references/pr-review-github.md) |

## Built-in tools must be wired

`/codex-headless:codex-mcp` does **not** start `codex mcp-server`. It only
documents calling `codex` / `codex-reply` **after** that server is in MCP config
(e.g. `claude mcp add` / `~/.claude.json` `mcpServers`). If those tools are
missing, use **`codex_headless_*`** or shell `codex exec` — do not invent them.

## Prefer headless when

- One-shot worker or reviewer pass
- Need `--profile` or structured JSON schema
- Must not leave persistent MCP threads
- Built-in `codex` / `codex-reply` tools are not registered

## Prefer built-in MCP when

- `codex` / `codex-reply` tools are available in this session
- Exploratory multi-turn conversation with Codex
- User wants to continue same thread with `codex-reply`
