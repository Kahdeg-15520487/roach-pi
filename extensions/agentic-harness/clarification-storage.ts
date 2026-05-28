import { randomBytes } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { dirname, join } from "node:path";
import { CLARIFICATION_STATE_SCHEMA_VERSION, type ClarificationState } from "./clarification-state.js";

export const CLARIFICATION_STATE_FILE = "state.json";
export const PI_CLARIFICATION_STATE_ROOT_ENV = "PI_CLARIFICATION_STATE_ROOT";

export interface ClarificationStateSnapshot {
  schemaVersion: typeof CLARIFICATION_STATE_SCHEMA_VERSION;
  state: ClarificationState;
  snapshotSeq: number;
  writtenAt: string;
}

function isoNow(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export function defaultClarificationStateRoot(cwd = process.cwd()): string {
  return process.env[PI_CLARIFICATION_STATE_ROOT_ENV] || join(cwd, ".pi", "agent", "clarification-state");
}

export function clarificationStateSnapshotPath(rootDir: string, runId: string): string {
  return join(rootDir, runId, CLARIFICATION_STATE_FILE);
}

export function createClarificationStateSnapshot(
  state: ClarificationState,
  options: { now?: string } = {},
): ClarificationStateSnapshot {
  return {
    schemaVersion: CLARIFICATION_STATE_SCHEMA_VERSION,
    state,
    snapshotSeq: state.ledger.length,
    writtenAt: options.now || isoNow(),
  };
}

function normalizeClarificationStateSnapshot(snapshot: ClarificationStateSnapshot, path: string): ClarificationStateSnapshot {
  if (!isRecord(snapshot) || snapshot.schemaVersion !== CLARIFICATION_STATE_SCHEMA_VERSION) {
    throw new Error(`Unsupported clarification state snapshot schema at ${path}: ${String(isRecord(snapshot) ? snapshot.schemaVersion : undefined)}`);
  }
  const state = snapshot.state;
  if (!isRecord(state) || state.schemaVersion !== CLARIFICATION_STATE_SCHEMA_VERSION) {
    throw new Error(`Unsupported clarification state schema at ${path}: ${String(isRecord(state) ? state.schemaVersion : undefined)}`);
  }
  if (typeof snapshot.snapshotSeq !== "number" || typeof snapshot.writtenAt !== "string") {
    throw new Error(`Invalid clarification state snapshot at ${path}`);
  }
  return snapshot;
}

async function replaceFile(tmp: string, file: string): Promise<void> {
  try {
    await rename(tmp, file);
    return;
  } catch (error) {
    if (!isNodeError(error) || process.platform !== "win32" || (error.code !== "EPERM" && error.code !== "EEXIST")) {
      throw error;
    }
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await copyFile(tmp, file);
      await rm(tmp, { force: true });
      return;
    } catch (error) {
      if (!isNodeError(error) || (error.code !== "EPERM" && error.code !== "EBUSY")) {
        throw error;
      }
      lastError = error;
      await delay(10 * (attempt + 1));
    }
  }
  throw lastError;
}

export async function writeClarificationStateSnapshot(path: string, snapshot: ClarificationStateSnapshot): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.${CLARIFICATION_STATE_FILE}.${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`);
  try {
    await writeFile(tmp, `${JSON.stringify(normalizeClarificationStateSnapshot(snapshot, path), null, 2)}\n`, "utf8");
    await replaceFile(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function readClarificationStateSnapshot(path: string): Promise<ClarificationStateSnapshot | null> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid clarification state snapshot JSON at ${path}: ${message}`);
  }
  return normalizeClarificationStateSnapshot(parsed as ClarificationStateSnapshot, path);
}
