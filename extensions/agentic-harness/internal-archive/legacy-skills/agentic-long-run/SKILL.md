---
name: agentic-long-run
description: Orchestrates multi-day execution of complex tasks through milestones. Each milestone goes through agentic-plan-crafting, agentic-run-plan (worker-validator), and agentic-review-work phases with checkpoint/recovery. Triggers when the user says "long run", "start long run", "execute milestones", or "run all milestones".
---

# Long Run Harness

Orchestrates multi-day execution of complex tasks through a milestone pipeline. Each milestone passes through agentic-plan-crafting → agentic-run-plan → agentic-review-work with checkpoints between milestones for recovery from interruptions.

## Core Principle

Long-running execution must be **resumable, auditable, and fail-safe.** Every state transition is persisted to disk before the next action begins. If execution stops for any reason — rate limit, crash, user pause, context loss — it can resume from the last checkpoint without repeating completed work.

## Hard Gates

1. **Milestones must exist before execution.** Either from `agentic-milestone-planning` skill or user-provided. Never generate milestones inline during execution.
2. **Canonical structured state must be updated before and after every milestone.** Use `harness_milestone` for milestone creation, dependency metadata, attempts, plan files, review files, and milestone lifecycle. Use `todoread` and `todowrite` for normal milestone/task progress updates visible to the agent. Rendered markdown is audit output only. If it is not in structured state, it didn't happen.
3. **Each milestone must complete the full pipeline.** agentic-plan-crafting → agentic-run-plan → agentic-review-work. No shortcuts. No skipping agentic-review-work "because it looked fine."
4. **Failed milestones block dependents.** If M2 depends on M1 and M1 fails review, M2 does not start. Period.
5. **User confirmation required at gate points.** Before starting a new milestone phase (planning, execution, review), check if the user wants to continue, pause, or abort.
6. **Never modify completed milestones.** Once a milestone passes agentic-review-work, its files are locked. If a later milestone needs changes to earlier work, that is a new milestone.
7. **Checkpoint after every milestone completion.** Write a checkpoint file recording what was done, test results, and review verdict before proceeding.
8. **Do not execute plan tasks directly as the main agent.** In long-run mode, the main agent is an orchestrator only. Plan task implementation must go through `agentic-run-plan` / worker-validator flow, and structured task progress must be persisted with `todoread` and `todowrite`.

## When To Use

- After `agentic-milestone-planning` has produced a milestone DAG
- When the user says "long run", "start long run", "execute milestones", or "run all milestones"
- When resuming a previously paused long run session

## When NOT To Use

- When milestones don't exist yet (use `agentic-milestone-planning` first)
- When there's only one milestone (use agentic-plan-crafting + agentic-run-plan directly)
- For quick tasks that don't warrant multi-phase execution

## Input

1. **Structured harness run identity** — `runId` plus optional `rootDir`/`PI_HARNESS_STATE_ROOT`.
2. Canonical milestone metadata is loaded with `harness_milestone load`; normal milestone/task progress is loaded with `todoread`. `state.md`, milestone markdown, and checkpoint markdown are rendered/audit artifacts only.

If no structured milestone state exists, ask the user if they want to run `agentic-milestone-planning` first.

## Process

### Phase 1: Load and Validate State

1. Load canonical milestone state with `harness_milestone load` using the run's `runId` and `rootDir`.
2. For every milestone that has a `planFile`/plan id, call `todoread` to load canonical milestone/task progress; do not infer task status from markdown checkboxes.
3. Validate:
   - All milestone dependencies in structured state form a valid DAG (no cycles, topological sort possible)
   - No milestone is in an invalid state (e.g., `executing` without an attached structured plan)
   - Dependent milestones only run after prerequisites are `completed`
4. Determine current position:
   - Which milestones are completed?
   - Which milestones are ready to start (all dependencies met)?
   - Is this a fresh start or a resume?
5. Present status to the user:

```
## Long Run Status: [Session Name]

**Progress:** N/M milestones completed
**Current phase:** [planning M3 | executing M3 | reviewing M3 | ready to start M3]
**Next up:** [M3, M4 (parallel)]

Completed: M1 ✓, M2 ✓
In progress: M3 (executing)
Pending: M4, M5
```

6. Ask user to confirm: continue, pause, or abort.

### Phase 2: Milestone Execution Loop

For each milestone in topological order:

