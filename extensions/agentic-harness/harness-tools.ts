import { Type, type TUnsafe } from "@sinclair/typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  selectPlanForMilestone,
  selectMilestoneSummary,
  selectPlanSummary,
  selectTodosForOwner,
  type HarnessMilestoneStatus,
  type HarnessPlanTaskStatus,
  type HarnessTodoOwnerType,
  type HarnessTodoStatus,
} from "./harness-state.js";
import {
  applyAndPersist,
  applyAndPersistFromLoadedState,
  loadHarnessState,
} from "./harness-state-service.js";
import {
  renderHarnessPlanMarkdown,
  renderHarnessStateMarkdown,
  renderHarnessTodoMarkdown,
} from "./harness-render.js";
import { extractHarnessReplayEventsFromSessionEntries } from "./harness-events.js";
import {
  parseTodoFacadeId,
  readTodosFromHarnessState,
  todoStatusToMilestoneStatus,
  todoStatusToPlanTaskStatus,
} from "./todo-facade.js";

type StringEnumSchema<T extends string> = TUnsafe<T> & {
  type: "string";
  enum: T[];
};

function stringEnum<T extends string>(
  values: readonly T[],
  options: { description: string; default?: T },
): StringEnumSchema<T> {
  return Type.Unsafe<T>({
    type: "string",
    enum: [...values],
    ...options,
  }) as StringEnumSchema<T>;
}

// ---------- Tool: harness_milestone ----------

const HarnessMilestoneAction = stringEnum(
  ["create", "update", "set_status", "load", "render"],
  { description: "Action to perform on the milestone" },
);

const HarnessMilestoneStatusEnum = stringEnum(
  ["pending", "planning", "executing", "validating", "completed", "failed", "skipped"],
  { description: "Milestone status" },
);

const HarnessMilestoneParams = Type.Object({
  runId: Type.String({ description: "Run ID for the harness state" }),
  action: HarnessMilestoneAction,
  rootDir: Type.Optional(
    Type.String({ description: "Optional override for the harness state root directory" }),
  ),
  id: Type.Optional(
    Type.String({ description: "Milestone ID (required for update, set_status, load, render)" }),
  ),
  name: Type.Optional(Type.String({ description: "Milestone name (required for create)" })),
  status: Type.Optional(HarnessMilestoneStatusEnum),
  dependencies: Type.Optional(
    Type.Array(Type.String(), { description: "Dependency milestone IDs" }),
  ),
  attempts: Type.Optional(Type.Number({ description: "Number of attempts" })),
  planFile: Type.Optional(Type.String({ description: "Path to plan file" })),
  reviewFile: Type.Optional(Type.String({ description: "Path to review file" })),
});

// ---------- Tool: harness_plan ----------

const HarnessPlanAction = stringEnum(
  ["attach", "define_tasks", "set_task_status", "load", "render"],
  { description: "Action to perform on the plan" },
);

const HarnessPlanTaskStatusEnum = stringEnum(
  ["pending", "running", "completed", "failed", "skipped"],
  { description: "Plan task status" },
);

const PlanTaskItem = Type.Object({
  id: Type.Number({ description: "Task ID" }),
  name: Type.String({ description: "Task name" }),
  dependencies: Type.Optional(
    Type.Array(Type.Number(), { description: "Dependency task IDs" }),
  ),
  files: Type.Optional(Type.Array(Type.String(), { description: "Affected files" })),
  testCommands: Type.Optional(
    Type.Array(Type.String(), { description: "Test commands" }),
  ),
  acceptanceCriteria: Type.Optional(
    Type.Array(Type.String(), { description: "Acceptance criteria" }),
  ),
  status: Type.Optional(HarnessPlanTaskStatusEnum),
  startedAt: Type.Optional(
    Type.String({ description: "ISO timestamp when task started" }),
  ),
  completedAt: Type.Optional(
    Type.String({ description: "ISO timestamp when task completed" }),
  ),
});

