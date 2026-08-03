# Claim 1 — PLAN v2 (predeclared; gate unchanged)

Supersedes claim-1 **live protocol** only. Gates from [PLAN.md](./PLAN.md) stay frozen:

| Gate | Value |
| --- | --- |
| Speed | Median total wall `(control−treatment)/control` ≥ **10%** |
| CI | Bootstrap 95% CI on relative median improvement must **exclude 0** for `proven` |
| Quality | Both turns ok **and** turn-2 content rubric pass (v2) |
| Claims | Still **claim 1** = exec persist + `exec resume`. Claim 3 stays app-server warm turn-2 |

v1 artifacts under `benchmarks/out/core-live/` are **preserved**; write v2 to a new output dir.

## Diagnosis summary (v1)

See `benchmarks/out/core-live/claim1-v1-diagnosis.md`.

- Tokens ↑ because resume turn-2 carries thread history (~80k vs ~35k).
- Spawn equal (2 cold CLIs); reported 4 was double-count.
- CI wide from n=5 + control stall outlier + one negative pair.
- Turn-2 prompt context-asymmetric.

## v2 protocol changes (predeclared)

1. **N = 21 trials/arm** (from v1 paired-% σ≈0.21: n≈15 for ~15% true effect / power≈0.8; **21** adds margin for heavy tails + CI-excludes-0 at ≥10% point).
2. **Randomized AB/BA** per repeat (unchanged `buildAbBaSchedule`).
3. **Warmup once per arm** before timed repeats (not per repeat).
4. **Matched task / quality**
   - Same turn-1 prompt both arms.
   - Turn-2 asks the same factual question (JSONL event kinds in `consumeJsonlLine`).
   - Control turn-2 is **self-contained** (may re-read `src/jsonl.ts`; no fake “prior context”).
   - Treatment turn-2 is **resume follow-up** (prefer prior thread; may skim file if needed).
   - Rubric: answer must name ≥3 of `{thread.started, turn.started, turn.completed, turn.failed, item.started, item.completed, error}` (case-insensitive). Fail → trial `ok=false`.
5. **Per-turn metrics** recorded (wall, tokens, spawn, ok) then summed for gate metric `total_wall_ms`.
6. **Spawn counting** per turn (no shared-counter double merge).
7. **Bootstrap** pairs by `repeatIndex` (not raw push order).
8. **Sequential only** — no concurrent live trials.
9. **Secondary (report only):** input tokens, cached tokens, per-turn walls. Token regression does **not** flip a wall pass.
10. **No gate move** after seeing v2 results.

## Exact v2 run command

```bash
# From repo root. Sequential. Do not parallelize.
pnpm run benchmark -- \
  --live-only \
  --protocol v2 \
  --trials 21 \
  --claims 1 \
  --output benchmarks/out/core-live-v2
```

Dry-run / structural (no API):

```bash
pnpm run benchmark -- --dry-run --protocol v2 --trials 21 --claims 1
pnpm run benchmark -- --structural-only --protocol v2 --claims 1
```

Expected wall clock: ~21 pairs × ~(40–90s/arm + warmups + cooldowns) ≈ **2–4 hours** sequential; do not overlap with other live claim runs.

## Pass expectation (pre-live)

**Not expected to pass** as a process-persistence claim (mechanism equals 2 cold execs).  
**Uncertain / lean fail-to-inconclusive** as a context-reuse wall claim under matched quality: true Δ may land ~0–20%; 10% gate + CI-excludes-0 is strict at residual noise. Claim 3 remains the proven warm-path result.

## Out of scope

- Relabeling app-server / claim 3 as claim 1.
- Loosening the 10% median wall gate.
- Concurrent live API calls.
- Deleting or overwriting `benchmarks/out/core-live/`.
