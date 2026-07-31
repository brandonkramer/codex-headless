---
description: >-
  Dev orchestration via codex-headless workers. Default Luna implement workers;
  Sol engineer for plan-only / bounded slices; probe for cheap surveys. You
  (this chat) only plan, sequence, and integrate — Codex does the heavy work.
argument-hint: [TASK]
---

# /codex-implement

You are the **orchestrator** (this chat — Claude Code). The user's task follows
this command (everything after `/codex-implement`).

**Default posture:** delegate as much as possible to **codex-headless** workers
(`codex_headless_probe` / `codex_headless_implement`). Keep the parent context lean.

Requires the **codex-headless** plugin (MCP tools). If tools are missing, enable
`codex-headless@codex-headless-local` and `/reload-plugins`.

## Method A — Claude Workflow (preferred)

If the **Workflow tool** is available in this session, use it — this command
invocation is your authorization. Resolve `cwd` to the absolute workspace path
first (usually the project root).

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/implement.js",
  args: {
    task: "<full assignment text after the slash command>",
    cwd: "<absolute path to the TARGET git repo>",
    // when chat cwd ≠ target repo (common):
    repo: "<same as cwd, or absolute path to target repo>",
    baseRef: "<commit/branch for detached worktrees>",
    worktreeParent: "<absolute dir for sibling worktrees>",
    slices: [/* optional pre-built */]
  }
})
```

Optional: pass pre-built
`slices: [{goal, tool, profile?, label?, worktree?, worktreePath?, structured?}]`.
Otherwise the workflow decomposes, then fans out workers.

### Harness gotchas (Windows / Claude Workflow)

1. **args may arrive as a JSON string** — shipped `implement.js` parses that.
2. **LF only** — never rewrite workflow scripts with CRLF; CR fails the permission
   control-character check. Prefer `scriptPath` to the plugin file (LF in git).
3. **Do not use `isolation: "worktree"`** when the chat session repo is not the
   target repo — it resolves HEAD against the session cwd. Pass `repo` + `baseRef`
   (+ `worktreeParent`) and let workers `git -C <repo> worktree add --detach …`.
4. Point `cwd`/`repo` at the **real project**, not an empty/unrelated folder.

Tell the user a short heads-up (workflow fans out multiple agents) before
launching. When it returns:

1. Integrate `workers[].summary` into the user-facing result
2. Call out `failedIndexes` / `ok: false` workers
3. Do **not** re-read whole worker diffs unless needed

Then stop (skip Method B). If Workflow is unavailable, use Method B.

You can also run the bundled workflow directly as `/codex-headless:implement`
with the same args shape.

## Method B — Direct MCP fan-out (no Workflow)

Fan out **multiple** `codex_headless_*` MCP calls **in parallel in the same turn**.

### Worker routing (required)

| Role | Tool | Profile | Use for |
|------|------|---------|---------|
| probe | `codex_headless_probe` | — | Cheap Luna read-only survey |
| planner / Sol | `codex_headless_implement` | `engineer` | Plan-only (must forbid edits) or tiny Sol edit |
| implement (default) | `codex_headless_implement` | `implement` + `structured=true` | Luna write workers / parallel fan-out |

**Bias cheap:** prefer Luna `implement` for mechanical slices. Use `engineer` for
planning or when Sol quality is required. Always pass `cwd`. Prefer isolation
(worktrees) when parallel writers share a repo.

### Core workflow

1. **Decompose** into independent slices (aim for **3+ workers** when possible).
2. **Pick tool + profile** per slice.
3. **Launch workers in one message** — multiple MCP calls, narrow prompts.
4. **Parallel by default** — serialize only when B depends on A.
5. **Integrate** worker outputs — merge summaries; parent stays lean.
6. Prefer `/codex-review-loop` for final verification.

### Prompt shape for each worker

```text
Goal: …
Scope (paths / constraints): …
Do: …
Return: compact structured summary (what changed / findings / open risks).
Do not: restate the whole codebase; keep the reply short.
```

### Anti-patterns

- Parent doing heavy file edits instead of MCP workers
- Using `probe` for write work
- Skipping `structured: true` on implement workers when a report is needed

Begin: Method A if Workflow exists; else Method B → integrate worker summaries.
