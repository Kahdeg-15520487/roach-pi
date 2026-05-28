import { describe, expect, it } from "vitest";
import {
  applyGoalCommand,
  buildGoalObjectiveHash,
  createGoalState,
  GoalInvariantError,
  type GoalItem,
  type GoalVerifierReceipt,
  GOAL_STATE_SCHEMA_VERSION,
} from "../goal-state.js";

const START = "2026-05-28T00:00:00.000Z";

function createGoal() {
  return applyGoalCommand(createGoalState("run-1", START), {
    type: "create_goal",
    goal: {
      id: "goal-1",
      title: "Goal 1",
      objective: "Ship goal runtime",
      priority: "high",
      successCriteria: ["Reducer works"],
      constraints: ["Use deterministic ids"],
      evidenceRequired: ["Tests pass"],
    },
  }, { now: "2026-05-28T00:01:00.000Z" }).state;
}

function passReceipt(goal: GoalItem, id = "receipt-1"): GoalVerifierReceipt {
  return {
    id,
    targetType: "goal",
    targetId: goal.id,
    objectiveHash: buildGoalObjectiveHash(goal),
    verdict: "PASS",
    verifiedAt: "2026-05-28T00:03:00.000Z",
    verifierAgent: "reviewer-verifier",
    summary: "Verified",
    blockers: [],
    commandsRun: ["npm test -- tests/goal-state.test.ts"],
    evidence: ["Tests pass"],
    rawOutput: "Verdict: PASS\nSummary: Verified",
  };
}

function failReceipt(goal: GoalItem): GoalVerifierReceipt {
  return {
    ...passReceipt(goal, "receipt-fail"),
    verdict: "FAIL",
    summary: "Blocked",
    blockers: ["Missing evidence"],
    rawOutput: "Verdict: FAIL\nSummary: Blocked",
  };
}

