# Review profiles and rules

Profiles live in `$CODEX_HOME/*.config.toml`, selected with `--profile <name>`.

| Profile | Model | Reasoning | Sandbox | Use for |
|---------|-------|-----------|---------|---------|
| `review` | gpt-5.6-sol | high | read-only | PR/diff/architecture review |
| `implement` | gpt-5.6-luna | xhigh | workspace-write | (sibling skill — not review) |
| `probe` | gpt-5.6-luna | medium | read-only | cheap exploratory passes |

## Exec rules

- One-shot runs: `--profile review --ephemeral --ignore-user-config --ignore-rules`
  (`--ignore-user-config` skips global MCP/plugins; `--ignore-rules` skips execpolicy `.rules`; profile + auth still load)
- Multi-step follow-up: omit `--ephemeral`; use `codex exec resume --last` (settings frozen from first run)
- Prompt as shell argument: always append `< /dev/null` (background runs exit 144 without it)
- Background: `run_in_background: true`, `-o <file>`, wait for harness notification — do not poll

## Review target exclusivity

Pick **one** per run — these conflict:

- `review --uncommitted`
- `review --base <ref>`
- `review --commit <sha>`
- custom stdin prompt (embed diff in prompt file instead of `--base`)

## Deprecated

- Top-level `codex review` (without `exec`) — use `codex exec review` only

## Reporting

Treat Codex output as evidence, not authority. Spot-check cited code before relaying findings.
