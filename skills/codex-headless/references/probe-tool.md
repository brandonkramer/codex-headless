# codex_headless_probe

Cheap exploratory pass via `--profile probe` (Luna, read-only; default `--ephemeral`). Optional `ephemeral=false` + `resumeThreadId`, or opt-in `persistentSessionKey`.

## Parameters

| Param | Effect |
|-------|--------|
| `prompt` (required) | Exploratory task |
| `cwd` | Working directory override |

## Pattern

Cheap Luna survey only. For orchestration planning use **codex-planner** (`codex_headless_implement` + `profile: "engineer"`), then **codex-implementer**, then **codex-reviewer**.

Shell details: [codex-implementation/references/probe.md](../codex-implementation/references/probe.md).
