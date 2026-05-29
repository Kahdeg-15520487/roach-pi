import { describe, it, expect } from "vitest";
import {
  getCompactionPrompt,
  formatCompactSummary,
  microcompactMessages,
  MICROCOMPACT_AGE_MS,
  buildGoalCompactionSummary,
  buildClarificationCompactionSummary,
} from "../compaction.js";
import { applyGoalCommand, buildGoalObjectiveHash, createGoalState, type GoalVerifierReceipt } from "../goal-state.js";
import { applyClarificationCommand, createClarificationState } from "../clarification-state.js";

describe("Compaction Prompts", () => {
  it("should generate base prompt for idle phase", () => {
    const prompt = getCompactionPrompt("idle", null);
    expect(prompt).toContain("Primary Request and Intent");
    expect(prompt).toContain("All User Messages");
    expect(prompt).toContain("<analysis>");
    expect(prompt).toContain("<summary>");
    expect(prompt).not.toContain("Active Workflow");
  });

  it("should include runtime clarification summary for clarifying", () => {
    let state = createClarificationState("run-1", "2026-05-29T00:00:00.000Z", "deep clarify");
    state = applyClarificationCommand(state, {
      type: "mark_checklist_item",
      id: "objective",
      value: "Make clarify exhaustive",
    }, { now: "2026-05-29T00:00:01.000Z" }).state;
    state = applyClarificationCommand(state, {
      type: "add_ambiguity",
      id: "amb-1",
      question: "Which edge cases matter?",
    }, { now: "2026-05-29T00:00:02.000Z" }).state;

    const summary = buildClarificationCompactionSummary(state);
    const prompt = getCompactionPrompt("clarifying", "docs/brief.md", undefined, null, summary);
    expect(prompt).toContain("Active Workflow: Agentic Clarification");
    expect(prompt).toContain("ACTIVE CLARIFICATION RUNTIME STATE");
    expect(prompt).toContain("Topic: deep clarify");
    expect(prompt).toContain("Checklist: 1/9 complete");
    expect(prompt).toContain("Which edge cases matter?");
  });

  it("should include phase-specific section for goal drafting", () => {
    const prompt = getCompactionPrompt("goal_drafting", "docs/goal-contract.md");
    expect(prompt).toContain("Active Workflow: Goal Drafting");
    expect(prompt).toContain("docs/goal-contract.md");
    expect(prompt).toContain("Goal Contract handoff");
  });

  it("should include goal runtime summary for goal execution compaction", () => {
    let state = createGoalState("run-1", "2026-05-28T00:00:00.000Z");
    state = applyGoalCommand(state, {
      type: "create_goal",
      goal: {
        id: "goal-1",
        title: "Ship goal runtime",
        objective: "Ship durable goal runtime",
        successCriteria: ["tests pass"],
        evidenceRequired: ["npm test output"],
      },
    }, { now: "2026-05-28T00:01:00.000Z" }).state;
    state = applyGoalCommand(state, { type: "activate_goal", goalId: "goal-1" }, { now: "2026-05-28T00:02:00.000Z" }).state;
    state = applyGoalCommand(state, {
      type: "create_subgoal",
      subgoal: { id: "subgoal-1", goalId: "goal-1", title: "Restore", objective: "Restore sessions" },
    }, { now: "2026-05-28T00:03:00.000Z" }).state;
    const goal = state.goals[0];
    const receipt: GoalVerifierReceipt = {
      id: "receipt-1",
      targetType: "goal",
      targetId: "goal-1",
      objectiveHash: buildGoalObjectiveHash(goal),
      verdict: "FAIL",
      verifiedAt: "2026-05-28T00:04:00.000Z",
      verifierAgent: "reviewer-verifier",
      summary: "Missing restore evidence",
      blockers: ["Need replay test"],
      commandsRun: ["npm test"],
      evidence: ["partial output"],
      rawOutput: "Verdict: FAIL\nSummary: Missing restore evidence",
    };
    state = applyGoalCommand(state, { type: "record_verifier_result", receipt }, { now: "2026-05-28T00:04:00.000Z" }).state;
    state = applyGoalCommand(state, {
      type: "queue_continuation",
      targetType: "goal",
      targetId: "goal-1",
      reason: "fix blockers",
      blockers: ["Need replay test"],
      leaseId: "lease-1",
    }, { now: "2026-05-28T00:05:00.000Z" }).state;

    const summary = buildGoalCompactionSummary(state);
    const prompt = getCompactionPrompt("goal_active", null, undefined, summary);
    expect(prompt).toContain("Active goal: goal-1 — Ship durable goal runtime");
    expect(prompt).toContain("Latest verifier result: FAIL — Missing restore evidence");
    expect(prompt).toContain("Queued next actions: continue goal goal-1: fix blockers");
  });

  it("should include phase-specific section for reviewing without a goal document", () => {
    const prompt = getCompactionPrompt("reviewing", null);
    expect(prompt).toContain("Active Workflow: Code Review");
    expect(prompt).toContain("resolved review target");
    expect(prompt).toContain("No changes to review");
  });

  it("should append custom instructions when provided", () => {
    const prompt = getCompactionPrompt("idle", null, "Focus on TypeScript changes");
    expect(prompt).toContain("Focus on TypeScript changes");
  });
});

