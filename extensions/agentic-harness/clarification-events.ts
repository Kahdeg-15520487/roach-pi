import {
  applyClarificationCommand,
  createClarificationState,
  REQUIRED_CLARIFICATION_CHECKLIST,
  type ClarificationChecklistId,
  type ClarificationCommand,
  type ClarificationState,
} from "./clarification-state.js";
import { clarificationStateSnapshotPath, readClarificationStateSnapshot } from "./clarification-storage.js";

export const CLARIFICATION_STATE_EVENT_CUSTOM_TYPE = "clarification-state-event";

export interface ClarificationStateReplayEvent {
  runId: string;
  command: ClarificationCommand;
  createdAt: string;
}

export interface ClarificationStateRestoreResult {
  state: ClarificationState;
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isChecklistId(value: unknown): value is ClarificationChecklistId {
  return typeof value === "string" && (REQUIRED_CLARIFICATION_CHECKLIST as readonly string[]).includes(value);
}

function isChecklistStatus(value: unknown): boolean {
  return value === undefined || value === "open" || value === "complete" || value === "accepted_risk";
}

export function isClarificationCommand(value: unknown): value is ClarificationCommand {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "start_interview":
      return typeof value.topic === "string";
    case "record_answer":
      return typeof value.id === "string" && typeof value.question === "string" && typeof value.answer === "string";
    case "record_exploration_finding":
      return typeof value.id === "string"
        && typeof value.topic === "string"
        && typeof value.summary === "string"
        && (value.files === undefined || isStringArray(value.files));
    case "mark_checklist_item":
      return isChecklistId(value.id) && typeof value.value === "string" && isChecklistStatus(value.status);
    case "add_ambiguity":
      return typeof value.id === "string" && typeof value.question === "string" && (value.blocking === undefined || typeof value.blocking === "boolean");
    case "resolve_ambiguity":
      return typeof value.id === "string" && typeof value.resolution === "string";
    case "accept_risk":
      return typeof value.id === "string" && typeof value.reason === "string";
    case "draft_goal_contract": {
      const contract = value.contract;
      return isRecord(contract)
        && typeof contract.objective === "string"
        && isStringArray(contract.scope)
        && isStringArray(contract.nonGoals)
        && isStringArray(contract.successCriteria)
        && isStringArray(contract.constraints)
        && isStringArray(contract.evidenceRequired)
        && isStringArray(contract.risks)
        && isStringArray(contract.suggestedSubgoals)
        && typeof contract.handoffCommand === "string";
    }
    case "cancel_interview":
      return true;
    default:
      return false;
  }
}

export function createClarificationStateReplayEvent(
  runId: string,
  command: ClarificationCommand,
  options: { now?: string } = {},
): ClarificationStateReplayEvent {
  return { runId, command, createdAt: options.now || new Date().toISOString() };
}

export function isClarificationStateReplayEvent(value: unknown): value is ClarificationStateReplayEvent {
  return isRecord(value)
    && typeof value.runId === "string"
    && typeof value.createdAt === "string"
    && isClarificationCommand(value.command);
}

export function extractClarificationStateReplayEventsFromSessionEntries(entries: unknown[]): ClarificationStateReplayEvent[] {
  return entries.flatMap((entry) => {
    if (!isRecord(entry) || entry.type !== "custom" || entry.customType !== CLARIFICATION_STATE_EVENT_CUSTOM_TYPE) return [];
    return isClarificationStateReplayEvent(entry.data) ? [entry.data] : [];
  });
}

export function sortClarificationStateReplayEvents(events: ClarificationStateReplayEvent[]): ClarificationStateReplayEvent[] {
  return [...events].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function replayClarificationStateEvents(
  baseState: ClarificationState,
  events: unknown[],
  options: { snapshotWrittenAt?: string } = {},
): ClarificationStateRestoreResult {
  const errors: string[] = [];
  const validEvents: ClarificationStateReplayEvent[] = [];
  events.forEach((event, index) => {
    if (!isClarificationStateReplayEvent(event)) {
      errors.push(`Ignored invalid clarification-state-event at index ${index}`);
      return;
    }
    if (event.runId !== baseState.runId) return;
    if (options.snapshotWrittenAt && event.createdAt <= options.snapshotWrittenAt) return;
    validEvents.push(event);
  });

  const state = sortClarificationStateReplayEvents(validEvents).reduce((current, event) => {
    try {
      return applyClarificationCommand(current, event.command, { now: event.createdAt }).state;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Ignored clarification-state-event at ${event.createdAt}: ${message}`);
      return current;
    }
  }, baseState);
  return { state, errors };
}

export async function restoreClarificationStateFromSnapshotAndEvents(
  rootDir: string,
  runId: string,
  events: unknown[],
): Promise<ClarificationStateRestoreResult> {
  const snapshot = await readClarificationStateSnapshot(clarificationStateSnapshotPath(rootDir, runId));
  const fallbackCreatedAt = sortClarificationStateReplayEvents(events.filter(isClarificationStateReplayEvent)).find((event) => event.runId === runId)?.createdAt
    || new Date().toISOString();
  const baseState = snapshot?.state ?? createClarificationState(runId, fallbackCreatedAt);
  return replayClarificationStateEvents(baseState, events, { snapshotWrittenAt: snapshot?.writtenAt });
}
