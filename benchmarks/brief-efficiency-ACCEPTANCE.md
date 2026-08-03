# Optimization #4 — implementation-ready briefs

Paired live trial: **loose prompt** vs **typed implement brief** on a disposable temp git repo. Never mutates the main plugin repo.

Coordinate with the general `benchmarks/` harness conceptually; this suite owns only `brief-*` filenames.

## Fixed protocol (before results)

| Item | Value |
|---|---|
| Task fixture | `benchmarks/brief-efficiency/fixture/` |
| Workspace | Fresh `mkdtemp` git repo per arm-trial; deleted after scoring |
| Profile | `engineer` (same both arms) |
| Default trials/arm | **3** |
| Evidence label | If trials &lt; 5 → **`exploratory`** |
| Order | Per trial: randomize arm order AB/BA via `--seed` |
| Live concurrency | Sequential only |
| Main repo | Read-only; all writes confined to temp dirs |

## Arms

### Loose (`loose_prompt`)

Unstructured prompt from `loose-prompt.txt` — same task intent, no writeScope/files/checks contract.

### Brief (`typed_brief`)

`brief.json` → `assembleImplementPrompt` / MCP-equivalent preamble (`change`, `files`, `writeScope`, `checks`, advisory budgets).

## Metrics per arm/trial

- Wall ms (process span)
- Tool-like JSONL items (command_execution, mcp_tool_call, file_change)
- Provider turns (`turn.completed` count)
- Tokens (input / cached / output / reasoning) when reported
- Out-of-scope **writes** (git changed paths ∉ writeScope)
- Out-of-scope **reads** (heuristic: JSONL command/file refs outside start `files` + writeScope)
- Test correctness: fixture acceptance command exit 0

## Waste score (primary efficiency signal)

```
waste = 10 * out_of_scope_writes + 2 * out_of_scope_reads + tool_like_items
```

Lower is better. Tokens reported separately (not in waste) to avoid conflating verbosity with scope discipline.

## Predeclared acceptance gates

### Structural (no API)

1. Temp repo is not under the plugin root; plugin `git status` unchanged by runner.
2. Brief parses; preamble contains Write scope + Checks.
3. Fixture acceptance tests **fail** on seed (red) and **pass** on golden patched tree.

### Live quality

4. Brief arm acceptance-test pass rate ≥ loose arm pass rate (equal quality floor).

### Live efficiency (pass claim — **not** wall-time)

5. Median brief `waste` &lt; median loose `waste`.
6. Median brief `out_of_scope_writes` ≤ median loose `out_of_scope_writes`.

### Explicit non-gates

- **Wall time is reported independently.** Brief may be slower (longer preamble / more careful). Wall regression alone does **not** fail the optimization claim.
- Token reduction is informational only.

### Pass / fail labels

- `PASS_LOWER_WASTE_EQUAL_QUALITY` — gates 1–6.
- `FAIL_WASTE` — quality OK, waste not improved.
- `FAIL_QUALITY` — brief pass rate below loose.
- `FAIL_STRUCTURAL` — 1–3 fail.
- `EXPLORATORY` suffix when trials &lt; 5.

## Commands

```bash
# Unit / structural (no API)
node --import tsx --test benchmarks/brief-efficiency/brief-efficiency-score.test.mjs \
  benchmarks/review-brief-metrics.test.mjs

# Dry-run
node --import tsx benchmarks/brief-efficiency/brief-efficiency-live.mjs --dry-run --trials 3

# Live (sequential; costly)
node --import tsx benchmarks/brief-efficiency/brief-efficiency-live.mjs --trials 3 --seed 42
```
