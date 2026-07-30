# Implement heavy (Luna)

Cross-cutting work, ambiguous scope, or escalation from `engineer`.

## When

- Many files, crates, or layers
- Underspecified task requiring architecture inference
- `engineer` output was shallow or missed edge cases

## Command

```bash
codex exec --profile implement --ephemeral \
  -o "$REPORT" \
  "Read AGENTS.md and CLAUDE.md. Implement <spec> across <scope>. Keep changes focused. Do not run tests, npx, install commands, or dev servers. Report changed files and verification you recommend." < /dev/null
```

## Read-only alternative

Patch proposal only → `--profile review --ephemeral` (no file writes).
