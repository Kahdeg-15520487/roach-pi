import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@mariozechner/pi-coding-agent", () => ({
  createBashTool: vi.fn(() => ({
    name: "bash",
    label: "bash",
    description: "mock bash",
    parameters: {},
    execute: vi.fn(),
  })),
  isToolCallEventType: (toolName: string, event: any) => event?.toolName === toolName,
  keyHint: (k: string, d?: string) => `${k}${d ? ` ${d}` : ""}`,
  keyText: (t: string) => t,
  rawKeyHint: (k: string, d?: string) => `${k}${d ? ` ${d}` : ""}`,
  convertToLlm: vi.fn((x: unknown) => x),
}));

vi.mock("@mariozechner/pi-tui", () => ({
  Text: class MockText {},
  truncateToWidth: (text: string, width?: number) => typeof width === "number" ? text.slice(0, width) : text,
  visibleWidth: (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "").length,
}));

vi.mock("@mariozechner/pi-ai", () => ({
  complete: vi.fn(),
}));

vi.mock("../subagent.js", async () => {
  const actual = await vi.importActual<typeof import("../subagent.js")>("../subagent.js");
  return {
    ...actual,
    runAgent: vi.fn(),
  };
});

vi.mock("../ui-settings.js", () => ({
  resolveAgenticUiSettings: vi.fn(() => ({ footerPreset: "compact", footerGlyphs: "plain" })),
}));

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import extension from "../index.js";
import { applyGoalCommand, createGoalState, type GoalItem, type GoalVerifierReceipt } from "../goal-state.js";
import { defaultGoalStateRoot } from "../goal-storage.js";
import { loadGoalState } from "../goal-state-service.js";
import { buildGoalVerifierReceipt, getGoalVerifierTarget, parseGoalVerifierOutput } from "../goal-verifier.js";
import { planGoalContinuation } from "../goal-continuation.js";
import { runAgent } from "../subagent.js";

const START = "2026-05-28T00:00:00.000Z";

beforeEach(() => {
  delete process.env.PI_SUBAGENT_DEPTH;
  delete process.env.PI_TEAM_WORKER;
  process.env.PI_ENABLE_TEAM_MODE = "1";
  vi.mocked(runAgent).mockReset();
});

