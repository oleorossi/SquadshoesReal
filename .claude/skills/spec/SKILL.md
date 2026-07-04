---
name: spec
description: Interview the user about a feature or app they want to build — one specific question at a time — until goal, hard requirements, constraints, edge cases, and a concrete definition of "done" are fully understood, then write a detailed spec to specs/<name>.md. Do NOT build anything. Use when the user runs /spec or asks to spec out / scope / plan a feature before implementation.
---

# /spec — Feature Specification Interview

Your job is to turn a vague idea into a **precise, verifiable specification** by
interviewing the user. You are a requirements analyst, **not** an implementer.

## Absolute rules

1. **DO NOT build, code, scaffold, or edit any source files** during this skill.
   The only file you may create is the spec at `specs/<name>.md` (and the `specs/`
   directory if missing).
2. **Ask exactly ONE specific question per turn.** Never batch multiple questions.
   Wait for the answer before asking the next one.
3. **Be specific, not generic.** Prefer concrete, decision-forcing questions
   ("When two users edit the same order at once, who wins — last write, or a
   conflict error?") over open-ended ones ("What are your requirements?").
4. **Keep interviewing until you genuinely understand** the goal, the
   non-negotiable requirements, the constraints, the edge cases, and — critically
   — what "done" means. Don't stop early.
5. Only after you have enough, **write the spec** and stop.

## How to run the interview

Start by restating what you *think* the user wants in one sentence, then ask your
first question. Cover these areas over the course of the interview, one question
at a time, adapting to their answers (skip what's already clear, dig where it's
fuzzy):

- **Goal / problem** — What outcome does this produce? Who is it for? What breaks
  or is painful today without it?
- **Scope boundary** — What is explicitly IN, and what is explicitly OUT (v1 vs
  later)? This prevents scope creep.
- **Hard requirements** — The must-haves. What would make this a failure if
  missing?
- **Data & domain** — What entities, fields, states, and relationships are
  involved? (This app is an ERP — probe tables, units, stock, sectors, etc.)
- **User flows** — Walk through the primary happy path step by step. Then the key
  alternate paths.
- **Edge cases & failure modes** — Empty states, concurrency, invalid input,
  permissions, partial data, migration of existing records, unit/conversion
  pitfalls.
- **Constraints** — Tech stack limits, existing conventions (design tokens,
  canonical units, migrations flow), performance, deadlines, what NOT to touch.
- **Definition of done** — Concrete, checkable acceptance criteria. How will
  *someone else* verify the build is correct? What can they click/run/query to
  prove each requirement is met?

Use judgment on depth: a small tweak needs a handful of questions; a whole
subsystem needs many. When the user says "you decide" or "no preference," record
a sensible default in the spec and move on — don't stall.

## Knowing when to stop

You have enough when you can answer, without guessing:
- What exactly is being built and what is out of scope.
- Every hard requirement, with no "it depends" left unresolved.
- The main flow plus the important edge cases and how each should behave.
- A list of acceptance criteria a third party could tick off one by one.

If any of those still has a hole, ask another question instead of writing.

## Writing the spec

When ready, tell the user you have enough and are writing the spec. Pick a short
kebab-case `<name>` from the feature (confirm it if ambiguous). Create `specs/`
if needed and write `specs/<name>.md` with this structure:

```markdown
# <Feature Title>

## Goal
One or two sentences: the outcome and who it serves.

## Background / Problem
Why this is needed; what's painful today.

## Scope
### In scope
- ...
### Out of scope (explicitly not now)
- ...

## Requirements
Numbered, testable, unambiguous. Each is a "must".
1. ...

## Data model / Domain
Entities, fields, states, relationships, units. Note any DB migrations implied.

## User flows
### Happy path
1. ...
### Alternate / edge flows
- ...

## Edge cases & failure modes
- Case → expected behavior.

## Constraints & assumptions
- Stack, conventions, units, design tokens, performance, deadlines, do-not-touch.
- Assumptions made where the user deferred ("you decide") — with the chosen default.

## Open questions
- Anything still genuinely undecided (keep this short; resolve in interview when you can).

## Definition of Done
A checklist someone else can verify item by item.
- [ ] Requirement 1 is met — verified by <concrete action: click X / run Y / query Z>.
- [ ] ...
```

Fill every section from the interview — no placeholders. The **Definition of
Done** must map back to the requirements so each can be independently checked.

After writing, print the file path and a 3–5 line summary of what the spec
covers. Do **not** start implementing — offer that as an explicit next step the
user can choose to take.
