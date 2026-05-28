import { applyGoalCommand, createGoalState, type GoalCommand, type GoalState } from "./goal-state.js";
import { goalStateSnapshotPath, readGoalStateSnapshot } from "./goal-storage.js";

export const GOAL_STATE_EVENT_CUSTOM_TYPE = "goal-state-event";

export interface GoalStateReplayEvent {
  runId: string;
  command: GoalCommand;
  createdAt: string;
}

export interface GoalStateRestoreResult {
  state: GoalState;
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isTargetType(value: unknown): value is "goal" | "subgoal" {
  return value === "goal" || value === "subgoal";
}

function isPriority(value: unknown): boolean {
  return value === "high" || value === "medium" || value === "low";
}

function isVerifierReceipt(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === "string"
    && isTargetType(value.targetType)
    && typeof value.targetId === "string"
    && typeof value.objectiveHash === "string"
    && (value.verdict === "PASS" || value.verdict === "FAIL")
    && typeof value.verifiedAt === "string"
    && value.verifierAgent === "reviewer-verifier"
    && typeof value.summary === "string"
    && isStringArray(value.blockers)
    && isStringArray(value.commandsRun)
    && isStringArray(value.evidence)
    && typeof value.rawOutput === "string";
}

export function isGoalCommand(value: unknown): value is GoalCommand {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }

  switch (value.type) {
    case "create_goal": {
      const goal = value.goal;
      return isRecord(goal)
        && typeof goal.id === "string"
        && typeof goal.title === "string"
        && typeof goal.objective === "string"
        && (goal.priority === undefined || isPriority(goal.priority))
        && (goal.successCriteria === undefined || isStringArray(goal.successCriteria))
        && (goal.constraints === undefined || isStringArray(goal.constraints))
        && (goal.evidenceRequired === undefined || isStringArray(goal.evidenceRequired));
    }
    case "activate_goal":
      return typeof value.goalId === "string";
    case "create_subgoal": {
      const subgoal = value.subgoal;
      return isRecord(subgoal)
        && typeof subgoal.id === "string"
        && typeof subgoal.goalId === "string"
        && typeof subgoal.title === "string"
        && typeof subgoal.objective === "string"
        && (subgoal.dependencies === undefined || isStringArray(subgoal.dependencies));
    }
    case "add_evidence":
      return isTargetType(value.targetType) && typeof value.targetId === "string" && typeof value.evidence === "string";
    case "request_completion":
    case "complete_target":
      return isTargetType(value.targetType) && typeof value.targetId === "string";
    case "record_verifier_result":
      return isVerifierReceipt(value.receipt);
    case "pause_goal":
    case "resume_goal":
    case "cancel_goal":
      return value.goalId === undefined || typeof value.goalId === "string";
    case "queue_continuation":
      return (value.targetType === undefined || isTargetType(value.targetType))
        && (value.targetId === undefined || typeof value.targetId === "string")
        && typeof value.reason === "string"
        && (value.blockers === undefined || isStringArray(value.blockers))
        && (value.leaseId === undefined || typeof value.leaseId === "string");
    case "clear_state":
    case "clear_continuation":
      return true;
    default:
      return false;
  }
}

export function createGoalStateReplayEvent(
  runId: string,
  command: GoalCommand,
  options: { now?: string } = {},
): GoalStateReplayEvent {
  return {
    runId,
    command,
    createdAt: options.now || new Date().toISOString(),
  };
}

export function isGoalStateReplayEvent(value: unknown): value is GoalStateReplayEvent {
  return isRecord(value)
    && typeof value.runId === "string"
    && typeof value.createdAt === "string"
    && isGoalCommand(value.command);
}

export function extractGoalStateReplayEventsFromSessionEntries(entries: unknown[]): GoalStateReplayEvent[] {
  return entries.flatMap((entry) => {
    if (!isRecord(entry) || entry.type !== "custom" || entry.customType !== GOAL_STATE_EVENT_CUSTOM_TYPE) {
      return [];
    }
    return isGoalStateReplayEvent(entry.data) ? [entry.data] : [];
  });
}

export function sortGoalStateReplayEvents(events: GoalStateReplayEvent[]): GoalStateReplayEvent[] {
  return [...events].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function replayGoalStateEvents(
  baseState: GoalState,
  events: unknown[],
  options: { snapshotWrittenAt?: string } = {},
): GoalStateRestoreResult {
  const errors: string[] = [];
  const validEvents: GoalStateReplayEvent[] = [];

  events.forEach((event, index) => {
    if (!isGoalStateReplayEvent(event)) {
      errors.push(`Ignored invalid goal-state-event at index ${index}`);
      return;
    }
    if (event.runId !== baseState.runId) {
      return;
    }
    if (options.snapshotWrittenAt && event.createdAt <= options.snapshotWrittenAt) {
      return;
    }
    validEvents.push(event);
  });

  const state = sortGoalStateReplayEvents(validEvents).reduce((current, event) => {
    try {
      return applyGoalCommand(current, event.command, { now: event.createdAt }).state;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Ignored goal-state-event at ${event.createdAt}: ${message}`);
      return current;
    }
  }, baseState);

  return { state, errors };
}

export async function restoreGoalStateFromSnapshotAndEvents(
  rootDir: string,
  runId: string,
  events: unknown[],
): Promise<GoalStateRestoreResult> {
  const snapshot = await readGoalStateSnapshot(goalStateSnapshotPath(rootDir, runId));
  const fallbackCreatedAt = sortGoalStateReplayEvents(events.filter(isGoalStateReplayEvent)).find((event) => event.runId === runId)?.createdAt
    || new Date().toISOString();
  const baseState = snapshot?.state ?? createGoalState(runId, fallbackCreatedAt);
  return replayGoalStateEvents(baseState, events, { snapshotWrittenAt: snapshot?.writtenAt });
}
