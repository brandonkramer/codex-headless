# GitHub PR review (markdown)

Posts a Codex review as a GitHub PR review via `gh`. Uses Conventional Comments, GFM alerts, tables, task lists, and collapsible findings.

## When

User asks to review a **GitHub PR** and post the result.

## Command

```bash
bash ~/.cursor/plugins/local/codex-headless/skills/codex-review/scripts/pr-review.sh <PR_NUMBER> [repo-root]
```

## Options

```bash
# Override model
CODEX_REVIEW_MODEL=gpt-5.6-sol \
  bash ~/.cursor/plugins/local/codex-headless/skills/codex-review/scripts/pr-review.sh 79 /path/to/repo

# Dry run (print body + event, do not post)
CODEX_PR_REVIEW_DRY_RUN=1 bash ~/.cursor/plugins/local/codex-headless/skills/codex-review/scripts/pr-review.sh 79

# Force neutral comment review (ignore verdict → approve/request-changes mapping)
CODEX_PR_REVIEW_ALWAYS_COMMENT=1 pr-review.sh 79

# Override GitHub review event
CODEX_PR_REVIEW_EVENT=comment pr-review.sh 79   # approve | comment | request-changes | auto

# Buffer until exit (no live stdout)
CODEX_STREAM=0 bash ~/.cursor/plugins/local/codex-headless/skills/codex-review/scripts/pr-review.sh 79
```

## Streaming

`pr-review.sh` runs Codex via `codex-pty.py` (pseudo-TTY wrapper). **Stdout streams live** by default — progress and agent output appear in the terminal while the review runs. The final review body is written to a temp file via `-o` for posting.

| Var | Default | Purpose |
|-----|---------|---------|
| `CODEX_STREAM` | `1` | Set `0` to buffer until Codex exits |
| `CODEX_MAX_SECS` | `600` | Wall-clock timeout before kill |

## Completion sentinel

On exit (success or failure), the script prints one line to **stderr**:

```text
CODEX_PR_REVIEW_DONE exit=0 pr=355 verdict=request-changes event=request-changes dry_run=1 posted=0
```

| Field | Meaning |
|-------|---------|
| `exit` | Shell exit code |
| `pr` | PR number reviewed |
| `verdict` | Normalized `VERDICT:` from Codex (`unknown` if missing) |
| `event` | Resolved `gh pr review` event |
| `dry_run` | `1` when `CODEX_PR_REVIEW_DRY_RUN=1` |
| `posted` | `1` after a successful GitHub post |

Use this line for agent completion — not arbitrary timeouts and not generic `error:` matches in streamed diff text.

## Agent invocation (Cursor)

Long reviews often exceed five minutes. **Do not** rely on a fixed `block_until_ms` cap.

1. Start the script in the **background** (`block_until_ms: 0`).
2. **Await** the terminal until `CODEX_PR_REVIEW_DONE` appears (or `exit_code:` in the terminal footer).
3. Optionally set `notify_on_output` with pattern `CODEX_PR_REVIEW_DONE` for a mid-turn nudge when the sentinel prints.

Example Shell tool settings:

- `block_until_ms`: `0`
- `notify_on_output.pattern`: `CODEX_PR_REVIEW_DONE`
- `notify_on_output.reason`: `PR review done`

After completion, read the terminal output: dry-run body is on **stdout**; the sentinel and dry-run header are on **stderr**.

## GitHub review event mapping

| Codex `VERDICT:` line | `gh pr review` flag |
|-------------------------|---------------------|
| `approve` | `--approve` |
| `approve-with-nits` | `--approve` (nits in body as `nitpick (non-blocking):`) |
| `request-changes` | `--request-changes` |
| missing / unrecognized | `--comment` |

Set `CODEX_PR_REVIEW_ALWAYS_COMMENT=1` if the bot must never approve or block merge.

## Posted format

1. **Script header** — `> [!NOTE]` with :robot:, model, commit SHA link, PR link, timestamp
2. **Script verdict callout** — deterministic emoji + alert by `VERDICT:` (not left to the model)
3. **Codex body** — summary, severity table, strengths, collapsible findings, verification task list
4. **Script footer** — AI disclaimer + dry-run hint

Findings use [Conventional Comments](https://conventionalcomments.org/) labels (`issue (blocking):`, `suggestion (non-blocking):`, `praise:`, etc.).

## Emoji scheme (GitHub shortcodes)

Use **shortcodes** (`:robot:`) — GitHub renders them everywhere in PR markdown. The script owns verdict emojis; Codex owns section/findings emojis per prompt.

| Role | Shortcode | Where |
|------|-----------|--------|
| Bot / automated | `:robot:` | Script header |
| Approve | `:white_check_mark:` | Script verdict callout |
| Request changes | `:x:` | Script verdict callout |
| Review / comment only | `:speech_balloon:` | Script verdict callout (unknown verdict) |
| Summary | `:memo:` | `##` heading |
| Strengths | `:sparkles:` | `##` heading + praise lines |
| Findings (collapsed) | `:mag:` | `<summary>` title |
| Blocking | `:rotating_light:` | Table row + finding lines |
| Major | `:warning:` | Table row + finding lines |
| Suggestion | `:bulb:` | Table row + finding lines |
| Nitpick | `:nail_care:` | Table row + finding lines |
| Question | `:question:` | Optional findings subsection |
| Security | `:lock:` | Optional findings subsection |
| Verification | `:test_tube:` | `##` heading |
| None identified | `:white_check_mark:` | Checked task item |

**Avoid:** obscure Unicode (e.g. Armenian letters), emoji-only severity without text labels, or more than one emoji per finding line.

**Not in shortcodes:** inline `suggestion` apply buttons — Tier 2 only.

## Requirements

- `gh`, `codex`, `jq`, and `python3` on `PATH`
- Uses `--profile review` (high, read-only) internally
- Reviews the **PR diff from GitHub**, not assumed local branch state

## After

Summarize verdict and GitHub event (`approve` / `comment` / `request-changes`) to the user after posting.
