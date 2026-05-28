# Clarify-to-Goal Runtime Rewrite Implementation Plan

> **Worker note:** This is an intentionally large, one-shot architectural rewrite plan. Execute strictly in task order. After each step completes and passes its stated verification, immediately flip that step checkbox and call `todoread`/`todowrite`. Do not claim completion while any checkbox remains open.

**Goal:** Replace the current user-facing `clarify -> plan/run-plan/milestones/long-run` workflow with a single durable `clarify -> goal` runtime that owns queueing, subgoals, evidence, verifier-subagent completion guard, and automatic continuation.

**Architecture:** Build a typed `/goal` runtime inside `extensions/agentic-harness` with reducer-style durable state, session replay events, and a ledger. Rewrite `/clarify` to produce a Goal Contract instead of a Context Brief for planning. Remove public `/plan` and milestone/long-run skill surfaces; keep only low-level primitives that the goal runtime needs (`subagent`, reviewers, todo tools, footer, storage patterns). Completion is a hard state transition guarded by a verifier subagent, not a prompt convention.

**Tech Stack:** TypeScript ESM, Pi extension API, `@mariozechner/pi-coding-agent`, `@mariozechner/pi-tui`, Vitest, filesystem JSON snapshots + session custom entries.

**Work Scope:**
- **In scope:** New goal state/storage/events/command/runtime/continuation modules; `/goal` command; `/clarify` handoff rewrite; removal of `/plan --milestones` and plan/milestone/long-run user-facing skills; verifier subagent guard using existing allowed verifier agent surface; goal footer/progress; compaction/session restore; docs/tests; full Windows-compatible verification.
- **Out of scope:** Keeping `/plan` compatibility; preserving old plan/milestone user-facing workflow; implementing a separate `ultragoal` command/name; changing Pi core packages.

**Non-negotiable decisions:**
- The user-facing workflow is `/clarify -> /goal`; not `/clarify -> /plan`.
- The feature name is `goal`, never `ultragoal`.
- `/plan` and `/plan --milestones` are removed from public command registration in the final state.
- `agentic-plan-crafting`, `agentic-run-plan`, `agentic-milestone-planning`, `agentic-long-run`, and `agentic-review-work` are not discoverable public skills in the final state.
- Completion requires verifier subagent PASS. Main-agent self-attestation is insufficient.
- Verifier FAIL automatically queues a continuation follow-up with blockers.

**Verification Strategy:**
- **Level:** test-suite + build + grep-based legacy-surface audit
- **Command:** `cd extensions/agentic-harness && npm test && npm run build`
- **Additional audit commands:**
  - `rg -n "agentic-plan-crafting|agentic-run-plan|agentic-milestone-planning|agentic-long-run|agentic-review-work|/plan|milestoneplanning|run-plan|long-run" extensions/agentic-harness README.md docs -g '!docs/engineering-discipline/plans/2026-05-28-clarify-to-goal-runtime-rewrite.md'`
  - Expected: only intentional compatibility comments/tests, or no matches after final cleanup.
- **What it validates:** Tests prove `/goal` lifecycle, persistence, verifier guard, continuation loop, clarify handoff, footer/progress, skill discovery cleanup, compaction restore, and absence of the old user-facing plan/milestone workflow.

**Success Criteria:**
- `/clarify` prompt and skill output route to a Goal Contract and `/goal activate`, not to plan/milestones.
- `/goal` supports durable multi-goal queue, active goal, subgoals, evidence ledger, pause/resume/status/clear, completion request, and verifier receipt.
- A goal/subgoal cannot transition to `completed` without a fresh PASS receipt from the verifier subagent.
- Verifier FAIL stores blockers and sends an automatic follow-up instructing continued work.
- PASS on a goal/subgoal automatically advances to the next runnable subgoal/goal when queue automation is enabled.
- `/plan` and `/plan --milestones` are not registered public commands.
- Old plan/milestone/run-plan/long-run skills are not discoverable public skills.
- Existing non-workflow features remain green: `ask_user_question`, `subagent`, `todoread`, `todowrite`, footer, shimmer status, `/review`, `/ultrareview`, `/team`, sandbox, webfetch.
- Full test suite and build pass on Windows.

