import { resolve as resolvePath } from "node:path";
import {
  applyClarificationCommand,
  createClarificationState,
  type ClarificationCommand,
  type ClarificationReducerResult,
  type ClarificationState,
} from "./clarification-state.js";
import {
  CLARIFICATION_STATE_EVENT_CUSTOM_TYPE,
  createClarificationStateReplayEvent,
  type ClarificationStateReplayEvent,
} from "./clarification-events.js";
import {
  clarificationStateSnapshotPath,
  createClarificationStateSnapshot,
  defaultClarificationStateRoot,
  readClarificationStateSnapshot,
  writeClarificationStateSnapshot,
} from "./clarification-storage.js";

function isoNow(): string {
  return new Date().toISOString();
}

const clarificationStateMutationLocks = new Map<string, Promise<unknown>>();

export async function withClarificationStateMutationLock<T>(
  runId: string,
  rootDir: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const key = `${resolvePath(rootDir ?? defaultClarificationStateRoot())}\0${runId}`;
  const previous = clarificationStateMutationLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  clarificationStateMutationLocks.set(key, queued);

  await previous.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (clarificationStateMutationLocks.get(key) === queued) {
      clarificationStateMutationLocks.delete(key);
    }
  }
}

export async function loadClarificationState(
  runId: string,
  rootDir?: string,
  now?: string,
): Promise<ClarificationState> {
  const dir = rootDir ?? defaultClarificationStateRoot();
  const snapshot = await readClarificationStateSnapshot(clarificationStateSnapshotPath(dir, runId));
  return snapshot?.state ?? createClarificationState(runId, now || isoNow());
}

export async function persistClarificationState(
  state: ClarificationState,
  rootDir?: string,
  now?: string,
): Promise<void> {
  const dir = rootDir ?? defaultClarificationStateRoot();
  await writeClarificationStateSnapshot(
    clarificationStateSnapshotPath(dir, state.runId),
    createClarificationStateSnapshot(state, { now: now || isoNow() }),
  );
}

export function emitClarificationStateEvent(
  ctx: { sessionManager?: any } | undefined,
  state: ClarificationState,
  command: ClarificationCommand,
  now?: string,
): ClarificationStateReplayEvent {
  const event = createClarificationStateReplayEvent(state.runId, command, { now: now || isoNow() });
  ctx?.sessionManager?.appendCustomEntry?.(CLARIFICATION_STATE_EVENT_CUSTOM_TYPE, event);
  return event;
}

export async function applyAndPersistClarificationCommand(
  runId: string,
  rootDir: string | undefined,
  command: ClarificationCommand,
  ctx?: { sessionManager?: any },
  now?: string,
): Promise<ClarificationReducerResult & { event: ClarificationStateReplayEvent }> {
  return withClarificationStateMutationLock(runId, rootDir, async () => {
    const timestamp = now || isoNow();
    const state = await loadClarificationState(runId, rootDir, timestamp);
    const event = createClarificationStateReplayEvent(runId, command, { now: timestamp });
    const result = applyClarificationCommand(state, command, { now: timestamp });
    await persistClarificationState(result.state, rootDir, timestamp);
    ctx?.sessionManager?.appendCustomEntry?.(CLARIFICATION_STATE_EVENT_CUSTOM_TYPE, event);
    return { ...result, event };
  });
}
