# Test Fragment Provenance Implementation Plan

## Overview

Bootstrap Vitest in the project, fix the orphan-idea gap in `persistIdeas`, and write unit tests proving that ideas with all-invalid fragment tags are not persisted. This directly addresses Risk #1 from the test plan: generated ideas containing no real fragment references.

## Current State Analysis

`persistIdeas` (`src/lib/ai/generation/service.ts:139-196`) silently drops unmatched tags at line 181-182 and skips the fragment-reference insert when zero refs survive (line 187). But the idea row is already inserted at line 150-170 before tag resolution happens. This means an idea with entirely hallucinated tags is persisted as an orphan -- no `idea_fragment_references` rows, no traceable connection to any source document.

No test infrastructure exists: zero test dependencies, no config, no test files.

### Key Discoveries:

- `persistIdeas` is module-scoped but **not exported** (`service.ts:139`) -- needs `export` to be directly unit-testable
- The function makes exactly 2 types of Supabase calls: `ideas` insert (per idea) and `idea_fragment_references` batch insert (per idea's surviving refs)
- The ideas loop is sequential (`for...of` at line 149), inserting each idea before resolving its refs -- the orphan is created in this gap
- `IdeaOutputSchema` enforces `source_references.min(1)` at the Zod level, so the LLM always returns at least one ref per idea -- but the tag strings are unconstrained (`z.string()` at `schemas.ts:5`)
- The fix requires moving the "should we persist this idea?" check before the idea insert, based on whether any refs survive tag resolution

## Desired End State

After this plan is complete:

- Vitest is installed and runnable via `npm test`
- `persistIdeas` is exported and skips ideas whose source_references all resolve to unmatched tags -- those ideas are not inserted into the database at all
- A test file proves: (a) ideas with valid tags are persisted with their refs, (b) ideas with all-invalid tags are skipped entirely, (c) in a mixed batch, only grounded ideas are persisted
- `npx astro sync`, `npm run lint`, `npm run build`, and `npm test` all pass

## What We're NOT Doing

- **Tightening the Zod schema** to validate tag format (e.g., `/^F\d+$/`) -- that's a separate concern (schema hardening, not persistence logic)
- **Testing `parseAndValidate`** -- out of scope per user decision; the validation gap is a separate change
- **Adding Vitest to CI** -- test-plan Phase 4 (quality gates) owns CI wiring; this change just bootstraps the runner locally
- **Testing through `createGenerationService().run()`** -- integration-level testing is out of scope; we test `persistIdeas` directly
- **Schema migrations** -- no new DB columns; the fix is pure application logic (skip the insert, don't flag it)

## Implementation Approach

Bottom-up: Phase 1 bootstraps Vitest so the runner is available. Phase 2 exports `persistIdeas` and fixes the orphan-idea gap by resolving tags *before* inserting the idea row. Phase 3 writes the test file against the fixed function.

---

## Phase 1: Bootstrap Vitest

### Overview

Install Vitest, configure it with the project's `@/` path alias, and add a `test` script to `package.json`.

### Changes Required:

#### 1. Install Vitest

**Intent**: Add the test runner as a dev dependency.

**Contract**: `npm install -D vitest` -- adds `vitest` to `devDependencies` in `package.json`.

#### 2. Create Vitest config

**File**: `vitest.config.ts` (new, project root)

**Intent**: Configure Vitest to resolve the `@/` path alias so test files can import from `src/` using the same alias as production code.

**Contract**: Export a `defineConfig` from `vitest/config` with `resolve.alias` mapping `@/` to `./src/` (using `new URL('./src/', import.meta.url).pathname` for correct resolution). No other config needed -- Vitest picks up TypeScript from the project's `tsconfig.json` automatically.

#### 3. Add test script

**File**: `package.json`

**Intent**: Provide a conventional `npm test` entry point.

**Contract**: Add `"test": "vitest run"` to the `scripts` object (between existing scripts, alphabetical order). `vitest run` executes once and exits (vs `vitest` which enters watch mode).

### Success Criteria:

#### Automated Verification:

- `npm test` runs and exits 0 (no test files found is a pass, not a failure -- Vitest exits 0 with "No test files found")
- `npm run lint` passes
- `npm run build` passes

---

## Phase 2: Export and Fix `persistIdeas`

### Overview

Export `persistIdeas` for direct testing, then fix the orphan-idea gap: resolve tags *before* inserting the idea row, and skip ideas with zero surviving references.

### Changes Required:

#### 1. Export `persistIdeas`

**File**: `src/lib/ai/generation/service.ts`

**Intent**: Make the function importable from test code.

**Contract**: Add `export` keyword to the function declaration at line 139. No signature or behavior change.

#### 2. Fix the orphan-idea gap

**File**: `src/lib/ai/generation/service.ts`

**Intent**: Prevent ideas with zero surviving fragment references from being inserted into the database. Currently, the idea is inserted (line 150-170) before its refs are resolved (line 179-185), creating orphan ideas when all tags are hallucinated. Move tag resolution before the idea insert and skip the idea if no refs survive.

**Contract**: Inside the `for...of` loop (line 149), before the `ideas` insert:
1. Resolve `idea.source_references` against `tagMap` (the same `.map()` + `.filter()` logic currently at lines 179-185)
2. If the resulting array is empty, `continue` the loop -- skip this idea entirely
3. If non-empty, proceed with the idea insert as before, then insert the already-resolved refs

The function's return type (`Promise<string[]>`) stays the same -- it returns only the IDs of ideas that were actually persisted. A batch of 5 ideas where 2 have all-invalid tags returns 3 IDs.

### Success Criteria:

#### Automated Verification:

- `npx astro sync` completes
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- Confirm that the `persistIdeas` function resolves tags before inserting the idea row (code review)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the code change looks correct before proceeding to the test phase.

---

## Phase 3: Write Unit Tests

### Overview

Write a test file for `persistIdeas` covering the critical scenarios: happy path, partial tag match, all-unmatched (idea skipped), and mixed batch.

### Changes Required:

#### 1. Create test file

**File**: `src/lib/ai/generation/service.test.ts` (new)

**Intent**: Prove that `persistIdeas` correctly handles tag resolution -- persisting only ideas with at least one valid fragment reference and skipping orphans.

**Contract**: Import `persistIdeas` from `./service`. Create a manual Supabase mock implementing the chained `.from().insert().select().single()` and `.from().insert()` patterns. The mock tracks which tables received inserts and with what data.

Test scenarios:

1. **All tags valid** -- idea has `source_references: [{ tag: "F1", ... }]`, tagMap has `F1`. Assert: idea inserted, fragment ref inserted, idea ID returned.
2. **Some tags valid, some not** -- idea has `[{ tag: "F1" }, { tag: "F99" }]`, tagMap has only `F1`. Assert: idea inserted, only `F1` ref inserted, `F99` silently dropped.
3. **All tags invalid (orphan prevention)** -- idea has `[{ tag: "F99" }]`, tagMap has no `F99`. Assert: idea NOT inserted, no fragment refs inserted, returned IDs array does not include this idea.
4. **Mixed batch** -- 3 ideas: one all-valid, one all-invalid, one partial. Assert: 2 ideas inserted (the valid and partial), 1 skipped (the all-invalid), returned array has 2 IDs.
5. **Supabase insert error** -- mock returns an error on `ideas` insert. Assert: function throws with the idea's working_title in the error message.

### Success Criteria:

#### Automated Verification:

- `npm test` passes with all 5 test scenarios green
- `npm run lint` passes
- `npm run build` passes

---

## Testing Strategy

### Unit Tests:

- `persistIdeas` with all-valid tags (happy path)
- `persistIdeas` with partial tag match (some refs survive)
- `persistIdeas` with all-invalid tags (idea skipped)
- `persistIdeas` with mixed batch (some ideas grounded, some orphaned)
- `persistIdeas` with Supabase error (insert failure)

### Integration Tests:

Not in scope -- this change tests `persistIdeas` in isolation.

### Manual Testing Steps:

1. Run `npm test` -- all scenarios pass
2. Review the diff to `persistIdeas` to confirm tag resolution happens before idea insert
3. Confirm `npm run lint` and `npm run build` still pass

## Performance Considerations

None -- unit tests run in-memory with mocked Supabase. No real DB or network calls.

## Migration Notes

No database schema changes. The behavioral change (skipping orphan ideas) is backward-compatible -- it prevents data that was never supposed to exist. Existing orphan ideas (if any) in the database are unaffected.

## References

- Research: `context/changes/risk-1-fragment-provenance/research.md`
- Test plan: `context/foundation/test-plan.md` (Risk #1, Phase 1)
- PRD guardrail: `context/foundation/prd.md` line 43 ("No hallucinated sources")
- `persistIdeas` function: `src/lib/ai/generation/service.ts:139-196`
- Tag resolution gap: `src/lib/ai/generation/service.ts:181-182`
- Zod schemas: `src/lib/ai/prompts/schemas.ts:3-31`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Bootstrap Vitest

#### Automated

- [x] 1.1 `npm test` runs and exits 0 — 9704f89
- [x] 1.2 `npm run lint` passes — 9704f89
- [x] 1.3 `npm run build` passes — 9704f89

### Phase 2: Export and Fix persistIdeas

#### Automated

- [x] 2.1 `npx astro sync` completes — 1736b00
- [x] 2.2 `npm run lint` passes — 1736b00
- [x] 2.3 `npm run build` passes — 1736b00

#### Manual

- [ ] 2.4 Confirm tag resolution happens before idea insert (code review)

### Phase 3: Write Unit Tests

#### Automated

- [x] 3.1 `npm test` passes with all 5 test scenarios green — 3745027
- [x] 3.2 `npm run lint` passes — 3745027
- [x] 3.3 `npm run build` passes — 3745027
