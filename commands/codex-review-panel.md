---
description: >-
  Parallel lens review over one capped evidence packet: one codex_headless_probe
  prep, then tool-light correctness/security/tests lenses; host merges verdict.
argument-hint: [SCOPE]
---

# /codex-review-panel

You are the **orchestrator** (this chat). Text after `/codex-review-panel` is
optional review scope.

**Roles:**
- **Prep** → one bounded `codex_headless_probe` (evidence only)
- **Lenses** → tool-light agents over the shared packet (no rediscovery)
- **Merge** → host dedupes findings and derives final verdict

Requires the **codex-headless** plugin. If MCP tools are missing, enable
`codex-headless@codex-headless-local` and `/reload-plugins`.

## Method A — Claude Workflow (preferred)

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/review-panel.js",
  args: {
    scope: "<review target>",
    cwd: "<absolute workspace path>"
    // optional: lenses: [{id, title, focus}, ...]  (max 5)
  }
})
```

`review-panel.js` is **self-contained** (no relative ESM imports) for the
Workflow harness. Pure helpers for Node tests live in
`workflows/lib/review-panel-core.js`.

## Method B — Manual

1. Call `codex_headless_probe` once for the scope; cap evidence (~6KB).
2. Fan out 2–3 tool-light review agents on that packet only.
3. Merge findings (blocker/major → fail); present to the user.