describe("goal-state reducer", () => {
  it("initializes goal state", () => {
    const state = createGoalState("run-1", START);

    expect(state).toMatchObject({
      schemaVersion: GOAL_STATE_SCHEMA_VERSION,
      runId: "run-1",
      status: "idle",
      goals: [],
      ledger: [],
      continuation: { queued: false, blockers: [], consecutiveFailures: {} },
      createdAt: START,
      updatedAt: START,
    });
  });

  it("creates and activates a goal", () => {
    let state = createGoal();

    expect(state.goals[0]).toMatchObject({
      id: "goal-1",
      title: "Goal 1",
      status: "queued",
      priority: "high",
      successCriteria: ["Reducer works"],
      constraints: ["Use deterministic ids"],
      evidenceRequired: ["Tests pass"],
    });
    expect(state.ledger.map((entry) => entry.type)).toEqual(["goal_created"]);

    state = applyGoalCommand(state, {
      type: "activate_goal",
      goalId: "goal-1",
    }, { now: "2026-05-28T00:02:00.000Z" }).state;

    expect(state.status).toBe("active");
    expect(state.activeGoalId).toBe("goal-1");
    expect(state.goals[0].status).toBe("active");
    expect(state.ledger.map((entry) => entry.type)).toEqual(["goal_created", "goal_activated"]);
  });

  it("creates subgoals with dependencies", () => {
    let state = createGoal();
    state = applyGoalCommand(state, {
      type: "create_subgoal",
      subgoal: {
        id: "subgoal-1",
        goalId: "goal-1",
        title: "First subgoal",
        objective: "Implement types",
      },
    }, { now: "2026-05-28T00:02:00.000Z" }).state;
    state = applyGoalCommand(state, {
      type: "create_subgoal",
      subgoal: {
        id: "subgoal-2",
        goalId: "goal-1",
        title: "Second subgoal",
        objective: "Implement commands",
        dependencies: ["subgoal-1"],
      },
    }, { now: "2026-05-28T00:03:00.000Z" }).state;

    expect(state.goals[0].activeSubgoalId).toBe("subgoal-1");
    expect(state.goals[0].subgoals.map((subgoal) => ({
      id: subgoal.id,
      status: subgoal.status,
      dependencies: subgoal.dependencies,
    }))).toEqual([
      { id: "subgoal-1", status: "active", dependencies: [] },
      { id: "subgoal-2", status: "queued", dependencies: ["subgoal-1"] },
    ]);
  });

  it("appends evidence to the ledger", () => {
    const state = applyGoalCommand(createGoal(), {
      type: "add_evidence",
      targetType: "goal",
      targetId: "goal-1",
      evidence: "npm test passed",
    }, { now: "2026-05-28T00:02:00.000Z" }).state;

    expect(state.ledger.at(-1)).toMatchObject({
      seq: 2,
      type: "evidence_added",
      goalId: "goal-1",
      message: "npm test passed",
    });
  });

  it("fails to complete without a PASS receipt", () => {
    const state = createGoal();

    expect(() => applyGoalCommand(state, {
      type: "complete_target",
      targetType: "goal",
      targetId: "goal-1",
    }, { now: "2026-05-28T00:02:00.000Z" })).toThrow(GoalInvariantError);
  });

  it("keeps a FAIL receipt from allowing completion", () => {
    let state = createGoal();
    state = applyGoalCommand(state, {
      type: "record_verifier_result",
      receipt: failReceipt(state.goals[0]),
    }, { now: "2026-05-28T00:02:00.000Z" }).state;

    expect(state.goals[0].status).toBe("blocked");
    expect(() => applyGoalCommand(state, {
      type: "complete_target",
      targetType: "goal",
      targetId: "goal-1",
    }, { now: "2026-05-28T00:03:00.000Z" })).toThrow(GoalInvariantError);
  });

  it("allows completion with a fresh PASS receipt", () => {
    let state = createGoal();
    state = applyGoalCommand(state, {
      type: "request_completion",
      targetType: "goal",
      targetId: "goal-1",
    }, { now: "2026-05-28T00:02:00.000Z" }).state;
    state = applyGoalCommand(state, {
      type: "record_verifier_result",
      receipt: passReceipt(state.goals[0]),
    }, { now: "2026-05-28T00:03:00.000Z" }).state;
    state = applyGoalCommand(state, {
      type: "complete_target",
      targetType: "goal",
      targetId: "goal-1",
    }, { now: "2026-05-28T00:04:00.000Z" }).state;

    expect(state.goals[0].status).toBe("completed");
    expect(state.status).toBe("completed");
  });

  it("treats new evidence after PASS as a stale receipt", () => {
    let state = createGoal();
    state = applyGoalCommand(state, {
      type: "record_verifier_result",
      receipt: passReceipt(state.goals[0]),
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

  it("marks the run completed when all goals are completed", () => {
    let state = createGoal();
    state = applyGoalCommand(state, {
      type: "create_goal",
      goal: {
        id: "goal-2",
        title: "Goal 2",
        objective: "Finish docs",
        successCriteria: ["Docs updated"],
        evidenceRequired: ["Docs test"],
      },
    }, { now: "2026-05-28T00:02:00.000Z" }).state;

    state = applyGoalCommand(state, {
      type: "record_verifier_result",
      receipt: passReceipt(state.goals[0], "receipt-goal-1"),
    }, { now: "2026-05-28T00:03:00.000Z" }).state;
    state = applyGoalCommand(state, {
      type: "complete_target",
      targetType: "goal",
      targetId: "goal-1",
    }, { now: "2026-05-28T00:04:00.000Z" }).state;

    expect(state.status).not.toBe("completed");

    state = applyGoalCommand(state, {
      type: "record_verifier_result",
      receipt: passReceipt(state.goals[1], "receipt-goal-2"),
    }, { now: "2026-05-28T00:05:00.000Z" }).state;
    state = applyGoalCommand(state, {
      type: "complete_target",
      targetType: "goal",
      targetId: "goal-2",
    }, { now: "2026-05-28T00:06:00.000Z" }).state;

    expect(state.status).toBe("completed");
    expect(state.activeGoalId).toBeUndefined();
  });
});
