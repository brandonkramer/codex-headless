# Paired live trials — optimizations #2 and #4

Distinct from a general four-claim harness: filenames are `review-*` / `brief-*` only.

| Opt | Claim | Plan | Runner |
|---|---|---|---|
| #2 | Shared evidence review fan-out | [review-fanout-ACCEPTANCE-v2.md](./review-fanout-ACCEPTANCE-v2.md) (live) · [v1 frozen](../out/v1-invalid-claims-2-4/MANIFEST.json) | `suites/review-fanout/review-fanout-live.mjs` |
| #4 | Implementation-ready briefs | [brief-efficiency-ACCEPTANCE-v2.md](./brief-efficiency-ACCEPTANCE-v2.md) (live) · [v1 frozen](../out/v1-invalid-claims-2-4/MANIFEST.json) | `suites/brief-efficiency/brief-efficiency-live.mjs` |

Shared helpers: `suites/shared/review-brief-metrics.mjs`, `harness/lib/trial-validity.mjs`, `harness/lib/schema-preflight.mjs`.

**v2 rerun:** [v2-rerun-protocol.md](./v2-rerun-protocol.md)

**Defaults:** 3 trials/arm exploratory; **v2 live confirmatory requires N≥5**. Sequential live calls.

**#4 pass claim:** lower waste with equal quality — wall time reported, not gated.

**Invalid trials (v2):** schema/API failures → `INCONCLUSIVE_INVALID`, not `FAIL_QUALITY` / `FAIL_WASTE`.
