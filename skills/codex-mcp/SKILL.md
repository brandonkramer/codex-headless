---
name: codex-mcp
description: "Use the built-in codex mcp-server tools (codex, codex-reply) with inline config presets matching review/implement/probe profiles. For foolproof headless exec with profiles and schemas, prefer codex-headless MCP tools instead."
tags: [tool, codex, mcp, gpt-5.6-sol]
triggers:
  - "codex mcp"
  - "codex mcp-server"
  - "call codex tool"
---

# Codex MCP (built-in server)

Ad-hoc Codex via **`codex`** and **`codex-reply`** — only when that MCP server is
already registered. This skill does **not** wire `codex mcp-server` for you.

If those tools are missing → use [codex-headless](../codex-headless/SKILL.md)
(`codex_headless_*`) or shell `codex exec`. For multi-agent orchestration
one-shots, prefer headless either way.

## References

| Topic | File | When to read |
|-------|------|--------------|
| Inline presets | [inline-config-presets.md](references/inline-config-presets.md) | Mirror review/implement/engineer/probe profiles |
| Multi-turn | [multi-turn.md](references/multi-turn.md) | `codex-reply` + `threadId` |
| Routing | [routing.md](references/routing.md) | Built-in MCP vs headless vs shell |

## Quick decisions

**Ad-hoc multi-turn?** → [multi-turn.md](references/multi-turn.md)

**Inline config for a profile?** → [inline-config-presets.md](references/inline-config-presets.md)

**One-shot orchestration?** → [routing.md](references/routing.md) → headless or shell, not this skill
