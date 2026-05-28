import { resolve as resolvePath } from "node:path";
import {
  applyGoalCommand,
  createGoalState,
  type GoalCommand,
  type GoalReducerResult,
  type GoalState,
} from "./goal-state.js";
import {
  createGoalStateReplayEvent,
  GOAL_STATE_EVENT_CUSTOM_TYPE,
  type GoalStateReplayEvent,
} from "./goal-events.js";
import {
  createGoalStateSnapshot,
  defaultGoalStateRoot,
  goalStateSnapshotPath,
  readGoalStateSnapshot,
  writeGoalStateSnapshot,
} from "./goal-storage.js";

function isoNow(): string {
  return new Date().toISOString();
}

const goalStateMutationLocks = new Map<string, Promise<unknown>>();

export async function withGoalStateMutationLock<T>(
  runId: string,
  rootDir: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const key = `${resolvePath(rootDir ?? defaultGoalStateRoot())}\0${runId}`;
  const previous = goalStateMutationLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  goalStateMutationLocks.set(key, queued);

  await previous.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (goalStateMutationLocks.get(key) === queued) {
      goalStateMutationLocks.delete(key);
    }
  }
}

export async function loadGoalState(
  runId: string,
  rootDir?: string,
  now?: string,
): Promise<GoalState> {
  const dir = rootDir ?? defaultGoalStateRoot();
  const snapshot = await readGoalStateSnapshot(goalStateSnapshotPath(dir, runId));
  if (snapshot) {
    return snapshot.state;
  }
  return createGoalState(runId, now || isoNow());
}

export async function persistGoalState(
  state: GoalState,
  rootDir?: string,
  now?: string,
): Promise<void> {
  const dir = rootDir ?? defaultGoalStateRoot();
  await writeGoalStateSnapshot(
    goalStateSnapshotPath(dir, state.runId),
    createGoalStateSnapshot(state, { now: now || isoNow() }),
  );
}

export function emitGoalStateEvent(
  ctx: { sessionManager?: any } | undefined,
  state: GoalState,
  command: GoalCommand,
  now?: string,
): GoalStateReplayEvent {
  const event = createGoalStateReplayEvent(state.runId, command, { now: now || isoNow() });
  ctx?.sessionManager?.appendCustomEntry?.(GOAL_STATE_EVENT_CUSTOM_TYPE, event);
  return event;
}

export async function applyAndPersistGoalCommand(
  runId: string,
  rootDir: string | undefined,
  command: GoalCommand,
  ctx?: { sessionManager?: any },
  now?: string,
): Promise<GoalReducerResult & { event: GoalStateReplayEvent }> {
  return withGoalStateMutationLock(runId, rootDir, async () => {
    const timestamp = now || isoNow();
    const state = await loadGoalState(runId, rootDir, timestamp);
    const event = createGoalStateReplayEvent(runId, command, { now: timestamp });
    const result = applyGoalCommand(state, command, { now: timestamp });
    await persistGoalState(result.state, rootDir, timestamp);
    ctx?.sessionManager?.appendCustomEntry?.(GOAL_STATE_EVENT_CUSTOM_TYPE, event);
    return { ...result, event };
  });
}
