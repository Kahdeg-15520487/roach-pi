import {
  selectPlanForMilestone,
  type HarnessMilestoneStatus,
  type HarnessPlanTaskStatus,
  type HarnessState,
} from "./harness-state.js";

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
