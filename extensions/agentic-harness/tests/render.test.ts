// tests/render.test.ts
import { describe, it, expect } from "vitest";
import assert from "node:assert";
import { formatTokens, formatUsage, statusIcon, formatToolCall, renderCall, renderResult } from "../render.js";
import { emptyUsage, type SingleResult, type SubagentDetails } from "../types.js";
import type { Theme } from "@mariozechner/pi-coding-agent";

const theme: Theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

describe("subagent call rendering", () => {
  it("shows an explicit starting state while single-mode args are incomplete", () => {
    const rendered = renderCall({}, theme, { argsComplete: false });
    const text = rendered.render(80).join("\n");

    expect(text).toContain("subagent starting...");
    expect(text).toContain("receiving task...");
    expect(text).not.toContain("subagent ...");
  });

  it("shows agent and one-line task preview when single-mode args are complete", () => {
    const rendered = renderCall(
      { agent: "explorer", task: "Read-only investigation:\ninspect subagent rendering" },
      theme,
      { argsComplete: true },
    );
    const text = rendered.render(80).join("\n");

    expect(text).toContain("subagent explorer");
    expect(text).toContain("Read-only investigation: inspect subagent rendering");
  });

  it("shows explicit missing labels when completed single-mode args are invalid", () => {
    const rendered = renderCall({}, theme, { argsComplete: true });
    const text = rendered.render(80).join("\n");

    expect(text).toContain("subagent missing agent");
    expect(text).toContain("missing task");
    expect(text).not.toContain("subagent ...");
  });

  it("renders action status without missing single-mode fields", () => {
    const rendered = renderCall({ action: "status" }, theme, { argsComplete: true });
    const text = rendered.render(80).join("\n");

    expect(text).toContain("subagent status");
    expect(text).toContain("all active runs");
    expect(text).not.toContain("missing agent");
    expect(text).not.toContain("missing task");
  });
});

describe("formatTokens", () => {
  it("should format small numbers as-is", () => {
    expect(formatTokens(500)).toBe("500");
  });
  it("should format thousands with k suffix", () => {
    expect(formatTokens(1500)).toBe("1.5k");
  });
  it("should format large thousands as rounded k", () => {
    expect(formatTokens(15000)).toBe("15k");
  });
  it("should format millions with M suffix", () => {
    expect(formatTokens(1500000)).toBe("1.5M");
  });
});

describe("formatUsage", () => {
  it("should format usage stats", () => {
    const result = formatUsage({ input: 1000, output: 500, turns: 2 });
    expect(result).toContain("2 turns");
    expect(result).toContain("↑1.0k");
    expect(result).toContain("↓500");
  });

  it("should handle empty usage", () => {
    expect(formatUsage({})).toBe("");
  });

  it("should include model when provided", () => {
    const result = formatUsage({ turns: 1 }, "claude-sonnet");
    expect(result).toContain("claude-sonnet");
  });
});

describe("statusIcon", () => {
  it("should return hourglass for running", () => {
    const r: SingleResult = { agent: "a", agentSource: "bundled", task: "t", exitCode: -1, messages: [], stderr: "", usage: emptyUsage() };
    const identity = (color: string, text: string) => text;
    expect(statusIcon(r, identity)).toBe("⏳");
  });

  it("should return check for success", () => {
    const r: SingleResult = { agent: "a", agentSource: "bundled", task: "t", exitCode: 0, messages: [], stderr: "", usage: emptyUsage() };
    const identity = (color: string, text: string) => text;
    expect(statusIcon(r, identity)).toBe("✓");
  });

  it("should return cross for error", () => {
    const r: SingleResult = { agent: "a", agentSource: "bundled", task: "t", exitCode: 1, messages: [], stderr: "", usage: emptyUsage() };
    const identity = (color: string, text: string) => text;
    expect(statusIcon(r, identity)).toBe("✗");
  });
});

describe("formatToolCall", () => {
  const identity = (color: string, text: string) => text;

  it("should format bash commands", () => {
    const result = formatToolCall("bash", { command: "ls -la" }, identity);
    expect(result).toContain("ls -la");
  });

  it("should format read with path", () => {
    const result = formatToolCall("read", { file_path: "/foo/bar.ts" }, identity);
    expect(result).toContain("bar.ts");
  });

  it("should keep read summaries as path plus optional range", () => {
    expect(formatToolCall("read", { path: "/tmp/file.ts" }, identity)).toBe("read /tmp/file.ts");
    expect(formatToolCall("read", { path: "/tmp/file.ts", offset: 3, limit: 2 }, identity)).toBe("read /tmp/file.ts:3-4");
  });

  it("should keep write summaries as path plus line count", () => {
    const result = formatToolCall("write", { path: "/tmp/file.ts", content: "one\ntwo\nthree" }, identity);
    expect(result).toBe("write /tmp/file.ts (3 lines)");
  });

  it("should keep edit summaries as path only", () => {
    expect(formatToolCall("edit", { path: "/tmp/file.ts" }, identity)).toBe("edit /tmp/file.ts");
  });

  it("should format grep with pattern", () => {
    const result = formatToolCall("grep", { pattern: "TODO", path: "/src" }, identity);
    expect(result).toContain("TODO");
  });
});

