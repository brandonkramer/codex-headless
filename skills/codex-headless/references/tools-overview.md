# MCP tools overview

Plugin tools default to `codex exec --profile …` (with `--ephemeral` unless opted out).

| Tool | Profile | Reasoning | Sandbox |
|------|---------|-----------|---------|
| `codex_headless_review` | review (+ `--ignore-user-config --ignore-rules --json`) | high | read-only |
| `codex_headless_implement` | implement | xhigh | workspace-write |
| `codex_headless_probe` | probe | medium | read-only |
| `codex_headless_app_server_turn` | mapped via thread/start (opt-in) | profile-dependent | profile-dependent |

## Ephemeral / resume / persistent

- **Default:** `--ephemeral` + `--skip-git-repo-check` (non-git / untrusted cwd OK).
- **Persist + resume (exec):** `ephemeral: false`, then `resumeThreadId` on a later call.
- **App-server reuse (opt-in):** `persistentSessionKey` on implement/probe, or `codex_headless_app_server_turn`. Do not combine with `resumeThreadId`.
- Review stays one-shot exec (hermetic flags).

## Gap

No `codex_headless_engineer` — use `profile: "engineer"` on implement, CLI, or [codex-mcp inline config](../codex-mcp/references/inline-config-presets.md).

## Fallback

MCP unavailable → **`bin/codex-headless`** CLI, or [codex-review](../codex-review/SKILL.md) / [codex-implementation](../codex-implementation/SKILL.md) references.
