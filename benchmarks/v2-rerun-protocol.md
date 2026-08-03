# v2 rerun protocol — claims #2 and #4

Sequential commands after schema repair. **No parallel live Codex calls.**

## 0. Preserve v1 (already frozen)

- Manifest: `benchmarks/out/v1-invalid-claims-2-4/MANIFEST.json`
- v1 reports remain at `benchmarks/out/review-fanout/` and `benchmarks/out/brief-efficiency/`
- v2 writes to **new** directories only

## 1. Pre-flight checks (no trials yet)

```bash
cd "$(git rev-parse --show-toplevel)"

pnpm run typecheck
pnpm run typecheck:benchmarks
pnpm run test
pnpm run test:benchmarks

node --test benchmarks/lib/trial-validity.test.mjs \
  benchmarks/lib/schema-preflight.test.mjs \
  benchmarks/review-fanout/review-fanout-deterministic.test.mjs \
  benchmarks/review-fanout/review-fanout-score.test.mjs \
  benchmarks/review-brief-metrics.test.mjs

node --import tsx --test benchmarks/brief-efficiency/brief-efficiency-score.test.mjs
```

## 2. Repair schema override (human step)

Ensure effective schemas pass Codex 0.146 strict validation:

```bash
# Option A: update user copies to match plugin bundled schemas
diff ~/.codex/schemas/reviewer-verdict.schema.json schemas/reviewer-verdict.schema.json
diff ~/.codex/schemas/implement-report.schema.json schemas/implement-report.schema.json

# Option B: remove stale overrides so bundled schemas win
# rm ~/.codex/schemas/reviewer-verdict.schema.json
# rm ~/.codex/schemas/implement-report.schema.json
```

Local validation (no API):

```bash
node -e "
import { loadAndValidateSchema } from './benchmarks/lib/schema-preflight.mjs';
for (const k of ['review','implement']) {
  const r = loadAndValidateSchema(k);
  console.log(k, r.source, r.path, r.ok ? 'OK' : r.violations);
  if (!r.ok) process.exitCode = 1;
}
"
```

## 3. Schema acceptance gate (one call each, live)

```bash
node --import tsx benchmarks/review-fanout/review-fanout-live.mjs \
  --preflight-only --out benchmarks/out/v2-review-fanout

node --import tsx benchmarks/brief-efficiency/brief-efficiency-live.mjs \
  --preflight-only --out benchmarks/out/v2-brief-efficiency
```

Both must exit 0. Artifacts: `schema-preflight.json` in each out dir.

## 4. Dry-run harness (no API)

```bash
node benchmarks/review-fanout/review-fanout-live.mjs \
  --dry-run --trials 5 --seed 42 --skip-preflight \
  --out benchmarks/out/v2-review-fanout-dryrun

node --import tsx benchmarks/brief-efficiency/brief-efficiency-live.mjs \
  --dry-run --trials 5 --seed 42 --skip-preflight \
  --out benchmarks/out/v2-brief-efficiency-dryrun
```

Expect labels `PASS_SPEED_AND_QUALITY` and `PASS_LOWER_WASTE_EQUAL_QUALITY` (confirmatory suffix at N=5).

## 5. Live confirmatory trials (sequential; costly)

```bash
node --import tsx benchmarks/review-fanout/review-fanout-live.mjs \
  --trials 5 --seed 42 \
  --out benchmarks/out/v2-review-fanout \
  2>&1 | tee benchmarks/out/v2-review-fanout-stdout.log

node --import tsx benchmarks/brief-efficiency/brief-efficiency-live.mjs \
  --trials 5 --seed 42 \
  --out benchmarks/out/v2-brief-efficiency \
  2>&1 | tee benchmarks/out/v2-brief-efficiency-stdout.log
```

## 6. Post-flight

```bash
pnpm run typecheck
pnpm run test:benchmarks
node --test benchmarks/lib/trial-validity.test.mjs benchmarks/lib/schema-preflight.test.mjs
git diff --check
```

## Gate reference (unchanged thresholds)

| Claim | Primary gate | Threshold |
| ---: | --- | --- |
| 2 | provider work **or** parallel latency model | ≤75% work **or** ≤55% latency |
| 2 | tool-like items | optimized ≤50% baseline |
| 2 | recall | optimized ≥ baseline − 0.05 |
| 2 | defect floor | median ≥2 defects recovered (optimized) |
| 4 | waste | median brief < median loose |
| 4 | quality | brief pass rate ≥ loose pass rate |

Invalid trials → `INCONCLUSIVE_INVALID`; do not count as quality/waste failures.