```
┌─────────────────────────────────────┐
│         Milestone Pipeline          │
│                                     │
│  ┌──────────┐    ┌─────────┐        │
│  │  Plan    │───→│  Run    │        │
│  │ Crafting │    │  Plan   │        │
│  └──────────┘    └────┬────┘        │
│                       │             │
│                  ┌────▼────┐        │
│                  │ Review  │        │
│                  │  Work   │        │
│                  └────┬────┘        │
│                       │             │
│              ┌────────▼────────┐    │
│              │   PASS?         │    │
│              │  Yes → checkpoint│    │
│              │  No  → retry    │    │
│              └─────────────────┘    │
└─────────────────────────────────────┘
```

#### Step 2-1: Gate Check

Before starting a milestone:

1. Verify all dependency milestones have status `completed`
2. Verify no file conflicts with in-progress parallel milestones
3. Update canonical structured state via `harness_milestone set_status`: set milestone status to `planning`
4. Render/update the human-readable execution log after the structured update

#### Step 2-2: Plan Crafting Phase

1. Compose a Context Brief from the milestone definition:
   - Goal → from milestone file
   - Scope → files affected from milestone file
   - Success Criteria → from milestone file
   - Constraints → inherited from the parent problem + completed milestone context
   - **Completed milestone context contract:** From each completed predecessor, include ONLY:
     - Files created/modified (from checkpoint's "Files Changed" list)
     - Interface contracts established (function signatures, API shapes, type definitions)
     - Success criteria that were verified as met
   - Do NOT include: execution logs, review documents, worker/validator output, or full checkpoint contents
   - **Note:** Context Briefs composed from milestone definitions omit the Complexity Assessment section, since routing has already been determined by the agentic-milestone-planning phase. The brief goes directly to agentic-plan-crafting without re-routing.
2. Invoke the `agentic-plan-crafting` skill pattern:
   - Create a plan document at `docs/engineering-discipline/plans/YYYY-MM-DD-<milestone-name>.md`
   - The plan must satisfy all milestone success criteria
   - The plan must not modify files outside the milestone's scope
3. Prepare to record the plan file path in canonical milestone state after user approval
4. **User gate:** Present the plan and ask for approval before execution
5. After approval, attach the plan file path to the milestone via `harness_milestone`:
   ```json
   { "runId": "<run-id>", "action": "update", "id": "M1", "planFile": "docs/.../plan.md" }
   ```
6. Initialize normal task progress from the approved plan via `todowrite` before execution begins:
   ```json
   { "items": [{ "id": "1", "content": "...", "status": "pending" }] }
   ```

#### Step 2-3: Run Plan Phase

1. Update canonical structured state via `harness_milestone update` / `set_status`: set milestone status to `executing`, increment `Attempts` counter by 1
2. Execute the plan using the `agentic-run-plan` skill pattern:
   - Worker-validator loop for each task
   - Parallel execution for independent tasks
   - Information-isolated validators
   - The main agent must not edit/write/bash implementation files directly for plan tasks
   - After every task PASS/FAIL, persist structured progress with `todoread` and `todowrite`
3. If agentic-run-plan reports failure after 3 retries on any task:
   - Update canonical structured state via `harness_milestone set_status`: set milestone status to `failed`
   - Record failure details in execution log
   - **Stop and report to user.** Do not proceed to dependent milestones.
4. If all tasks complete: proceed to review phase

   **Update milestone status via structured tools instead of editing `state.md` tables:**
   ```json
   { "runId": "<run-id>", "action": "set_status", "id": "M1", "status": "executing" }
   ```

#### Step 2-4: Review Work Phase

1. Update canonical structured state via `harness_milestone set_status`: set milestone status to `validating`
2. Invoke the `agentic-review-work` skill pattern:
   - Information-isolated review against the plan document
   - Binary PASS/FAIL verdict
3. **If PASS:**
   - Update canonical structured state via `harness_milestone set_status`: set milestone status to `completed`
   - Write checkpoint file (see Checkpoint Format below)
   - Update execution log
   - Set final status via `harness_milestone`:
     ```json
     { "runId": "<run-id>", "action": "set_status", "id": "M1", "status": "completed" }
     ```
   - Proceed to next milestone
4. **If FAIL:**
   - Record review findings in execution log
   - **Retry decision (based on the structured milestone `attempts` counter from `harness_milestone load`, which persists across crashes):**
     - If Attempts == 1: return to Step 2-3 with review feedback (re-execute same plan)
     - If Attempts == 2: return to Step 2-2 (re-plan with review feedback as constraint)
     - If Attempts >= 3: set status to `failed`, stop, report to user

#### Step 2-5: Cross-Milestone Integration Check

After a milestone passes agentic-review-work but **before** writing the checkpoint, verify that the milestone's output integrates correctly with all previously completed milestones:

1. **Run the project's highest-level verification** (from structured run metadata/rendered verification strategy, or rediscover using agentic-plan-crafting's Verification Discovery order)
2. **Check cross-milestone interfaces:** If the completed milestone defines or consumes interfaces from predecessor milestones, verify they are compatible (function signatures match, API contracts hold, types align)