describe("goal continuation", () => {
  it("sends a FAIL follow-up with blockers", async () => {
    vi.mocked(runAgent).mockResolvedValue(verifierResult("Verdict: FAIL\nSummary: Missing evidence\nBlockers:\n- missing test\nCommands Run:\n- npm test\nEvidence Checked:\n- none"));
    const cwd = await mkdtemp(join(tmpdir(), "goal-continuation-fail-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-continuation-fail");

      await goal.handler("create Ship continuation", ctx);
      await goal.handler("complete goal-1", ctx);

      const state = await loadGoalState("run-continuation-fail", defaultGoalStateRoot(cwd));
      expect(state.continuation).toMatchObject({ queued: true, targetType: "goal", targetId: "goal-1", blockers: ["missing test"] });
      expect(mockPi.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("missing test"), { deliverAs: "followUp" });
      expect(mockPi.sendUserMessage.mock.calls.at(-1)?.[0]).toContain("Do not claim complete");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("sends a PASS follow-up for the next runnable target", async () => {
    vi.mocked(runAgent).mockResolvedValue(verifierResult("Verdict: PASS\nSummary: Complete\nBlockers:\nCommands Run:\n- npm test\nEvidence Checked:\n- tests passed"));
    const cwd = await mkdtemp(join(tmpdir(), "goal-continuation-pass-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-continuation-pass");

      await goal.handler("create Ship continuation", ctx);
      await goal.handler("activate goal-1", ctx);
      await goal.handler("subgoal goal-1 First target", ctx);
      await goal.handler("subgoal goal-1 Second target", ctx);
      await goal.handler("complete subgoal-1", ctx);

      const state = await loadGoalState("run-continuation-pass", defaultGoalStateRoot(cwd));
      expect(state.goals[0].activeSubgoalId).toBe("subgoal-2");
      expect(state.continuation).toMatchObject({ queued: true, targetType: "subgoal", targetId: "subgoal-2" });
      expect(mockPi.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("Next subgoal: subgoal-2"), { deliverAs: "followUp" });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("sends a PASS follow-up for parent goal after final subgoal completes", () => {
    let state = stateWithGoal();
    state = applyGoalCommand(state, { type: "activate_goal", goalId: "goal-1" }, { now: START }).state;
    state = applyGoalCommand(state, {
      type: "create_subgoal",
      subgoal: { id: "subgoal-1", goalId: "goal-1", title: "Only target", objective: "Finish only subgoal" },
    }, { now: START }).state;
    const target = getGoalVerifierTarget(state, "subgoal", "subgoal-1");
    const receipt = buildGoalVerifierReceipt(target, parseGoalVerifierOutput("Verdict: PASS\nSummary: Complete"), {
      id: "receipt-pass",
      verifiedAt: "2026-05-28T00:01:00.000Z",
    });
    state = applyGoalCommand(state, { type: "record_verifier_result", receipt }, { now: "2026-05-28T00:01:00.000Z" }).state;
    state = applyGoalCommand(state, { type: "complete_target", targetType: "subgoal", targetId: "subgoal-1" }, { now: "2026-05-28T00:02:00.000Z" }).state;

    const decision = planGoalContinuation(state, receipt, rootContext());

    expect(decision).toMatchObject({ action: "follow_up", reason: "next_target", targetType: "goal", targetId: "goal-1" });
    expect(decision.action === "follow_up" ? decision.prompt : "").toContain("Next goal: goal-1");
  });

  it("does not duplicate follow-up when a lease exists", () => {
    const { state, receipt } = stateWithFailReceipt();
    const leased = {
      ...state,
      continuation: {
        ...state.continuation,
        queued: true,
        leaseId: "existing-lease",
      },
    };

    expect(planGoalContinuation(leased, receipt, rootContext())).toEqual({ action: "none", reason: "continuation already queued" });
  });

  it("does not continue in subagent depth greater than zero", () => {
    const { state, receipt } = stateWithFailReceipt();

    expect(planGoalContinuation(state, receipt, { ...rootContext(), subagentDepth: 1 })).toEqual({ action: "none", reason: "subagent context" });
  });

  it("stops automation at the max failure budget", () => {
    let state = stateWithGoal();
    let latestReceipt!: GoalVerifierReceipt;
    for (let index = 1; index <= 3; index += 1) {
      latestReceipt = failReceipt(state.goals[0], `receipt-${index}`);
      state = applyGoalCommand(state, {
        type: "record_verifier_result",
        receipt: latestReceipt,
      }, { now: `2026-05-28T00:0${index}:00.000Z` }).state;
    }

    expect(planGoalContinuation(state, latestReceipt, rootContext())).toEqual({ action: "none", reason: "max verifier failures reached" });
  });
});

function createMockPi() {
  const commands = new Map<string, any>();
  const events = new Map<string, any[]>();

  const mockPi: any = {
    registerTool: vi.fn(),
    registerCommand: (name: string, def: any) => {
      commands.set(name, def);
    },
    on: (event: string, handler: any) => {
      if (!events.has(event)) events.set(event, []);
      events.get(event)!.push(handler);
    },
    sendUserMessage: vi.fn(),
  };

  return { mockPi, commands, events };
}

function mockGoalCtx(cwd: string, runId: string) {
  return {
    cwd,
    runId,
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
    },
    sessionManager: {
      appendCustomEntry: vi.fn(),
    },
  };
}

function verifierResult(text: string): any {
  return {
    agent: "reviewer-verifier",
    agentSource: "bundled",
    task: "verify",
    exitCode: 0,
    messages: [{ role: "assistant", content: [{ type: "text", text }] }],
    stderr: "",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
  };
}

function rootContext() {
  return { isRootSession: true, isTeamWorker: false, subagentDepth: 0 };
}

function stateWithGoal() {
  return applyGoalCommand(createGoalState("run-1", START), {
    type: "create_goal",
    goal: {
      id: "goal-1",
      title: "Goal 1",
      objective: "Ship continuation loop",
      successCriteria: ["Continuation works"],
      evidenceRequired: ["Tests pass"],
    },
  }, { now: START }).state;
}

function stateWithFailReceipt() {
  let state = stateWithGoal();
  const receipt = failReceipt(state.goals[0], "receipt-fail");
  state = applyGoalCommand(state, {
    type: "record_verifier_result",
    receipt,
  }, { now: "2026-05-28T00:01:00.000Z" }).state;
  return { state, receipt };
}

function failReceipt(goal: GoalItem, id: string): GoalVerifierReceipt {
  const target = getGoalVerifierTarget({ ...stateWithGoal(), goals: [goal] }, "goal", goal.id);
  return buildGoalVerifierReceipt(target, parseGoalVerifierOutput("Verdict: FAIL\nSummary: Missing evidence\nBlockers:\n- missing test"), {
    id,
    verifiedAt: "2026-05-28T00:01:00.000Z",
  });
}
