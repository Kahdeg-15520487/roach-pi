import { describe, expect, it } from "vitest";
import { applyHarnessCommand, createHarnessState, type HarnessState } from "../harness-state.js";
import {
  milestoneStatusToTodoStatus,
  parseTodoFacadeId,
  planTaskStatusToTodoStatus,
  readTodosFromHarnessState,
  todoStatusToMilestoneStatus,
  todoStatusToPlanTaskStatus,
} from "../todo-facade.js";

function apply(state: HarnessState, command: Parameters<typeof applyHarnessCommand>[1]): HarnessState {
  return applyHarnessCommand(state, command, { now: "2026-05-18T00:00:00.000Z" }).state;
}

describe("todo facade id parsing", () => {
  it("parses milestone and plan task ids", () => {
    expect(parseTodoFacadeId("M1")).toEqual({ kind: "milestone", milestoneId: "M1" });
    expect(parseTodoFacadeId("M2.T3")).toEqual({ kind: "plan_task", milestoneId: "M2", taskId: 3 });
    expect(parseTodoFacadeId("misc")).toEqual({ kind: "unknown", id: "misc" });
  });
});

describe("todo facade status mappings", () => {
  it("maps between harness and facade statuses", () => {
    expect(todoStatusToMilestoneStatus("in_progress")).toBe("executing");
    expect(todoStatusToPlanTaskStatus("in_progress")).toBe("running");
    expect(milestoneStatusToTodoStatus("validating")).toBe("in_progress");
    expect(planTaskStatusToTodoStatus("skipped")).toBe("cancelled");
  });
});

describe("readTodosFromHarnessState", () => {
  it("returns milestones and selected plan tasks", () => {
    let state = createHarnessState({
      runId: "run-1",
      title: "Run 1",
      now: "2026-05-18T00:00:00.000Z",
    });
    state = apply(state, {
      type: "upsert_milestone",
      milestone: { id: "M1", name: "Milestone 1", status: "completed" },
    });
    state = apply(state, {
      type: "upsert_milestone",
      milestone: { id: "M2", name: "Milestone 2", status: "executing" },
    });
    state = apply(state, {
      type: "attach_plan",
      plan: { id: "m2-plan", milestoneId: "M2", title: "M2 Plan", goal: "Ship M2" },
    });
    state = apply(state, {
      type: "define_plan_tasks",
      planId: "m2-plan",
      tasks: [
        { id: 1, name: "Task 1", status: "running" },
        { id: 2, name: "Task 2", status: "pending" },
      ],
    });

    const result = readTodosFromHarnessState(state, { rootDir: "root-dir" });

    expect(result.runId).toBe("run-1");
    expect(result.rootDir).toBe("root-dir");
    expect(result.todos.map((todo) => todo.id)).toEqual(["M1", "M2", "M2.T1", "M2.T2"]);
    expect(result.todos).toEqual([
      { id: "M1", content: "Milestone 1", status: "completed", priority: "medium" },
      { id: "M2", content: "Milestone 2", status: "in_progress", priority: "high" },
      { id: "M2.T1", content: "Task 1", status: "in_progress", priority: "high" },
      { id: "M2.T2", content: "Task 2", status: "pending", priority: "medium" },
    ]);
  });
});