describe("formatCompactSummary", () => {
  it("should strip analysis block and extract summary", () => {
    const raw = `<analysis>thinking here</analysis>\n<summary>the summary</summary>`;
    const result = formatCompactSummary(raw);
    expect(result).not.toContain("thinking here");
    expect(result).toContain("the summary");
    expect(result).not.toContain("<analysis>");
  });

  it("should handle missing tags gracefully", () => {
    const raw = "plain text summary";
    const result = formatCompactSummary(raw);
    expect(result).toBe("plain text summary");
  });
});

describe("microcompactMessages", () => {
  const now = Date.now();
  const oldTimestamp = now - MICROCOMPACT_AGE_MS - 1000;
  const recentTimestamp = now - 1000;

  it("should truncate old tool results with a stable marker", () => {
    const messages: any[] = [
      {
        role: "toolResult",
        toolCallId: "t1",
        toolName: "bash",
        content: [{ type: "text", text: "a".repeat(5000) }],
        isError: false,
        timestamp: oldTimestamp,
      },
    ];
    const result = microcompactMessages(messages, now);
    const laterResult = microcompactMessages(messages, now + 60 * 1000);
    expect(result[0].content[0].text).toBe("[Compacted] bash result");
    expect(laterResult[0].content[0].text).toBe(result[0].content[0].text);
    expect(result[0].content[0].text).not.toContain("min ago");
    expect(result[0].content[0].text.length).toBeLessThan(500);
  });

  it("should preserve recent tool results", () => {
    const messages: any[] = [
      {
        role: "toolResult",
        toolCallId: "t2",
        toolName: "bash",
        content: [{ type: "text", text: "a".repeat(5000) }],
        isError: false,
        timestamp: recentTimestamp,
      },
    ];
    const result = microcompactMessages(messages, now);
    expect(result[0].content[0].text).toBe("a".repeat(5000));
  });

  it("should preserve error tool results regardless of age", () => {
    const messages: any[] = [
      {
        role: "toolResult",
        toolCallId: "t3",
        toolName: "bash",
        content: [{ type: "text", text: "error details ".repeat(500) }],
        isError: true,
        timestamp: oldTimestamp,
      },
    ];
    const result = microcompactMessages(messages, now);
    expect(result[0].content[0].text).toContain("error details");
    expect(result[0].content[0].text.length).toBeGreaterThan(500);
  });

  it("should not modify non-toolResult messages", () => {
    const messages: any[] = [
      {
        role: "user",
        content: "hello",
        timestamp: oldTimestamp,
      },
    ];
    const result = microcompactMessages(messages, now);
    expect(result[0]).toEqual(messages[0]);
  });
});
