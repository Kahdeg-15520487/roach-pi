# Long Run State: Structured Harness State Tools Migration

**Created:** 2026-05-06 18:00
**Last Updated:** 2026-05-06 19:10
**Status:** executing

**Context Brief:** docs/engineering-discipline/context/2026-05-06-structured-harness-state-tools-brief.md

**Verification Strategy:**
- **Level:** test-suite + build
- **Command:** `cd extensions/agentic-harness && npm run build && npm test`
- **What it validates:** TypeScript correctness and the full agentic-harness regression suite, including structured state, storage, replay, tools, renderers, footer, and skill-contract tests added during migration.

## Milestones

| ID | Name | Status | Attempts | Dependencies | Plan File | Review File |
|----|------|--------|----------|--------------|-----------|-------------|
| M1 | State Kernel and Pure Renderers | completed | 1 | — | docs/engineering-discipline/plans/2026-05-06-m1-state-kernel-and-pure-renderers.md | docs/engineering-discipline/reviews/2026-05-06-m1-state-kernel-and-pure-renderers-review.md |
| M2 | Durable Storage and Replay Foundation | pending | 0 | M1 | — | — |
| M3 | Structured Harness Tools | pending | 0 | M1, M2 | — | — |
| M4 | Skill and Workflow Migration | pending | 0 | M3 | — | — |
| M5 | Footer and Progress Cutover | pending | 0 | M3 | — | — |
| M6 | Runtime Replay Cutover and Parser Quarantine | pending | 0 | M4, M5 | — | — |
| M7 | Legacy Cleanup and Regression Stabilization | pending | 0 | M6 | — | — |
| M_final | Integration Verification | pending | 0 | M1, M2, M3, M4, M5, M6, M7 | — | — |

Status values: pending | planning | executing | validating | completed | failed | skipped
Attempts: number of plan-execute-review cycles attempted.

## Execution Order

```text
Phase 1: M1
Phase 2: M2
Phase 3: M3
Phase 4 parallel: M4, M5
Phase 5: M6
Phase 6: M7
Phase 7: M_final
```

## DAG Validation

- No circular dependencies.
- M4 and M5 can run in parallel: skill docs vs runtime/UI mostly separate.
- Parser removal is delayed until structured tools, footer integration, and skills are ready.
- Every milestone has measurable success criteria.
- M_final depends on all implementation milestones.

## Execution Log

| Timestamp | Event | Details |
|-----------|-------|---------|
| 2026-05-06 18:00 | milestones-locked | 8 milestones approved by user, including M_final integration verification. |
| 2026-05-06 18:09 | planning-started | M1 State Kernel and Pure Renderers |
| 2026-05-06 18:13 | plan-written | M1 plan saved to docs/engineering-discipline/plans/2026-05-06-m1-state-kernel-and-pure-renderers.md |
| 2026-05-06 18:13 | execution-started | M1 attempt 1 |
| 2026-05-06 18:31 | plan-corrected | M1 verification commands hardened with workspace-local TMPDIR after sandboxed Vitest hit EPERM in /var/folders. |
| 2026-05-06 18:59 | blocker-fixed | Subagent launch sandbox disabled in code path for future sessions; root build/test passed. Current pi session still has old registered tool closure until restart. |
| 2026-05-06 19:02 | review-started | M1 State Kernel and Pure Renderers |
| 2026-05-06 19:10 | review-passed | M1 independent review PASS; checkpoint written to docs/engineering-discipline/harness/structured-harness-state-tools-2026-05-06/checkpoints/M1-checkpoint.md |
