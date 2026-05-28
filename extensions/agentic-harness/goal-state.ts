import { createHash } from "node:crypto";

export const GOAL_STATE_SCHEMA_VERSION = 1;

export type GoalRunStatus = "idle" | "active" | "paused" | "completed" | "failed" | "cancelled";
export type GoalStatus = "queued" | "active" | "blocked" | "verifying" | "completed" | "failed" | "cancelled";
export type SubgoalStatus = "queued" | "active" | "implemented" | "verifying" | "completed" | "failed" | "blocked" | "cancelled";
export type GoalPriority = "high" | "medium" | "low";

export interface GoalContinuationState {
  queued: boolean;
  targetType?: "goal" | "subgoal";
  targetId?: string;
  reason?: string;
  blockers: string[];
  consecutiveFailures: Record<string, number>;
  leaseId?: string;
  updatedAt?: string;
}

export interface GoalState {
  schemaVersion: 1;
  runId: string;
  status: GoalRunStatus;
  activeGoalId?: string;
  goals: GoalItem[];
  ledger: GoalLedgerEntry[];
  continuation: GoalContinuationState;
  createdAt: string;
  updatedAt: string;
}

export interface GoalItem {
  id: string;
  title: string;
  objective: string;
  status: GoalStatus;
  priority: GoalPriority;
  successCriteria: string[];
  constraints: string[];
  evidenceRequired: string[];
  evidence: string[];
  subgoals: SubgoalItem[];
  activeSubgoalId?: string;
  verifierReceipts: GoalVerifierReceipt[];
  blockers: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SubgoalItem {
  id: string;
  goalId: string;
  title: string;
  objective: string;
  status: SubgoalStatus;
  dependencies: string[];
  evidence: string[];
  attempts: number;
  verifierReceipts: GoalVerifierReceipt[];
  blockers: string[];
  createdAt: string;
  updatedAt: string;
}

export interface GoalVerifierReceipt {
  id: string;
  targetType: "goal" | "subgoal";
  targetId: string;
  objectiveHash: string;
  verdict: "PASS" | "FAIL";
  verifiedAt: string;
  verifierAgent: "reviewer-verifier";
  summary: string;
  blockers: string[];
  commandsRun: string[];
  evidence: string[];
  rawOutput: string;
}

export interface GoalLedgerEntry {
  seq: number;
  type:
    | "goal_created"
    | "goal_activated"
    | "subgoal_created"
    | "evidence_added"
    | "completion_requested"
    | "verifier_started"
    | "verifier_pass"
    | "verifier_fail"
    | "continuation_queued"
    | "goal_completed"
    | "goal_paused"
    | "goal_resumed"
    | "goal_cancelled"
    | "goal_cleared";
  goalId?: string;
  subgoalId?: string;
  message: string;
  createdAt: string;
  data?: Record<string, unknown>;
}

export type GoalCommand =
  | {
      type: "create_goal";
      goal: {
        id: string;
        title: string;
        objective: string;
        priority?: GoalPriority;
        successCriteria?: string[];
        constraints?: string[];
        evidenceRequired?: string[];
      };
    }
  | { type: "activate_goal"; goalId: string }
  | {
      type: "create_subgoal";
      subgoal: {
        id: string;
        goalId: string;
        title: string;
        objective: string;
        dependencies?: string[];
      };
    }
  | { type: "add_evidence"; targetType: "goal" | "subgoal"; targetId: string; evidence: string }
  | { type: "request_completion"; targetType: "goal" | "subgoal"; targetId: string }
  | { type: "record_verifier_result"; receipt: GoalVerifierReceipt }
  | { type: "complete_target"; targetType: "goal" | "subgoal"; targetId: string }
  | { type: "pause_goal"; goalId?: string }
  | { type: "resume_goal"; goalId?: string }
  | { type: "cancel_goal"; goalId?: string }
  | { type: "clear_state" }
  | {
      type: "queue_continuation";
      targetType?: "goal" | "subgoal";
      targetId?: string;
      reason: string;
      blockers?: string[];
      leaseId?: string;
    }
  | { type: "clear_continuation" };

export interface GoalReducerResult {
  state: GoalState;
  ledgerEntry?: GoalLedgerEntry;
}

export class GoalInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoalInvariantError";
  }
}