---

## File Structure Mapping

### New files
- `extensions/agentic-harness/goal-state.ts` — reducer, state types, lifecycle invariants.
- `extensions/agentic-harness/goal-storage.ts` — snapshot paths, atomic reads/writes, default root.
- `extensions/agentic-harness/goal-events.ts` — session replay custom entry format and restore helpers.
- `extensions/agentic-harness/goal-state-service.ts` — mutation lock + apply/persist/replay helpers.
- `extensions/agentic-harness/goal-command.ts` — `/goal` command parser and help text.
- `extensions/agentic-harness/goal-render.ts` — status/ledger/footer-friendly rendering.
- `extensions/agentic-harness/goal-verifier.ts` — fixed verifier prompt builder, verdict parser, receipt builder.
- `extensions/agentic-harness/goal-continuation.ts` — continuation policy, follow-up prompt builder, loop guards.
- `extensions/agentic-harness/skills/agentic-goal/SKILL.md` — new primary execution skill.
- Tests:
  - `extensions/agentic-harness/tests/goal-state.test.ts`
  - `extensions/agentic-harness/tests/goal-storage.test.ts`
  - `extensions/agentic-harness/tests/goal-events.test.ts`
  - `extensions/agentic-harness/tests/goal-command.test.ts`
  - `extensions/agentic-harness/tests/goal-verifier.test.ts`
  - `extensions/agentic-harness/tests/goal-continuation.test.ts`
  - `extensions/agentic-harness/tests/goal-workflow.test.ts`

### Modified files
- `extensions/agentic-harness/index.ts` — register `/goal`, remove `/plan`, rewrite phases/guidance, wire events/continuation/footer restore.
- `extensions/agentic-harness/footer.ts` — display active goal/subgoal summary.
- `extensions/agentic-harness/skills/agentic-clarification/SKILL.md` — output Goal Contract, no plan handoff.
- `extensions/agentic-harness/skills/*` — remove public plan/milestone/long-run/review-work skills from discoverable surface.
- `extensions/agentic-harness/tests/extension.test.ts` — command registration, prompt, event, no-legacy assertions.
- `extensions/agentic-harness/tests/skill-docs.test.ts` — new goal docs and no old workflow leakage.
- `extensions/agentic-harness/tests/footer.test.ts` — goal footer rendering.
- `README.md` and relevant docs — clarify -> goal workflow.

### Deleted or moved to non-discoverable archive
- Public skill directories to remove from `skills/` discovery:
  - `agentic-plan-crafting`
  - `agentic-run-plan`
  - `agentic-milestone-planning`
  - `agentic-long-run`
  - `agentic-review-work`
- If historical content must be retained, move under `extensions/agentic-harness/internal-archive/legacy-skills/` and ensure resource discovery does not load it.

---

## Goal Runtime Contract

### State model

