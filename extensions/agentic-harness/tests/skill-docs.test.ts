import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSkill(name: string): string {
  return readFileSync(new URL(`../skills/${name}/SKILL.md`, import.meta.url), "utf-8");
}

const legacySkillNames = [
  ["agentic", "pl", "an", "crafting"].join("-"),
  ["agentic", "run", "pl", "an"].join("-"),
  ["agentic", "milestone", "planning"].join("-"),
  ["agentic", "long", "run"].join("-"),
  ["agentic", "review", "work"].join("-"),
];
const removedPlanRoute = ["/", "pl", "an"].join("");
const removedRunPlanTerm = ["run", "pl", "an"].join("-");
const removedLongRunTerm = ["long", "run"].join("-");

function discoveredSkillNames(): string[] {
  const skillsDir = new URL("../skills/", import.meta.url);
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(new URL(`${entry.name}/SKILL.md`, skillsDir)))
    .map((entry) => entry.name)
    .sort();
}

describe("goal skill docs", () => {
  it("agentic-goal requires durable goal runtime, todos, evidence, and verifier PASS", () => {
    const src = readSkill("agentic-goal");

    expect(src).toContain("/goal status");
    expect(src).toContain("todoread");
    expect(src).toContain("todowrite");
    expect(src).toContain("/goal evidence");
    expect(src).toContain("verifier subagent returns PASS");
    expect(src).toContain("verifier returns FAIL");
    for (const legacySkillName of legacySkillNames) {
      expect(src).not.toContain(legacySkillName);
    }
  });
});

describe("clarification skill goal handoff", () => {
  it("requires Goal Contract output and excludes legacy routing strings", () => {
    const src = readSkill("agentic-clarification");

    expect(src).toContain("Goal Contract");
    expect(src).toContain("/goal");
    expect(src).toContain("clarification_state");
    expect(src).toContain("Runtime Gate");
    expect(src).toContain("Gate: PASS");
    expect(src.toLowerCase()).toContain("non-goals");
    expect(src).toContain("Edge cases");
    expect(src).toContain("Technical context");
    expect(src.toLowerCase()).toContain("success criteria");
    expect(src.toLowerCase()).toContain("evidence required");
    expect(src).not.toContain(legacySkillNames[0]);
    expect(src).not.toContain(legacySkillNames[2]);
    expect(src).not.toContain(removedPlanRoute);
    expect(src).not.toContain("milestones");
    expect(src).not.toContain(removedRunPlanTerm);
    expect(src).not.toContain(removedLongRunTerm);
  });
});

describe("goal runtime skill discovery surface", () => {
  it("discovers agentic-goal and hides legacy public workflow skills", () => {
    const skills = discoveredSkillNames();

    expect(skills).toContain("agentic-goal");
    for (const legacySkillName of legacySkillNames) {
      expect(skills).not.toContain(legacySkillName);
    }
  });
});
