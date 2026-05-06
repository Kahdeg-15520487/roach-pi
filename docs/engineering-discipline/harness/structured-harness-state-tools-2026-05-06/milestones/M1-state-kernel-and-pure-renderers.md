# Milestone: State Kernel and Pure Renderers

**ID:** M1
**Status:** completed
**Dependencies:** None
**Risk:** High
**Effort:** Medium

## Goal

Establish the canonical structured state model, reducer, selectors, invariants, and pure markdown renderers without touching runtime behavior.

## Success Criteria

- [ ] `HarnessState` includes schema version, milestones, plans, plan tasks, todos, IDs, timestamps, and status enums.
- [ ] Reducer rejects or normalizes illegal transitions with clear, agent-readable errors.
- [ ] Selectors produce milestone, plan, task, and todo summaries for footer/tool consumers.
- [ ] Pure render tests cover `state.md`, plan markdown, and `todo.md` output from structured state.
- [ ] `cd extensions/agentic-harness && npm run build && npm test` passes for added state/render tests.

## Files Affected

- Create: `extensions/agentic-harness/harness-state.ts`
- Create: `extensions/agentic-harness/harness-render.ts`
- Create: `extensions/agentic-harness/tests/harness-state.test.ts`
- Create: `extensions/agentic-harness/tests/harness-render.test.ts`

## User Value

No visible runtime behavior changes yet; creates the minimum viable foundation for reliable non-parser progress tracking.

## Abort Point

Yes — this milestone is foundational and can be reviewed independently before runtime integration.

## Notes

Do not modify existing parser/runtime paths in this milestone. Keep all new code pure and testable.
