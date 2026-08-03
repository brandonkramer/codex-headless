# Benchmark harness

Reproducible proofs for four codex-headless optimizations. Methodology and gates: [docs/PLAN.md](./docs/PLAN.md). Claim 1 v2 protocol: [docs/PLAN-v2.md](./docs/PLAN-v2.md).

## Four claims

| ID | Optimization | Suite / harness |
| --- | --- | --- |
| 1 | Persistent exec + resume | [harness/](./harness/) (`pnpm run benchmark`) |
| 2 | Shared-evidence review fan-out | [suites/review-fanout/](./suites/review-fanout/) |
| 3 | Persistent app-server warm turns | [harness/](./harness/) |
| 4 | Structured implementation brief | [suites/brief-efficiency/](./suites/brief-efficiency/) |

Shared paired-trial metrics: [suites/shared/](./suites/shared/). Trial protocol and acceptance docs: [docs/](./docs/). Generated reports: [out/](./out/) (gitignored).

## Quick commands (repo root)

```bash
# Harness unit tests (stats, order, gates, structural)
pnpm run test:benchmarks

# Deterministic structural proofs (~1s)
pnpm run benchmark -- --structural-only

# Plan live trials without API cost
pnpm run benchmark -- --dry-run --trials 5

# Live sequential benchmarks (API cost; run one worker at a time)
pnpm run benchmark -- --live-only --trials 5 --claims 1,2,3,4

# Claim 1 v2 (recommended N=21; do not overwrite v1 core-live/)
pnpm run benchmark -- --live-only --protocol v2 --trials 21 --claims 1 --output benchmarks/out/core-live-v2
```

Suite-specific live runners and acceptance criteria: see [docs/review-brief-TRIALS.md](./docs/review-brief-TRIALS.md) and [docs/v2-rerun-protocol.md](./docs/v2-rerun-protocol.md).

Harness reports land in `benchmarks/out/benchmark-report.{json,md}` (default `--output benchmarks/out`).
