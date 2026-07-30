# Orchestrated review (codex-reviewer agent)

Final verification pass after worker subagents in a multi-agent orchestration workflow. Emit structured JSON the parent can parse.

Invoked via Task with `subagent_type: "codex-reviewer"` (plugin agent in `agents/codex-reviewer.md`).

If Task does **not** expose `codex-reviewer`, the **parent** must call MCP `codex_headless_review` (`structured: true`) directly — **never** fake the reviewer as `generalPurpose` / `/worker` / `/worker-composer`.

## Canonical install

```text
~/.cursor/plugins/local/codex-headless
```

Never use `~/.claude/plugins/cache/codex-headless-local/...` (stale copies).

## Order

1. Run targeted tests via shell; record command, pass/fail, snippets
2. Codex review (this workflow)
3. Spot-check findings; set `accepted` on each in structured output

Keep **tests** and **Codex** separate in the report: tests-green ≠ Codex-approved.

## MCP (required when the tool exists)

```json
{ "review_uncommitted": true, "structured": true }
```

or

```json
{ "prompt": "…", "structured": true }
```

Tool: `codex_headless_review` — see [codex-headless/references/review-tool.md](../codex-headless/references/review-tool.md).

**Hard rules**

- If GetMcpTools lists `codex_headless_review` → **must** use MCP. Do not shell out.
- Never run Codex review as a **Background** shell (Cursor turn abort kills it; no report file).
- Parent: rely on Task/subagent **completion notifications** — do not poll with `AwaitShell` sleep loops.
- Never `resume` a still-running reviewer agent; wait for completion or abort, then integrate.

## Timeouts

Large Sol high reviews often exceed 90s. Soft hang bound: **~10 minutes** with no progress → wrapper kills the process (`maxQuietMs`, default 600000) and surfaces hang failure; orchestrator maps that to `verdict: "inconclusive"`. Do not treat 60–90s as automatic failure. Never auto-retry after `thread.started` / tool items (`retrySafe=false`).

## Shell fallback (MCP tool missing only)

Foreground/blocking until the report file exists; stdin closed:

```bash
PLUGIN="$HOME/.cursor/plugins/local/codex-headless"
REPORT="$(mktemp -t codex-review-XXXXXX.json)"
"$PLUGIN/bin/codex-headless" review --structured -f "$PROMPT" -o "$REPORT" -C "$CWD" < /dev/null
```

Equivalent raw `codex exec` only if local CLI missing:

```bash
codex exec --profile review --ephemeral --ignore-user-config --ignore-rules --json \
  --output-schema "$HOME/.codex/schemas/reviewer-verdict.schema.json" \
  -o "$REPORT" - < "$PROMPT" < /dev/null
```

CI without Cursor: see `examples/github-actions/codex-pr-review.yml`.

Populate `tests` from shell commands you ran before Codex review.

## Output format

- Orchestration: `reviewer-verdict.schema.json` (JSON)
- Verdict enum: `pass` | `pass-with-notes` | `fail` | `inconclusive`
- GitHub PR comments: markdown via [pr-review-github.md](pr-review-github.md) — not the schema
