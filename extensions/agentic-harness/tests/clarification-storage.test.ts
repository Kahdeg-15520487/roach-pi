import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { applyClarificationCommand, createClarificationState } from "../clarification-state.js";
import { clarificationStateSnapshotPath, createClarificationStateSnapshot, readClarificationStateSnapshot, writeClarificationStateSnapshot } from "../clarification-storage.js";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "clarification-state-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("clarification storage", () => {
  it("writes and reads snapshots", async () => {
    const root = await tempDir();
    let state = createClarificationState("run-1", "2026-05-29T00:00:00.000Z", "deep clarify");
    state = applyClarificationCommand(state, {
      type: "record_answer",
      id: "answer-1",
      question: "What is the objective?",
      answer: "Reduce ambiguity",
    }, { now: "2026-05-29T00:00:01.000Z" }).state;

    const path = clarificationStateSnapshotPath(root, "run-1");
    await writeClarificationStateSnapshot(path, createClarificationStateSnapshot(state, { now: "2026-05-29T00:00:02.000Z" }));
    const snapshot = await readClarificationStateSnapshot(path);

    expect(snapshot?.state.topic).toBe("deep clarify");
    expect(snapshot?.state.answers[0].answer).toBe("Reduce ambiguity");
    expect(snapshot?.snapshotSeq).toBe(1);
  });
});
