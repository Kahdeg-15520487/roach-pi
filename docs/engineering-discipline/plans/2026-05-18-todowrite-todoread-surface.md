# Todowrite/Todoread Surface Implementation Plan

> **Worker note:** Execute this plan task-by-task using the run-plan skill or subagents. Checkbox syntax is rendered task formatting only; canonical progress for this plan should be updated through `todowrite` after Task 3 lands.

**Goal:** Replace normal agent-facing progress updates with `todowrite` and `todoread` while keeping roach-pi's structured harness state as the canonical backend.

**Architecture:** Add a thin facade layer over the existing `HarnessState` reducer, snapshot, and replay-event system. Existing `harness_milestone`, `harness_plan`, and `harness_todo` remain as compatibility/internal tools, but prompt guidance and default active tools should steer agents to `todowrite` and `todoread`.

**Tech Stack:** TypeScript, pi extension API, `@sinclair/typebox`, Vitest, existing `HarnessState` reducer/storage/replay modules.

**Work Scope:**
- **In scope:** Add `todowrite` and `todoread` tools; support `M1`/`M2` milestone IDs and `M1.T1`/`M2.T3` plan-task IDs; infer active run state from session replay or explicit params; update docs/skills/tests to train agents toward the new surface.
- **Out of scope:** Replacing `HarnessState`; creating a separate todo database; removing legacy harness tools in this release; redesigning team-mode run state.

**Verification Strategy:**
- **Level:** test-suite
- **Command:** `npm --prefix extensions/agentic-harness test && npm --prefix extensions/agentic-harness run build`
- **What it validates:** Agentic harness unit/integration tests, tool registration contracts, structured harness state behavior, session replay behavior, and TypeScript correctness.

---

## File Structure Mapping

- Create `extensions/agentic-harness/harness-state-service.ts`
  - Shared load/apply/persist/event helpers currently private to `harness-tools.ts`.
- Create `extensions/agentic-harness/todo-facade.ts`
  - Pure mapping between `HarnessState` and `todowrite`/`todoread` item shapes.
- Modify `extensions/agentic-harness/harness-tools.ts`
  - Reuse shared service helpers and register `todowrite`/`todoread`.
  - De-emphasize `harness_plan` and `harness_todo` guidance.
- Modify `extensions/agentic-harness/index.ts`
  - Keep registering compatibility tools.
  - On session start, prefer active tools that include `todowrite`/`todoread` and exclude `harness_plan`/`harness_todo` when `setActiveTools` is available.
- Modify skill docs:
  - `extensions/agentic-harness/skills/agentic-run-plan/SKILL.md`
  - `extensions/agentic-harness/skills/agentic-long-run/SKILL.md`
  - `extensions/agentic-harness/skills/agentic-plan-crafting/SKILL.md`
  - `extensions/agentic-harness/skills/agentic-review-work/SKILL.md`
  - `extensions/agentic-harness/skills/agentic-milestone-planning/SKILL.md`
- Modify tests:
  - `extensions/agentic-harness/tests/harness-tools.test.ts`
  - `extensions/agentic-harness/tests/extension.test.ts`
  - `extensions/agentic-harness/tests/skill-docs.test.ts`
- Create `extensions/agentic-harness/tests/todo-facade.test.ts`
  - Focused pure mapper tests.

## Project Capability Discovery

No project-specific agents or skills are required for this implementation. Existing validation is handled by the `extensions/agentic-harness` Vitest suite and TypeScript build.

---

### Task 1: Extract Harness State Service Helpers

**Dependencies:** None
**Files:**
- Create: `extensions/agentic-harness/harness-state-service.ts`
- Modify: `extensions/agentic-harness/harness-tools.ts`
- Test: `extensions/agentic-harness/tests/harness-tools.test.ts`

- [ ] **Step 1: Create shared service module**

Create `extensions/agentic-harness/harness-state-service.ts` with the helper functions currently private in `harness-tools.ts`: `loadHarnessState`, `persistHarnessState`, `applyAndPersist`, `applyAndPersistFromLoadedState`, and `emitHarnessEvent`.

The exported signatures must be:

