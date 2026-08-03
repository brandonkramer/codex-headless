# Benchmark harness

Reproducible proofs for the four codex-headless optimizations. See [PLAN.md](./PLAN.md).
Claim 1 v2 protocol: [PLAN-v2.md](./PLAN-v2.md) (gate unchanged ≥10% median wall).

```bash
# Unit tests (stats, order, gates, structural)
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

Reports land in `benchmarks/out/benchmark-report.{json,md}`.
