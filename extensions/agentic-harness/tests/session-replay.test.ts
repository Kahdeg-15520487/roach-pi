import { describe, expect, it } from "vitest";
import {
  applyHarnessCommand,
  createHarnessState,
} from "../harness-state.js";
import {
  createHarnessReplayEvent,
  extractHarnessReplayEventsFromSessionEntries,
  HARNESS_STATE_EVENT_CUSTOM_TYPE,
} from "../harness-events.js";
import {
  createHarnessStateSnapshot,
  defaultHarnessStateRoot,
  harnessStateSnapshotPath,
  writeHarnessStateSnapshot,
} from "../harness-storage.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyGoalCommand, createGoalState } from "../goal-state.js";
import { createGoalStateReplayEvent, restoreGoalStateFromSnapshotAndEvents } from "../goal-events.js";
import { createGoalStateSnapshot, goalStateSnapshotPath, writeGoalStateSnapshot } from "../goal-storage.js";

const tempDirs: string[] = [];

async function cleanup() {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
}

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "session-replay-"));
  tempDirs.push(dir);
  return dir;
}

function customEntry(data: unknown) {
  return { type: "custom", customType: HARNESS_STATE_EVENT_CUSTOM_TYPE, data };
}

describe("structured session replay", () => {
  it("detects structured runId from session entries", async () => {
    const rootDir = await makeTempDir();
    let state = createHarnessState({ runId: "run-1", title: "Test" });
    state = applyHarnessCommand(state, {
      type: "upsert_milestone",
      milestone: { id: "M1", name: "Milestone 1", status: "completed" },
    }).state;

    await writeHarnessStateSnapshot(
      harnessStateSnapshotPath(rootDir, "run-1"),
      createHarnessStateSnapshot(state),
    );

    const entries = [
      customEntry({ schemaVersion: 1, runId: "run-1", seq: 1, at: "2026-05-06T00:00:00.000Z", command: { type: "upsert_milestone", milestone: { id: "M1", name: "Milestone 1" } } }),
    ];

    // Verify the entry has the expected structure
    const found = entries.find((e: any) =>
      e.type === "custom"
      && e.customType === HARNESS_STATE_EVENT_CUSTOM_TYPE
      && e.data?.runId === "run-1"
    );
    expect(found).toBeDefined();
    expect((found as any).data.runId).toBe("run-1");
  });

  it("restores milestone statuses from snapshot", async () => {
    const rootDir = await makeTempDir();
    let state = createHarnessState({ runId: "run-1", title: "Test" });
    state = applyHarnessCommand(state, {
      type: "upsert_milestone",
      milestone: { id: "M1", name: "Milestone 1", status: "completed" },
    }).state;
    state = applyHarnessCommand(state, {
      type: "upsert_milestone",
      milestone: { id: "M2", name: "Milestone 2", status: "executing" },
    }).state;

    await writeHarnessStateSnapshot(
      harnessStateSnapshotPath(rootDir, "run-1"),
      createHarnessStateSnapshot(state),
    );

    // Verify snapshot can be read back
    const { readHarnessStateSnapshot } = await import("../harness-storage.js");
    const snapshot = await readHarnessStateSnapshot(harnessStateSnapshotPath(rootDir, "run-1"));
    expect(snapshot).not.toBeNull();
    expect(snapshot!.state.milestones).toHaveLength(2);
    expect(snapshot!.state.milestones[0].status).toBe("completed");
    expect(snapshot!.state.milestones[1].status).toBe("executing");
  });

  it("replays events onto snapshot state", async () => {
    let state = createHarnessState({ runId: "run-1", title: "Test" });
    state = applyHarnessCommand(state, {
      type: "upsert_milestone",
      milestone: { id: "M1", name: "Milestone 1", status: "executing" },
    }).state;

    const event = createHarnessReplayEvent(state, {
      type: "set_milestone_status",
      id: "M1",
      status: "completed",
    });

    const { replayHarnessEvents } = await import("../harness-events.js");
    const replayed = replayHarnessEvents(state, [event]);
    expect(replayed.milestones[0].status).toBe("completed");
  });

  it("extracts only valid structured replay events with rootDir metadata", () => {
    let state = createHarnessState({ runId: "run-1", title: "Test" });
    state = applyHarnessCommand(state, {
      type: "upsert_milestone",
      milestone: { id: "M1", name: "Milestone 1" },
    }).state;
    const event = createHarnessReplayEvent(state, {
      type: "set_milestone_status",
      id: "M1",
      status: "completed",
    }, { rootDir: "custom-root" });

    const extracted = extractHarnessReplayEventsFromSessionEntries([
      customEntry({ malformed: true }),
      customEntry(event),
    ]);

    expect(extracted).toHaveLength(1);
    expect(extracted[0].rootDir).toBe("custom-root");
  });

  it("handles empty session gracefully", () => {
    const state = createHarnessState({ runId: "run-1", title: "Test" });
    expect(state.milestones).toHaveLength(0);
    expect(state.plans).toHaveLength(0);
    expect(state.todos).toHaveLength(0);
  });

  it("restores active goal runtime state from snapshot plus session events", async () => {
    const rootDir = await makeTempDir();
    let state = createGoalState("goal-run-1", "2026-05-28T00:00:00.000Z");
    state = applyGoalCommand(state, {
      type: "create_goal",
      goal: { id: "goal-1", title: "Restore runtime", objective: "Restore active goal after restart" },
    }, { now: "2026-05-28T00:01:00.000Z" }).state;
    state = applyGoalCommand(state, { type: "activate_goal", goalId: "goal-1" }, { now: "2026-05-28T00:02:00.000Z" }).state;

    await writeGoalStateSnapshot(
      goalStateSnapshotPath(rootDir, "goal-run-1"),
      createGoalStateSnapshot(state, { now: "2026-05-28T00:03:00.000Z" }),
    );

    const laterEvidence = createGoalStateReplayEvent("goal-run-1", {
      type: "add_evidence",
      targetType: "goal",
      targetId: "goal-1",
      evidence: "session replay restored active goal",
    }, { now: "2026-05-28T00:04:00.000Z" });

    const restored = await restoreGoalStateFromSnapshotAndEvents(rootDir, "goal-run-1", [laterEvidence]);

    expect(restored.errors).toEqual([]);
    expect(restored.state.status).toBe("active");
    expect(restored.state.activeGoalId).toBe("goal-1");
    expect(restored.state.goals[0].objective).toBe("Restore active goal after restart");
    expect(restored.state.goals[0].subgoals).toHaveLength(0);
    expect(restored.state.ledger.at(-1)?.type).toBe("evidence_added");
  });
});