const HarnessPlanParams = Type.Object({
  runId: Type.String({ description: "Run ID for the harness state" }),
  action: HarnessPlanAction,
  rootDir: Type.Optional(
    Type.String({ description: "Optional override for the harness state root directory" }),
  ),
  id: Type.Optional(Type.String({ description: "Plan ID (alias for planId)" })),
  planId: Type.Optional(Type.String({ description: "Plan ID" })),
  milestoneId: Type.Optional(
    Type.String({ description: "Milestone ID (required for attach)" }),
  ),
  title: Type.Optional(Type.String({ description: "Plan title (required for attach)" })),
  goal: Type.Optional(Type.String({ description: "Plan goal (required for attach)" })),
  planFile: Type.Optional(Type.String({ description: "Path to plan file" })),
  tasks: Type.Optional(
    Type.Array(PlanTaskItem, { description: "Tasks to define (required for define_tasks)" }),
  ),
  taskId: Type.Optional(
    Type.Number({ description: "Task ID (required for set_task_status)" }),
  ),
  status: Type.Optional(HarnessPlanTaskStatusEnum),
  startedAt: Type.Optional(
    Type.String({ description: "ISO timestamp when task started" }),
  ),
  completedAt: Type.Optional(
    Type.String({ description: "ISO timestamp when task completed" }),
  ),
});

// ---------- Tool: harness_todo ----------

const HarnessTodoAction = stringEnum(
  ["set", "update_status", "clear", "load", "render"],
  { description: "Action to perform on todos" },
);

const HarnessTodoOwnerTypeEnum = stringEnum(
  ["milestone", "plan", "plan_task"],
  { description: "Owner type for the todo" },
);

const HarnessTodoStatusEnum = stringEnum(
  ["pending", "completed"],
  { description: "Todo status" },
);

const TodoItem = Type.Object({
  id: Type.String({ description: "Todo ID" }),
  text: Type.String({ description: "Todo text" }),
  status: Type.Optional(HarnessTodoStatusEnum),
});

const HarnessTodoParams = Type.Object({
  runId: Type.String({ description: "Run ID for the harness state" }),
  action: HarnessTodoAction,
  rootDir: Type.Optional(
    Type.String({ description: "Optional override for the harness state root directory" }),
  ),
  ownerType: Type.Optional(HarnessTodoOwnerTypeEnum),
  ownerId: Type.Optional(Type.String({ description: "Owner ID" })),
  todos: Type.Optional(
    Type.Array(TodoItem, { description: "Todos to set (required for set)" }),
  ),
  todoId: Type.Optional(Type.String({ description: "Todo ID (required for update_status)" })),
  status: Type.Optional(HarnessTodoStatusEnum),
});

// ---------- Tools: todoread / todowrite ----------

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

// ---------- Registration ----------

