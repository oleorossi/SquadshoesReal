---
name: build
description: Read a specification at specs/<name>.md and build EXACTLY what it describes — nothing more. Do not add features, do not refactor unrelated code, do not invent requirements not in the spec. When done, list which spec requirements were implemented so a review step can verify each one. Use when the user runs /build or asks to implement/build a feature from an existing spec.
---

# /build — Implement Exactly From a Spec

Your job is to build **precisely** what a spec describes — no more, no less.
You are an implementer executing a contract, not a designer improving it.

## Absolute rules

1. **Build ONLY what the spec says.** Every requirement in the spec must be
   implemented; nothing outside the spec may be added.
2. **Do NOT add features** — no "nice to have" extras, no speculative options, no
   UI/flows the spec didn't ask for.
3. **Do NOT refactor unrelated code.** Touch only what implementing the spec
   requires. If you spot unrelated problems, note them at the end — do not fix
   them.
4. **Do NOT invent requirements.** If the spec is silent or ambiguous on
   something you need to decide, STOP and ask the user rather than guessing. Do
   not fill gaps with assumptions.
5. When done, **list every spec requirement and how it was met** so the review
   step can verify each one against the code.

## Step 1 — Locate and read the spec

- If the user passed a name (`/build inventory`), read `specs/inventory.md`.
- Otherwise list `specs/*.md`. If exactly one exists, use it. If several exist,
  ask the user which one. If none exist, tell the user to run `/spec` first and
  stop.
- Read the **entire** spec before writing any code. Pay special attention to the
  **Requirements**, **Scope (esp. Out of scope)**, **Constraints**, and
  **Definition of Done** sections.

## Step 2 — Turn the spec into a checklist

Extract every numbered requirement and every Definition-of-Done item into a
working checklist (use TaskCreate to track them). This checklist is the contract
— you are done when all items are satisfied and no extra work was done.

If any requirement is ambiguous, contradictory, or missing information you need
(a field name, a unit, a default, a state transition), **ask the user now**,
before coding. One clarifying question at a time.

## Step 3 — Build

Implement the requirements, honoring this repo's conventions (from CLAUDE.md):

- **TypeScript must stay clean:** run `bunx tsc -p tsconfig.app.json --noEmit`
  (NOT the root `tsc` — the root tsconfig checks nothing). Fix all type errors.
- **Design tokens, not hardcoded colors:** after visual edits run
  `npm run check:tokens`. Use `bg-card`, `text-muted-foreground`, etc. — never
  `bg-white`/`text-gray-*`. (Print/label components are exempt — see CLAUDE.md.)
- **Canonical units** for any material/stock work (`m`, `dm²`, `un`, `par`,
  `placa`, `kg`, `L`) — respect the material-consumption rules in CLAUDE.md.
- **Migrations** go in `supabase/migrations/` and are applied via Supabase MCP —
  only if the spec actually requires schema changes.
- Match the surrounding code's style, naming, and idioms. Reuse existing helpers
  (e.g. `groupHierarchy.ts`, `categoryFromGroup.ts`) instead of duplicating.

Stay strictly inside the spec's scope while doing this. If implementing reveals
that a requirement is impossible or conflicts with another, stop and surface it
to the user rather than silently deviating.

## Step 4 — Verify

Before reporting done, confirm the build actually satisfies the spec:

- Run the typecheck and (for visual changes) `npm run check:tokens`; both clean.
- Walk each Definition-of-Done item and confirm it is actually met — drive the
  real flow where feasible, don't just assume.
- Confirm you added nothing outside the spec.

## Step 5 — Report requirements met

End with a **Requirements coverage** report the reviewer can check line by line.
For each requirement from the spec:

```
## Requirements coverage — specs/<name>.md

- [x] R1: <requirement text> → implemented in <file:line>; verified by <how>.
- [x] R2: ...
- [ ] Rn: NOT done — <why> (only if something was intentionally left; explain).

### Definition of Done
- [x] <DoD item> → <how it's satisfied / how to verify>.

### Out of scope (confirmed NOT touched)
- <items the spec excluded, confirmed absent from this change>.

### Notes for reviewer
- Unrelated issues observed but deliberately NOT fixed (if any).
```

Map each item back to concrete files/lines so review is a mechanical check of
"spec requirement ↔ code." Do not claim a requirement is met unless it truly is.

Then commit with a clear message referencing the spec, and stop. Do not begin
additional work beyond the spec unless the user asks.
