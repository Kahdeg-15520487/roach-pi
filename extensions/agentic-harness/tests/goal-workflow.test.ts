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
import { loadGoalState } from "../goal-state-service.js";
import { defaultGoalStateRoot } from "../goal-storage.js";
import { applyAndPersistClarificationCommand } from "../clarification-state-service.js";
import { defaultClarificationStateRoot } from "../clarification-storage.js";
import { runAgent } from "../subagent.js";

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

beforeEach(() => {
  delete process.env.PI_SUBAGENT_DEPTH;
  delete process.env.PI_TEAM_WORKER;
  process.env.PI_ENABLE_TEAM_MODE = "1";
  vi.mocked(runAgent).mockReset();
});

describe("clarify to goal workflow", () => {
  it("delegates /clarify to a gated Goal Contract handoff", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "clarify-workflow-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);

      const clarify = commands.get("clarify");
      const mockCtx: any = {
        cwd,
        runId: "clarify-workflow",
        sessionManager: { appendCustomEntry: vi.fn() },
        ui: {
          confirm: vi.fn().mockResolvedValue(true),
          setStatus: vi.fn(),
        },
      };

      await clarify.handler("rewrite workflow", mockCtx);

      expect(mockPi.sendUserMessage).toHaveBeenCalledTimes(1);
      const prompt = mockPi.sendUserMessage.mock.calls[0][0];
      expect(prompt).toContain("Goal Contract");
      expect(prompt).toContain("/goal handoff");
      expect(prompt).toContain("clarification_state");
      expect(prompt).toContain("Gate: PASS");
      expect(prompt).not.toContain(["agentic", "pl", "an", "crafting"].join("-"));
      expect(prompt).not.toContain(["agentic", "milestone", "planning"].join("-"));
      expect(prompt).not.toContain(["/", "pl", "an"].join(""));
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("auto-creates and activates latest drafted Goal Contract with /goal", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "goal-auto-contract-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-auto");
      await draftClarificationContract(cwd, "run-auto", ctx);

      await goal.handler("", ctx);

      const state = await loadGoalState("run-auto", defaultGoalStateRoot(cwd));
      expect(state.status).toBe("active");
      expect(state.activeGoalId).toBe("goal-1");
      expect(state.goals[0]).toMatchObject({
        objective: "Ship automatic goal runtime",
        successCriteria: ["/goal starts automatically"],
        evidenceRequired: ["goal workflow tests pass"],
      });
      expect(state.goals[0].subgoals).toHaveLength(2);
      const autoPrompt = mockPi.sendUserMessage.mock.calls[0][0];
      expect(autoPrompt).toContain("until the entire active goal is complete");
      expect(autoPrompt).toContain("Goal: goal-1 (Ship automatic goal runtime)");
      expect(autoPrompt).toContain("Current active subgoal: subgoal-1 (Implement auto start)");
      expect(autoPrompt).toContain("Work until the entire active goal receives verifier PASS");
      expect(autoPrompt).toContain("If a subgoal receives PASS and /goal advances to another active subgoal, continue automatically");
      expect(autoPrompt).toContain("After all subgoals receive PASS, request completion for the active goal itself");
      expect(autoPrompt).toContain("Stop only when the entire active goal receives reviewer-verifier PASS");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("does not duplicate a goal when /goal is repeated for the same contract", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "goal-auto-idempotent-"));
    try {
      const { mockPi, commands: commandMap } = createMockPi();
      extension(mockPi);
      const goal = commandMap.get("goal");
      const ctx = mockGoalCtx(cwd, "run-idempotent");
      await draftClarificationContract(cwd, "run-idempotent", ctx);

      await goal.handler("", ctx);
      await goal.handler("", ctx);

      const state = await loadGoalState("run-idempotent", defaultGoalStateRoot(cwd));
      expect(state.goals).toHaveLength(1);
      expect(state.goals[0].status).toBe("active");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("requires confirmation for high-risk contract text in suggested subgoals", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "goal-high-risk-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-high-risk");
      ctx.ui.confirm = vi.fn().mockResolvedValue(false);
      await draftClarificationContract(cwd, "run-high-risk", ctx, ["Delete production data"]);

      await goal.handler("", ctx);

      const state = await loadGoalState("run-high-risk", defaultGoalStateRoot(cwd));
      expect(ctx.ui.confirm).toHaveBeenCalledWith("Start high-risk goal?", expect.stringContaining("Ship automatic goal runtime"));
      expect(state.goals).toHaveLength(0);
      expect(mockPi.sendUserMessage).not.toHaveBeenCalledWith(expect.stringContaining("Work until verifier PASS"), expect.anything());
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("routes /goal into clarification when no active goal or contract exists", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "goal-auto-empty-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-empty");

      await goal.handler("", ctx);

      const state = await loadGoalState("run-empty", defaultGoalStateRoot(cwd));
      expect(state.goals).toHaveLength(0);
      expect(mockPi.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("no active goal and no drafted Goal Contract"), { deliverAs: "followUp" });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("completes a goal only when reviewer-verifier returns PASS", async () => {
    vi.mocked(runAgent).mockResolvedValue(verifierResult("Verdict: PASS\nSummary: Complete\nBlockers:\nCommands Run:\n- npm test\nEvidence Checked:\n- tests passed"));
    const cwd = await mkdtemp(join(tmpdir(), "goal-pass-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-pass");

      await goal.handler("create Ship verifier guard", ctx);
      await goal.handler("complete goal-1", ctx);

      const state = await loadGoalState("run-pass", defaultGoalStateRoot(cwd));
      expect(runAgent).toHaveBeenCalledTimes(1);
      expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({
        sandbox: expect.objectContaining({ enabled: true, requireApprovalForAllCommands: true }),
      }));
      expect(state.goals[0].status).toBe("completed");
      expect(state.goals[0].verifierReceipts[0]).toMatchObject({ verdict: "PASS", rawOutput: expect.stringContaining("Verdict: PASS") });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("stores FAIL verifier receipts without completing", async () => {
    vi.mocked(runAgent).mockResolvedValue(verifierResult("Verdict: FAIL\nSummary: Missing evidence\nBlockers:\n- missing test\nCommands Run:\n- npm test\nEvidence Checked:\n- none"));
    const cwd = await mkdtemp(join(tmpdir(), "goal-fail-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-fail");

      await goal.handler("create Ship verifier guard", ctx);
      await goal.handler("complete goal-1", ctx);

      const state = await loadGoalState("run-fail", defaultGoalStateRoot(cwd));
      expect(state.goals[0].status).toBe("blocked");
      expect(state.goals[0].verifierReceipts[0]).toMatchObject({ verdict: "FAIL", blockers: ["missing test"] });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("clears consumed continuation so verifier retry can proceed to PASS", async () => {
    vi.mocked(runAgent)
      .mockResolvedValueOnce(verifierResult("Verdict: FAIL\nSummary: Missing evidence\nBlockers:\n- missing test\nCommands Run:\n- npm test\nEvidence Checked:\n- none"))
      .mockResolvedValueOnce(verifierResult("Verdict: PASS\nSummary: Complete\nBlockers:\nCommands Run:\n- npm test\nEvidence Checked:\n- fixed"));
    const cwd = await mkdtemp(join(tmpdir(), "goal-retry-pass-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-retry-pass");

      await goal.handler("create Ship verifier guard", ctx);
      await goal.handler("complete goal-1", ctx);
      let state = await loadGoalState("run-retry-pass", defaultGoalStateRoot(cwd));
      expect(state.continuation.queued).toBe(true);

      await goal.handler("evidence goal-1 fixed blockers", ctx);
      await goal.handler("complete goal-1", ctx);

      state = await loadGoalState("run-retry-pass", defaultGoalStateRoot(cwd));
      expect(state.goals[0].status).toBe("completed");
      expect(state.continuation.queued).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("treats malformed verifier output as FAIL", async () => {
    vi.mocked(runAgent).mockResolvedValue(verifierResult("Summary: I think it is fine"));
    const cwd = await mkdtemp(join(tmpdir(), "goal-malformed-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-malformed");

      await goal.handler("create Ship verifier guard", ctx);
      await goal.handler("complete goal-1", ctx);

      const state = await loadGoalState("run-malformed", defaultGoalStateRoot(cwd));
      expect(state.goals[0].status).toBe("blocked");
      expect(state.goals[0].verifierReceipts[0]).toMatchObject({ verdict: "FAIL", rawOutput: "Summary: I think it is fine" });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("treats verifier process errors as FAIL", async () => {
    vi.mocked(runAgent).mockRejectedValue(new Error("spawn failed"));
    const cwd = await mkdtemp(join(tmpdir(), "goal-error-"));
    try {
      const { mockPi, commands } = createMockPi();
      extension(mockPi);
      const goal = commands.get("goal");
      const ctx = mockGoalCtx(cwd, "run-error");

      await goal.handler("create Ship verifier guard", ctx);
      await goal.handler("complete goal-1", ctx);

      const state = await loadGoalState("run-error", defaultGoalStateRoot(cwd));
      expect(state.goals[0].status).toBe("blocked");
      expect(state.goals[0].verifierReceipts[0]).toMatchObject({ verdict: "FAIL", rawOutput: "spawn failed" });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

async function draftClarificationContract(cwd: string, runId: string, ctx: any, suggestedSubgoals = ["Implement auto start", "Verify idempotency"]) {
  const rootDir = defaultClarificationStateRoot(cwd);
  const now = "2026-05-29T00:00:00.000Z";
  await applyAndPersistClarificationCommand(runId, rootDir, { type: "start_interview", topic: "auto goal" }, ctx, now);
  const checklist = ["objective", "scope", "non_goals", "constraints", "success_criteria", "evidence_required", "risks", "edge_cases", "technical_context"] as const;
  for (const id of checklist) {
    await applyAndPersistClarificationCommand(runId, rootDir, { type: "mark_checklist_item", id, value: `${id} clarified` }, ctx, now);
  }
  await applyAndPersistClarificationCommand(runId, rootDir, {
    type: "draft_goal_contract",
    contract: {
      objective: "Ship automatic goal runtime",
      scope: ["auto create", "auto activate"],
      nonGoals: ["legacy workflow"],
      successCriteria: ["/goal starts automatically"],
      constraints: ["no manual create"],
      evidenceRequired: ["goal workflow tests pass"],
      risks: ["duplicate goals"],
      suggestedSubgoals,
      handoffCommand: "/goal",
    },
  }, ctx, now);
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
