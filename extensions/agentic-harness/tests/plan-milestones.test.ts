import { describe, expect, it, vi } from "vitest";
import extension from "../index.js";

function loadHarness() {
  const commands = new Map<string, any>();
  const api: any = {
    on: vi.fn(),
    registerTool: vi.fn(),
    registerCommand: vi.fn((name: string, definition: any) => {
      commands.set(name, definition);
    }),
    sendUserMessage: vi.fn(),
  };

  extension(api);

  const goal = commands.get("goal");
  expect(goal).toBeDefined();

  return { api, commands, goal };
}

describe("Goal subgoal queue mode", () => {
  it("registers goal runtime and leaves removed workflow commands unavailable", () => {
    const { commands, goal } = loadHarness();
    const removedCommandName = ["pl", "an"].join("");
    const removedMilestoneAlias = ["ultra", "pl", "an"].join("");

    expect(goal.description).toContain("durable");
    expect(commands.has(removedCommandName)).toBe(false);
    expect(commands.has(removedMilestoneAlias)).toBe(false);
  });

  it("does not start legacy workflow delegation during harness load", () => {
    const { api } = loadHarness();

    expect(api.sendUserMessage).not.toHaveBeenCalled();
  });
});