```ts
export type GoalRunStatus = "idle" | "active" | "paused" | "completed" | "failed" | "cancelled";
export type GoalStatus = "queued" | "active" | "blocked" | "verifying" | "completed" | "failed" | "cancelled";
export type SubgoalStatus = "queued" | "active" | "implemented" | "verifying" | "completed" | "failed" | "blocked" | "cancelled";

export interface GoalState {
  schemaVersion: 1;
  runId: string;
  status: GoalRunStatus;
  activeGoalId?: string;
  goals: GoalItem[];
  ledger: GoalLedgerEntry[];
  continuation: GoalContinuationState;
  createdAt: string;
  updatedAt: string;
}

export interface GoalItem {
  id: string;
  title: string;
  objective: string;
  status: GoalStatus;
  priority: "high" | "medium" | "low";
  successCriteria: string[];
  constraints: string[];
  evidenceRequired: string[];
  subgoals: SubgoalItem[];
  activeSubgoalId?: string;
  verifierReceipts: GoalVerifierReceipt[];
  blockers: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SubgoalItem {
  id: string;
  goalId: string;
  title: string;
  objective: string;
  status: SubgoalStatus;
  dependencies: string[];
  evidence: string[];
  attempts: number;
  verifierReceipts: GoalVerifierReceipt[];
  blockers: string[];
  createdAt: string;
  updatedAt: string;
}

export interface GoalVerifierReceipt {
  id: string;
  targetType: "goal" | "subgoal";
  targetId: string;
  objectiveHash: string;
  verdict: "PASS" | "FAIL";
  verifiedAt: string;
  verifierAgent: "reviewer-verifier";
  summary: string;
  blockers: string[];
  commandsRun: string[];
  evidence: string[];
  rawOutput: string;
}

export interface GoalLedgerEntry {
  seq: number;
  type:
    | "goal_created"
    | "goal_activated"
    | "subgoal_created"
    | "evidence_added"
    | "completion_requested"
    | "verifier_started"
    | "verifier_pass"
    | "verifier_fail"
    | "continuation_queued"
    | "goal_completed"
    | "goal_paused"
    | "goal_resumed"
    | "goal_cancelled";
  goalId?: string;
  subgoalId?: string;
  message: string;
  createdAt: string;
  data?: Record<string, unknown>;
}
```

### Completion invariant

A reducer call that completes a target must reject unless:
- the target has a latest verifier receipt with `verdict === "PASS"`,
- receipt `objectiveHash` matches the current target objective/success criteria/evidence requirements,
- no newer `evidence_added`, `subgoal_created`, or `completion_requested` entry invalidates the receipt,
- receipt target id matches the target being completed.

---

## Task 0: Baseline Lock and Legacy Surface Snapshot

**Dependencies:** None
**Files:**
- Modify: `extensions/agentic-harness/tests/extension.test.ts`
- Modify: `extensions/agentic-harness/tests/skill-docs.test.ts`
- Create: `extensions/agentic-harness/tests/goal-workflow.test.ts`

- [x] **Step 1: Add failing tests for desired final public commands**

Add tests asserting final public command surface includes `/goal` and does not include `/plan`.

Expected before implementation: FAIL because `/goal` does not exist and `/plan` exists.

- [x] **Step 2: Add failing tests for final skill discovery surface**

Add tests asserting `agentic-goal` exists and old public workflow skills are not discovered from `skills/`.

Expected before implementation: FAIL.

- [x] **Step 3: Add failing clarify handoff snapshot test**

Test that `/clarify` guidance says Goal Contract and `/goal activate`, and does not say `agentic-plan-crafting`, `agentic-milestone-planning`, or `/plan`.

Expected before implementation: FAIL.

- [x] **Step 4: Run baseline failing tests**

Run: `cd extensions/agentic-harness && npm test -- tests/extension.test.ts tests/skill-docs.test.ts tests/goal-workflow.test.ts`
Expected: FAIL only on the new goal rewrite assertions.

---

## Task 1: Implement Goal State Reducer and Invariants

**Dependencies:** Task 0
**Files:**
- Create: `extensions/agentic-harness/goal-state.ts`
- Create: `extensions/agentic-harness/tests/goal-state.test.ts`

- [x] **Step 1: Implement types and `createGoalState(runId, now)`**

Create state/types exactly around the contract above. Use deterministic ids supplied by commands in tests; do not generate ids inside the reducer except ledger `seq`.

- [x] **Step 2: Implement reducer commands**

Support commands:
- `create_goal`
- `activate_goal`
- `create_subgoal`
- `add_evidence`
- `request_completion`
- `record_verifier_result`
- `complete_target`
- `pause_goal`
- `resume_goal`
- `cancel_goal`
- `queue_continuation`
- `clear_continuation`

- [x] **Step 3: Enforce completion invariant in reducer**

`complete_target` must throw `GoalInvariantError` when PASS receipt is missing/stale/mismatched.

- [x] **Step 4: Add reducer tests**