export function createGoalState(runId: string, now: string): GoalState {
  return {
    schemaVersion: GOAL_STATE_SCHEMA_VERSION,
    runId,
    status: "idle",
    goals: [],
    ledger: [],
    continuation: {
      queued: false,
      blockers: [],
      consecutiveFailures: {},
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function applyGoalCommand(
  state: GoalState,
  command: GoalCommand,
  options: { now: string },
): GoalReducerResult {
  const now = options.now;
  const next = cloneState(state);
  next.updatedAt = now;

  switch (command.type) {
    case "create_goal": {
      if (next.goals.some((goal) => goal.id === command.goal.id)) {
        throw new Error(`Goal ${command.goal.id} already exists`);
      }
      const goal: GoalItem = {
        id: command.goal.id,
        title: command.goal.title,
        objective: command.goal.objective,
        status: "queued",
        priority: command.goal.priority ?? "medium",
        successCriteria: [...(command.goal.successCriteria ?? [])],
        constraints: [...(command.goal.constraints ?? [])],
        evidenceRequired: [...(command.goal.evidenceRequired ?? [])],
        evidence: [],
        subgoals: [],
        verifierReceipts: [],
        blockers: [],
        createdAt: now,
        updatedAt: now,
      };
      next.goals.push(goal);
      return withLedger(next, {
        type: "goal_created",
        goalId: goal.id,
        message: `Created goal ${goal.id}`,
        createdAt: now,
      });
    }

    case "activate_goal": {
      const goal = getGoal(next, command.goalId);
      next.goals = next.goals.map((candidate) => ({
        ...candidate,
        status: candidate.id === goal.id ? "active" : candidate.status === "active" ? "queued" : candidate.status,
        updatedAt: candidate.id === goal.id ? now : candidate.updatedAt,
      }));
      next.status = "active";
      next.activeGoalId = goal.id;
      return withLedger(next, {
        type: "goal_activated",
        goalId: goal.id,
        message: `Activated goal ${goal.id}`,
        createdAt: now,
      });
    }

    case "create_subgoal": {
      const goal = getGoal(next, command.subgoal.goalId);
      if (goal.subgoals.some((subgoal) => subgoal.id === command.subgoal.id)) {
        throw new Error(`Subgoal ${command.subgoal.id} already exists`);
      }
      const subgoal: SubgoalItem = {
        id: command.subgoal.id,
        goalId: goal.id,
        title: command.subgoal.title,
        objective: command.subgoal.objective,
        status: goal.activeSubgoalId ? "queued" : "active",
        dependencies: [...(command.subgoal.dependencies ?? [])],
        evidence: [],
        attempts: 0,
        verifierReceipts: [],
        blockers: [],
        createdAt: now,
        updatedAt: now,
      };
      goal.subgoals.push(subgoal);
      goal.activeSubgoalId = goal.activeSubgoalId ?? subgoal.id;
      goal.updatedAt = now;
      return withLedger(next, {
        type: "subgoal_created",
        goalId: goal.id,
        subgoalId: subgoal.id,
        message: `Created subgoal ${subgoal.id}`,
        createdAt: now,
      });
    }

    case "add_evidence": {
      const target = getTarget(next, command.targetType, command.targetId);
      if (target.type === "goal") {
        target.goal.evidence.push(command.evidence);
        target.goal.blockers = [];
        target.goal.updatedAt = now;
      } else {
        target.subgoal.evidence.push(command.evidence);
        target.subgoal.blockers = [];
        target.subgoal.updatedAt = now;
      }
      return withLedger(next, {
        type: "evidence_added",
        goalId: target.goal.id,
        subgoalId: target.type === "subgoal" ? target.subgoal.id : undefined,
        message: command.evidence,
        createdAt: now,
      });
    }

    case "request_completion": {
      const target = getTarget(next, command.targetType, command.targetId);
      if (target.type === "goal") {
        target.goal.status = "verifying";
        target.goal.updatedAt = now;
      } else {
        target.subgoal.status = "verifying";
        target.subgoal.attempts += 1;
        target.subgoal.updatedAt = now;
      }
      return withLedger(next, {
        type: "completion_requested",
        goalId: target.goal.id,
        subgoalId: target.type === "subgoal" ? target.subgoal.id : undefined,
        message: `Completion requested for ${command.targetType} ${command.targetId}`,
        createdAt: now,
      });
    }

    case "record_verifier_result": {
      const target = getTarget(next, command.receipt.targetType, command.receipt.targetId);
      if (target.type === "goal") {
        target.goal.verifierReceipts.push(cloneReceipt(command.receipt));
        target.goal.status = command.receipt.verdict === "PASS" ? "verifying" : "blocked";
        target.goal.blockers = [...command.receipt.blockers];
        target.goal.updatedAt = now;
      } else {
        target.subgoal.verifierReceipts.push(cloneReceipt(command.receipt));
        target.subgoal.status = command.receipt.verdict === "PASS" ? "verifying" : "blocked";
        target.subgoal.blockers = [...command.receipt.blockers];
        target.subgoal.updatedAt = now;
      }
      const ledgerType = command.receipt.verdict === "PASS" ? "verifier_pass" : "verifier_fail";
      return withLedger(next, {
        type: ledgerType,
        goalId: target.goal.id,
        subgoalId: target.type === "subgoal" ? target.subgoal.id : undefined,
        message: command.receipt.summary,
        createdAt: now,
        data: { receiptId: command.receipt.id },
      });
    }

    case "complete_target": {
      const target = getTarget(next, command.targetType, command.targetId);
      assertCompletionInvariant(next, target);
      if (target.type === "goal") {
        target.goal.status = "completed";
        target.goal.updatedAt = now;
        if (next.activeGoalId === target.goal.id) {
          const nextGoal = next.goals.find((goal) => goal.status === "queued");
          if (nextGoal) {
            nextGoal.status = "active";
            nextGoal.updatedAt = now;
            next.activeGoalId = nextGoal.id;
            next.status = "active";
          }
        }
      } else {
        target.subgoal.status = "completed";
        target.subgoal.updatedAt = now;
        activateNextRunnableSubgoal(target.goal, now);
      }
      if (next.goals.length > 0 && next.goals.every((goal) => goal.status === "completed")) {
        next.status = "completed";
        delete next.activeGoalId;
      }
      return withLedger(next, {
        type: "goal_completed",
        goalId: target.goal.id,
        subgoalId: target.type === "subgoal" ? target.subgoal.id : undefined,
        message: `Completed ${command.targetType} ${command.targetId}`,
        createdAt: now,
      });
    }

    case "pause_goal": {
      const goal = getGoal(next, command.goalId ?? next.activeGoalId ?? "");
      goal.status = "blocked";
      goal.updatedAt = now;
      next.status = "paused";
      return withLedger(next, {
        type: "goal_paused",
        goalId: goal.id,
        message: `Paused goal ${goal.id}`,
        createdAt: now,
      });
    }

    case "resume_goal": {
      const goal = getGoal(next, command.goalId ?? next.activeGoalId ?? "");
      goal.status = "active";
      goal.updatedAt = now;
      next.status = "active";
      next.activeGoalId = goal.id;
      return withLedger(next, {
        type: "goal_resumed",
        goalId: goal.id,
        message: `Resumed goal ${goal.id}`,
        createdAt: now,
      });
    }

    case "cancel_goal": {
      const goal = getGoal(next, command.goalId ?? next.activeGoalId ?? "");
      goal.status = "cancelled";
      goal.updatedAt = now;
      if (next.activeGoalId === goal.id) {
        delete next.activeGoalId;
      }
      if (next.goals.every((candidate) => candidate.status === "cancelled" || candidate.status === "completed")) {
        next.status = "cancelled";
      }
      return withLedger(next, {
        type: "goal_cancelled",
        goalId: goal.id,
        message: `Cancelled goal ${goal.id}`,
        createdAt: now,
      });
    }

    case "clear_state": {
      return withLedger(createGoalState(next.runId, now), {
        type: "goal_cleared",
        message: "Cleared goal runtime state",
        createdAt: now,
      });
    }

    case "queue_continuation": {
      next.continuation = {
        ...next.continuation,
        queued: true,
        targetType: command.targetType,
        targetId: command.targetId,
        reason: command.reason,
        blockers: [...(command.blockers ?? [])],
        leaseId: command.leaseId,
        updatedAt: now,
      };
      return withLedger(next, {
        type: "continuation_queued",
        message: command.reason,
        createdAt: now,
        data: { targetType: command.targetType, targetId: command.targetId },
      });
    }

    case "clear_continuation": {
      next.continuation = {
        queued: false,
        blockers: [],
        consecutiveFailures: { ...next.continuation.consecutiveFailures },
        updatedAt: now,
      };
      return { state: next };
    }
  }
}

function cloneState(state: GoalState): GoalState {
  return {
    ...state,
    goals: state.goals.map((goal) => ({
      ...goal,
      successCriteria: [...goal.successCriteria],
      constraints: [...goal.constraints],
      evidenceRequired: [...goal.evidenceRequired],
      evidence: [...(goal.evidence ?? [])],
      subgoals: goal.subgoals.map((subgoal) => ({
        ...subgoal,
        dependencies: [...subgoal.dependencies],
        evidence: [...subgoal.evidence],
        verifierReceipts: subgoal.verifierReceipts.map(cloneReceipt),
        blockers: [...subgoal.blockers],
      })),
      verifierReceipts: goal.verifierReceipts.map(cloneReceipt),
      blockers: [...goal.blockers],
    })),
    ledger: state.ledger.map((entry) => ({ ...entry, data: entry.data ? { ...entry.data } : undefined })),
    continuation: {
      ...state.continuation,
      blockers: [...state.continuation.blockers],
      consecutiveFailures: { ...state.continuation.consecutiveFailures },
    },
  };
}

function cloneReceipt(receipt: GoalVerifierReceipt): GoalVerifierReceipt {
  return {
    ...receipt,
    blockers: [...receipt.blockers],
    commandsRun: [...receipt.commandsRun],
    evidence: [...receipt.evidence],
  };
}

function withLedger(
  state: GoalState,
  entry: Omit<GoalLedgerEntry, "seq">,
): GoalReducerResult {
  const ledgerEntry: GoalLedgerEntry = {
    ...entry,
    seq: state.ledger.length + 1,
  };
  return {
    state: {
      ...state,
      ledger: [...state.ledger, ledgerEntry],
    },
    ledgerEntry,
  };
}

function getGoal(state: GoalState, goalId: string): GoalItem {
  const goal = state.goals.find((candidate) => candidate.id === goalId);
  if (!goal) {
    throw new Error(`Goal ${goalId} not found`);
  }
  return goal;
}

type GoalTarget = { type: "goal"; goal: GoalItem } | { type: "subgoal"; goal: GoalItem; subgoal: SubgoalItem };

function getTarget(state: GoalState, targetType: "goal" | "subgoal", targetId: string): GoalTarget {
  if (targetType === "goal") {
    return { type: "goal", goal: getGoal(state, targetId) };
  }
  for (const goal of state.goals) {
    const subgoal = goal.subgoals.find((candidate) => candidate.id === targetId);
    if (subgoal) {
      return { type: "subgoal", goal, subgoal };
    }
  }
  throw new Error(`Subgoal ${targetId} not found`);
}

export function buildGoalObjectiveHash(goal: GoalItem, subgoal?: SubgoalItem): string {
  const payload = subgoal
    ? {
        targetType: "subgoal",
        targetId: subgoal.id,
        objective: subgoal.objective,
        successCriteria: goal.successCriteria,
        evidenceRequired: goal.evidenceRequired,
        evidence: subgoal.evidence,
      }
    : {
        targetType: "goal",
        targetId: goal.id,
        objective: goal.objective,
        successCriteria: goal.successCriteria,
        evidenceRequired: goal.evidenceRequired,
        evidence: goal.evidence,
      };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function assertCompletionInvariant(state: GoalState, target: GoalTarget): void {
  const targetType = target.type;
  const targetId = target.type === "goal" ? target.goal.id : target.subgoal.id;
  const receipts = target.type === "goal" ? target.goal.verifierReceipts : target.subgoal.verifierReceipts;
  const latestReceipt = receipts.at(-1);

  if (!latestReceipt || latestReceipt.verdict !== "PASS") {
    throw new GoalInvariantError(`Cannot complete ${targetType} ${targetId}: latest verifier receipt is not PASS`);
  }
  if (latestReceipt.targetType !== targetType || latestReceipt.targetId !== targetId) {
    throw new GoalInvariantError(`Cannot complete ${targetType} ${targetId}: verifier receipt target mismatch`);
  }

  const expectedHash = target.type === "goal"
    ? buildGoalObjectiveHash(target.goal)
    : buildGoalObjectiveHash(target.goal, target.subgoal);
  if (latestReceipt.objectiveHash !== expectedHash) {
    throw new GoalInvariantError(`Cannot complete ${targetType} ${targetId}: verifier receipt objective hash is stale`);
  }

  const verifierPassEntry = [...state.ledger].reverse().find((entry) =>
    entry.type === "verifier_pass"
    && entry.data?.receiptId === latestReceipt.id
    && entryMatchesTarget(entry, targetType, target.goal.id, target.type === "subgoal" ? target.subgoal.id : undefined)
  );
  if (!verifierPassEntry) {
    throw new GoalInvariantError(`Cannot complete ${targetType} ${targetId}: verifier PASS ledger entry is missing`);
  }

  const staleEntry = state.ledger.find((entry) =>
    entry.seq > verifierPassEntry.seq
    && (entry.type === "evidence_added" || entry.type === "subgoal_created" || entry.type === "completion_requested")
    && entryMatchesTarget(entry, targetType, target.goal.id, target.type === "subgoal" ? target.subgoal.id : undefined)
  );
  if (staleEntry) {
    throw new GoalInvariantError(`Cannot complete ${targetType} ${targetId}: verifier receipt is stale after ${staleEntry.type}`);
  }
}

function entryMatchesTarget(
  entry: GoalLedgerEntry,
  targetType: "goal" | "subgoal",
  goalId: string,
  subgoalId: string | undefined,
): boolean {
  if (targetType === "goal") {
    return entry.goalId === goalId && entry.subgoalId === undefined;
  }
  return entry.goalId === goalId && entry.subgoalId === subgoalId;
}

function activateNextRunnableSubgoal(goal: GoalItem, now: string): void {
  if (goal.activeSubgoalId && goal.subgoals.some((subgoal) => subgoal.id === goal.activeSubgoalId && subgoal.status !== "completed")) {
    return;
  }
  const nextSubgoal = goal.subgoals.find((subgoal) =>
    subgoal.status === "queued" && subgoal.dependencies.every((dependencyId) =>
      goal.subgoals.some((candidate) => candidate.id === dependencyId && candidate.status === "completed")
    )
  );
  if (nextSubgoal) {
    nextSubgoal.status = "active";
    nextSubgoal.updatedAt = now;
    goal.activeSubgoalId = nextSubgoal.id;
  } else {
    delete goal.activeSubgoalId;
  }
}
