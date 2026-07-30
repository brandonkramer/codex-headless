---
tags:
  - ssot
  - codex
  - review
version: 1.3.0
updated: 2026-07-10
skip:
---

## CODEX REVIEW

Independent read-only code review via `codex exec --profile review --ephemeral --ignore-user-config --ignore-rules` (gpt-5.6-sol, high, read-only; no global MCP/rules).

---

#### ▸ What I Use It For

- Built-in diff review without a custom prompt
- Custom-scope review (architecture, embedded diff, plan critique)
- GitHub PR review posted as markdown (`scripts/pr-review.sh`)
- Final **codex-reviewer** agent pass with structured JSON verdict

---

#### ▸ Commands

| Command | What |
|---------|------|
| `codex exec --profile review --ephemeral --ignore-user-config --ignore-rules review --uncommitted` | Review working tree |
| `codex exec --profile review --ephemeral --ignore-user-config --ignore-rules review --base origin/main` | Review branch vs base |
| `codex exec --profile review --ephemeral --ignore-user-config --ignore-rules review --commit <sha>` | Review one commit |
| `codex exec --profile review --ephemeral --ignore-user-config --ignore-rules -o out.md - < prompt.md` | Custom review via stdin prompt |
| `codex exec --profile review --ephemeral --ignore-user-config --ignore-rules --json --output-schema … -o out.json - < prompt.md` | Structured orchestration verdict |
| `bash scripts/pr-review.sh <pr> [repo-root]` | PR diff → Codex → `gh pr review` (maps verdict to approve/comment/request-changes) |

**Deprecated:** top-level `codex review` (without `exec`). Use `codex exec review` only.

---

#### ▸ Review target rules (from Codex CLI)

| Rule | Detail |
|------|--------|
| One target per run | `--uncommitted`, `--base`, `--commit`, and a custom stdin prompt **conflict** — pick one |
| Custom scope | Embed diff/context in the prompt file; do not combine with `codex exec review --base` |
| Read-only | `--profile review` sets `sandbox_mode = read-only`, `approval_policy = never` |
| One-shot orchestration | Always `--ephemeral` for codex-reviewer and workers |
| Multi-step follow-up | Omit `--ephemeral`; continue with `codex exec resume --last` (settings frozen from first run) |

---

#### ▸ Profiles and config

Profiles are separate files: `~/.codex/<name>.config.toml`, selected with `codex exec --profile <name>`. Codex loads `~/.codex/config.toml` first, then overlays the profile file. Since Codex **0.134.0**, legacy `[profiles.*]` tables in `config.toml` are **not** read — use independent profile files only.

| Profile file | Model | Reasoning | Sandbox |
|--------------|-------|-----------|---------|
| `review.config.toml` | gpt-5.6-sol | high | read-only |

Key config keys: `model`, `model_reasoning_effort`, `approval_policy`, `sandbox_mode`, `service_tier` (`default`; opt into `fast` only for latency — ~2× API cost). See sample config for full schema.

Codex reads `AGENTS.md` (and related filenames) from the repo for project instructions — reference in review prompts when relevant.

---

#### ▸ Non-interactive exec essentials

| Flag / pattern | What |
|----------------|------|
| `--ephemeral` | Skip persisting session rollout files (preferred for CI and one-shot review) |
| `-o <file>` | Write formatted output to file |
| `--json` | NDJSON event stream (debugging only) |
| `< /dev/null` | Required when prompt is a shell argument — prevents stdin hang / exit 144 in background |
| `codex exec -` | Omit prompt arg to read full prompt from stdin |

Default sandbox for `codex exec` is read-only; explicit `--profile review` keeps review runs predictable vs interactive TUI settings.

---

#### ▸ PR review (`gh`)

| Step | Tool |
|------|------|
| Fetch diff | `gh pr diff <n>` |
| Post review | `gh pr review <n> --approve \| --comment \| --request-changes -F body.md` |
| Verdict mapping | `VERDICT: approve` → approve; `approve-with-nits` → approve; `request-changes` → request-changes |
| Force comment only | `CODEX_PR_REVIEW_ALWAYS_COMMENT=1` |
| Dry run | `CODEX_PR_REVIEW_DRY_RUN=1 scripts/pr-review.sh <n>` |

Requires `gh` and `codex` on `PATH`.

---

#### ▸ Gotchas

- `--uncommitted` and custom prompt are mutually exclusive with `codex exec review --base`
- Resume cannot change model or reasoning — pick `--profile review` on the first run
- Ephemeral sessions cannot be resumed with prior context
- Treat Codex findings as evidence; spot-check before relaying
- Background `codex exec` without `< /dev/null` often fails before starting

---

#### ▸ Links

Canonical list: `docs/sources.json`. Primary index: [Codex docs](https://developers.openai.com/codex).

| Topic | Link |
|-------|------|
| Non-interactive mode | [developers.openai.com/codex/noninteractive](https://developers.openai.com/codex/noninteractive) |
| CLI commands (`codex exec review`) | [developers.openai.com/codex/cli/slash-commands](https://developers.openai.com/codex/cli/slash-commands) |
| Profiles (`*.config.toml`) | [developers.openai.com/codex/config-advanced](https://developers.openai.com/codex/config-advanced) |
| Config keys reference | [developers.openai.com/codex/config-sample](https://developers.openai.com/codex/config-sample) |
| AGENTS.md | [developers.openai.com/codex/guides/agents-md](https://developers.openai.com/codex/guides/agents-md) |
| GitHub CLI | [cli.github.com/manual](https://cli.github.com/manual/) |
| Release notes | [github.com/openai/codex/releases](https://github.com/openai/codex/releases) |
