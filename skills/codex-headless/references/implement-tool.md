# codex_headless_implement

Implementation via `--ephemeral` (workspace-write). Default `--profile implement` (Luna).

## Parameters

| Param | Effect |
|-------|--------|
| `prompt` (required) | Implementation or plan-only task |
| `profile` | `implement` (default, Luna) or `engineer` (Sol) |
| `structured: true` | `implement-report.schema.json` |
| `cwd` | Working directory override |

## Orchestrator worker subagents

- **codex-planner** → `profile: "engineer"` + plan-only prompt (no edits)
- **codex-implementer** → default `implement` + `structured: true`

Shell details: [codex-implementation/references/parallel-workers.md](../codex-implementation/references/parallel-workers.md).

## Note

Escalate to Terra/Sol if Luna workers miss the bar. Bounded Sol edits: `profile: "engineer"` or shell [engineer-one-shot.md](../codex-implementation/references/engineer-one-shot.md).
