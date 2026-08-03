# Optimization #2 — shared evidence review fan-out

Paired live trial: **baseline** (N lenses each rediscover evidence) vs **optimized** (one ≤6000-byte prep packet → N evidence-only lenses).

Coordinate with the general `benchmarks/` harness conceptually; this suite owns only `review-*` filenames.

## Fixed protocol (before results)

| Item | Value |
|---|---|
| Fixture | `benchmarks/suites/review-fanout/fixture/` (seeded defects; frozen) |
| Lenses N | 3 — `correctness`, `security`, `tests-api` (same both arms) |
| Profile | `review` (structured verdict when live) |
| Default trials/arm | **3** (API cost bound) |
| Evidence label | If trials &lt; 5 → report **`exploratory`** (not confirmatory) |
| Order | Per trial: randomize arm order AB/BA via `--seed` |
| Live concurrency | **Sequential provider calls only** (no parallel live Codex) |
| Warm-up | One dry structural pass; not counted in medians |

## Arms

### Baseline (`independent_discovery`)

Each lens independently receives the fixed fixture workspace + the same scope string and **must rediscover** evidence (read/search allowed in prompt). No shared packet.

### Optimized (`shared_evidence_packet`)

1. Build **exactly one** evidence packet from frozen fixture sections via `buildEvidencePacket` (budget **6000** UTF-8 bytes).
2. Optional `--live-prep`: replace frozen sections with one `probe` call (still one packet).
3. Same N lenses review **evidence-only** (prompt forbids tools/repo rediscovery).

## Scheduling definitions (both always reported)

From sequential stage wall times \(t_{\mathrm{prep}}, t_1,\ldots,t_N\) (baseline \(t_{\mathrm{prep}}=0\)):

| Metric | Formula | Meaning |
|---|---|---|
| `provider_work_ms` | \(t_{\mathrm{prep}}+\sum t_i\) | Total provider work if stages run back-to-back |
| `user_latency_ms_parallel_model` | \(t_{\mathrm{prep}}+\max(t_i)\) | User-visible latency if lenses fan out after prep |

Do **not** claim parallel latency was measured live unless `--simulate-parallel-wall` is off and a true parallel run was used (default: sequential live; parallel model is derived).

## Metrics recorded per arm/trial

- `provider_work_ms`, `user_latency_ms_parallel_model`
- Provider turns, tool-like items, token usage (from JSONL when present)
- Finding quality vs `known-defects.json` (recall / precision / F1)
- Packet: `bytesUsed`, `byteBudget`, `truncated`, `digest` (optimized only)

## Predeclared acceptance gates

Evaluate **only after** all trials finish. Gates use medians across completed trials.

### Structural (must pass; deterministic; no API)

1. `bytesUsed ≤ 6000` for every optimized packet.
2. Same sections → identical `digest` and body (deterministic).
3. `mergeFindings` dedupes duplicate location+why across lenses.

### Live quality (must not regress)

4. Median optimized **recall** ≥ median baseline recall − **0.05**.
5. At least **2/3** of seeded defects recovered by optimized in the median trial’s merged findings (or exploratory note if trials &lt; 5).

### Live efficiency (primary speed claim)

6. Median optimized `provider_work_ms` ≤ median baseline `provider_work_ms` × **0.75**  
   **OR** median optimized `user_latency_ms_parallel_model` ≤ median baseline × **0.55**.
7. Median optimized tool-like item count ≤ median baseline × **0.50**.

### Pass / fail labels

- `PASS_SPEED_AND_QUALITY` — gates 1–7 hold.
- `PASS_QUALITY_ONLY` — 1–5 hold; 6–7 fail (packet path correct, speed claim falsified).
- `FAIL_QUALITY` — 4 or 5 fail.
- `FAIL_STRUCTURAL` — 1–3 fail.
- `EXPLORATORY` suffix when trials &lt; 5 (e.g. `PASS_SPEED_AND_QUALITY_EXPLORATORY`).

Wall and token distributions are always printed; tiny-N must not claim significance.

## Commands

```bash
# Deterministic + score unit tests (no API)
node --test benchmarks/suites/review-fanout/review-fanout-deterministic.test.mjs \
  benchmarks/suites/review-fanout/review-fanout-score.test.mjs \
  benchmarks/suites/shared/review-brief-metrics.test.mjs

# Dry-run live harness (no Codex)
node benchmarks/suites/review-fanout/review-fanout-live.mjs --dry-run --trials 3

# Live (sequential; costly)
node --import tsx benchmarks/suites/review-fanout/review-fanout-live.mjs --trials 3 --seed 42
```
