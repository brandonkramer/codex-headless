---
name: codex-headless
description: "MCP tools codex_headless_review, codex_headless_implement, codex_headless_probe (default ephemeral exec; optional resume / app-server session). Prefer for orchestrator worker subagents and codex-reviewer structured output."
tags: [tool, codex, mcp, profiles, orchestration]
triggers:
  - "codex headless"
  - "codex_headless"
  - "headless codex review"
  - "headless codex implement"
---

# Codex Headless MCP

Prefer these MCP tools for one-shot orchestration runs (worker subagents and final review).

## References

| Topic | File | When to read |
|-------|------|--------------|
| Tool overview | [tools-overview.md](references/tools-overview.md) | Which tool, ephemeral rule, fallbacks |
| Review tool | [review-tool.md](references/review-tool.md) | `codex_headless_review`, codex-reviewer agent |
| Implement tool | [implement-tool.md](references/implement-tool.md) | `codex_headless_implement`, workers |
| Probe tool | [probe-tool.md](references/probe-tool.md) | `codex_headless_probe`, exploration |

## Quick decisions

**Final review / diff?** → [review-tool.md](references/review-tool.md)

**Implementation worker?** → [implement-tool.md](references/implement-tool.md)

**Cheap exploration?** → [probe-tool.md](references/probe-tool.md)

**Tool comparison / fallbacks?** → [tools-overview.md](references/tools-overview.md)
