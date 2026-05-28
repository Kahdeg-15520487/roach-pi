import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGoalState } from "../goal-state.js";
import {
  applyAndPersistGoalCommand,
  loadGoalState,
} from "../goal-state-service.js";
import {
  createGoalStateSnapshot,
  defaultGoalStateRoot,
  GOAL_STATE_FILE,
  goalStateSnapshotPath,
  PI_GOAL_STATE_ROOT_ENV,
  readGoalStateSnapshot,
  writeGoalStateSnapshot,
} from "../goal-storage.js";

const START = "2026-05-28T00:00:00.000Z";
const T1 = "2026-05-28T00:01:00.000Z";
const T2 = "2026-05-28T00:02:00.000Z";

const tempDirs: string[] = [];

afterEach(async () => {
  delete process.env[PI_GOAL_STATE_ROOT_ENV];
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "goal-storage-"));
  tempDirs.push(dir);
  return dir;
}

function stateWithGoal(id: string, now = T1) {
  const state = createGoalState("run-1", START);
  return {
    ...state,
    goals: [{
      id,
      title: `Goal ${id}`,
      objective: `Objective ${id}`,
      status: "queued" as const,
      priority: "medium" as const,
      successCriteria: [],
      constraints: [],
      evidenceRequired: [],
      subgoals: [],
      verifierReceipts: [],
      blockers: [],
      createdAt: now,
      updatedAt: now,
    }],
    updatedAt: now,
  };
}

describe("goal-storage", () => {
  it("uses env override and fallback path for the default root", () => {
    process.env[PI_GOAL_STATE_ROOT_ENV] = "/tmp/goal-state-root";
    expect(defaultGoalStateRoot("/workspace/project")).toBe("/tmp/goal-state-root");

    delete process.env[PI_GOAL_STATE_ROOT_ENV];
    expect(defaultGoalStateRoot("/workspace/project")).toBe(join("/workspace/project", ".pi", "agent", "goal-state"));
  });

  it("builds the snapshot path as root/runId/state.json", () => {
    expect(goalStateSnapshotPath("/state-root", "run-1")).toBe(join("/state-root", "run-1", GOAL_STATE_FILE));
  });

  it("writes and reads a snapshot", async () => {
    const root = await makeTempDir();
    const path = goalStateSnapshotPath(root, "run-1");
    const state = stateWithGoal("goal-1");
    const snapshot = createGoalStateSnapshot(state, { now: T2 });

    await writeGoalStateSnapshot(path, snapshot);
    const restored = await readGoalStateSnapshot(path);

    expect(restored?.state).toEqual(state);
    expect(restored?.snapshotSeq).toBe(state.ledger.length);
    expect(restored?.writtenAt).toBe(T2);
  });

  it("returns null for a missing snapshot", async () => {
    const root = await makeTempDir();

    await expect(readGoalStateSnapshot(goalStateSnapshotPath(root, "missing"))).resolves.toBeNull();
  });

  it("keeps snapshots valid during concurrent writes", async () => {
    const root = await makeTempDir();
    const path = goalStateSnapshotPath(root, "run-1");
    const first = createGoalStateSnapshot(stateWithGoal("goal-1"), { now: T1 });
    const second = createGoalStateSnapshot(stateWithGoal("goal-2", T2), { now: T2 });

    await Promise.all([
      writeGoalStateSnapshot(path, first),
      writeGoalStateSnapshot(path, second),
    ]);

    const restored = await readGoalStateSnapshot(path);
    expect(["goal-1", "goal-2"]).toContain(restored?.state.goals[0]?.id);
  });

  it("serializes concurrent apply and persist mutations through the lock", async () => {
    const root = await makeTempDir();

    await Promise.all([
      applyAndPersistGoalCommand("run-1", root, {
        type: "create_goal",
        goal: { id: "goal-1", title: "Goal 1", objective: "First" },
      }, undefined, T1),
      applyAndPersistGoalCommand("run-1", root, {
        type: "create_goal",
        goal: { id: "goal-2", title: "Goal 2", objective: "Second" },
      }, undefined, T2),
    ]);

    const state = await loadGoalState("run-1", root);
    expect(state.goals.map((goal) => goal.id).sort()).toEqual(["goal-1", "goal-2"]);
  });
});