```ts
export async function loadHarnessState(
  runId: string,
  rootDir?: string,
  now?: string,
): Promise<HarnessState>;

export async function persistHarnessState(
  state: HarnessState,
  rootDir?: string,
  now?: string,
): Promise<void>;

export function emitHarnessEvent(
  ctx: { sessionManager?: any },
  state: HarnessState,
  command: HarnessCommand,
  now?: string,
  rootDir?: string,
): void;

export async function applyAndPersistFromLoadedState(
  runId: string,
  rootDir: string | undefined,
  buildCommand: (state: HarnessState) => HarnessCommand,
  ctx: { sessionManager?: any },
): Promise<{
  state: HarnessState;
  event: import("./harness-state.js").HarnessStateEvent;
}>;

export async function applyAndPersist(
  runId: string,
  rootDir: string | undefined,
  command: HarnessCommand,
  ctx: { sessionManager?: any },
): Promise<{
  state: HarnessState;
  event: import("./harness-state.js").HarnessStateEvent;
}>;
```

Preserve the existing in-process mutation lock key behavior:

```ts
const key = `${rootDir ?? defaultHarnessStateRoot()}\0${runId}`;
```

- [ ] **Step 2: Replace local helper definitions in `harness-tools.ts`**

Remove the private helper implementations from `harness-tools.ts` and import them:

```ts
import {
  applyAndPersist,
  applyAndPersistFromLoadedState,
  loadHarnessState,
} from "./harness-state-service.js";
```

Keep existing tool behavior unchanged in this task.

- [ ] **Step 3: Run focused harness tool tests**

Run:

```bash
npm --prefix extensions/agentic-harness test -- tests/harness-tools.test.ts
```

Expected: PASS. Existing harness tool registration and execution behavior remains unchanged.

### Task 2: Add Pure Todowrite/Todoread Mapping

**Dependencies:** Task 1
**Files:**
- Create: `extensions/agentic-harness/todo-facade.ts`
- Create: `extensions/agentic-harness/tests/todo-facade.test.ts`

- [ ] **Step 1: Define facade types and ID parsing**

Create `todo-facade.ts` with these public types:

```ts
export type TodoFacadeStatus = "pending" | "in_progress" | "completed" | "failed" | "cancelled";
export type TodoFacadePriority = "high" | "medium" | "low";

export interface TodoFacadeItem {
  id: string;
  content: string;
  status: TodoFacadeStatus;
  priority?: TodoFacadePriority;
}

export interface TodoReadResult {
  runId: string;
  rootDir?: string;
  todos: TodoFacadeItem[];
}
```

Add ID parsing helpers:

```ts
export function parseTodoFacadeId(id: string):
  | { kind: "milestone"; milestoneId: string }
  | { kind: "plan_task"; milestoneId: string; taskId: number }
  | { kind: "unknown"; id: string } {
  const milestone = /^M\d+$/.exec(id);
  if (milestone) return { kind: "milestone", milestoneId: id };

  const task = /^(M\d+)\.T(\d+)$/.exec(id);
  if (task) return { kind: "plan_task", milestoneId: task[1], taskId: Number(task[2]) };

  return { kind: "unknown", id };
}
```

- [ ] **Step 2: Map harness statuses to facade statuses**

Implement these exact mappings:

```ts
export function milestoneStatusToTodoStatus(status: HarnessMilestoneStatus): TodoFacadeStatus {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "skipped") return "cancelled";
  if (status === "planning" || status === "executing" || status === "validating") return "in_progress";
  return "pending";
}

export function planTaskStatusToTodoStatus(status: HarnessPlanTaskStatus): TodoFacadeStatus {
  if (status === "running") return "in_progress";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "skipped") return "cancelled";
  return "pending";
}
```

Implement reverse mappings:

```ts
export function todoStatusToMilestoneStatus(status: TodoFacadeStatus): HarnessMilestoneStatus {
  if (status === "in_progress") return "executing";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "skipped";
  return "pending";
}

export function todoStatusToPlanTaskStatus(status: TodoFacadeStatus): HarnessPlanTaskStatus {
  if (status === "in_progress") return "running";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "skipped";
  return "pending";
}
```

- [ ] **Step 3: Build `readTodosFromHarnessState`**

Add:

