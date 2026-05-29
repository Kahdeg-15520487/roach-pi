/**
 * Shared helpers for subagent argument parsing and plan path extraction.
 *
 * These functions are used by both the structured state pipeline and
 * the legacy session-restore path. They do NOT depend on any tracker
 * or rendering class.
 */


const ENGINEERING_PLAN_PATH_RE = /(?:^|\/)docs\/engineering-discipline\/plans\/[^/\s"'`<>),]+\.md$/i;
const GENERIC_PLAN_PATH_RE = /(?:^|\/)(?:plans|plan)\/[^/\s"'`<>),]+\.md$/i;
const ENGINEERING_PLAN_PATH_IN_TEXT_RE = /(?:[^\s"'`<>),]*docs\/engineering-discipline\/plans\/[^\s"'`<>),]+\.md)/gi;

function normalizePathForMatch(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function isPlanMarkdownPath(filePath: string): boolean {
  const normalized = normalizePathForMatch(filePath);
  return ENGINEERING_PLAN_PATH_RE.test(normalized) || GENERIC_PLAN_PATH_RE.test(normalized);
}

function addPlanPath(paths: string[], candidate: unknown): void {
  if (typeof candidate !== "string") return;
  if (!isPlanMarkdownPath(candidate)) return;
  if (!paths.includes(candidate)) paths.push(candidate);
}

function addTaskTextPlanPaths(paths: string[], taskText: unknown): void {
  if (typeof taskText !== "string") return;
  for (const match of taskText.matchAll(ENGINEERING_PLAN_PATH_IN_TEXT_RE)) {
    addPlanPath(paths, match[0]);
  }
}

function addReads(paths: string[], reads: unknown): void {
  if (!Array.isArray(reads)) return;
  for (const readPath of reads) addPlanPath(paths, readPath);
}

function addSubagentItems(paths: string[], items: unknown): void {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    addPlanPath(paths, record.planFile);
    addReads(paths, record.reads);
    addTaskTextPlanPaths(paths, record.task);
  }
}

export function extractPlanPathsFromArgs(args: unknown): string[] {
  const paths: string[] = [];
  if (!args || typeof args !== "object") return paths;

  const record = args as Record<string, unknown>;
  addPlanPath(paths, record.planFile);
  addReads(paths, record.reads);
  addTaskTextPlanPaths(paths, record.task);
  addSubagentItems(paths, record.tasks);
  addSubagentItems(paths, record.chain);

  return paths;
}

export function subagentItemRecords(args: unknown): Array<Record<string, unknown>> {
  if (!args || typeof args !== "object") return [];
  const record = args as Record<string, unknown>;

  if (Array.isArray(record.tasks)) return record.tasks.filter((t): t is Record<string, unknown> => !!t && typeof t === "object");
  if (Array.isArray(record.chain)) return record.chain.filter((t): t is Record<string, unknown> => !!t && typeof t === "object");
  if (typeof record.agent === "string") return [record];
  return [];
}

export function getToolExecutionArgs(
  event: { toolName?: unknown; input?: unknown },
  trackedArgs: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (trackedArgs) return trackedArgs;
  if (event.input && typeof event.input === "object") return event.input as Record<string, unknown>;
  return undefined;
}
