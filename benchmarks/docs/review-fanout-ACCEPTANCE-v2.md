# Optimization #2 — v2 pre-registration (shared evidence review fan-out)

**Supersedes for new runs:** [review-fanout-ACCEPTANCE.md](./review-fanout-ACCEPTANCE.md) protocol details unchanged unless noted below.

**v1 invalid live trials:** frozen under [out/v1-invalid-claims-2-4/](../out/v1-invalid-claims-2-4/MANIFEST.json). Do not delete or reinterpret v1 gate labels; v1 `FAIL_QUALITY` reflected schema rejection scored as 0% recall (harness bug, fixed in v2).

## v2 corrections (harness only)

| Change | Version | Reason |
| --- | --- | --- |
| Invalid/schema-rejected arms → `validity: invalid`, `recall: null` | v2 | API 400 is not a quality sample |
| Gate label `INCONCLUSIVE_INVALID` when zero valid quality arms | v2 | Honest rerun semantics |
| Preflight schema gate (local strict + optional one live probe) | v2 | Abort before N×3 lens calls |
| Medians/bootstrap exclude invalid arms only | v2 | Same speed/waste gates, valid samples only |

**Speed/waste gates unchanged from v1:** provider work ≤75% **or** parallel latency ≤55%; tools ≤50%; recall ≥ baseline−0.05; defect floor ≥2 recovered.

## Fixed protocol (unchanged workload)

| Item | Value |
| --- | --- |
| Fixture | `benchmarks/suites/review-fanout/fixture/` (`review-fanout-seeded-v1`) |
| Lenses | 3 — `correctness`, `security`, `tests-api` |
| Profile | `review`, structured verdict both arms |
| Trials/arm | **≥5** (confirmatory) |
| Order | AB/BA per trial via `--seed 42` |
| Concurrency | Sequential live calls only |
| Output | `benchmarks/out/v2-review-fanout/` |

## Preflight (required before live)

```bash
# Local Codex-strict schema check (no API)
node benchmarks/suites/review-fanout/review-fanout-live.mjs \
  --preflight-only --dry-run --out benchmarks/out/v2-review-fanout

# After ~/.codex/schemas repaired — one live probe (optional but recommended)
node --import tsx benchmarks/suites/review-fanout/review-fanout-live.mjs \
  --preflight-only --out benchmarks/out/v2-review-fanout
```

Preflight must pass (`exit 0`). If `~/.codex/schemas/reviewer-verdict.schema.json` overrides bundled schema, update or remove it so `tests.items.required` includes `output_snippet`.

## Pass / fail labels (v2)

Same as v1 plus:

- **`INCONCLUSIVE_INVALID`** — all arms invalid (schema/API); not `FAIL_QUALITY`.

## Structural proofs (no API)

Frozen defects in `known-defects.json`; deterministic packet digest; scoring in `review-fanout-score.mjs`.
