# codex_headless_implement

Implementation via `codex exec` (workspace-write). Default `--ephemeral` and `--profile implement` (Luna).

## Parameters

| Param | Effect |
|-------|--------|
| `prompt` and/or `brief` | Task text; typed `brief` assembles preamble (`timeoutMs` → `maxWallMs`) |
| `profile` | `implement` (default, Luna) or `engineer` (Sol) |
| `structured: true` | `implement-report.schema.json` |
| `cwd` | Working directory override |
| `ephemeral` | Default true; set false to persist for `resumeThreadId` |
| `resumeThreadId` | `codex exec resume <id>` (not with `ephemeral=true` or `persistentSessionKey`) |
| `persistentSessionKey` | Opt-in app-server session reuse |

## Orchestrator worker subagents

- **codex-planner** → `profile: "engineer"` + plan-only prompt (no edits)
- **codex-implementer** → default `implement` + `structured: true`

Shell details: [codex-implementation/references/parallel-workers.md](../codex-implementation/references/parallel-workers.md).

## Windows / stability

- `structured: true` requires every schema property in `required` (OpenAI strict mode). `recommended_verification` is required; use `[]` when empty.
- On `win32`, the wrapper prepends a **no `apply_patch`** instruction (sandbox crashes). Workers write full file contents instead.
- JSONL path is always materialized under the OS temp dir when `json` is true; response includes `jsonlPath`. Quiet hangs are killed via `maxQuietMs` (default 10m); child process trees are reaped with `taskkill /T` on Windows.
- Sandbox often blocks `pnpm` signature verification / `CreateFileMapping` — report typecheck failure as infra, not code defects.

## Note

Escalate to Terra/Sol if Luna workers miss the bar. Bounded Sol edits: `profile: "engineer"` or shell [engineer-one-shot.md](../codex-implementation/references/engineer-one-shot.md).
