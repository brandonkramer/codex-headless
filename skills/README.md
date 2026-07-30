# Codex Headless plugin — skills

Canonical location for all Codex orchestration skills.

| Skill | Index | Workflows |
|-------|-------|-----------|
| `codex-headless/` | MCP tool routing | `references/` (review, implement, probe tools) |
| `codex-review/` | Review routing | `references/` (PR, diff, custom, orchestrated) |
| `codex-implementation/` | Implementation routing | `references/` (engineer, implement, probe, parallel, resume) |
| `codex-computer-use/` | Verify routing | `references/` (surfaces, headless, structured) |
| `codex-mcp/` | Built-in MCP routing | `references/` (presets, multi-turn, routing) |

Plugin root: `~/.cursor/plugins/local/codex-headless`

Agents (per host under `agents/cursor/` + `agents/claude/`): `codex-planner` → `codex-implementer` → `codex-reviewer`

Profiles: `~/.codex/{review,engineer,implement,probe}.config.toml` (reference copies in `profiles/`)

Schemas: `~/.codex/schemas/`

## Maintenance order

1. `docs/SSOT.md` — facts and links
2. `references/*.md` — workflow docs (derived from SSOT)
3. `SKILL.md` — thin index with explicit links to references

Agent loads `SKILL.md` on trigger; reads only the linked reference file(s) needed for the task.
