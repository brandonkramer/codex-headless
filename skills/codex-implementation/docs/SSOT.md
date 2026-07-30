---
tags:
  - ssot
  - codex
  - implementation
version: 1.3.0
updated: 2026-07-10
skip:
---

## CODEX IMPLEMENTATION

Delegated code changes via `codex exec --profile engineer` (default) or `--profile implement` (heavy). One-shot runs use `--ephemeral`; multi-step loops use `codex exec resume --last`.

---

#### ▸ What I Use It For

- Surgical one-shot edits with clear specs (`engineer`)
- Cross-cutting refactors, ambiguous scope, parallel workers (`implement`)
- Cheap scope surveys before committing (`probe`)
- Read-only patch proposals (`review` profile — sibling to implementation, not default)

---

#### ▸ Profile routing

| Profile | Model | Reasoning | Sandbox | When |
|---------|-------|-----------|---------|------|
| `engineer` | gpt-5.6-sol | high | workspace-write | **Default** — bounded spec, surgical edits |
| `implement` | gpt-5.6-luna | xhigh | workspace-write | Multi-file refactors, ambiguity, parallel fan-out |
| `probe` | gpt-5.6-luna | medium | read-only | Explore scope; no edits |
| `review` | gpt-5.6-sol | high | read-only | Patch proposal only |

Escalation: `probe` → `engineer` → `implement` → `review`.

| Situation | Profile |
|-----------|---------|
| Add function + one call site | `engineer` |
| Refactor across many crates | `implement` |
| Parallel worker + structured report | `implement` |
| Unknown scope | `probe` first |
| Engineer output missed edge cases | `implement`, then `review` |

**MCP:** `codex_headless_implement` always uses `implement` (Luna). For Sol edits via MCP, shell `codex exec --profile engineer` or built-in `codex` MCP with inline config. Escalate to Terra/Sol if Luna misses the bar.

---

#### ▸ Commands

| Command | What |
|---------|------|
| `codex exec --profile engineer --ephemeral …` | Default one-shot implementation |
| `codex exec --profile implement --ephemeral …` | Heavy / parallel implementation |
| `codex exec --profile probe --ephemeral …` | Read-only scope survey |
| `codex exec --profile implement --ephemeral --output-schema …/implement-report.schema.json …` | Structured worker report |
| `codex exec --profile engineer "…" < /dev/null` | Start multi-step run (no `--ephemeral`) |
| `codex exec resume --last "…"` | Continue previous exec session |

---

#### ▸ Profiles and config

Profiles live at `~/.codex/<name>.config.toml`, activated with `--profile <name>`. Layer order: base `~/.codex/config.toml` → profile file → project `.codex/config.toml` → CLI flags.

Since Codex **0.134.0**: independent profile files only — no `[profiles.*]` in `config.toml`, no top-level `profile = "…"` selector. Migrate legacy tables to `~/.codex/<name>.config.toml`.

| Key | Typical value (implement profiles) |
|-----|----------------------------------|
| `approval_policy` | `never` (unattended headless) |
| `sandbox_mode` | `workspace-write` for engineer/implement; `read-only` for probe |
| `model_reasoning_effort` | `xhigh` (implement), `high` (engineer/review), `medium` (probe) |
| `service_tier` | `default` (use `fast` only when latency matters — ~2× API cost) |

Prompts should tell Codex to read `AGENTS.md` / project instruction files when present.

---

#### ▸ Non-interactive exec essentials

| Flag / pattern | What |
|----------------|------|
| `--ephemeral` | One-shot runs; no session files on disk (use for orchestration workers) |
| Omit `--ephemeral` | When `codex exec resume --last` may follow |
| `--sandbox workspace-write` | Explicit write access (profile files set this for engineer/implement) |
| `-o <file>` | Capture report output |
| `< /dev/null` | Required on prompt-as-argument runs — prevents background hang / exit 144 |
| `codex exec resume --last` | Reuses original model, reasoning, sandbox — cannot override on resume |

Default `codex exec` sandbox is read-only; implementation profiles must set `workspace-write`.

---

#### ▸ Parallel workers

- Use `--profile implement` + optional `implement-report.schema.json`
- Worktree isolation to avoid edit collisions
- Label agents `gpt-5.6-luna:` for implement workers, `gpt-5.6-sol:` for engineer runs

---

#### ▸ Gotchas

- Resume cannot change model or reasoning — choose profile before first run
- Ephemeral runs cannot be resumed with prior transcript context
- `codex exec` defaults to read-only — verify profile sets `workspace-write` before expecting edits
- Always inspect diff and run verification after Codex edits
- Background exec without `< /dev/null` often dies at exit 144

---

#### ▸ Links

Canonical list: `docs/sources.json`. Primary index: [Non-interactive mode](https://developers.openai.com/codex/noninteractive).

| Topic | Link |
|-------|------|
| Non-interactive mode | [developers.openai.com/codex/noninteractive](https://developers.openai.com/codex/noninteractive) |
| CLI commands | [developers.openai.com/codex/cli/slash-commands](https://developers.openai.com/codex/cli/slash-commands) |
| Profiles | [developers.openai.com/codex/config-advanced](https://developers.openai.com/codex/config-advanced) |
| Config keys | [developers.openai.com/codex/config-sample](https://developers.openai.com/codex/config-sample) |
| AGENTS.md | [developers.openai.com/codex/guides/agents-md](https://developers.openai.com/codex/guides/agents-md) |
| Profile file migration (0.134.0+) | [github.com/openai/codex/commit/162a6e7](https://github.com/openai/codex/commit/162a6e746b7b4ef6024ccc819bf8ceaaa5f802f6) |
| Release notes | [github.com/openai/codex/releases](https://github.com/openai/codex/releases) |
