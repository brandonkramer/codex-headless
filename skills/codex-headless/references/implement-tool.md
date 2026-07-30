# codex_headless_implement

Implementation via `--profile implement --ephemeral` (Luna, workspace-write).

## Parameters

| Param | Effect |
|-------|--------|
| `prompt` (required) | Implementation task |
| `structured: true` | `implement-report.schema.json` |
| `cwd` | Working directory override |

## Orchestrator worker subagents

`codex_headless_implement` with `structured: true` for parallel workers.

Shell details: [codex-implementation/references/parallel-workers.md](../codex-implementation/references/parallel-workers.md).

## Note

Always Luna — for Sol default edits use shell [engineer-one-shot.md](../codex-implementation/references/engineer-one-shot.md). Escalate to Terra/Sol if quality misses.