```ts
export function readTodosFromHarnessState(
  state: HarnessState,
  options: { rootDir?: string } = {},
): TodoReadResult {
  const todos: TodoFacadeItem[] = [];

  for (const milestone of state.milestones) {
    todos.push({
      id: milestone.id,
      content: milestone.name,
      status: milestoneStatusToTodoStatus(milestone.status),
      priority: milestone.status === "executing" || milestone.status === "validating" ? "high" : "medium",
    });

    const plan = selectPlanForMilestone(state, milestone);
    if (!plan) continue;
    for (const task of plan.tasks) {
      todos.push({
        id: `${milestone.id}.T${task.id}`,
        content: task.name,
        status: planTaskStatusToTodoStatus(task.status),
        priority: task.status === "running" || task.status === "failed" ? "high" : "medium",
      });
    }
  }

  return { runId: state.runId, rootDir: options.rootDir, todos };
}
```

- [ ] **Step 4: Add pure mapper tests**

Create `todo-facade.test.ts` with tests covering:

```ts
expect(parseTodoFacadeId("M1")).toEqual({ kind: "milestone", milestoneId: "M1" });
expect(parseTodoFacadeId("M2.T3")).toEqual({ kind: "plan_task", milestoneId: "M2", taskId: 3 });
expect(parseTodoFacadeId("misc")).toEqual({ kind: "unknown", id: "misc" });
expect(todoStatusToMilestoneStatus("in_progress")).toBe("executing");
expect(todoStatusToPlanTaskStatus("in_progress")).toBe("running");
expect(milestoneStatusToTodoStatus("validating")).toBe("in_progress");
expect(planTaskStatusToTodoStatus("skipped")).toBe("cancelled");
```

Also build a `HarnessState` with milestones `M1`, `M2` and a plan under `M2`, then assert that `readTodosFromHarnessState` returns IDs `M1`, `M2`, `M2.T1`, and `M2.T2`.

- [ ] **Step 5: Run focused mapper tests**

Run:

```bash
npm --prefix extensions/agentic-harness test -- tests/todo-facade.test.ts
```

Expected: PASS.

### Task 3: Register Todoread/Todowrite Tools

**Dependencies:** Tasks 1 and 2
**Files:**
- Modify: `extensions/agentic-harness/harness-tools.ts`
- Modify: `extensions/agentic-harness/tests/harness-tools.test.ts`
- Modify: `extensions/agentic-harness/tests/extension.test.ts`

- [ ] **Step 1: Add tool schemas**

In `harness-tools.ts`, add a `TodoFacadeStatusEnum`, `TodoFacadePriorityEnum`, `TodoWriteItem`, `TodoWriteParams`, and `TodoReadParams` near the existing tool schema definitions:

```ts
const TodoFacadeStatusEnum = stringEnum(
  ["pending", "in_progress", "completed", "failed", "cancelled"],
  { description: "Todo status" },
);

const TodoFacadePriorityEnum = stringEnum(
  ["high", "medium", "low"],
  { description: "Todo priority" },
);

const TodoWriteItem = Type.Object({
  id: Type.String({ description: "Milestone id like M1 or plan task id like M2.T3" }),
  content: Type.String({ description: "Human-readable task or milestone label" }),
  status: TodoFacadeStatusEnum,
  priority: Type.Optional(TodoFacadePriorityEnum),
});

const TodoWriteParams = Type.Object({
  runId: Type.Optional(Type.String({ description: "Harness run id. Optional when a current run can be inferred from session replay." })),
  rootDir: Type.Optional(Type.String({ description: "Harness state root directory override" })),
  todos: Type.Array(TodoWriteItem, { description: "Complete updated milestone/task todo list" }),
});

const TodoReadParams = Type.Object({
  runId: Type.Optional(Type.String({ description: "Harness run id. Optional when a current run can be inferred from session replay." })),
  rootDir: Type.Optional(Type.String({ description: "Harness state root directory override" })),
});
```

- [ ] **Step 2: Infer active run from session replay**

Add a local helper in `harness-tools.ts`:

```ts
function resolveRunIdentityFromParamsOrSession(
  params: { runId?: string; rootDir?: string },
  ctx: { cwd?: string; sessionManager?: any },
): { runId: string; rootDir?: string } {
  if (params.runId) return { runId: params.runId, rootDir: params.rootDir };

  const branch = ctx.sessionManager?.getBranch?.() ?? [];
  const events = extractHarnessReplayEventsFromSessionEntries(branch);
  const latest = events.at(-1);
  if (latest?.runId) {
    return {
      runId: latest.runId,
      rootDir: params.rootDir ?? latest.rootDir,
    };
  }

  throw new Error("runId is required because no active harness run could be inferred from this session");
}
```

