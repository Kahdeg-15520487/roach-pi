import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSkill(name: string): string {
  return readFileSync(new URL(`../skills/${name}/SKILL.md`, import.meta.url), "utf-8");
}

describe("skill docs reference structured harness tools", () => {
  it("agentic-run-plan requires mandatory todowrite task status updates", () => {
    const src = readSkill("agentic-run-plan");
    expect(src).toContain("Task Status Update (MANDATORY)");
    expect(src).toContain("todowrite");
    expect(src).toContain("todoread");
    expect(src).not.toContain("harness_plan set_task_status");
    expect(src).toContain("After the validator passes");
    expect(src).toContain("rendered output only");
  });

  it("agentic-long-run references harness_milestone, todowrite, todoread, and canonical structured state", () => {
    const src = readSkill("agentic-long-run");
    expect(src).toContain("harness_milestone");
    expect(src).toContain("todowrite");
    expect(src).toContain("todoread");
    expect(src).toContain("canonical structured state");
  });

  it("agentic-long-run does not use markdown checkboxes or state.md as canonical recovery state", () => {
    const src = readSkill("agentic-long-run");
    expect(src).not.toContain("first unchecked task");
    expect(src).not.toContain("checkboxes marked");
    expect(src).not.toContain("Update state.md");
    expect(src).not.toContain("Checkpoint files are the source of truth");
    expect(src).toContain("Do not infer task status from markdown checkboxes");
  });

  it("agentic-long-run forbids main-agent direct task execution and requires structured task status", () => {
    const src = readSkill("agentic-long-run");
    expect(src).toContain("Do not execute plan tasks directly as the main agent");
    expect(src).toContain("Initialize normal task progress from the approved plan via `todowrite`");
    expect(src).toContain("todoread");
    expect(src).toContain("todowrite");
    expect(src).not.toContain("harness_plan set_task_status");
    expect(src).toContain("harness_milestone set_status");
    expect(src).not.toContain("Update state.md: set milestone status");
    expect(src).not.toContain("Set milestone status to `skipped` in state.md");
  });

  it("agentic-long-run records milestone plan files through harness_milestone", () => {
    const src = readSkill("agentic-long-run");
    expect(src).toContain("Use `harness_milestone` for milestone creation, dependency metadata, attempts, plan files");
    expect(src).toContain("attach the plan file path to the milestone via `harness_milestone`");
    expect(src).toContain('{ "runId": "<run-id>", "action": "update", "id": "M1", "planFile": "docs/.../plan.md" }');
    expect(src).not.toContain("attach the plan to the milestone via `harness_plan`");
    expect(src).not.toContain('{ "runId": "<run-id>", "action": "attach", "planId": "<plan-id>", "milestoneId": "M1", "title": "...", "goal": "...", "planFile": "docs/.../plan.md" }');
  });

  it("agentic-plan-crafting references harness_plan and define_tasks", () => {
    const src = readSkill("agentic-plan-crafting");
    expect(src).toContain("harness_plan");
    expect(src).toContain("define_tasks");
    expect(src).not.toContain("syntax for progress tracking");
    expect(src).toContain("canonical progress is read with `todoread` and updated with `todowrite`");
  });

  it("agentic-review-work references harness_milestone", () => {
    const src = readSkill("agentic-review-work");
    expect(src).toContain("harness_milestone");
    expect(src).toContain("todowrite");
    expect(src).toContain("rather than `harness_plan`");
  });

  it("agentic-milestone-planning references harness_milestone", () => {
    const src = readSkill("agentic-milestone-planning");
    expect(src).toContain("harness_milestone");
    expect(src).toContain("todoread");
    expect(src).toContain("todowrite");
    expect(src).not.toContain("harness_plan set_task_status");
  });
});
