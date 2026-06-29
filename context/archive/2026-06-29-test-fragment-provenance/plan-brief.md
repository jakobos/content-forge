# Test Fragment Provenance -- Plan Brief

> Full plan: `context/changes/test-fragment-provenance/plan.md`
> Research: `context/changes/risk-1-fragment-provenance/research.md`

## What & Why

Bootstrap Vitest and write unit tests for `persistIdeas` to defend against Risk #1: generated ideas containing hallucinated fragment references. The research found a structural gap where ideas are inserted into the database before their tags are resolved, allowing orphan ideas with zero valid fragment references to exist. This change fixes the gap and proves the fix with tests.

## Starting Point

No test infrastructure exists. `persistIdeas` (`service.ts:139-196`) silently drops unmatched tags and persists ideas even when all their fragment references are invalid. The function is unexported.

## Desired End State

`npm test` runs a Vitest suite that proves `persistIdeas` skips ideas with zero surviving fragment references. The function is exported, the orphan-idea gap is closed, and the test runner is available for future test-plan phases.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|----------|--------|-------------------|--------|
| Testability approach | Export `persistIdeas` directly | Simplest path; it's an internal lib, not a public package | Plan |
| Supabase mocking | Manual mock object | No extra deps, full control, function only makes 2 table operations | Plan |
| Orphan-idea behavior | Skip persisting entirely | Matches PRD guardrail "no hallucinated sources"; cleanest guarantee | Plan |
| Scope | persistIdeas only | Tight scope; parseAndValidate validation gap is a separate concern | Plan |
| Provenance gap is real | Confirmed by research | Silent drop at service.ts:181-182 creates orphan ideas | Research |

## Scope

**In scope:**
- Install Vitest and configure with `@/` path alias
- Export `persistIdeas`
- Fix: resolve tags before idea insert, skip ideas with zero surviving refs
- 5 test scenarios covering happy path, partial match, all-invalid, mixed batch, and insert error

**Out of scope:**
- Zod schema hardening (constraining tag format)
- Testing `parseAndValidate`
- CI integration (test-plan Phase 4)
- Integration-level testing through the service factory

## Architecture / Approach

Pure unit-test change. `persistIdeas` is restructured to resolve tags before the idea insert (currently the insert happens first, then tags are resolved). A manual Supabase mock tracks inserts per table. No real DB, no network calls.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|-------|-----------------|----------|
| 1. Bootstrap Vitest | Test runner installed and runnable via `npm test` | Path alias resolution |
| 2. Export and Fix persistIdeas | Function exported, orphan-idea gap closed | Behavioral regression in production generation |
| 3. Write Unit Tests | 5 test scenarios proving the fix | Mock fidelity to real Supabase chain API |

**Prerequisites:** None -- this is the first test infrastructure in the project.
**Estimated effort:** ~1 session, 3 phases.

## Open Risks & Assumptions

- The Supabase mock must faithfully reproduce the `.from().insert().select().single()` chain pattern; if the real client diverges, tests may pass but production may not
- Skipping orphan ideas reduces the batch count below `batch_size` -- the user gets fewer ideas than requested, but all are grounded

## Success Criteria (Summary)

- `npm test` passes with all 5 scenarios green
- No orphan ideas can be created by `persistIdeas` when all tags are invalid
- `npm run lint` and `npm run build` still pass