describe("metadata rendering via renderResult", () => {
  it("should show truncation, artifacts, context, and worktree metadata", () => {
    const result: SingleResult = {
      agent: "worker",
      agentSource: "bundled",
      task: "t",
      exitCode: 0,
      messages: [],
      stderr: "",
      usage: emptyUsage(),
      outputTruncation: { truncated: true, originalLength: 1000, returnedLength: 100, maxOutput: 100 },
      artifacts: { artifactDir: "/tmp/artifacts", outputFile: "/tmp/artifacts/output.md", progressFile: "/tmp/artifacts/progress.md" },
      contextMode: "fork",
      contextError: "missing session",
      worktree: { worktreePath: "/tmp/worktree", worktreeDiffFile: "/tmp/artifacts/worktree.diff.md", worktreeCleanupStatus: "removed" },
    };
    const details: SubagentDetails = { mode: "single", results: [result] };
    const rendered = renderResult({ content: [{ type: "text", text: "" }], details }, false, theme);
    const text = rendered.render(120).join("\n");
    expect(text).toContain("truncated 1000 → 100 chars");
    expect(text).toContain("artifacts /tmp/artifacts");
    expect(text).toContain("context fork");
    expect(text).toContain("worktree /tmp/worktree");
    expect(text).toMatch(/diff\s+\/tmp\/artifacts\/worktree\.diff\.md/);
  });
});

describe("single subagent collapsed result preview", () => {
  it("shows task preview on the collapsed success header", () => {
    const result: SingleResult = {
      agent: "explorer",
      agentSource: "bundled",
      task: "Read-only investigation: inspect subagent rendering behavior after recent updates",
      exitCode: 0,
      messages: [],
      stderr: "",
      usage: emptyUsage(),
    };
    const details: SubagentDetails = { mode: "single", results: [result] };
    const rendered = renderResult({ content: [{ type: "text", text: "" }], details }, false, theme);
    const firstLine = rendered.render(140).join("\n").split("\n")[0];

    expect(firstLine).toContain("✓ explorer (bundled)");
    expect(firstLine).toContain("Read-only investigation: inspect subagent rendering behavior");
  });

  it("prefers lastActivity over task preview on the collapsed running header", () => {
    const result: SingleResult = {
      agent: "explorer",
      agentSource: "bundled",
      task: "Original research task that should not be the header preview while activity exists",
      exitCode: -1,
      messages: [],
      stderr: "",
      usage: emptyUsage(),
      lastActivity: { name: "grep", args: { pattern: "renderCall", path: "extensions/agentic-harness" }, timestamp: 123 },
    };
    const details: SubagentDetails = { mode: "single", results: [result] };
    const rendered = renderResult({ content: [{ type: "text", text: "(running...)" }], details }, false, theme);
    const firstLine = rendered.render(160).join("\n").split("\n")[0];

    expect(firstLine).toContain("⏳ explorer (bundled)");
    expect(firstLine).toContain("grep /renderCall/ in extensions/agentic-harness");
    expect(firstLine).not.toContain("Original research task");
  });

  it("truncates long collapsed task previews", () => {
    const result: SingleResult = {
      agent: "worker",
      agentSource: "bundled",
      task: `Investigate ${"rendering ".repeat(30)}TAIL_MARKER`,
      exitCode: 0,
      messages: [],
      stderr: "",
      usage: emptyUsage(),
    };
    const details: SubagentDetails = { mode: "single", results: [result] };
    const rendered = renderResult({ content: [{ type: "text", text: "" }], details }, false, theme);
    const firstLine = rendered.render(200).join("\n").split("\n")[0];

    expect(firstLine).toContain("Investigate rendering rendering");
    expect(firstLine).toContain("...");
    expect(firstLine).not.toContain("TAIL_MARKER");
  });
});

describe("nested subagent rendering via renderResult", () => {
  it("should show nested subagent calls with ⏳ when parent is running", () => {
    const result: SingleResult = {
      agent: "reviewer-architecture",
      agentSource: "bundled",
      task: "review the plan",
      exitCode: -1,
      messages: [
        {
          role: "assistant",
          content: [
            { type: "text", text: "Let me check the implementation." },
            { type: "toolCall", name: "subagent", arguments: { agent: "worker", task: "Run the test suite" } },
          ],
          usage: { input: 100, output: 50, totalTokens: 150 },
        },
      ],
      stderr: "",
      usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 150, turns: 1 },
      nestedCalls: [{ agent: "worker", task: "Run the test suite" }],
    };
    const details: SubagentDetails = { mode: "single", results: [result] };
    const rendered = renderResult(
      { content: [{ type: "text", text: "(running...)" }], details },
      false,
      theme,
    );
    const text = rendered.render(80).join("\n");
    assert.ok(text.includes("worker"), `Expected "worker" in rendered output: ${text}`);
    assert.ok(text.includes("⏳"), `Expected ⏳ icon in rendered output: ${text}`);
    assert.ok(text.includes("└─"), `Expected tree branch in rendered output: ${text}`);
  });

  it("should show ✓ for nested calls when parent completed", () => {
    const result: SingleResult = {
      agent: "reviewer-architecture",
      agentSource: "bundled",
      task: "review the plan",
      exitCode: 0,
      messages: [
        {
          role: "assistant",
          content: [
            { type: "text", text: "Review complete." },
          ],
          usage: { input: 100, output: 50, totalTokens: 150 },
        },
      ],
      stderr: "",
      usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 150, turns: 1 },
      stopReason: "end_turn",
      nestedCalls: [{ agent: "worker", task: "Run the test suite" }],
    };
    const details: SubagentDetails = { mode: "single", results: [result] };
    const rendered = renderResult(
      { content: [{ type: "text", text: "Review complete." }], details },
      false,
      theme,
    );
    const text = rendered.render(80).join("\n");
    assert.ok(text.includes("worker"), `Expected "worker" in rendered output: ${text}`);
    assert.ok(text.includes("✓"), `Expected ✓ icon in rendered output: ${text}`);
  });
});
