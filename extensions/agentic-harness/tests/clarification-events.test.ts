import { describe, expect, it } from "vitest";
import { createClarificationState } from "../clarification-state.js";
import {
  CLARIFICATION_STATE_EVENT_CUSTOM_TYPE,
  createClarificationStateReplayEvent,
  extractClarificationStateReplayEventsFromSessionEntries,
  replayClarificationStateEvents,
} from "../clarification-events.js";

describe("clarification events", () => {
  it("extracts and replays valid custom events", () => {
    const event = createClarificationStateReplayEvent("run-1", {
      type: "start_interview",
      topic: "deep clarify",
    }, { now: "2026-05-29T00:00:00.000Z" });

    const entries = [
      { type: "custom", customType: CLARIFICATION_STATE_EVENT_CUSTOM_TYPE, data: event },
      { type: "custom", customType: "other", data: event },
    ];

    const extracted = extractClarificationStateReplayEventsFromSessionEntries(entries);
    expect(extracted).toHaveLength(1);

    const restored = replayClarificationStateEvents(createClarificationState("run-1", "2026-05-29T00:00:00.000Z"), extracted);
    expect(restored.errors).toEqual([]);
    expect(restored.state.topic).toBe("deep clarify");
    expect(restored.state.status).toBe("interviewing");
  });

  it("ignores malformed events", () => {
    const restored = replayClarificationStateEvents(createClarificationState("run-1", "2026-05-29T00:00:00.000Z"), [{ nope: true }]);
    expect(restored.errors[0]).toContain("Ignored invalid clarification-state-event");
  });
});
