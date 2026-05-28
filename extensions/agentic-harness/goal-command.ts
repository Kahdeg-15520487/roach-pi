export const GOAL_HELP_TEXT = `Goal runtime\n\nFlow: use /clarify to shape a Goal Contract, then run /goal. The runtime creates, activates, continues, and verifies automatically until PASS.\n\nCommands:\n  /goal                         Auto-start or continue the active goal until verifier PASS\n  /goal status                  Show status only\n  /goal create <objective>      Advanced: queue a goal objective\n  /goal activate <goalId>       Advanced: activate a queued goal\n  /goal subgoal <goalId> <title> Add a subgoal\n  /goal evidence <targetId> <evidence> Record evidence\n  /goal complete <targetId>     Request verifier-guarded completion\n  /goal pause [goalId]          Pause active or selected goal\n  /goal resume [goalId]         Resume active or selected goal\n  /goal clear --confirm         Clear goal runtime state\n  /goal help                    Show this help\n\nCompletion guard: completion is accepted only after reviewer-verifier returns PASS for the current objective and evidence. If verification fails, blockers stay on the goal and work continues.`;

export type ParsedGoalCommand =
  | { kind: "auto" }
  | { kind: "status" }
  | { kind: "create"; objective: string }
  | { kind: "activate"; goalId: string }
  | { kind: "subgoal"; goalId: string; title: string }
  | { kind: "evidence"; targetId: string; evidence: string }
  | { kind: "complete"; targetId: string }
  | { kind: "pause"; goalId?: string }
  | { kind: "resume"; goalId?: string }
  | { kind: "clear"; confirm: true }
  | { kind: "help" }
  | { kind: "error"; message: string };

export function parseGoalCommand(input: string): ParsedGoalCommand {
  const args = normalizeGoalInput(input);
  if (args.length === 0) return { kind: "auto" };

  const [command, ...rest] = args;
  switch (command) {
    case "status":
      return rest.length === 0 ? { kind: "status" } : error("Usage: /goal status");
    case "create": {
      const objective = rest.join(" ").trim();
      return objective ? { kind: "create", objective } : error("Usage: /goal create <objective>");
    }
    case "activate":
      return singleArg(rest, "Usage: /goal activate <goalId>", (goalId) => ({ kind: "activate", goalId }));
    case "subgoal": {
      if (rest.length < 2) return error("Usage: /goal subgoal <goalId> <title>");
      const [goalId, ...titleParts] = rest;
      const title = titleParts.join(" ").trim();
      return title ? { kind: "subgoal", goalId, title } : error("Usage: /goal subgoal <goalId> <title>");
    }
    case "evidence": {
      if (rest.length < 2) return error("Usage: /goal evidence <targetId> <evidence>");
      const [targetId, ...evidenceParts] = rest;
      const evidence = evidenceParts.join(" ").trim();
      return evidence ? { kind: "evidence", targetId, evidence } : error("Usage: /goal evidence <targetId> <evidence>");
    }
    case "complete":
      return singleArg(rest, "Usage: /goal complete <targetId>", (targetId) => ({ kind: "complete", targetId }));
    case "pause":
      return optionalSingleArg(rest, "Usage: /goal pause [goalId]", (goalId) => ({ kind: "pause", goalId }));
    case "resume":
      return optionalSingleArg(rest, "Usage: /goal resume [goalId]", (goalId) => ({ kind: "resume", goalId }));
    case "clear":
      return rest.length === 1 && rest[0] === "--confirm"
        ? { kind: "clear", confirm: true }
        : error("Usage: /goal clear --confirm");
    case "help":
      return rest.length === 0 ? { kind: "help" } : error("Usage: /goal help");
    default:
      return error(`Unknown /goal command: ${command}`);
  }
}

function normalizeGoalInput(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  const parts = trimmed.split(/\s+/);
  if (parts[0] === "/goal" || parts[0] === "goal") return parts.slice(1);
  return parts;
}

function singleArg<T>(args: string[], usage: string, build: (arg: string) => T): T | Extract<ParsedGoalCommand, { kind: "error" }> {
  return args.length === 1 ? build(args[0]) : error(usage);
}

function optionalSingleArg<T>(args: string[], usage: string, build: (arg: string | undefined) => T): T | Extract<ParsedGoalCommand, { kind: "error" }> {
  return args.length <= 1 ? build(args[0]) : error(usage);
}

function error(message: string): Extract<ParsedGoalCommand, { kind: "error" }> {
  return { kind: "error", message };
}
