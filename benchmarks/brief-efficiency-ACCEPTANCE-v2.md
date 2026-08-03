# Optimization #4 — v2 pre-registration (implementation-ready briefs)

**Supersedes for new runs:** [brief-efficiency-ACCEPTANCE.md](./brief-efficiency-ACCEPTANCE.md) protocol details unchanged unless noted below.

**v1 invalid live trials:** frozen under [out/v1-invalid-claims-2-4/](./out/v1-invalid-claims-2-4/MANIFEST.json). v1 `FAIL_WASTE` with tied 0 waste was schema rejection, not a waste observation.

## v2 corrections (harness only)

| Change | Version | Reason |
| --- | --- | --- |
| Invalid arms → `validity: invalid`, `quality/waste: null` | v2 | No completed work ≠ 0% quality |
| Gate label `INCONCLUSIVE_INVALID` when zero valid arms | v2 | Honest rerun semantics |
| Preflight implement schema gate | v2 | Abort before N×2 implement calls |
| Medians/bootstrap exclude invalid arms | v2 | Same waste gates, valid samples only |

**Gates unchanged from v1:** brief pass rate ≥ loose; median brief waste < loose; brief OOS writes ≤ loose. Wall time informational only.

## Fixed protocol (unchanged workload)

| Item | Value |
| --- | --- |
| Fixture | `benchmarks/brief-efficiency/fixture/` (clamp task; seed red / golden green) |
| Profile | `engineer`, structured both arms |
| Trials/arm | **≥5** |
| Order | AB/BA via `--seed 42` |
| Workspace | Disposable temp git repo per arm; plugin repo read-only |
| Output | `benchmarks/out/v2-brief-efficiency/` |

Task is intentionally nontrivial (noise files + loose discovery prompt) to expose scope/waste differences when provider calls succeed.

## Preflight (required before live)

```bash
node --import tsx benchmarks/brief-efficiency/brief-efficiency-live.mjs \
  --preflight-only --dry-run --out benchmarks/out/v2-brief-efficiency

node --import tsx benchmarks/brief-efficiency/brief-efficiency-live.mjs \
  --preflight-only --out benchmarks/out/v2-brief-efficiency
```

Repair or remove stale `~/.codex/schemas/implement-report.schema.json` so `recommended_verification` is in `required`.

## Pass / fail labels (v2)

Same as v1 plus **`INCONCLUSIVE_INVALID`** when all arms schema-rejected.
