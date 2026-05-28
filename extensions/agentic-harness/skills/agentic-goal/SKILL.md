---
name: agentic-goal
description: Primary execution workflow for durable /goal runtime. Use when a Goal Contract is active or when the user asks to execute, continue, verify, or complete a goal.
---

# Agentic Goal

Work only through the durable `/goal` runtime.

## Core Rules

1. Start by reading `/goal status` when a goal may be active.
2. Work only on the active goal or active subgoal shown by `/goal status`.
3. Track immediate work with `todoread` and `todowrite`.
4. Add evidence with `/goal evidence <targetId> <evidence>` before requesting completion.
5. Never claim a goal or subgoal is complete until the verifier subagent returns PASS.
6. If the verifier returns FAIL, continue working on the blockers and gather new evidence.
7. If the verifier returns PASS, the runtime may advance to the next queued goal or subgoal.

## Workflow

1. Inspect `/goal status`.
2. Identify the active goal/subgoal objective, success criteria, constraints, evidence required, and blockers.
3. Create or update todos for the immediate work.
4. Implement the required changes.
5. Record evidence with `/goal evidence`.
6. Request completion with `/goal complete <targetId>`.
7. Follow the verifier outcome:
   - PASS: stop or continue with the next runtime-provided goal.
   - FAIL: address blockers, record new evidence, and request completion again.

## Durable State Handoff

The `/goal` runtime is canonical. Do not use external planning documents as the source of truth. Do not route to legacy workflow skills as user-facing next steps.
