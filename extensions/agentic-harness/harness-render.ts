import type { HarnessState, HarnessTodo } from "./harness-state.js";
import { selectMilestoneSummary, selectTodosForOwner } from "./harness-state.js";

function markdownLines(lines: string[]): string {
  return `${lines.join("\n")}\n`;
}

function tableCell(value: string | number | undefined): string {
  return String(value ?? "—").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function inlineCode(value: string): string {
  return `\`${value.replace(/`/g, "\\`")}\``;
}

function formatList(values: Array<string | number>): string {
  return values.length > 0 ? values.join(", ") : "none";
}

function appendBulletList(lines: string[], values: string[], emptyText: string): void {
  if (values.length === 0) {
    lines.push(`- ${emptyText}`);
    return;
  }
  for (const value of values) {
    lines.push(`- ${value}`);
  }
}

export function renderHarnessStateMarkdown(state: HarnessState): string {
  const milestoneSummary = selectMilestoneSummary(state);
  const lines = [
    `# ${state.title}`,
    "",
    `- Run ID: ${inlineCode(state.runId)}`,
    `- Schema Version: ${state.schemaVersion}`,
    `- Status: ${state.status}`,
    `- Created At: ${state.createdAt}`,
    `- Updated At: ${state.updatedAt}`,
    "",
    "## Milestones",
    "",
    "| ID | Name | Status | Dependencies | Attempts | Plan File | Review File |",
    "| --- | --- | --- | --- | ---: | --- | --- |",
  ];

  for (const milestone of milestoneSummary.items) {
    lines.push(
      `| ${tableCell(milestone.id)} | ${tableCell(milestone.name)} | ${tableCell(milestone.status)} | ${tableCell(milestone.dependencies.join(", ") || undefined)} | ${tableCell(milestone.attempts)} | ${tableCell(milestone.planFile)} | ${tableCell(milestone.reviewFile)} |`,
    );
  }

  lines.push(
    "",
    "## Execution Metadata",
    "",
    `- Events Applied: ${state.eventSeq}`,
    `- Milestones Total: ${milestoneSummary.total}`,
    `- Milestones Completed: ${milestoneSummary.completed}`,
    `- Milestones Failed: ${milestoneSummary.failed}`,
    `- Milestones Executing: ${milestoneSummary.executing}`,
    `- Milestones Pending: ${milestoneSummary.pending}`,
    `- Plans Total: ${state.plans.length}`,
    `- Todos Total: ${state.todos.length}`,
  );

  return markdownLines(lines);
}

export function renderHarnessPlanMarkdown(state: HarnessState, planId: string): string {
  const plan = state.plans.find((candidate) => candidate.id === planId);
  if (!plan) {
    throw new Error(`Plan ${planId} not found`);
  }

  const lines = [
    `# ${plan.title}`,
    "",
    `- Plan ID: ${inlineCode(plan.id)}`,
    `- Milestone ID: ${inlineCode(plan.milestoneId)}`,
    `- Goal: ${plan.goal}`,
    "",
    "## Tasks",
  ];

  for (const task of plan.tasks) {
    lines.push(
      "",
      `### Task ${task.id}: ${task.name}`,
      `- Status: ${inlineCode(task.status)}`,
      `- Dependencies: ${formatList(task.dependencies)}`,
      "",
      "#### Files",
    );
    appendBulletList(lines, task.files.map((file) => inlineCode(file)), "No files");
    lines.push("", "#### Test Commands");
    appendBulletList(lines, task.testCommands.map((command) => inlineCode(command)), "No test commands");
    lines.push("", "#### Acceptance Criteria");
    appendBulletList(lines, task.acceptanceCriteria, "No acceptance criteria");
  }

  return markdownLines(lines);
}

export function renderHarnessTodoMarkdown(
  state: HarnessState,
  ownerType: HarnessTodo["ownerType"],
  ownerId: string,
): string {
  const lines = [`# Todos for ${ownerType} ${ownerId}`, ""];
  for (const todo of selectTodosForOwner(state, ownerType, ownerId)) {
    const checkbox = todo.status === "completed" ? "[x]" : "[ ]";
    lines.push(`- ${checkbox} ${todo.text}`);
  }
  return markdownLines(lines);
}