Tests must cover:
- create/activate goal
- subgoal dependencies
- evidence ledger append
- complete without PASS fails
- FAIL receipt blocks completion
- PASS receipt allows completion
- new evidence after PASS makes receipt stale
- all goals completed marks run completed

- [x] **Step 5: Run goal state tests**

Run: `cd extensions/agentic-harness && npm test -- tests/goal-state.test.ts`
Expected: PASS.

---

## Task 2: Implement Goal Storage, Session Events, and Restore

**Dependencies:** Task 1
**Files:**
- Create: `extensions/agentic-harness/goal-storage.ts`
- Create: `extensions/agentic-harness/goal-events.ts`
- Create: `extensions/agentic-harness/goal-state-service.ts`
- Create: `extensions/agentic-harness/tests/goal-storage.test.ts`
- Create: `extensions/agentic-harness/tests/goal-events.test.ts`

- [x] **Step 1: Implement snapshot storage**

Use root `.pi/agent/goal-state/<runId>/state.json` by default. Atomic writes must be Windows-safe: write tmp, rename; on Windows EPERM/EBUSY, retry copy/unlink fallback like `team-state.ts`.

- [x] **Step 2: Implement session replay event type**

Use custom type `goal-state-event`. Store `{ runId, command, createdAt }`.

- [x] **Step 3: Implement restore from snapshot + session events**

`restoreGoalStateFromSnapshotAndEvents(rootDir, runId, events)` applies events after snapshot. Invalid events are ignored with explicit error return for tests.

- [x] **Step 4: Implement mutation lock service**

Add `withGoalStateMutationLock(runId, fn)` and `applyAndPersistGoalCommand(...)` modeled after harness service.

- [x] **Step 5: Add storage/replay tests**

Tests must cover:
- write/read snapshot
- concurrent writes on Windows
- replay event order
- snapshot + later events
- malformed events ignored safely

- [x] **Step 6: Run storage tests**

Run: `cd extensions/agentic-harness && npm test -- tests/goal-storage.test.ts tests/goal-events.test.ts`
Expected: PASS.

---

## Task 3: Implement `/goal` Command Parser and Renderer

**Dependencies:** Task 1
**Files:**
- Create: `extensions/agentic-harness/goal-command.ts`
- Create: `extensions/agentic-harness/goal-render.ts`
- Create: `extensions/agentic-harness/tests/goal-command.test.ts`

- [x] **Step 1: Implement parser**

Support:
- `/goal` -> status
- `/goal status`
- `/goal create <objective>`
- `/goal activate <goalId>`
- `/goal subgoal <goalId> <title>`
- `/goal evidence <targetId> <evidence>`
- `/goal complete <targetId>`
- `/goal pause [goalId]`
- `/goal resume [goalId]`
- `/goal clear --confirm`
- `/goal help`

- [x] **Step 2: Implement help text**

Help must describe clarify -> goal and verifier guard. It must not mention `/plan`, run-plan, milestones, or long-run.

- [x] **Step 3: Implement renderer**

Render active goal, subgoals, blockers, latest verifier receipt, and next action.

- [x] **Step 4: Add parser/render tests**

Tests must cover every command and invalid inputs.

- [x] **Step 5: Run command tests**

Run: `cd extensions/agentic-harness && npm test -- tests/goal-command.test.ts`
Expected: PASS.

---

## Task 4: Register `/goal` and Remove Public `/plan`

**Dependencies:** Tasks 2 and 3
**Files:**
- Modify: `extensions/agentic-harness/index.ts`
- Modify: `extensions/agentic-harness/tests/extension.test.ts`

- [x] **Step 1: Register `/goal` command**

Wire parser actions to goal state service. Use `ctx.sessionManager?.appendCustomEntry?.("goal-state-event", event)` after successful mutations.

- [x] **Step 2: Remove `/plan` command registration**

Delete the public `/plan` registration and `/plan --milestones` path from `index.ts`. Do not leave a compatibility alias.

- [x] **Step 3: Update command registration tests**