Import `extractHarnessReplayEventsFromSessionEntries` from `harness-events.js`.

- [ ] **Step 3: Register `todoread`**

Inside `registerHarnessTools(pi)`, register `todoread` before the compatibility harness tools:

```ts
pi.registerTool({
  name: "todoread",
  label: "TodoRead",
  description: "Read current milestone and plan-task progress from roach-pi structured harness state.",
  promptSnippet: "Read current milestone/task todo progress",
  promptGuidelines: [
    "Use todoread before updating or reporting plan/milestone progress.",
    "IDs like M1 and M2 refer to milestones. IDs like M2.T1 refer to plan tasks inside that milestone.",
    "Use todowrite to persist progress updates. Do not edit markdown checkboxes as progress state.",
  ],
  parameters: TodoReadParams,
  execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
    try {
      const identity = resolveRunIdentityFromParamsOrSession(params, ctx);
      const state = await loadHarnessState(identity.runId, identity.rootDir);
      const result = readTodosFromHarnessState(state, { rootDir: identity.rootDir });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  },
});
```

- [ ] **Step 4: Register `todowrite`**

Add `todowrite` after `todoread`. It must apply only recognized IDs and must reject unknown IDs instead of silently ignoring them.

Implementation rules:
- For `M1`: use `set_milestone_status`.
- For `M2.T3`: find the plan attached to milestone `M2`, then use `set_plan_task_status`.
- If a milestone ID does not exist, return `isError: true`.
- If a task ID does not exist in the milestone's active plan, return `isError: true`.
- Ignore `priority` for persistence in this release, but keep it accepted in the schema.

Core execute loop:

```ts
const result = await applyAndPersistFromLoadedState(
  identity.runId,
  identity.rootDir,
  (current) => {
    const item = params.todos[index];
    const parsed = parseTodoFacadeId(item.id);
    if (parsed.kind === "milestone") {
      if (!current.milestones.some((m) => m.id === parsed.milestoneId)) {
        throw new Error(`Milestone ${parsed.milestoneId} not found`);
      }
      return {
        type: "set_milestone_status",
        id: parsed.milestoneId,
        status: todoStatusToMilestoneStatus(item.status),
      };
    }
    if (parsed.kind === "plan_task") {
      const milestone = current.milestones.find((m) => m.id === parsed.milestoneId);
      if (!milestone) throw new Error(`Milestone ${parsed.milestoneId} not found`);
      const plan = selectPlanForMilestone(current, milestone);
      if (!plan) throw new Error(`No active plan found for milestone ${parsed.milestoneId}`);
      if (!plan.tasks.some((task) => task.id === parsed.taskId)) {
        throw new Error(`Task ${item.id} not found`);
      }
      const status = todoStatusToPlanTaskStatus(item.status);
      const at = new Date().toISOString();
      return {
        type: "set_plan_task_status",
        planId: plan.id,
        taskId: parsed.taskId,
        status,
        startedAt: status === "running" ? at : undefined,
        completedAt: status === "completed" || status === "failed" || status === "skipped" ? at : undefined,
      };
    }
    throw new Error(`Unsupported todo id ${item.id}; expected M1 or M1.T1`);
  },
  ctx,
);
```

Because `applyAndPersistFromLoadedState` applies one command per call, implement the actual `todowrite` body as a sequential loop over `params.todos`, reloading state through the helper each time. After the loop, load final state and return `readTodosFromHarnessState(finalState)`.

- [ ] **Step 5: Add registration and execute tests**

In `harness-tools.test.ts` and `extension.test.ts`, assert:

```ts
expect(tools.get("todoread")).toBeDefined();
expect(tools.get("todowrite")).toBeDefined();
```

