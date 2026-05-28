import { describe, expect, it } from "vitest";
import { applyGoalCommand, createGoalState } from "../goal-state.js";
import {
  buildGoalVerifierPrompt,
  buildGoalVerifierReceipt,
  getGoalVerifierTarget,
  parseGoalVerifierOutput,
} from "../goal-verifier.js";

const START = "2026-05-28T00:00:00.000Z";

function stateWithGoal() {
  let state = applyGoalCommand(createGoalState("run-1", START), {
    type: "create_goal",
    goal: {
      id: "goal-1",
      title: "Goal 1",
      objective: "Ship verifier guard",
      successCriteria: ["Verifier runs independently"],
      evidenceRequired: ["Tests pass"],
    },
  }, { now: START }).state;
  state = applyGoalCommand(state, {
    type: "create_subgoal",
    subgoal: {
      id: "subgoal-1",
      goalId: "goal-1",
      title: "Subgoal 1",
      objective: "Verify subgoal evidence",
    },
  }, { now: START }).state;
  state = applyGoalCommand(state, {
    type: "add_evidence",
    targetType: "subgoal",
    targetId: "subgoal-1",
    evidence: "npm test passed",
  }, { now: START }).state;
  return state;
}

describe("goal verifier prompt and parser", () => {
  it("builds a fixed reviewer-verifier prompt", () => {
    const target = getGoalVerifierTarget(stateWithGoal(), "subgoal", "subgoal-1");
    const prompt = buildGoalVerifierPrompt(target, "C:/repo");

    expect(prompt).toContain("Repo cwd: C:/repo");
    expect(prompt).toContain("Target: subgoal subgoal-1");
    expect(prompt).toContain("Verify subgoal evidence");
    expect(prompt).toContain("Verifier runs independently");
    expect(prompt).toContain("npm test passed");
    expect(prompt).toContain("Inspect the repo independently");
    expect(prompt).toContain("Verdict: PASS|FAIL");
    expect(prompt).toContain("Commands Run:");
    expect(prompt).toContain("Evidence Checked:");
  });

  it("uses concrete goal evidence for goal-level verification", () => {
    let state = stateWithGoal();
    state = applyGoalCommand(state, {
      type: "add_evidence",
      targetType: "goal",
      targetId: "goal-1",
      evidence: "full workflow test passed",
    }, { now: START }).state;

    const target = getGoalVerifierTarget(state, "goal", "goal-1");
    const prompt = buildGoalVerifierPrompt(target, "C:/repo");

    expect(prompt).toContain("full workflow test passed");
    expect(prompt).not.toContain("- Tests pass");
  });

  it("parses PASS verifier output", () => {
    const parsed = parseGoalVerifierOutput([
      "Verdict: PASS",
      "Summary: Complete",
      "Blockers:",
      "- none",
      "Commands Run:",
      "- npm test",
      "Evidence Checked:",
      "- tests passed",
    ].join("\n"));

    expect(parsed).toMatchObject({
      verdict: "PASS",
      summary: "Complete",
      blockers: ["none"],
      commandsRun: ["npm test"],
      evidence: ["tests passed"],
    });
  });

  it("fails closed when verifier output is malformed", () => {
    const parsed = parseGoalVerifierOutput("Summary: looks good");

    expect(parsed.verdict).toBe("FAIL");
    expect(parsed.rawOutput).toBe("Summary: looks good");
  });

  it("builds receipts with raw verifier output", () => {
    const target = getGoalVerifierTarget(stateWithGoal(), "goal", "goal-1");
    const parsed = parseGoalVerifierOutput("Verdict: FAIL\nSummary: Missing evidence");
    const receipt = buildGoalVerifierReceipt(target, parsed, {
      id: "receipt-1",
      verifiedAt: "2026-05-28T00:01:00.000Z",
    });

    expect(receipt).toMatchObject({
      id: "receipt-1",
      targetType: "goal",
      targetId: "goal-1",
      verdict: "FAIL",
      verifierAgent: "reviewer-verifier",
      summary: "Missing evidence",
      rawOutput: "Verdict: FAIL\nSummary: Missing evidence",
    });
    expect(receipt.objectiveHash).toHaveLength(64);
  });

  it("does not allow a stale PASS receipt after new evidence", () => {
    let state = stateWithGoal();
    const target = getGoalVerifierTarget(state, "goal", "goal-1");
    const receipt = buildGoalVerifierReceipt(target, parseGoalVerifierOutput("Verdict: PASS\nSummary: Complete"), {
      id: "receipt-pass",
      verifiedAt: "2026-05-28T00:01:00.000Z",
    });

    state = applyGoalCommand(state, {
      type: "record_verifier_result",
      receipt,
    }, { now: "2026-05-28T00:02:00.000Z" }).state;
    state = applyGoalCommand(state, {
      type: "add_evidence",
      targetType: "goal",
      targetId: "goal-1",
      evidence: "new evidence after verifier pass",
    }, { now: "2026-05-28T00:03:00.000Z" }).state;

    expect(() => applyGoalCommand(state, {
      type: "complete_target",
      targetType: "goal",
      targetId: "goal-1",
    }, { now: "2026-05-28T00:04:00.000Z" })).toThrow(/stale/);
  });
});
