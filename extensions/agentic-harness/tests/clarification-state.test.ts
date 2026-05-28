import { describe, expect, it } from "vitest";
import {
  applyClarificationCommand,
  canDraftGoalContract,
  ClarificationGateError,
  createClarificationState,
  getClarificationGateIssues,
  REQUIRED_CLARIFICATION_CHECKLIST,
} from "../clarification-state.js";

describe("clarification state", () => {
  it("starts with required deep-interview checklist open", () => {
    const state = createClarificationState("run-1", "2026-05-29T00:00:00.000Z", "ship feature");

    expect(state.status).toBe("interviewing");
    expect(state.checklist.map((item) => item.id)).toEqual([...REQUIRED_CLARIFICATION_CHECKLIST]);
    expect(canDraftGoalContract(state)).toBe(false);
    expect(getClarificationGateIssues(state)).toContain("Required checklist item is incomplete: Objective");
  });

  it("blocks Goal Contract drafting until checklist and blocking ambiguities are resolved", () => {
    let state = createClarificationState("run-1", "2026-05-29T00:00:00.000Z", "ship feature");
    state = applyClarificationCommand(state, {
      type: "add_ambiguity",
      id: "amb-1",
      question: "Which users are affected?",
    }, { now: "2026-05-29T00:00:01.000Z" }).state;

    for (const id of REQUIRED_CLARIFICATION_CHECKLIST) {
      state = applyClarificationCommand(state, {
        type: "mark_checklist_item",
        id,
        value: `${id} clarified`,
      }, { now: `2026-05-29T00:00:02.000Z` }).state;
    }

    expect(canDraftGoalContract(state)).toBe(false);
    expect(() => applyClarificationCommand(state, {
      type: "draft_goal_contract",
      contract: {
        objective: "Ship feature",
        scope: ["implementation"],
        nonGoals: ["redesign"],
        successCriteria: ["tests pass"],
        constraints: ["windows"],
        evidenceRequired: ["npm test"],
        risks: ["regression"],
        suggestedSubgoals: ["implement"],
        handoffCommand: "/goal",
      },
    }, { now: "2026-05-29T00:00:03.000Z" })).toThrow(ClarificationGateError);

    state = applyClarificationCommand(state, {
      type: "resolve_ambiguity",
      id: "amb-1",
      resolution: "Admins only",
    }, { now: "2026-05-29T00:00:04.000Z" }).state;

    const drafted = applyClarificationCommand(state, {
      type: "draft_goal_contract",
      contract: {
        objective: "Ship feature",
        scope: ["implementation"],
        nonGoals: ["redesign"],
        successCriteria: ["tests pass"],
        constraints: ["windows"],
        evidenceRequired: ["npm test"],
        risks: ["regression"],
        suggestedSubgoals: ["implement"],
        handoffCommand: "/goal",
      },
    }, { now: "2026-05-29T00:00:05.000Z" }).state;

    expect(drafted.status).toBe("contract_drafted");
    expect(drafted.goalContract?.handoffCommand).toBe("/goal");
  });

  it("rejects empty checklist completion values", () => {
    const state = createClarificationState("run-1", "2026-05-29T00:00:00.000Z", "ship feature");

    expect(() => applyClarificationCommand(state, {
      type: "mark_checklist_item",
      id: "objective",
      value: "   ",
    }, { now: "2026-05-29T00:00:01.000Z" })).toThrow(ClarificationGateError);
  });

  it("allows explicitly accepted ambiguity risks to pass the gate", () => {
    let state = createClarificationState("run-1", "2026-05-29T00:00:00.000Z", "ship feature");
    state = applyClarificationCommand(state, { type: "add_ambiguity", id: "amb-1", question: "Unknown rollout timing" }, { now: "2026-05-29T00:00:01.000Z" }).state;
    for (const id of REQUIRED_CLARIFICATION_CHECKLIST) {
      state = applyClarificationCommand(state, { type: "mark_checklist_item", id, value: `${id} clarified` }, { now: "2026-05-29T00:00:02.000Z" }).state;
    }
    state = applyClarificationCommand(state, { type: "accept_risk", id: "amb-1", reason: "User accepted rollout timing as follow-up risk" }, { now: "2026-05-29T00:00:03.000Z" }).state;

    expect(canDraftGoalContract(state)).toBe(true);
    expect(getClarificationGateIssues(state)).toEqual([]);
  });
});
