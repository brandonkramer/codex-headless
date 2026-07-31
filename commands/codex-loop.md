---
description: >-
  Arm Claude Code /loop (session scheduler) to repeatedly run codex-headless
  work: implement remaining slices, review→fix, or babysit CI/PR fixes.
argument-hint: "[interval] [implement|review|babysit] [SCOPE_OR_TASK]"
---

# /codex-loop

You are in **Claude Code**. Use the session **scheduled-task / `/loop`** machinery
to re-run codex-headless work on an interval while this session stays open.

Parse arguments after `/codex-loop` as:

| Piece | Meaning | Default |
|-------|---------|---------|
| Leading interval (`5m`, `10m`, `1h`, …) | Fixed `/loop` schedule | omit → let `/loop` choose dynamically |
| Mode: `implement` \| `review` \| `babysit` | What each tick does | infer from the rest, else `review` |
| Remainder | Task / review scope | required (ask once if missing) |

Examples:

```text
/codex-loop 10m review uncommitted auth changes
/codex-loop 15m implement finish the remaining parser slices
/codex-loop babysit keep fixing CI failures via codex-implement
/codex-loop 5m review
```

## Preconditions

- **codex-headless** MCP tools available
- Dynamic workflows optional — ticks can use `/codex-implement` or `/codex-review-loop`
- Loops are **session-scoped**: they stop when the session ends

If MCP tools are missing, tell the user to enable
`codex-headless@codex-headless-local` and reload plugins — do not arm a loop.

## What to schedule

### Mode: `review` (default)

Each tick: run a scoped `/codex-review-loop` (Workflow when available, else MCP).

### Mode: `implement`

Each tick: run `/codex-implement` on remaining work (or direct MCP fan-out).

### Mode: `babysit`

Each tick: check CI/PR comments / failing checks; launch
`codex_headless_implement` fixes for clear actionable failures; keep parent lean.

## Arming

Prefer invoking `/loop` with a clear tick prompt so the user sees the same UX.
Stop with `Esc` while waiting, or ask to cancel the cron job. For durable
unattended runs use Desktop scheduled tasks — not `/loop`.