Assert:
- `/goal` exists
- `/plan` does not exist
- `/clarify`, `/review`, `/ultrareview`, `/ask`, `/team` keep expected behavior

- [x] **Step 4: Run extension command tests**

Run: `cd extensions/agentic-harness && npm test -- tests/extension.test.ts tests/goal-command.test.ts`
Expected: PASS.

---

## Task 5: Rewrite Workflow Phases and Prompt Guidance

**Dependencies:** Task 4
**Files:**
- Modify: `extensions/agentic-harness/index.ts`
- Modify: `extensions/agentic-harness/tests/extension.test.ts`

- [x] **Step 1: Replace `WorkflowPhase` values**

Final phases:
- `idle`
- `clarifying`
- `goal_drafting`
- `goal_active`
- `goal_verifying`
- `reviewing`
- `ultrareviewing`

Remove `planning` and `milestoneplanning`.

- [x] **Step 2: Rewrite `PHASE_GUIDANCE`**

Guidance must say:
- clarification creates Goal Contract
- active goal uses `/goal status`, `todoread`, `todowrite`, evidence ledger
- completion requires verifier PASS
- no plan checkbox requirement unless the active goal explicitly creates todos

- [x] **Step 3: Replace unconditional plan-checkbox prompt block**

Remove plan markdown checkbox hard-rule as a global rule. Replace with goal progress rules:
- use `todoread` before status changes
- use `todowrite` immediately after task progress
- append goal evidence before completion request
- never claim goal complete before verifier PASS

- [x] **Step 4: Update prompt tests**

Assert no `milestoneplanning`, `agentic-plan-crafting`, or `run-plan` appears in root system guidance.

- [x] **Step 5: Run prompt tests**

Run: `cd extensions/agentic-harness && npm test -- tests/extension.test.ts`
Expected: PASS.

---

## Task 6: Rewrite Clarification Skill to Goal Contract Handoff

**Dependencies:** Task 5
**Files:**
- Modify: `extensions/agentic-harness/skills/agentic-clarification/SKILL.md`
- Modify: `extensions/agentic-harness/tests/skill-docs.test.ts`
- Modify: `extensions/agentic-harness/tests/extension.test.ts`

- [x] **Step 1: Rewrite output contract**

Clarification must end with a Goal Contract containing:
- objective
- scope in/out
- success criteria
- constraints
- evidence required
- risks
- suggested initial subgoals
- exact `/goal create` or `/goal activate` handoff

- [x] **Step 2: Remove plan routing language**

Delete references to `agentic-plan-crafting`, `agentic-milestone-planning`, `/plan`, milestones, run-plan, and long-run as next steps.

- [x] **Step 3: Update `/clarify` command prompt in `index.ts` if needed**

Ensure command prompt tells agent to produce Goal Contract and stop, not plan.

- [x] **Step 4: Add skill doc tests**

Assert clarification skill contains `Goal Contract`, `/goal`, `success criteria`, `evidence required`, and does not contain old plan routing strings.

- [x] **Step 5: Run skill tests**

Run: `cd extensions/agentic-harness && npm test -- tests/skill-docs.test.ts tests/extension.test.ts`
Expected: PASS.

---

## Task 7: Remove Old Public Workflow Skills from Discovery

**Dependencies:** Task 6
**Files:**
- Move/Delete: `extensions/agentic-harness/skills/agentic-plan-crafting/`
- Move/Delete: `extensions/agentic-harness/skills/agentic-run-plan/`
- Move/Delete: `extensions/agentic-harness/skills/agentic-milestone-planning/`
- Move/Delete: `extensions/agentic-harness/skills/agentic-long-run/`
- Move/Delete: `extensions/agentic-harness/skills/agentic-review-work/`
- Create/Modify: `extensions/agentic-harness/skills/agentic-goal/SKILL.md`
- Modify: `extensions/agentic-harness/tests/skill-docs.test.ts`

- [x] **Step 1: Add `agentic-goal` skill**

