# Implementation profiles and routing

| Profile | Model | Reasoning | Sandbox | When |
|---------|-------|-----------|---------|------|
| `engineer` | gpt-5.6-sol | high | workspace-write | **Default** — bounded spec, surgical edits |
| `implement` | gpt-5.6-luna | xhigh | workspace-write | Cross-cutting refactors, ambiguity, parallel workers |
| `review` | gpt-5.6-sol | high | read-only | Patch proposal only (no edits) |
| `probe` | gpt-5.6-luna | medium | read-only | Explore scope before editing |

Escalate: `probe` → `engineer` → `implement` → `review`.

| Situation | Profile |
|-----------|---------|
| Add function + one call site | `engineer` |
| Refactor across many crates | `implement` |
| Parallel worker + structured report | `implement` |
| Unknown scope | `probe` |
| Engineer missed edge cases | `implement`, then `review` |

## Exec rules

- One-shot: `--ephemeral`
- Multi-step: omit `--ephemeral`; `codex exec resume --last` (cannot change profile/model on resume)
- Prompt as argument: `< /dev/null` (required for background — exit 144 without it)
- Background: `run_in_background: true`, `-o <file>`, wait for notification

## MCP note

`codex_headless_implement` always uses `--profile implement` (Luna). For Sol edits via MCP, shell `--profile engineer` or built-in `codex` MCP inline config. Escalate to `gpt-5.6-terra` / Sol if Luna misses the bar.

## Orchestrator duties

Define the task, constrain sandbox, inspect diff, run verification, own the result.