Add execution tests in `harness-tools.test.ts`:
- Create milestone `M1`, attach plan `m1-plan`, define task `1`.
- Call `todoread` with explicit `runId`; expect IDs `M1` and `M1.T1`.
- Call `todowrite` with `M1` as `in_progress`; expect snapshot milestone status `executing`.
- Call `todowrite` with `M1.T1` as `completed`; expect snapshot plan task status `completed`.
- Call `todowrite` with `M9`; expect `isError: true`.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm --prefix extensions/agentic-harness test -- tests/todo-facade.test.ts tests/harness-tools.test.ts tests/extension.test.ts
```

Expected: PASS.

### Task 4: De-Emphasize Legacy Harness Plan/Todo Surface

**Dependencies:** Task 3
**Files:**
- Modify: `extensions/agentic-harness/harness-tools.ts`
- Modify: `extensions/agentic-harness/index.ts`
- Modify: `extensions/agentic-harness/tests/extension.test.ts`
- Modify: `extensions/agentic-harness/tests/harness-tools.test.ts`

- [ ] **Step 1: Remove prompt training from `harness_plan` and `harness_todo`**

Keep the `harness_plan` and `harness_todo` registrations for compatibility, but remove their `promptSnippet` and `promptGuidelines` fields. Update their descriptions to say:

```ts
description:
  "Compatibility tool for structured harness plan state. Prefer todoread/todowrite for normal agent-facing progress updates.",
```

and:

```ts
description:
  "Compatibility tool for structured harness todo state. Prefer todoread/todowrite for normal agent-facing progress updates.",
```

Leave `harness_milestone` public in this release because it still owns milestone creation metadata, dependencies, attempts, plan files, and review files.

- [ ] **Step 2: Prefer active tools at session start when supported**

In `index.ts`, add a `session_start` handler after tool registration or inside the existing session start flow:

```ts
function preferTodoSurfaceTools(pi: any): void {
  if (typeof pi.getActiveTools !== "function" || typeof pi.setActiveTools !== "function") {
    return;
  }
  const active = pi.getActiveTools();
  if (!Array.isArray(active)) return;
  pi.setActiveTools(active.filter((name: string) => name !== "harness_plan" && name !== "harness_todo"));
}
```

Call `preferTodoSurfaceTools(pi)` once during extension setup and again on `session_start`. This preserves compatibility for manual re-enable while making the default agent surface `todoread`/`todowrite`.

- [ ] **Step 3: Update tests for de-emphasized legacy tools**

Update harness tool registration tests:
- Keep asserting `harness_plan` and `harness_todo` are registered.
- Stop asserting they have `promptSnippet` or non-empty `promptGuidelines`.
- Add assertions that `todoread` and `todowrite` have non-empty `promptGuidelines`.

Add an `extension.test.ts` case with mock `getActiveTools`/`setActiveTools`:

```ts
const activeTools = ["todoread", "todowrite", "harness_plan", "harness_todo", "harness_milestone"];
mockPi.getActiveTools = vi.fn(() => activeTools);
mockPi.setActiveTools = vi.fn();
extension(mockPi);
expect(mockPi.setActiveTools).toHaveBeenCalledWith(["todoread", "todowrite", "harness_milestone"]);
```

- [ ] **Step 4: Run focused registration tests**

Run:

```bash
npm --prefix extensions/agentic-harness test -- tests/harness-tools.test.ts tests/extension.test.ts
```

Expected: PASS.

### Task 5: Update Skill Guidance To Use Todowrite/Todoread

**Dependencies:** Task 4
**Files:**
- Modify: `extensions/agentic-harness/skills/agentic-run-plan/SKILL.md`
- Modify: `extensions/agentic-harness/skills/agentic-long-run/SKILL.md`
- Modify: `extensions/agentic-harness/skills/agentic-plan-crafting/SKILL.md`
- Modify: `extensions/agentic-harness/skills/agentic-review-work/SKILL.md`
- Modify: `extensions/agentic-harness/skills/agentic-milestone-planning/SKILL.md`
- Modify: `extensions/agentic-harness/tests/skill-docs.test.ts`

- [ ] **Step 1: Update run-plan task status language**

In `agentic-run-plan/SKILL.md`, replace the mandatory `harness_plan set_task_status` instruction with:

````md
After the validator passes, you **MUST** update structured progress via `todowrite`. First call `todoread`, then write back the complete list with the relevant `M#.T#` item marked `completed`.

Example:
```json
{
  "todos": [
    { "id": "M1", "content": "Foundation", "status": "in_progress" },
    { "id": "M1.T1", "content": "Create shared service", "status": "completed" },
    { "id": "M1.T2", "content": "Register todowrite", "status": "pending" }
  ]
}
```
````

Keep the statement that markdown checkboxes are rendered output only.

- [ ] **Step 2: Update long-run state language**