**If integration check passes:** Proceed to checkpoint.

**If integration check fails — Cross-Milestone Failure Response:**

The milestone passed its own agentic-review-work (internal correctness) but breaks integration with other milestones. This is a boundary problem.

1. **Diagnose (attempt 1):**
   - Read the failure output
   - Identify which interface boundary or interaction is broken
   - Determine if the fix belongs to the current milestone or requires a corrective milestone
   - If fixable within current milestone scope: dispatch a targeted fix worker → re-run agentic-review-work → re-run integration check
   - If the fix is outside current milestone scope: proceed to escalation

2. **Diagnose (attempt 2):**
   - If the first fix didn't resolve it, re-analyze
   - Apply a second targeted fix
   - Re-run integration check

3. **Escalate to user (after 2 failed attempts):**
   - Report: which milestones are involved, what integration boundary failed, what fixes were tried
   - Options: add corrective milestone, rollback to checkpoint, accept and continue (user acknowledges the integration gap)
   - Log the user's decision in structured state and rendered audit artifacts

#### Step 2-6: Checkpoint

After a milestone passes review:

Write `checkpoints/M<N>-checkpoint.md`:

```markdown
# Checkpoint: M<N> — [Milestone Name]

**Completed:** YYYY-MM-DD HH:MM
**Duration:** [time from planning start to review pass]
**Attempts:** [number of plan-execute-review cycles]

## Plan File
`docs/engineering-discipline/plans/YYYY-MM-DD-<name>.md`

## Review File
`docs/engineering-discipline/reviews/YYYY-MM-DD-<name>-review.md`

## Test Results
[Full test suite status at checkpoint time]

## Files Changed
[List of files created/modified in this milestone]

## State After Milestone
[Brief description of system state — what works now that didn't before]
```

6. Render the current state for human readability via `harness_milestone`:
   ```json
   { "runId": "<run-id>", "action": "render" }
   ```
   This produces markdown output from structured state. Do not treat the markdown as editable source of truth.

### Phase 3: Parallel Milestone Execution

When multiple milestones have all dependencies satisfied and no file conflicts:

1. Identify parallelizable milestone group
2. Run agentic-plan-crafting for ALL parallel milestones first (sequentially — plans are lightweight)
3. Present ALL plans together for batch approval: "Milestones M3 and M4 can run in parallel. Here are both plans. Approve each individually."
4. User approves or rejects each plan independently. Only approved milestones proceed to execution. Rejected milestones return to Step 2-2 while approved ones execute.
5. If all approved, dispatch each milestone's pipeline concurrently:
   - Each milestone runs agentic-run-plan → agentic-review-work (plan already approved in step 3)
   - Each runs in a separate working directory (`cwd` parameter on the `subagent` tool) to prevent file conflicts
   - After both complete and pass review, merge changes back
4. If either fails: handle independently (the other can continue if no dependency)

**Worktree merge protocol:**
1. Both milestones pass review in their respective worktrees
2. Check for file conflicts between worktree changes
3. If no conflicts: merge sequentially (M_lower first, then M_higher)
4. If conflicts detected: stop, report to user, request manual resolution
5. After merge: run full test suite on merged result
6. If tests fail: stop, report to user

### Phase 4: Completion

After all milestones are completed (including the Integration Verification Milestone from agentic-milestone-planning):

1. Update canonical structured state/rendered audit output to record overall status `completing`
2. **Final E2E Gate:** Run the project's highest-level verification one final time on the fully integrated codebase
3. **Run full test suite** for regression check
4. **If Final E2E Gate fails:**
   - Diagnose: identify which milestone's output is the likely cause
   - Create a corrective milestone via Mid-Execution Correction procedure
   - Execute corrective milestone through the full pipeline (agentic-plan-crafting → agentic-run-plan → agentic-review-work)
   - Re-run E2E Gate after correction
   - If 2 corrective attempts fail: escalate to user with full diagnosis
