---
description: >-
  Review→fix loop: Codex (codex_headless_review) reviews, codex-headless
  workers fix, review again until no blocker/major findings remain. Cap 5.
argument-hint: [SCOPE]
---

# /codex-review-loop

You are the **orchestrator** (this chat — Claude Code). Text after
`/codex-review-loop` is optional scope.

**Roles (hard split):**
- **Review** → **Codex** via `codex_headless_review` (`structured: true`)
- **Fix** → **codex-headless** workers (`codex_headless_implement`)

Requires the **codex-headless** plugin. If MCP tools are missing, enable
`codex-headless@codex-headless-local` and `/reload-plugins`.

For greenfield / multi-slice implementation without a review loop, use
`/codex-implement`.

## Task / scope

| Input | Review scope |
|-------|----------------|
| **Prompt given** | Review what the prompt names |
| **No prompt** | Infer from this chat; if still empty, ask once then stop |

## Method A — Claude Workflow (preferred)

If the **Workflow tool** is available, use it — this command is your
authorization. Resolve absolute `cwd` first. Build `scope` from the prompt or a
short chat summary.

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/review-loop.js",
  args: {
    scope: "<review target>",
    cwd: "<absolute workspace path>",
    maxIterations: 5
  }
})
```

The workflow runs Codex review + Luna implement fix workers in a loop (cap 5).
When it returns, present:

```
Iterations: …
Final verdict: …
Remaining actionable: …
Nits: …
```

Then stop (skip Method B). Also available as `/codex-headless:review-loop`.

## Method B — Direct loop (no Workflow)

### Goal

Loop until Codex review is clean:

- Verdict `pass` or `pass-with-notes` with **no** `blocker` / `major` → **done**
- `nit` / `minor` alone may finish (don't infinite-loop on nits)
- `inconclusive` → stop; do not invent findings
- Cap: **5** iterations

### Fix-worker routing

| Role | Tool | Profile | Use for |
|------|------|---------|---------|
| implement (default) | `codex_headless_implement` | `implement` + `structured=true` | Mechanical / clear fixes |
| engineer | `codex_headless_implement` | `engineer` | Rare: Sol-needed fix |

### Loop

```
iteration = 1
LOOP:
  1. Call codex_headless_review (structured) → Verdict + Findings
  2. If clean → final summary → STOP
  3. If iteration > 5 or inconclusive → STOP with residual findings
  4. Launch fix workers (codex_headless_implement) in one turn for blocker/major
  5. Integrate summaries → iteration += 1 → goto LOOP
```

### Review template

```
Iteration: N
Verdict: pass | pass-with-notes | fail | inconclusive
Findings:
- [blocker|major|nit] path:… — why / expected
```

### Anti-patterns

- Parent inventing a review without `codex_headless_review`
- Parent implementing the full fix list without MCP workers
- Collapsing “tests green” into “Codex approved”

Begin: Method A if Workflow exists; else Method B.