In `agentic-long-run/SKILL.md`, preserve `harness_milestone` instructions for milestone creation and milestone metadata. Replace plan-task progress instructions with `todoread`/`todowrite`.

Required wording:

```md
Use `harness_milestone` for milestone creation, dependency metadata, attempts, plan files, review files, and milestone lifecycle. Use `todoread` and `todowrite` for normal milestone/task progress updates visible to the agent.
```

For recovery instructions, say:

```md
For executing milestones, call `todoread` and continue from the first item whose status is not `completed` or `cancelled`. Do not infer task status from markdown checkboxes.
```

- [ ] **Step 3: Update plan-crafting guidance**

In `agentic-plan-crafting/SKILL.md`, change worker notes so generated plans tell workers to use `todowrite` after the facade lands:

```md
> **Worker note:** Execute this plan task-by-task using the agentic-run-plan skill or subagents. Checkbox syntax is rendered task formatting only; canonical progress is read with `todoread` and updated with `todowrite`.
```

Keep plan registration details only where the plan is attached to a milestone. Do not tell normal workers to call `harness_plan set_task_status`.

- [ ] **Step 4: Update review and milestone-planning guidance**

In `agentic-review-work/SKILL.md`, keep `harness_milestone` for review-result milestone status when needed, but add:

```md
If review completion corresponds to a plan task, update that task through `todowrite` rather than `harness_plan`.
```

In `agentic-milestone-planning/SKILL.md`, keep `harness_milestone` initialization. If task progress examples exist, convert them to `todowrite`.

- [ ] **Step 5: Update skill-doc tests**

Update `skill-docs.test.ts` expectations:
- `agentic-run-plan` contains `todowrite` and `todoread`.
- `agentic-run-plan` does not contain `harness_plan set_task_status`.
- `agentic-long-run` contains `harness_milestone`, `todowrite`, and `todoread`.
- `agentic-plan-crafting` contains `canonical progress is read with \`todoread\` and updated with \`todowrite\``.

- [ ] **Step 6: Run skill doc tests**

Run:

```bash
npm --prefix extensions/agentic-harness test -- tests/skill-docs.test.ts
```

Expected: PASS.

### Task 6: Final Verification

**Dependencies:** Tasks 1-5
**Files:** None (read-only verification)

- [ ] **Step 1: Run full agentic harness test suite and build**

Run:

```bash
npm --prefix extensions/agentic-harness test && npm --prefix extensions/agentic-harness run build
```

Expected: PASS.

- [ ] **Step 2: Verify user-facing success criteria**

Manually inspect the final code and tests:
- [ ] `todoread` is registered and returns current `M#` and `M#.T#` progress from `HarnessState`.
- [ ] `todowrite` is registered and can update milestone and plan-task statuses.
- [ ] `harness_plan` and `harness_todo` remain registered for compatibility but are no longer promoted in prompt guidance.
- [ ] `harness_milestone` remains available for milestone metadata and lifecycle operations.
- [ ] Skill docs train agents to use `todoread`/`todowrite` for normal progress.
- [ ] No separate todo state store was introduced.

- [ ] **Step 3: Inspect local diff**

Run:

```bash
git diff -- extensions/agentic-harness/harness-state-service.ts extensions/agentic-harness/todo-facade.ts extensions/agentic-harness/harness-tools.ts extensions/agentic-harness/index.ts extensions/agentic-harness/skills extensions/agentic-harness/tests
```

Expected: Diff only contains facade, tool registration, skill guidance, and tests described in this plan.

---

## Self-Review

- **Spec coverage:** The plan covers `todowrite`/`todoread` as the surface API, `M1`/`M2` milestone IDs, `M1.T1` task IDs, compatibility retention, prompt migration, tests, and final verification.
- **Placeholder scan:** No unresolved implementation placeholders are left. All new files, functions, mappings, and commands are named explicitly.
- **Type consistency:** `TodoFacadeStatus`, `TodoFacadeItem`, `TodoReadResult`, and `HarnessState` mappings are used consistently across tasks.
- **Dependency verification:** Tasks 1-5 are sequential because they touch overlapping files or depend on exported APIs from earlier tasks. Task 6 depends on all implementation tasks.
- **Verification coverage:** Final verification runs the highest discovered test-suite command and includes manual checks for the user-facing contract.