5. **If Final E2E Gate passes:** update canonical structured state/rendered audit output to record overall status `completed`
6. Generate completion summary:

```markdown
# Long Run Complete: [Session Name]

**Started:** YYYY-MM-DD
**Completed:** YYYY-MM-DD
**Total milestones:** N
**Total attempts:** [sum of all milestone attempts]

## Milestone Summary

| Milestone | Status | Attempts | Duration |
|-----------|--------|----------|----------|
| M1: [name] | ✓ completed | 1 | 2h |
| M2: [name] | ✓ completed | 2 | 4h |
| ...

## Final Test Suite
[PASS/FAIL — N passed, M failed]

## Files Changed (Total)
[Aggregated list across all milestones]
```

4. Present to user and suggest `agentic-simplify` for a final code quality pass

## Recovery Protocol

When resuming a paused or interrupted session:

1. Use `harness_milestone load` for milestone lifecycle metadata and `todoread` for normal milestone/task progress.
2. For each milestone, determine recovery action:

| Last Status | Recovery Action |
|-------------|----------------|
| `pending` | Start normally |
| `planning` | Restart agentic-plan-crafting (plan file may be incomplete) |
| `executing` | Check agentic-run-plan progress; resume or restart |
| `validating` | Restart agentic-review-work (review may be incomplete) |
| `completed` | Skip (already checkpointed) |
| `failed` | Present failure to user; ask whether to retry or skip (see Skip Rules below) |
| `skipped` | Skip (user previously chose to skip this milestone) |

3. For executing milestones, call `todoread` and continue from the first item whose status is not `completed` or `cancelled`. Do not infer task status from markdown checkboxes.
4. Read the structured milestone `attempts` counter to determine retry budget remaining. Do not reset the counter on resume — it persists across crashes to prevent infinite retry loops.
5. Present recovery plan to user before proceeding.

## Mid-Execution Correction

If execution reveals that a completed milestone's output is incorrect or a new milestone is needed:

1. **Pause execution** — do not continue with dependent milestones
2. **Log the discovery** in canonical structured state/rendered audit output: what was found, which milestone triggered the discovery
3. **User decision required:** present the situation and options:
   - **Add corrective milestone:** Create a new milestone definition (the user writes the goal and success criteria, or re-run agentic-milestone-planning for just the new scope). Insert it into the DAG with appropriate dependencies. Resume execution from the new milestone.
   - **Re-plan from a checkpoint:** Roll back to a completed milestone's checkpoint, mark subsequent milestones as `pending`, reset their `Attempts` to 0, and restart from that point.
   - **Abort:** Set overall status to `failed` and stop.
4. **New milestones follow the same pipeline** — agentic-plan-crafting → agentic-run-plan → agentic-review-work. No shortcuts even for "quick fixes."
5. **Completed milestones are never modified** (Hard Gate #6 still applies). The corrective milestone produces new files or overwrites with a full plan cycle.

## Skip Rules

When a user chooses to skip a failed milestone:

1. Set milestone status to `skipped` via `harness_milestone set_status`
2. Log the skip event with user's reason in execution log after the structured update
3. **Dependents of a skipped milestone are also blocked by default** — same as `failed`. The DAG contract is: dependents run only after prerequisites are `completed`.
4. The user may explicitly unblock a dependent by acknowledging the missing prerequisite: "Proceed with M4 despite M2 being skipped." Log this override in the execution log.
5. If the user unblocks a dependent, add a note to that milestone's Context Brief during agentic-plan-crafting: "Prerequisite M2 was skipped. The following outputs are missing: [list from M2's success criteria]."

**Skipped milestones cannot be un-skipped.** If the user wants to attempt the milestone later, create a new milestone with the same goal.

## Duration Guard

If a single milestone's total active time (from planning start to review completion) becomes excessive:

1. **Soft limit:** If a milestone has been in `planning` or `executing` status for more than what appears to be a proportionally large share of the overall work, pause and report to user: "Milestone M3 has been in progress for an extended period. Continue, re-scope, or abort?"
2. **Hard limit on attempts:** The 3-attempt limit (F1) bounds retry loops. But if even a single attempt's agentic-plan-crafting generates more than 15 tasks, pause and report: "This milestone's plan has N tasks — it may be too large for a single milestone. Consider splitting."
3. **Purpose:** Prevent a single runaway milestone from consuming the entire execution budget or running indefinitely on flaky tests.