The skill must describe:
- read `/goal status`
- work only on active goal/subgoal
- maintain todos/evidence
- request completion only when evidence is present
- verifier FAIL means continue blockers
- verifier PASS advances queue

- [x] **Step 2: Remove old workflow skill directories from discoverable `skills/`**

Move old directories to `extensions/agentic-harness/internal-archive/legacy-skills/` or delete them. If moved, ensure discovery only scans `skills/`.

- [x] **Step 3: Update skill docs tests**

Assert old skill names are absent from bundled skill discovery fixtures.

- [x] **Step 4: Run skill discovery tests**

Run: `cd extensions/agentic-harness && npm test -- tests/skill-docs.test.ts tests/extension.test.ts`
Expected: PASS.

---

## Task 8: Implement Verifier Subagent Guard

**Dependencies:** Tasks 1, 2, 4
**Files:**
- Create: `extensions/agentic-harness/goal-verifier.ts`
- Modify: `extensions/agentic-harness/index.ts`
- Create: `extensions/agentic-harness/tests/goal-verifier.test.ts`
- Modify: `extensions/agentic-harness/tests/goal-workflow.test.ts`

- [x] **Step 1: Build fixed verifier prompt**

Use existing allowed `reviewer-verifier` subagent name. Prompt includes:
- target goal/subgoal objective
- success criteria
- evidence list
- blockers
- repo cwd
- instruction to inspect independently
- strict output format:

```text
Verdict: PASS|FAIL
Summary: ...
Blockers:
- ...
Commands Run:
- ...
Evidence Checked:
- ...
```

- [x] **Step 2: Parse verifier output fail-closed**

If output lacks `Verdict: PASS`, treat as FAIL. Store raw output.

- [x] **Step 3: Invoke verifier on `/goal complete`**

Use `runAgent(...)` from `subagent.ts` with discovered `reviewer-verifier` config. Do not ask the main agent to call the subagent tool for completion guard.

- [x] **Step 4: Store verifier receipt**

Apply `record_verifier_result` command. PASS then applies `complete_target`. FAIL does not complete.

- [x] **Step 5: Add verifier tests**

Mock `runAgent` result:
- PASS allows completion
- FAIL blocks completion
- malformed output blocks completion
- verifier process error blocks completion
- stale PASS does not allow completion after new evidence

- [x] **Step 6: Run verifier tests**

Run: `cd extensions/agentic-harness && npm test -- tests/goal-verifier.test.ts tests/goal-workflow.test.ts`
Expected: PASS.

---

## Task 9: Implement Automatic Continuation Loop

**Dependencies:** Task 8
**Files:**
- Create: `extensions/agentic-harness/goal-continuation.ts`
- Modify: `extensions/agentic-harness/index.ts`
- Create: `extensions/agentic-harness/tests/goal-continuation.test.ts`

- [x] **Step 1: Define continuation policy**

Rules:
- only root session
- no continuation in subagent or team worker context
- one outstanding continuation at a time
- max consecutive verifier failures per target: 3
- if FAIL, send blockers follow-up
- if PASS and next runnable target exists, send next target follow-up
- if queue complete, stop

- [x] **Step 2: Wire event hook**

Use `agent_end` or `turn_end` if available; otherwise trigger continuation immediately after `/goal complete` verifier result. Use `pi.sendUserMessage(prompt, { deliverAs: "followUp" })` when available, fallback to `pi.sendUserMessage(prompt)` in tests if options unsupported.

- [x] **Step 3: Build continuation prompts**

FAIL prompt:
- verifier failed
- blockers
- required next evidence
- do not claim complete until fixed

PASS next prompt:
- previous target passed
- next goal/subgoal objective
- required evidence

- [x] **Step 4: Add continuation tests**

Assert:
- FAIL sends follow-up with blockers
- PASS advances next runnable target
- no duplicate follow-up if lease exists
- no continuation in subagent depth > 0
- max failure budget stops automation

- [x] **Step 5: Run continuation tests**

Run: `cd extensions/agentic-harness && npm test -- tests/goal-continuation.test.ts tests/goal-workflow.test.ts`
Expected: PASS.

