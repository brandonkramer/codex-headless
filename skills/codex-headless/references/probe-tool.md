# codex_headless_probe

Cheap exploratory pass via `--profile probe --ephemeral` (Luna, read-only).

## Parameters

| Param | Effect |
|-------|--------|
| `prompt` (required) | Exploratory task |
| `cwd` | Working directory override |

## Pattern

Cheap Luna survey only. For orchestration planning use **codex-planner** (`codex_headless_implement` + `profile: "engineer"`), then **codex-implementer**, then **codex-reviewer**.

Shell details: [codex-implementation/references/probe.md](../codex-implementation/references/probe.md).
