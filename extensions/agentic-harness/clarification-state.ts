export const CLARIFICATION_STATE_SCHEMA_VERSION = 1;

export const REQUIRED_CLARIFICATION_CHECKLIST = [
  "objective",
  "scope",
  "non_goals",
  "constraints",
  "success_criteria",
  "evidence_required",
  "risks",
  "edge_cases",
  "technical_context",
] as const;

export type ClarificationChecklistId = typeof REQUIRED_CLARIFICATION_CHECKLIST[number];
export type ClarificationStatus = "idle" | "interviewing" | "ready_for_contract" | "contract_drafted" | "cancelled";
export type ClarificationChecklistStatus = "open" | "complete" | "accepted_risk";
export type ClarificationAmbiguityStatus = "open" | "resolved" | "accepted_risk";

export interface ClarificationState {
  schemaVersion: 1;
  runId: string;
  status: ClarificationStatus;
  topic: string;
  checklist: ClarificationChecklistItem[];
  ambiguities: ClarificationAmbiguity[];
  answers: ClarificationAnswer[];
  explorationFindings: ClarificationExplorationFinding[];
  goalContract?: ClarificationGoalContract;
  ledger: ClarificationLedgerEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface ClarificationChecklistItem {
  id: ClarificationChecklistId;
  label: string;
  status: ClarificationChecklistStatus;
  value?: string;
  updatedAt?: string;
}

export interface ClarificationAmbiguity {
  id: string;
  question: string;
  status: ClarificationAmbiguityStatus;
  blocking: boolean;
  resolution?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClarificationAnswer {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
}

export interface ClarificationExplorationFinding {
  id: string;
  topic: string;
  summary: string;
  files: string[];
  createdAt: string;
}

export interface ClarificationGoalContract {
  objective: string;
  scope: string[];
  nonGoals: string[];
  successCriteria: string[];
  constraints: string[];
  evidenceRequired: string[];
  risks: string[];
  suggestedSubgoals: string[];
  handoffCommand: string;
  draftedAt: string;
}

export interface ClarificationLedgerEntry {
  seq: number;
  type:
    | "interview_started"
    | "answer_recorded"
    | "finding_recorded"
    | "checklist_updated"
    | "ambiguity_added"
    | "ambiguity_resolved"
    | "risk_accepted"
    | "contract_drafted"
    | "interview_cancelled";
  message: string;
  createdAt: string;
  data?: Record<string, unknown>;
}

export type ClarificationCommand =
  | { type: "start_interview"; topic: string }
  | { type: "record_answer"; id: string; question: string; answer: string }
  | { type: "record_exploration_finding"; id: string; topic: string; summary: string; files?: string[] }
  | { type: "mark_checklist_item"; id: ClarificationChecklistId; value: string; status?: ClarificationChecklistStatus }
  | { type: "add_ambiguity"; id: string; question: string; blocking?: boolean }
  | { type: "resolve_ambiguity"; id: string; resolution: string }
  | { type: "accept_risk"; id: string; reason: string }
  | { type: "draft_goal_contract"; contract: Omit<ClarificationGoalContract, "draftedAt"> }
  | { type: "cancel_interview" };

export interface ClarificationReducerResult {
  state: ClarificationState;
  ledgerEntry?: ClarificationLedgerEntry;
}

export class ClarificationGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClarificationGateError";
  }
}

const CHECKLIST_LABELS: Record<ClarificationChecklistId, string> = {
  objective: "Objective",
  scope: "Scope",
  non_goals: "Non-goals",
  constraints: "Constraints",
  success_criteria: "Success criteria",
  evidence_required: "Evidence required",
  risks: "Risks",
  edge_cases: "Edge cases",
  technical_context: "Affected files / technical context",
};

