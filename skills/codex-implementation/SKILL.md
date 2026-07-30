---
name: codex-implementation
description: "Use Codex to perform delegated implementation, migrations, mechanical edits, structured extraction, fan-out, or clear-spec code work through `codex exec --profile engineer` (default) or `--profile implement` (heavy). MUST invoke when the user asks to hand implementation to Codex/GPT or when parallel/bulk Codex execution is useful."
tags: [tool, codex, implementation, gpt-5.6-sol, gpt-5.6-luna, profiles, delegation, workspace-write]
triggers:
  - "codex implement"
  - "gpt implement"
  - "have gpt write this"
  - "delegate implementation to codex"
  - "codex implementation"
  - "parallel codex agents"
  - "bulk codex work"
---

# Codex Implementation

Delegate code changes from a clear spec. You orchestrate; Codex edits.

## References

| Topic | File | When to read |
|-------|------|--------------|
| Profile routing | [profiles-and-routing.md](references/profiles-and-routing.md) | engineer vs implement vs probe |
| Default edit | [engineer-one-shot.md](references/engineer-one-shot.md) | Bounded one-shot implementation |
| Heavy edit | [implement-heavy.md](references/implement-heavy.md) | Large/ambiguous cross-cutting work |
| Parallel workers | [parallel-workers.md](references/parallel-workers.md) | Multi-agent orchestration fan-out |
| Explore scope | [probe.md](references/probe.md) | Read-only survey before editing |
| Multi-step | [resume-and-background.md](references/resume-and-background.md) | `resume --last`, background runs |

## Quick decisions

**Clear bounded edit?** → [engineer-one-shot.md](references/engineer-one-shot.md)

**Heavy / ambiguous / multi-layer?** → [implement-heavy.md](references/implement-heavy.md)

**Parallel worker fan-out?** → [parallel-workers.md](references/parallel-workers.md)

**Unknown scope first?** → [probe.md](references/probe.md)

**Multi-step fix loop?** → [resume-and-background.md](references/resume-and-background.md)

**Which profile?** → [profiles-and-routing.md](references/profiles-and-routing.md)
