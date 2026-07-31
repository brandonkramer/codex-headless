# Codex Headless

Headless Codex for **Cursor** and **Claude Code**: MCP tools, CLI, profiles, agent skills, orchestration subagents (**codex-planner**, **codex-implementer**, **codex-reviewer**), and Claude Code workflows/slash commands.

## Layout

- `.cursor-plugin/` — Cursor plugin manifest + MCP launcher
- `.claude-plugin/` — Claude Code marketplace + plugin manifest
- `.mcp.json` — Claude MCP server entry (`CLAUDE_PLUGIN_ROOT` → `bin/codex-headless-mcp`)
- `skills/` — codex-headless, codex-review, codex-implementation, codex-computer-use, codex-mcp
- `agents/cursor/` / `agents/claude/` — host-specific planner / implementer / reviewer
- `commands/` — Claude slash commands (`/codex-implement`, `/codex-review-loop`, `/codex-loop`)
- `workflows/` — Claude Code dynamic workflows (`implement`, `review-loop`)
- `profiles/` — reference `codex exec --profile` configs (install → `~/.codex/`)

Requires `node>=22`, `pnpm install` in this repo, and `codex` on PATH (for runs).

## Install (Cursor)

```bash
# symlink or clone into Cursor local plugins
ln -sfn ~/.agents/plugins/codex-headless ~/.cursor/plugins/local/codex-headless
cd ~/.cursor/plugins/local/codex-headless
chmod +x bin/codex-headless bin/codex-headless-mcp scripts/*.sh
pnpm install
bash scripts/install.sh    # profiles + schemas → ~/.codex/
```

Enable the **codex-headless** plugin in Cursor (loads skills + MCP from
`~/.cursor/plugins/local/codex-headless`). Plugin `mcp.json` launches via
`node --import tsx src/mcp/server.ts` with an expanded PATH (Homebrew / nvm /
Volta). Or add to `~/.cursor/mcp.json` using that same pattern /
`bin/codex-headless-mcp`.

## Install (Claude Code)

Same clone — marketplace root is this repo (`.claude-plugin/marketplace.json`):

```bash
claude plugin marketplace add /path/to/codex-headless
claude plugin install codex-headless@codex-headless-local
bash scripts/install.sh    # profiles + schemas → ~/.codex/
```

Or in `~/.claude/settings.json`:

```json
{
  "enabledPlugins": {
    "codex-headless@codex-headless-local": true
  },
  "extraKnownMarketplaces": {
    "codex-headless-local": {
      "source": {
        "source": "directory",
        "path": "/Users/YOU/.agents/plugins/codex-headless"
      }
    }
  }
}
```

Restart Claude Code / `/reload-plugins` after install. MCP entry is `.mcp.json`
(`${CLAUDE_PLUGIN_ROOT}/bin/codex-headless-mcp`).

## Use

**Orchestrator + workers:** prefer MCP — `codex_headless_probe` / `codex_headless_implement` / `codex_headless_review`. Plugin agents: **codex-planner** → **codex-implementer**(s) → **codex-reviewer**.

### Claude slash commands

| Command | Role |
|---------|------|
| `/codex-implement` | You plan/sequence/integrate; fan out `codex_headless_*` workers |
| `/codex-review-loop` | Codex reviews → Luna implement fixes → review again (max 5) |
| `/codex-loop` | Arm Claude `/loop` to re-run implement / review / babysit |

### Claude workflows (Claude Code only)

Requires Dynamic workflows (Claude Code ≥ 2.1.154; enable in `/config`).

| Workflow | Slash / name | What it does |
|----------|--------------|--------------|
| `workflows/implement.js` | `/codex-headless:implement` or via `/codex-implement` | Decompose + fan-out thin Claude wrappers that call `codex_headless_*` MCP |
| `workflows/review-loop.js` | `/codex-headless:review-loop` or via `/codex-review-loop` | Codex review ↔ `codex_headless_implement` fix workers (max 5) |

Slash commands prefer the Workflow tool when available, and fall back to direct MCP fan-out.

**Shell / CI:** `bin/codex-headless` (same flags as MCP):

```bash
codex-headless review --uncommitted
codex-headless implement -p "Implement foo"
codex-headless probe -p "Survey auth; do not edit"
codex-headless review --structured -f prompt.md -o verdict.json
```

**GitHub PR review (local helper):** `bash skills/codex-review/scripts/pr-review.sh <PR>`

**GitHub Actions (CI):** copy [`examples/github-actions/codex-pr-review.yml`](examples/github-actions/codex-pr-review.yml) — `openai/codex-action` + hermetic flags + `reviewer-verdict` schema.

Review runs always use `--ignore-user-config --ignore-rules`. JSONL (`--json`) is on by default for durable output + usage telemetry; progress heartbeats go to stderr as `[codex-headless] …`.

## Profiles

Installed to `~/.codex/` by `scripts/install.sh`. Reference copies in [`profiles/`](profiles/).

| Profile | Model | Reasoning | Sandbox | service_tier |
|---------|-------|-----------|---------|--------------|
| `review` | gpt-5.6-sol | high | read-only | `default` |
| `engineer` | gpt-5.6-sol | high | workspace-write | `default` |
| `implement` | gpt-5.6-luna | xhigh | workspace-write | `default` |
| `probe` | gpt-5.6-luna | medium | read-only | `default` |

Opt into Fast with `-c service_tier="fast"` when latency matters (~2× API cost).

Structured JSON schemas: [`schemas/`](schemas/) → `~/.codex/schemas/`.

## Skills

Canonical Codex skills live in [`skills/`](skills/) — each `SKILL.md` is a thin index; workflows are in `references/`.

| Skill | For |
|-------|-----|
| [codex-headless](skills/codex-headless/SKILL.md) | MCP tools |
| [codex-review](skills/codex-review/SKILL.md) | Review, PR helper, codex-reviewer agent |
| [codex-implementation](skills/codex-implementation/SKILL.md) | engineer vs implement routing |
| [codex-computer-use](skills/codex-computer-use/SKILL.md) | UI/browser verify |
| [codex-mcp](skills/codex-mcp/SKILL.md) | Built-in `codex` / `codex-reply` |

## Agents

| Agent | For |
|-------|-----|
| [codex-planner](agents/cursor/codex-planner.md) / [Claude](agents/claude/codex-planner.md) | Scope + worker slices (`implement` + `profile=engineer`) |
| [codex-implementer](agents/cursor/codex-implementer.md) / [Claude](agents/claude/codex-implementer.md) | Implementation worker (`implement`, structured) |
| [codex-reviewer](agents/cursor/codex-reviewer.md) / [Claude](agents/claude/codex-reviewer.md) | Final diff review + tests |

## Dev

```bash
pnpm typecheck
pnpm cli -- --help
pnpm mcp
```

MIT
