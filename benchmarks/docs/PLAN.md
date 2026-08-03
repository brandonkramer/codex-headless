# Codex-headless optimization benchmark plan

Reproducible harness for four landed optimizations. **Pass gates are fixed before observing live results.**

## Claims under test

| ID | Optimization | Control (A) | Treatment (B) | Primary metric |
| --- | --- | --- | --- | --- |
| 1 | Persistent exec + resume | Two independent `codex exec --ephemeral` probe turns | `ephemeral=false` start + `resumeThreadId` follow-up | Total wall time (turn1+turn2) |
| 2 | Shared-evidence review fan-out | Each lens runs full prep-style probe (rediscover) | One prep probe → capped shared packet → tool-light lens prompts | Total wall time + total input tokens |
| 3 | Persistent app-server warm turns | Fresh `codex exec --ephemeral` per turn | Opt-in `persistentSessionKey` app-server; measure turn 2 warm | Turn-2 wall time + process spawns |
| 4 | Structured implementation brief | Semantically equivalent loose probe prompt | `assembleImplementPrompt` brief preamble (read-only analysis task) | Wall time + tool-call count + tokens; quality via JSON schema |

## Design principles

1. **Sequential live requests** — no concurrent model trials (avoid contention).
2. **Randomized AB/BA** — per repeat, coin-flip order; arms separated by cooldown.
3. **Separate warmup** — one discarded probe per arm before timed repeats (not counted).
4. **Fixed read-only workloads** — probe profile, no workspace writes; prompts reference pinned files under this repo.
5. **Minimum practical N** — default **5 repeats per arm** (`--trials 5`). Do not claim significance from tiny N; report raw distributions + bootstrap 95% CI on median difference.
6. **Bounded cost** — `--dry-run` plans trials without API calls; `--claims` filters subsets.
7. **Structural vs live** — deterministic proofs (prompt shape, arg vectors, packet budgets) run without Codex; live proofs are stochastic.

## Pass gates (pre-registered)

Improvement = `(control_median - treatment_median) / control_median`. Quality regression = treatment success rate < control success rate − 0.2 (absolute).

| Claim | Speed gate | Quality gate |
| --- | --- | --- |
| 1 | Median total wall ≥ **10%** faster (B) | Both arms: `ok` on both turns |
| 2 | Median total wall ≥ **15%** faster OR median input tokens ≥ **15%** lower | Treatment lenses return parseable JSON; no arm `ok` rate drop > 20pp |
| 3 | Median turn-2 wall ≥ **20%** faster (B) | Both turns `ok`; treatment spawn count on turn 2 ≤ control |
| 4 | Median tool calls ≥ **10%** lower OR median input tokens ≥ **10%** lower | Treatment JSON passes brief quality rubric (required keys present) |

**Verdict labels:** `proven` (speed gate + quality gate), `falsified` (quality ok but speed gate missed), `inconclusive` (N too small / overlapping bootstrap CI includes zero), `quality_regression`.

Bootstrap: 2000 resamples, seed derived from git SHA for reproducibility.

## Execution

```bash
# Plan only (no API)
pnpm run benchmark -- --dry-run

# Structural proofs only (~seconds)
pnpm run benchmark -- --structural-only

# Live stochastic proofs (sequential; ~minutes per claim)
pnpm run benchmark -- --live-only --trials 5 --claims 1,2,3,4

# Full report
pnpm run benchmark -- --trials 5 --output benchmarks/out
```

**Claim 1 live re-run:** use [PLAN-v2.md](./PLAN-v2.md) (`--protocol v2 --trials 21`, new output dir). Speed gate stays ≥10% median wall; do not overwrite `benchmarks/out/core-live/`.

Outputs: `benchmark-report.json`, `benchmark-report.md` with environment metadata (Codex version, OS, timestamp, git SHA, profiles).

## Statistical honesty

- Report **every trial** raw row (wall ms, tokens, spawns, ok, order).
- Plot-less summary: min / q1 / median / q3 / max per arm.
- Bootstrap CI on paired differences when AB/BA pairing applies.
- Do **not** use p<0.05 language with N=5; say "consistent with" or "insufficient to conclude".