---

## Task 10: Goal Footer and Progress Integration

**Dependencies:** Tasks 2, 4, 9
**Files:**
- Modify: `extensions/agentic-harness/footer.ts`
- Create/Modify: `extensions/agentic-harness/goal-render.ts`
- Modify: `extensions/agentic-harness/index.ts`
- Modify: `extensions/agentic-harness/tests/footer.test.ts`

- [x] **Step 1: Add goal summary provider**

On session start, restore goal state and pass current goal summary to footer. Footer segment shows:
- active goal id/title
- active subgoal count
- verifier status (`verify:pass`, `verify:fail`, `verify:pending`)

- [x] **Step 2: Invalidate footer on goal events**

Whenever `goal-state-event` is appended or state mutates, request render.

- [x] **Step 3: Keep todo panel independent**

`todoread`/`todowrite` footer behavior must remain unchanged.

- [x] **Step 4: Add footer tests**

Assert:
- no active goal => no goal segment
- active goal renders width-safe
- verifier fail renders blocker indicator
- todos still render

- [x] **Step 5: Run footer tests**

Run: `cd extensions/agentic-harness && npm test -- tests/footer.test.ts`
Expected: PASS.

---

## Task 11: Compaction and Session Restore for Goal Runtime

**Dependencies:** Tasks 2, 5, 9
**Files:**
- Modify: `extensions/agentic-harness/index.ts`
- Modify: `extensions/agentic-harness/compaction.ts`
- Modify: `extensions/agentic-harness/tests/compaction.test.ts`
- Modify: `extensions/agentic-harness/tests/session-replay.test.ts`

- [x] **Step 1: Replace artifact goal naming**

Rename old ambiguous `activeGoalDocument` usage to explicit `activeArtifactDocument` unless it now refers to real goal runtime state.

- [x] **Step 2: Include goal state summary in compaction**

Compaction must preserve active goal id, objective, blockers, latest verifier result, and queued next actions.

- [x] **Step 3: Restore goal state on `session_start`**

Load snapshot + session events. If multiple goal runs exist, pick latest non-terminal active run.

- [x] **Step 4: Add replay/compaction tests**

Assert active goal survives session restore and compaction.

- [x] **Step 5: Run restore tests**

Run: `cd extensions/agentic-harness && npm test -- tests/compaction.test.ts tests/session-replay.test.ts tests/goal-events.test.ts`
Expected: PASS.

---

## Task 12: Remove Legacy Plan/Milestone Runtime Surfaces and Tests

**Dependencies:** Tasks 4–11
**Files:**
- Modify: `extensions/agentic-harness/index.ts`
- Modify/Delete: plan/milestone-related tests
- Modify: `extensions/agentic-harness/harness-progress.ts` if now unused
- Modify: `extensions/agentic-harness/harness-runtime-progress.ts` if now unused
- Modify: docs/README

- [x] **Step 1: Remove remaining public legacy references**

Run audit:

```bash
rg -n "agentic-plan-crafting|agentic-run-plan|agentic-milestone-planning|agentic-long-run|agentic-review-work|/plan|milestoneplanning|run-plan|long-run" extensions/agentic-harness README.md docs -g '!docs/engineering-discipline/plans/2026-05-28-clarify-to-goal-runtime-rewrite.md'
```

Remove or rewrite all matches unless they are in archived legacy docs excluded from discovery.

- [x] **Step 2: Remove obsolete tests or rewrite them to goal expectations**

Do not delete verification coverage; convert it:
- plan command tests -> goal command tests
- milestone tests -> goal subgoal queue tests
- run-plan tests -> goal verifier/continuation tests

- [x] **Step 3: Preserve low-level tools**

Keep `subagent`, `todoread`, `todowrite`, sandbox, webfetch, review/ultrareview, team unless tests prove they are unused and intentionally removed.

- [x] **Step 4: Run legacy audit**

Expected: no user-facing legacy workflow strings remain.

- [x] **Step 5: Run broad tests**