## Structured State vs Markdown

`state.md`, milestone markdown files, and plan markdown files are rendered views of the canonical structured state stored in `state.json`. Use `harness_milestone` for milestone creation, dependency metadata, attempts, plan files, review files, and milestone lifecycle. Use `todoread` and `todowrite` for normal milestone/task progress updates visible to the agent. Editing markdown files directly bypasses the structured state and will be overwritten on the next render.

## Context Window Management

Long-running sessions will hit context window limits. Pi automatically compresses old messages (context compaction). The harness must be designed to survive this:

1. **Never rely on conversation memory for state.** Canonical state lives in structured harness state (`state.json` plus replay events). If the context is compressed, reload milestone metadata with `harness_milestone load` and progress with `todoread` — no information is lost.
2. **Each milestone is a fresh context boundary.** When starting a new milestone's agentic-plan-crafting, the worker subagent starts with a clean context. It receives only the milestone definition and completed predecessor context (see F8 contract) — not the full conversation history.
3. **Checkpoint files are audit artifacts, not canonical state.** If context is lost mid-milestone, recovery reads structured state first and checkpoint files only for summarized predecessor context.
4. **Avoid accumulating large inline state.** Do not build up a running summary of all milestones in the conversation. Instead, reference structured harness state and rendered audit artifacts by path.

## Rate Limit Handling

Long-running sessions will encounter rate limits. Pi has built-in retry with exponential backoff. The harness should work with this, not against it:

1. **Let pi handle transient rate limits.** Short 429/529 errors are retried automatically with backoff. Do not preemptively save state on every API error.
2. **Save state on persistent rate limits.** If a rate limit persists beyond the automatic retry window (you'll see repeated "rate limit" messages), record current state to disk immediately.
3. Log the rate limit event in execution log with timestamp.
4. Report to user: "Rate limit hit. State saved. Resume with `agentic-long-run` when ready."
5. Do NOT add manual retry loops on top of pi's built-in retry — this causes retry amplification.
6. **Subagent bail:** Subagent processes may bail on 529 overload errors instead of retrying. This is why Phase 2.5 reviewer failure handling exists — reviewer failures are often transient rate limits, not permanent errors.

## Anti-Patterns

| Anti-Pattern | Why It Fails |
|---|---|
| Generating milestones inline instead of using agentic-milestone-planning | Milestones lack adversarial review; poor decomposition |
| Skipping agentic-review-work for "simple" milestones | Undetected defects compound across milestones |
| Continuing after a milestone fails | Dependent milestones build on broken foundation |
| Not updating structured state between phases | Crash loses progress; cannot resume |
| Modifying completed milestone files | Breaks checkpoint invariant; invalidates reviews |
| Running parallel milestones without directory isolation | File conflicts corrupt both milestones |
| Auto-retrying on rate limit | Wastes quota; user may prefer to wait |
| Skipping user gates between milestones | User loses control of multi-day execution |
| Merging worktrees without conflict check | Silent data loss if files overlap |
| Skipping cross-milestone integration check | Milestones pass independently but break each other at boundaries |
| Retrying E2E failures indefinitely without user escalation | 2-attempt limit exists to avoid budget waste on misdiagnosed problems |

## Minimal Checklist

- [ ] Structured harness state exists and loads with `harness_milestone load`
- [ ] Dependency DAG validated (no cycles)
- [ ] Current position determined (fresh start or resume)
- [ ] User confirmed continuation at session start
- [ ] Each milestone goes through agentic-plan-crafting → agentic-run-plan → agentic-review-work
- [ ] State.md updated before and after every phase transition
- [ ] Checkpoint written after every successful milestone
- [ ] Failed milestones block dependents
- [ ] Parallel milestones use directory isolation
- [ ] Cross-milestone integration check passes after each milestone
- [ ] Final E2E Gate passes at completion
- [ ] Full test suite passes at completion

## Transition

After long run completion:

- For final code quality pass → `agentic-simplify` skill
- If issues found in completion testing → `agentic-systematic-debugging` skill
- If user wants to extend with more milestones → `agentic-milestone-planning` skill

This skill itself **does not invoke the next skill.** It reports completion and lets the user decide the next step.
