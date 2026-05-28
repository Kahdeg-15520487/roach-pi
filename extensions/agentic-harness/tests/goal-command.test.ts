import { describe, expect, it } from "vitest";
import { GOAL_HELP_TEXT, parseGoalCommand } from "../goal-command.js";
import { applyGoalCommand, buildGoalObjectiveHash, createGoalState, type GoalVerifierReceipt } from "../goal-state.js";
import { renderGoalStatus, renderGoalSummary } from "../goal-render.js";

const NOW = "2026-05-28T00:00:00.000Z";

describe("goal command parser", () => {
  it("parses auto and status commands", () => {
    expect(parseGoalCommand("/goal")).toEqual({ kind: "auto" });
    expect(parseGoalCommand("/goal status")).toEqual({ kind: "status" });
    expect(parseGoalCommand("status")).toEqual({ kind: "status" });
  });

  it("parses create", () => {
    expect(parseGoalCommand("/goal create Ship the goal runtime")).toEqual({
      kind: "create",
      objective: "Ship the goal runtime",
    });
  });

  it("parses activate", () => {
    expect(parseGoalCommand("/goal activate goal-1")).toEqual({ kind: "activate", goalId: "goal-1" });
  });

  it("parses subgoal", () => {
    expect(parseGoalCommand("/goal subgoal goal-1 Implement parser and renderer")).toEqual({
      kind: "subgoal",
      goalId: "goal-1",
      title: "Implement parser and renderer",
    });
  });

  it("parses evidence", () => {
    expect(parseGoalCommand("/goal evidence subgoal-1 npm test passed")).toEqual({
      kind: "evidence",
      targetId: "subgoal-1",
      evidence: "npm test passed",
    });
  });

  it("parses complete", () => {
    expect(parseGoalCommand("/goal complete subgoal-1")).toEqual({ kind: "complete", targetId: "subgoal-1" });
  });

  it("parses pause with optional goal id", () => {
    expect(parseGoalCommand("/goal pause")).toEqual({ kind: "pause", goalId: undefined });
    expect(parseGoalCommand("/goal pause goal-1")).toEqual({ kind: "pause", goalId: "goal-1" });
  });

  it("parses resume with optional goal id", () => {
    expect(parseGoalCommand("/goal resume")).toEqual({ kind: "resume", goalId: undefined });
    expect(parseGoalCommand("/goal resume goal-1")).toEqual({ kind: "resume", goalId: "goal-1" });
  });

  it("parses clear confirmation", () => {
    expect(parseGoalCommand("/goal clear --confirm")).toEqual({ kind: "clear", confirm: true });
  });

  it("parses help", () => {
    expect(parseGoalCommand("/goal help")).toEqual({ kind: "help" });
  });

  it("returns errors for invalid inputs", () => {
    expect(parseGoalCommand("/goal create")).toMatchObject({ kind: "error" });
    expect(parseGoalCommand("/goal activate")).toMatchObject({ kind: "error" });
    expect(parseGoalCommand("/goal subgoal goal-1")).toMatchObject({ kind: "error" });
    expect(parseGoalCommand("/goal evidence goal-1")).toMatchObject({ kind: "error" });
    expect(parseGoalCommand("/goal complete a b")).toMatchObject({ kind: "error" });
    expect(parseGoalCommand("/goal pause a b")).toMatchObject({ kind: "error" });
    expect(parseGoalCommand("/goal resume a b")).toMatchObject({ kind: "error" });
    expect(parseGoalCommand("/goal clear")).toMatchObject({ kind: "error" });
    expect(parseGoalCommand("/goal unknown")).toMatchObject({ kind: "error" });
  });

  it("describes clarify to goal and verifier guard without legacy workflow terms", () => {
    expect(GOAL_HELP_TEXT).toContain("/clarify");
    expect(GOAL_HELP_TEXT).toContain("Goal Contract");
    expect(GOAL_HELP_TEXT).toContain("reviewer-verifier");
    expect(GOAL_HELP_TEXT).not.toContain(["/", "pl", "an"].join(""));
    expect(GOAL_HELP_TEXT).not.toContain(["run", "pl", "an"].join("-"));
    expect(GOAL_HELP_TEXT).not.toContain("milestones");
    expect(GOAL_HELP_TEXT).not.toContain(["long", "run"].join("-"));
  });
});

describe("goal renderer", () => {
  it("renders empty state with next action", () => {
    const rendered = renderGoalStatus(createGoalState("run-1", NOW));

    expect(rendered).toContain("Active goal: none");
    expect(rendered).toContain("Next action: /clarify, then /goal");
    expect(renderGoalSummary(createGoalState("run-1", NOW))).toBeUndefined();
  });

  it("renders active goal, subgoals, blockers, latest verifier receipt, and next action", () => {
    let state = createGoalState("run-1", NOW);
    state = applyGoalCommand(state, {
      type: "create_goal",
      goal: {
        id: "goal-1",
        title: "Goal 1",
        objective: "Ship goal runtime",
        successCriteria: ["Parser works"],
        evidenceRequired: ["Command tests pass"],
      },
    }, { now: "2026-05-28T00:01:00.000Z" }).state;
    state = applyGoalCommand(state, { type: "activate_goal", goalId: "goal-1" }, { now: "2026-05-28T00:02:00.000Z" }).state;
    state = applyGoalCommand(state, {
      type: "create_subgoal",
      subgoal: {
        id: "subgoal-1",
        goalId: "goal-1",
        title: "Parser",
        objective: "Implement parser",
      },
    }, { now: "2026-05-28T00:03:00.000Z" }).state;
    state = applyGoalCommand(state, {
      type: "add_evidence",
      targetType: "subgoal",
      targetId: "subgoal-1",
      evidence: "npm test -- tests/goal-command.test.ts passed",
    }, { now: "2026-05-28T00:04:00.000Z" }).state;

    const goal = state.goals[0];
    const receipt: GoalVerifierReceipt = {
      id: "receipt-1",
      targetType: "subgoal",
      targetId: "subgoal-1",
      objectiveHash: buildGoalObjectiveHash(goal, goal.subgoals[0]),
      verdict: "FAIL",
      verifiedAt: "2026-05-28T00:05:00.000Z",
      verifierAgent: "reviewer-verifier",
      summary: "Needs one more assertion",
      blockers: ["Missing invalid input coverage"],
      commandsRun: ["npm test -- tests/goal-command.test.ts"],
      evidence: ["partial test output"],
      rawOutput: "Verdict: FAIL\nSummary: Needs one more assertion",
    };
    state = applyGoalCommand(state, { type: "record_verifier_result", receipt }, { now: "2026-05-28T00:05:00.000Z" }).state;

    const rendered = renderGoalStatus(state);

    expect(rendered).toContain("Active goal: goal-1 — Goal 1");
    expect(rendered).toContain("* subgoal-1 [blocked] Parser");
    expect(rendered).toContain("blocker: Missing invalid input coverage");
    expect(rendered).toContain("Latest verifier receipt: FAIL receipt-1");
    expect(rendered).toContain("Next action: fix blockers, add evidence, then /goal complete subgoal-1");
    expect(renderGoalSummary(state)).toBe("goal-1 | verify:fail | subgoals:0/1 | Goal 1");
  });
});
