# Parallel workers (multi-agent orchestration)

Fan-out implementation with structured worker reports.

## When

Multiple independent implementation slices in parallel.

## Command

```bash
codex exec --profile implement --ephemeral \
  --output-schema ~/.codex/schemas/implement-report.schema.json \
  -o "$REPORT" \
  "Read AGENTS.md. Implement <spec>. Keep changes surgical. Do not run tests or dev servers." < /dev/null
```

## MCP / plugin agents

Prefer plugin agents when available:

1. **codex-planner** — scope + slices (`codex_headless_implement` + `profile: "engineer"`, plan-only)
2. **codex-implementer** × N — `codex_headless_implement` with `structured: true`
3. **codex-reviewer** — tests + `codex_headless_review`

Or call `codex_headless_implement` directly from the parent.

## Isolation

- Worktree per worker — no shared checkout edits
- Label agents `gpt-5.6-luna:` for implement workers

## After workers

Run **codex-reviewer** (plugin agent) — see [codex-review/references/orchestrated-review.md](../codex-review/references/orchestrated-review.md).
