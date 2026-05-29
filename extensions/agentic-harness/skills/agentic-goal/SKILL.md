---
name: agentic-goal
description: Primary execution workflow for durable /goal runtime. Use when a Goal Contract is active or when the user asks to execute, continue, verify, or complete a goal.
---

# Agentic Goal

Work only through the durable `/goal` runtime.

## Core Rules

1. Start by reading `/goal status` when a goal may be active.
2. Work only on the active goal or active subgoal shown by `/goal status`.
3. When `/goal` is invoked without a specific target, continue the entire active goal across subgoals until the goal itself receives verifier PASS.
4. Track immediate work with `todoread` and `todowrite`.
5. Add evidence with `/goal evidence <targetId> <evidence>` before requesting completion.
6. Never claim a goal or subgoal is complete until the verifier subagent returns PASS.
7. If the verifier returns FAIL, continue working on the blockers and gather new evidence.
8. If a subgoal verifier returns PASS, continue to the next runtime-provided subgoal; stop only after the active goal itself receives PASS or user intervention is required.

## Workflow

1. Inspect `/goal status`.
2. Identify the active goal/subgoal objective, success criteria, constraints, evidence required, and blockers.
3. Create or update todos for the immediate work.
4. Implement the required changes.
5. Record evidence with `/goal evidence`.
6. Request completion with `/goal complete <targetId>`.
7. Follow the verifier outcome:
   - Subgoal PASS: continue with the next runtime-provided subgoal.
   - Goal PASS: stop; the active goal is complete.
   - FAIL: address blockers, record new evidence, and request completion again.

## Durable State Handoff

The `/goal` runtime is canonical. Do not use external planning documents as the source of truth. Do not route to legacy workflow skills as user-facing next steps.
