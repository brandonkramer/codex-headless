# MCP tools overview

Plugin tools shell out to `codex exec --profile … --ephemeral`.

| Tool | Profile | Reasoning | Sandbox |
|------|---------|-----------|---------|
| `codex_headless_review` | review (+ `--ignore-user-config --ignore-rules --json`) | high | read-only |
| `codex_headless_implement` | implement | xhigh | workspace-write |
| `codex_headless_probe` | probe | medium | read-only |

## Ephemeral rule

All tools always pass `--ephemeral` and `--skip-git-repo-check` (non-git / untrusted cwd OK). For `codex exec resume`, use shell or built-in `codex` + `codex-reply`.

## Gap

No `codex_headless_engineer` — use `bin/codex-headless implement --profile engineer` or [codex-mcp inline config](../codex-mcp/references/inline-config-presets.md).

## Fallback

MCP unavailable → **`bin/codex-headless`** CLI, or [codex-review](../codex-review/SKILL.md) / [codex-implementation](../codex-implementation/SKILL.md) references.
