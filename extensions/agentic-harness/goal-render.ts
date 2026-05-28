import type { GoalItem, GoalState, GoalVerifierReceipt, SubgoalItem } from "./goal-state.js";

export function renderGoalStatus(state: GoalState): string {
  const lines: string[] = ["Goal status"];
  const activeGoal = getActiveGoal(state);

  lines.push(`Run: ${state.status}`);
  if (!activeGoal) {
    lines.push("Active goal: none");
    lines.push(`Queued goals: ${state.goals.filter((goal) => goal.status === "queued").length}`);
    lines.push(`Next action: ${state.goals.length === 0 ? "/clarify, then /goal" : "/goal"}`);
    return lines.join("\n");
  }

  lines.push(`Active goal: ${activeGoal.id} — ${activeGoal.title}`);
  lines.push(`Objective: ${activeGoal.objective}`);
  lines.push(`Goal status: ${activeGoal.status}`);
  appendList(lines, "Success criteria", activeGoal.successCriteria);
  appendList(lines, "Evidence required", activeGoal.evidenceRequired);
  appendList(lines, "Evidence", activeGoal.evidence ?? []);
  appendList(lines, "Blockers", activeGoal.blockers);

  if (activeGoal.subgoals.length > 0) {
    lines.push("Subgoals:");
    for (const subgoal of activeGoal.subgoals) {
      const marker = subgoal.id === activeGoal.activeSubgoalId ? "*" : "-";
      lines.push(`${marker} ${subgoal.id} [${subgoal.status}] ${subgoal.title}`);
      if (subgoal.blockers.length > 0) {
        for (const blocker of subgoal.blockers) lines.push(`  blocker: ${blocker}`);
      }
      if (subgoal.evidence.length > 0) lines.push(`  evidence: ${subgoal.evidence.length}`);
    }
  } else {
    lines.push("Subgoals: none");
  }

  const receipt = latestReceipt(activeGoal);
  lines.push(receipt ? renderReceipt(receipt) : "Latest verifier receipt: none");
  lines.push(`Next action: ${nextAction(activeGoal)}`);
  return lines.join("\n");
}

export function renderGoalSummary(state: GoalState): string | undefined {
  const activeGoal = getActiveGoal(state);
  if (!activeGoal) return undefined;
  const activeSubgoals = activeGoal.subgoals.filter((subgoal) => subgoal.status === "active").length;
  const receipt = latestReceipt(activeGoal);
  const verifierStatus = receipt ? `verify:${receipt.verdict.toLowerCase()}` : "verify:pending";
  return `${activeGoal.id} | ${verifierStatus} | subgoals:${activeSubgoals}/${activeGoal.subgoals.length} | ${activeGoal.title}`;
}

function getActiveGoal(state: GoalState): GoalItem | undefined {
  return state.goals.find((goal) => goal.id === state.activeGoalId)
    ?? state.goals.find((goal) => goal.status === "active");
}

function latestReceipt(goal: GoalItem): GoalVerifierReceipt | undefined {
  const receipts = [
    ...goal.verifierReceipts,
    ...goal.subgoals.flatMap((subgoal) => subgoal.verifierReceipts),
  ];
  return receipts.sort((a, b) => a.verifiedAt.localeCompare(b.verifiedAt)).at(-1);
}

function renderReceipt(receipt: GoalVerifierReceipt): string {
  const blockerText = receipt.blockers.length > 0 ? ` blockers: ${receipt.blockers.join("; ")}` : "";
  return `Latest verifier receipt: ${receipt.verdict} ${receipt.id} at ${receipt.verifiedAt} — ${receipt.summary}${blockerText}`;
}

function nextAction(goal: GoalItem): string {
  const activeSubgoal = goal.subgoals.find((subgoal) => subgoal.id === goal.activeSubgoalId);
  if (activeSubgoal) return nextSubgoalAction(activeSubgoal);
  if (goal.status === "blocked") return `add evidence for blockers, then /goal complete ${goal.id}`;
  if (goal.status === "verifying") return "wait for verifier result";
  if (goal.status === "completed") return "goal completed";
  return `/goal evidence ${goal.id} <evidence> then /goal complete ${goal.id}`;
}

function nextSubgoalAction(subgoal: SubgoalItem): string {
  if (subgoal.status === "blocked") return `fix blockers, add evidence, then /goal complete ${subgoal.id}`;
  if (subgoal.status === "verifying") return "wait for verifier result";
  if (subgoal.evidence.length === 0) return `/goal evidence ${subgoal.id} <evidence>`;
  return `/goal complete ${subgoal.id}`;
}

function appendList(lines: string[], label: string, values: string[]): void {
  if (values.length === 0) return;
  lines.push(`${label}:`);
  for (const value of values) lines.push(`- ${value}`);
}