Run: `cd extensions/agentic-harness && npm test && npm run build`
Expected: PASS.

---

## Task 13: Documentation and Operator UX Rewrite

**Dependencies:** Task 12
**Files:**
- Modify: `README.md`
- Modify: `extensions/agentic-harness/README.md`
- Modify/Create: docs under `docs/engineering-discipline/`
- Modify: welcome UI docs/tests if needed

- [x] **Step 1: Rewrite primary workflow docs**

Document only:

```text
/clarify -> Goal Contract -> /goal activate -> automatic verifier-guarded execution
```

- [x] **Step 2: Document `/goal` commands**

Include examples for create/status/evidence/complete/pause/resume/clear.

- [x] **Step 3: Document verifier guard behavior**

Explain PASS/FAIL, blockers, continuation, failure budget, and evidence requirements.

- [x] **Step 4: Update welcome/help text tests**

Assert docs/help do not advertise `/plan`.

- [x] **Step 5: Run docs-related tests**

Run: `cd extensions/agentic-harness && npm test -- tests/skill-docs.test.ts tests/welcome-ui.test.ts tests/extension.test.ts`
Expected: PASS.

---

## Task 14 (Final): Full Verification Gate

**Dependencies:** All preceding tasks
**Files:** None, except fixing failures discovered by this task.

- [x] **Step 1: Run full test suite and build**

Run: `cd extensions/agentic-harness && npm test && npm run build`
Expected: PASS on Windows.

- [x] **Step 2: Run legacy workflow audit**

Run:

```bash
rg -n "agentic-plan-crafting|agentic-run-plan|agentic-milestone-planning|agentic-long-run|agentic-review-work|/plan|milestoneplanning|run-plan|long-run" extensions/agentic-harness README.md docs -g '!docs/engineering-discipline/plans/2026-05-28-clarify-to-goal-runtime-rewrite.md'
```

Expected: no user-facing matches. Any remaining match must be explicitly documented as archived/non-discoverable compatibility content.

- [x] **Step 3: Manual command surface smoke via tests/mocks**

Verify in tests or a mocked extension host:
- `/goal` registered
- `/plan` not registered
- `/clarify` registered and routes to Goal Contract
- `/review`, `/ultrareview`, `/team`, `/ask` still registered as intended

- [ ] **Step 4: Manual workflow smoke**

Run a local Pi session and verify:
1. `/clarify` for a small change asks questions and outputs Goal Contract.
2. `/goal create` creates durable state.
3. `/goal status` shows queue.
4. Add evidence.
5. `/goal complete` triggers verifier subagent.
6. FAIL keeps goal active and sends continuation.
7. PASS completes and advances queue.
8. Restart session; `/goal status` restores state.

- [x] **Step 5: Inspect changed files**

Run: `git diff --stat` and inspect major diffs.
Expected: changes match this plan only: goal runtime, workflow rewrite, skill/doc/test updates, legacy workflow removal.

---

## Rollback Plan

If full verification fails late:
1. Keep new goal modules and tests if they pass independently.
2. Revert only public surface removal (`/plan`, old skills) to recover usability.
3. Keep `/goal` behind an env flag `PI_AGENTIC_GOAL_RUNTIME=1` only if necessary.
4. Do not ship a half-rewritten state where `/clarify` routes to goal but old plan skills remain discoverable.

## Self-Review

- **Spec coverage:** Covers full rewrite, not incremental compatibility. Includes `/goal` runtime, queue, subgoals, ledger, verifier subagent guard, automatic continuation, clarify handoff, legacy workflow removal, docs/tests.
- **Verification strictness:** Every major task has targeted tests. Final gate includes full suite/build, grep audit, command surface smoke, and manual runtime smoke.
- **Risk controls:** Completion is reducer-enforced; verifier is fail-closed; continuation has leases/budget; old public workflow strings are audited.
- **Known conflict with reviewer caution:** Reviewers recommended staged compatibility. The user explicitly chose full rewrite. This plan still orders implementation safely inside one large migration branch while final state removes compatibility.
