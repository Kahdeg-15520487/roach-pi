import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGoalState } from "../goal-state.js";
import {
  createGoalStateReplayEvent,
  extractGoalStateReplayEventsFromSessionEntries,
  GOAL_STATE_EVENT_CUSTOM_TYPE,
  replayGoalStateEvents,
  restoreGoalStateFromSnapshotAndEvents,
  sortGoalStateReplayEvents,
  type GoalStateReplayEvent,
} from "../goal-events.js";
import {
  createGoalStateSnapshot,
  goalStateSnapshotPath,
  writeGoalStateSnapshot,
} from "../goal-storage.js";

const START = "2026-05-28T00:00:00.000Z";
const T1 = "2026-05-28T00:01:00.000Z";
const T2 = "2026-05-28T00:02:00.000Z";
const T3 = "2026-05-28T00:03:00.000Z";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "goal-events-"));
  tempDirs.push(dir);
  return dir;
}

function createGoalEvent(id: string, createdAt: string, runId = "run-1"): GoalStateReplayEvent {
  return createGoalStateReplayEvent(runId, {
    type: "create_goal",
    goal: { id, title: `Goal ${id}`, objective: `Objective ${id}` },
  }, { now: createdAt });
}

describe("goal-events", () => {
  it("creates goal-state-event records", () => {
    const event = createGoalEvent("goal-1", T1);

    expect(event).toEqual({
      runId: "run-1",
      createdAt: T1,
      command: {
        type: "create_goal",
        goal: { id: "goal-1", title: "Goal goal-1", objective: "Objective goal-1" },
      },
    });
  });

  it("sorts replay events by creation time", () => {
    const events = [createGoalEvent("goal-2", T2), createGoalEvent("goal-1", T1)];

    expect(sortGoalStateReplayEvents(events).map((event) => event.command.type === "create_goal" ? event.command.goal.id : "other")).toEqual([
      "goal-1",
      "goal-2",
    ]);
  });

  it("replays events in order", () => {
    const result = replayGoalStateEvents(createGoalState("run-1", START), [
      createGoalEvent("goal-2", T2),
      createGoalEvent("goal-1", T1),
    ]);

    expect(result.errors).toEqual([]);
    expect(result.state.goals.map((goal) => goal.id)).toEqual(["goal-1", "goal-2"]);
    expect(result.state.updatedAt).toBe(T2);
  });

  it("restores from snapshot and applies later events", async () => {
    const root = await makeTempDir();
    const baseResult = replayGoalStateEvents(createGoalState("run-1", START), [createGoalEvent("goal-1", T1)]);
    await writeGoalStateSnapshot(
      goalStateSnapshotPath(root, "run-1"),
      createGoalStateSnapshot(baseResult.state, { now: T2 }),
    );

    const result = await restoreGoalStateFromSnapshotAndEvents(root, "run-1", [
      createGoalEvent("stale-goal", T1),
      createGoalEvent("goal-2", T3),
    ]);

    expect(result.errors).toEqual([]);
    expect(result.state.goals.map((goal) => goal.id)).toEqual(["goal-1", "goal-2"]);
  });

  it("ignores malformed events safely with explicit errors", () => {
    const result = replayGoalStateEvents(createGoalState("run-1", START), [
      { runId: "run-1", command: { type: "create_goal" }, createdAt: T1 },
      createGoalEvent("goal-1", T2),
      createGoalEvent("other-goal", T3, "other-run"),
      createGoalEvent("goal-1", T3),
    ]);

    expect(result.state.goals.map((goal) => goal.id)).toEqual(["goal-1"]);
    expect(result.errors).toEqual([
      "Ignored invalid goal-state-event at index 0",
      "Ignored goal-state-event at 2026-05-28T00:03:00.000Z: Goal goal-1 already exists",
    ]);
  });

  it("replays clear_state events", () => {
    const result = replayGoalStateEvents(createGoalState("run-1", START), [
      createGoalEvent("goal-1", T1),
      createGoalStateReplayEvent("run-1", { type: "clear_state" }, { now: T2 }),
    ]);

    expect(result.errors).toEqual([]);
    expect(result.state.goals).toEqual([]);
    expect(result.state.ledger.at(-1)?.type).toBe("goal_cleared");
  });

  it("extracts valid custom replay events and ignores unrelated entries", () => {
    const valid = createGoalEvent("goal-1", T1);
    const entries = [
      { type: "custom", customType: GOAL_STATE_EVENT_CUSTOM_TYPE, data: valid },
      { type: "custom", customType: "other", data: valid },
      { type: "message", data: valid },
      { type: "custom", customType: GOAL_STATE_EVENT_CUSTOM_TYPE, data: { ...valid, createdAt: 123 } },
      null,
    ];

    expect(extractGoalStateReplayEventsFromSessionEntries(entries)).toEqual([valid]);
  });
});