export function createClarificationState(runId: string, now: string, topic = ""): ClarificationState {
  return {
    schemaVersion: CLARIFICATION_STATE_SCHEMA_VERSION,
    runId,
    status: topic ? "interviewing" : "idle",
    topic,
    checklist: REQUIRED_CLARIFICATION_CHECKLIST.map((id) => ({ id, label: CHECKLIST_LABELS[id], status: "open" })),
    ambiguities: [],
    answers: [],
    explorationFindings: [],
    ledger: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function getClarificationGateIssues(state: ClarificationState): string[] {
  const openChecklist = state.checklist.filter((item) => item.status === "open").map((item) => item.label);
  const openAmbiguities = state.ambiguities.filter((item) => item.blocking && item.status === "open").map((item) => item.question);
  return [
    ...openChecklist.map((label) => `Required checklist item is incomplete: ${label}`),
    ...openAmbiguities.map((question) => `Blocking ambiguity is unresolved: ${question}`),
  ];
}

export function canDraftGoalContract(state: ClarificationState): boolean {
  return getClarificationGateIssues(state).length === 0;
}

export function applyClarificationCommand(
  state: ClarificationState,
  command: ClarificationCommand,
  options: { now: string },
): ClarificationReducerResult {
  const now = options.now;
  const next = cloneState(state);
  next.updatedAt = now;

  switch (command.type) {
    case "start_interview":
      next.status = "interviewing";
      next.topic = command.topic;
      return withLedger(next, { type: "interview_started", message: `Started clarification interview: ${command.topic || "untitled"}`, createdAt: now });

    case "record_answer":
      next.answers.push({ id: command.id, question: command.question, answer: command.answer, createdAt: now });
      return withLedger(next, { type: "answer_recorded", message: `Recorded answer ${command.id}`, createdAt: now, data: { question: command.question } });

    case "record_exploration_finding":
      next.explorationFindings.push({ id: command.id, topic: command.topic, summary: command.summary, files: [...(command.files ?? [])], createdAt: now });
      return withLedger(next, { type: "finding_recorded", message: `Recorded exploration finding ${command.id}`, createdAt: now, data: { topic: command.topic } });

    case "mark_checklist_item": {
      const item = next.checklist.find((candidate) => candidate.id === command.id);
      if (!item) throw new Error(`Unknown clarification checklist item: ${command.id}`);
      const status = command.status ?? "complete";
      if (status === "complete" && command.value.trim().length === 0) {
        throw new ClarificationGateError(`Cannot complete clarification checklist item ${command.id}: value is empty`);
      }
      item.value = command.value;
      item.status = status;
      item.updatedAt = now;
      if (canDraftGoalContract(next)) next.status = "ready_for_contract";
      return withLedger(next, { type: "checklist_updated", message: `Updated ${item.label}`, createdAt: now, data: { id: item.id, status: item.status } });
    }

    case "add_ambiguity":
      if (!next.ambiguities.some((item) => item.id === command.id)) {
        next.ambiguities.push({ id: command.id, question: command.question, status: "open", blocking: command.blocking ?? true, createdAt: now, updatedAt: now });
      }
      return withLedger(next, { type: "ambiguity_added", message: `Added ambiguity ${command.id}`, createdAt: now, data: { question: command.question } });

    case "resolve_ambiguity": {
      const ambiguity = getAmbiguity(next, command.id);
      ambiguity.status = "resolved";
      ambiguity.resolution = command.resolution;
      ambiguity.updatedAt = now;
      if (canDraftGoalContract(next)) next.status = "ready_for_contract";
      return withLedger(next, { type: "ambiguity_resolved", message: `Resolved ambiguity ${command.id}`, createdAt: now });
    }

    case "accept_risk": {
      const ambiguity = getAmbiguity(next, command.id);
      ambiguity.status = "accepted_risk";
      ambiguity.resolution = command.reason;
      ambiguity.updatedAt = now;
      if (canDraftGoalContract(next)) next.status = "ready_for_contract";
      return withLedger(next, { type: "risk_accepted", message: `Accepted ambiguity risk ${command.id}`, createdAt: now, data: { reason: command.reason } });
    }

    case "draft_goal_contract": {
      const issues = getClarificationGateIssues(next);
      if (issues.length > 0) {
        throw new ClarificationGateError(`Cannot draft Goal Contract until clarification gate passes:\n- ${issues.join("\n- ")}`);
      }
      next.goalContract = { ...cloneContract(command.contract), draftedAt: now };
      next.status = "contract_drafted";
      return withLedger(next, { type: "contract_drafted", message: "Drafted Goal Contract", createdAt: now, data: { handoffCommand: command.contract.handoffCommand } });
    }

    case "cancel_interview":
      next.status = "cancelled";
      return withLedger(next, { type: "interview_cancelled", message: "Cancelled clarification interview", createdAt: now });
  }
}

export function renderClarificationGateSummary(state: ClarificationState): string {
  const checklist = state.checklist.map((item) => `${item.status === "open" ? "[ ]" : item.status === "accepted_risk" ? "[risk]" : "[x]"} ${item.label}${item.value ? ` — ${item.value}` : ""}`);
  const ambiguities = state.ambiguities.length === 0
    ? ["none recorded"]
    : state.ambiguities.map((item) => `${item.status === "open" ? "[open]" : item.status === "accepted_risk" ? "[risk]" : "[resolved]"} ${item.question}${item.resolution ? ` — ${item.resolution}` : ""}`);
  const issues = getClarificationGateIssues(state);
  return [
    `Topic: ${state.topic || "(none)"}`,
    `Status: ${state.status}`,
    "Checklist:",
    ...checklist.map((line) => `- ${line}`),
    "Ambiguities:",
    ...ambiguities.map((line) => `- ${line}`),
    issues.length === 0 ? "Gate: PASS" : `Gate: BLOCKED\n${issues.map((issue) => `- ${issue}`).join("\n")}`,
  ].join("\n");
}

function getAmbiguity(state: ClarificationState, id: string): ClarificationAmbiguity {
  const ambiguity = state.ambiguities.find((candidate) => candidate.id === id);
  if (!ambiguity) throw new Error(`Unknown clarification ambiguity: ${id}`);
  return ambiguity;
}

function withLedger(state: ClarificationState, entry: Omit<ClarificationLedgerEntry, "seq">): ClarificationReducerResult {
  const ledgerEntry = { ...entry, seq: state.ledger.length + 1 };
  state.ledger.push(ledgerEntry);
  return { state, ledgerEntry };
}

function cloneContract(contract: Omit<ClarificationGoalContract, "draftedAt">): Omit<ClarificationGoalContract, "draftedAt"> {
  return {
    objective: contract.objective,
    scope: [...contract.scope],
    nonGoals: [...contract.nonGoals],
    successCriteria: [...contract.successCriteria],
    constraints: [...contract.constraints],
    evidenceRequired: [...contract.evidenceRequired],
    risks: [...contract.risks],
    suggestedSubgoals: [...contract.suggestedSubgoals],
    handoffCommand: contract.handoffCommand,
  };
}

function cloneState(state: ClarificationState): ClarificationState {
  return {
    ...state,
    checklist: state.checklist.map((item) => ({ ...item })),
    ambiguities: state.ambiguities.map((item) => ({ ...item })),
    answers: state.answers.map((item) => ({ ...item })),
    explorationFindings: state.explorationFindings.map((item) => ({ ...item, files: [...item.files] })),
    goalContract: state.goalContract ? { ...state.goalContract, scope: [...state.goalContract.scope], nonGoals: [...state.goalContract.nonGoals], successCriteria: [...state.goalContract.successCriteria], constraints: [...state.goalContract.constraints], evidenceRequired: [...state.goalContract.evidenceRequired], risks: [...state.goalContract.risks], suggestedSubgoals: [...state.goalContract.suggestedSubgoals] } : undefined,
    ledger: state.ledger.map((item) => ({ ...item, data: item.data ? { ...item.data } : undefined })),
  };
}