export function registerHarnessTools(pi: ExtensionAPI): void {
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
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          details: undefined,
          isError: true,
        };
      }
    },
  });

  pi.registerTool({
    name: "todowrite",
    label: "TodoWrite",
    description: "Persist milestone and plan-task progress into roach-pi structured harness state.",
    promptSnippet: "Update current milestone/task todo progress",
    promptGuidelines: [
      "Call todoread first, then write back the complete updated milestone/task todo list.",
      "Use milestone IDs like M1 and task IDs like M1.T1.",
      "Priority is accepted for compatibility but structured progress persists only status.",
    ],
    parameters: TodoWriteParams,
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      try {
        const identity = resolveRunIdentityFromParamsOrSession(params, ctx);

        for (let index = 0; index < params.todos.length; index += 1) {
          await applyAndPersistFromLoadedState(
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
        }

        const finalState = await loadHarnessState(identity.runId, identity.rootDir);
        const result = readTodosFromHarnessState(finalState, { rootDir: identity.rootDir });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          details: undefined,
          isError: true,
        };
      }
    },
  });

  pi.registerTool({
    name: "harness_milestone",
    label: "Harness Milestone",
    description:
      "Create, update, load, or render harness milestones through structured state. Prefer this tool over hand-editing milestone markdown files.",
    promptSnippet: "Update harness milestone state",
    promptGuidelines: [
      "Use harness_milestone to create, update, or query milestones in the structured harness state.",
      "Always provide runId. Use create for new milestones, update to merge fields, set_status for status transitions.",
      "Use load to get structured JSON summary, render to get markdown output.",
      "Prefer this tool over editing state.md or milestone files directly.",
    ],
    parameters: HarnessMilestoneParams,
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const { runId, action, rootDir, id, name, status, dependencies, attempts, planFile, reviewFile } =
        params;
      try {
        switch (action) {
          case "create": {
            if (!name) throw new Error("name is required for create");
            const effectiveId = id || name.replace(/\s+/g, "-").toLowerCase();
            const result = await applyAndPersist(
              runId,
              rootDir,
              {
                type: "upsert_milestone",
                milestone: {
                  id: effectiveId,
                  name,
                  status: status as HarnessMilestoneStatus | undefined,
                  dependencies: dependencies || [],
                  attempts: attempts ?? 0,
                  planFile,
                  reviewFile,
                },
              },
              ctx,
            );
            return {
              content: [
                {
                  type: "text",
                  text: `Milestone created: ${result.state.milestones.find((m) => m.id === effectiveId)?.id}`,
                },
              ],
              details: selectMilestoneSummary(result.state),
            };
          }
          case "update": {
            if (!id) throw new Error("id is required for update");
            const result = await applyAndPersistFromLoadedState(
              runId,
              rootDir,
              (current) => {
                const existing = current.milestones.find((m) => m.id === id);
                if (!existing) throw new Error(`Milestone ${id} not found`);
                return {
                  type: "upsert_milestone",
                  milestone: {
                    id,
                    name: name || existing.name,
                    status,
                    dependencies,
                    attempts,
                    planFile,
                    reviewFile,
                  },
                };
              },
              ctx,
            );
            return {
              content: [{ type: "text", text: `Milestone updated: ${id}` }],
              details: selectMilestoneSummary(result.state),
            };
          }
          case "set_status": {
            if (!id) throw new Error("id is required for set_status");
            if (!status) throw new Error("status is required for set_status");
            const result = await applyAndPersist(
              runId,
              rootDir,
              {
                type: "set_milestone_status",
                id,
                status: status as HarnessMilestoneStatus,
              },
              ctx,
            );
            return {
              content: [
                { type: "text", text: `Milestone ${id} status set to ${status}` },
              ],
              details: selectMilestoneSummary(result.state),
            };
          }
          case "load": {
            const state = await loadHarnessState(runId, rootDir);
            return {
              content: [
                { type: "text", text: JSON.stringify(selectMilestoneSummary(state), null, 2) },
              ],
              details: selectMilestoneSummary(state),
            };
          }
          case "render": {
            const state = await loadHarnessState(runId, rootDir);
            return {
              content: [{ type: "text", text: renderHarnessStateMarkdown(state) }],
              details: selectMilestoneSummary(state),
            };
          }
          default:
            throw new Error(`Unknown action: ${action}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          details: undefined,
          isError: true,
        };
      }
    },
  });

  pi.registerTool({
    name: "harness_plan",
    label: "Harness Plan",
    description:
      "Compatibility tool for structured harness plan state. Prefer todoread/todowrite for normal agent-facing progress updates.",
    parameters: HarnessPlanParams,
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const {
        runId,
        action,
        rootDir,
        id,
        planId,
        milestoneId,
        title,
        goal,
        planFile,
        tasks,
        taskId,
        status,
        startedAt,
        completedAt,
      } = params;
      try {
        const resolvedPlanId = planId || id;
        switch (action) {
          case "attach": {
            if (!resolvedPlanId) throw new Error("id or planId is required for attach");
            if (!milestoneId) throw new Error("milestoneId is required for attach");
            if (!title) throw new Error("title is required for attach");
            if (!goal) throw new Error("goal is required for attach");
            const result = await applyAndPersist(
              runId,
              rootDir,
              {
                type: "attach_plan",
                plan: {
                  id: resolvedPlanId,
                  milestoneId,
                  title,
                  goal,
                  planFile,
                },
              },
              ctx,
            );
            return {
              content: [{ type: "text", text: `Plan attached: ${resolvedPlanId}` }],
              details: selectPlanSummary(result.state, resolvedPlanId),
            };
          }
          case "define_tasks": {
            if (!resolvedPlanId) throw new Error("id or planId is required for define_tasks");
            if (!Array.isArray(tasks)) throw new Error("tasks array is required for define_tasks");
            const result = await applyAndPersist(
              runId,
              rootDir,
              {
                type: "define_plan_tasks",
                planId: resolvedPlanId,
                tasks: tasks.map((t) => ({
                  id: t.id,
                  name: t.name,
                  dependencies: t.dependencies,
                  files: t.files,
                  testCommands: t.testCommands,
                  acceptanceCriteria: t.acceptanceCriteria,
                  status: t.status as HarnessPlanTaskStatus | undefined,
                  startedAt: t.startedAt,
                  completedAt: t.completedAt,
                })),
              },
              ctx,
            );
            return {
              content: [
                {
                  type: "text",
                  text: `Tasks defined for plan ${resolvedPlanId}: ${tasks.length} tasks`,
                },
              ],
              details: selectPlanSummary(result.state, resolvedPlanId),
            };
          }
          case "set_task_status": {
            if (!resolvedPlanId) throw new Error("id or planId is required for set_task_status");
            if (taskId === undefined) throw new Error("taskId is required for set_task_status");
            if (!status) throw new Error("status is required for set_task_status");
            const result = await applyAndPersist(
              runId,
              rootDir,
              {
                type: "set_plan_task_status",
                planId: resolvedPlanId,
                taskId,
                status: status as HarnessPlanTaskStatus,
                startedAt,
                completedAt,
              },
              ctx,
            );
            return {
              content: [
                {
                  type: "text",
                  text: `Plan ${resolvedPlanId} task ${taskId} status set to ${status}`,
                },
              ],
              details: selectPlanSummary(result.state, resolvedPlanId),
            };
          }
          case "load": {
            const state = await loadHarnessState(runId, rootDir);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(selectPlanSummary(state, resolvedPlanId), null, 2),
                },
              ],
              details: selectPlanSummary(state, resolvedPlanId),
            };
          }
          case "render": {
            const state = await loadHarnessState(runId, rootDir);
            if (!resolvedPlanId) throw new Error("id or planId is required for render");
            return {
              content: [
                { type: "text", text: renderHarnessPlanMarkdown(state, resolvedPlanId) },
              ],
              details: selectPlanSummary(state, resolvedPlanId),
            };
          }
          default:
            throw new Error(`Unknown action: ${action}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          details: undefined,
          isError: true,
        };
      }
    },
  });

  pi.registerTool({
    name: "harness_todo",
    label: "Harness Todo",
    description:
      "Compatibility tool for structured harness todo state. Prefer todoread/todowrite for normal agent-facing progress updates.",
    parameters: HarnessTodoParams,
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const { runId, action, rootDir, ownerType, ownerId, todos, todoId, status } = params;
      try {
        switch (action) {
          case "set": {
            if (!ownerType) throw new Error("ownerType is required for set");
            if (!ownerId) throw new Error("ownerId is required for set");
            if (!Array.isArray(todos)) throw new Error("todos array is required for set");
            const result = await applyAndPersist(
              runId,
              rootDir,
              {
                type: "set_todos",
                ownerType: ownerType as HarnessTodoOwnerType,
                ownerId,
                todos: todos.map((t) => ({
                  id: t.id,
                  text: t.text,
                  status: t.status as HarnessTodoStatus | undefined,
                })),
              },
              ctx,
            );
            return {
              content: [
                {
                  type: "text",
                  text: `Todos set for ${ownerType} ${ownerId}: ${todos.length} todos`,
                },
              ],
              details: selectTodosForOwner(
                result.state,
                ownerType as HarnessTodoOwnerType,
                ownerId,
              ),
            };
          }
          case "update_status": {
            if (!todoId) throw new Error("todoId is required for update_status");
            if (!status) throw new Error("status is required for update_status");
            const result = await applyAndPersist(
              runId,
              rootDir,
              {
                type: "set_todo_status",
                todoId,
                status: status as HarnessTodoStatus,
              },
              ctx,
            );
            return {
              content: [
                { type: "text", text: `Todo ${todoId} status set to ${status}` },
              ],
              details: result.state.todos.find((t) => t.id === todoId),
            };
          }
          case "clear": {
            if (!ownerType) throw new Error("ownerType is required for clear");
            if (!ownerId) throw new Error("ownerId is required for clear");
            const result = await applyAndPersist(
              runId,
              rootDir,
              {
                type: "clear_todos",
                ownerType: ownerType as HarnessTodoOwnerType,
                ownerId,
              },
              ctx,
            );
            return {
              content: [
                { type: "text", text: `Todos cleared for ${ownerType} ${ownerId}` },
              ],
              details: [],
            };
          }
          case "load": {
            if (!ownerType) throw new Error("ownerType is required for load");
            if (!ownerId) throw new Error("ownerId is required for load");
            const state = await loadHarnessState(runId, rootDir);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    selectTodosForOwner(state, ownerType as HarnessTodoOwnerType, ownerId),
                    null,
                    2,
                  ),
                },
              ],
              details: selectTodosForOwner(state, ownerType as HarnessTodoOwnerType, ownerId),
            };
          }
          case "render": {
            if (!ownerType) throw new Error("ownerType is required for render");
            if (!ownerId) throw new Error("ownerId is required for render");
            const state = await loadHarnessState(runId, rootDir);
            return {
              content: [
                {
                  type: "text",
                  text: renderHarnessTodoMarkdown(
                    state,
                    ownerType as HarnessTodoOwnerType,
                    ownerId,
                  ),
                },
              ],
              details: selectTodosForOwner(state, ownerType as HarnessTodoOwnerType, ownerId),
            };
          }
          default:
            throw new Error(`Unknown action: ${action}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          details: undefined,
          isError: true,
        };
      }
    },
  });
}
