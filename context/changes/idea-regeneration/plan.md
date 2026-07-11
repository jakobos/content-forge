# Idea Regeneration Implementation Plan

## Overview

Implement FR-017 (single idea regeneration) and FR-018 (batch regeneration) so users can regenerate ideas with an optional improvement hint (up to 200 chars). New ideas appear alongside old ones under a fresh `generation_number`. A single `POST /api/ai/regenerate-ideas` endpoint handles both modes, using the existing SSE streaming + `background_operations` infrastructure.

## Current State Analysis

The generation pipeline is well-established with two service factories in `service.ts`: `createGenerationService` (batch, line 303) and `createStructuringService` (manual, line 411). Both follow the same async-generator pattern: fetch context -> retrieve fragments -> build prompts -> LLM call -> validate -> persist -> yield progress via SSE.

The DB schema is pre-provisioned:

- `ideas.improvement_hint` (text, nullable) exists but is never written (`20260606094848_create_application_schema.sql:145`)
- `operation_type` enum includes `'idea_regeneration'` but it's unused (migration line 26)
- `generation_number` auto-increments per campaign, grouping ideas into batches

No regeneration code exists anywhere in `src/`.

### Key Discoveries:

- `IdeaOutputSchema` (batch: `{ ideas: [...] }`) works for regeneration output since we always produce N ideas — `schemas.ts:29-31`
- The `callLLM` helper (`service.ts:140-168`) accepts a custom `jsonSchema` parameter, making it reusable
- `autoIncrementGenerationNumber` (`service.ts:81-91`) gives regenerated ideas a new batch number automatically
- `persistIdeas` (`service.ts:174-237`) can be reused directly — it already handles `generation_number` and `source: "auto"`, just needs `improvement_hint` wired in
- `IdeaActions` is in the `<summary>` (collapsed view, `[id].astro:204-213`), while the expanded detail area ends with `<IdeaPublication>` (`[id].astro:333-338`) — the regenerate form slots in after that

## Desired End State

A user viewing a campaign detail page can:

1. Expand any idea and click "Regenerate" at the bottom — a hint textarea appears (optional, max 200 chars). Submitting triggers regeneration of that single idea. A new generation group appears with 1 fresh idea.
2. Click "Regenerate" in a generation group header — same hint form, but regenerates the entire batch (same count as original). A new generation group appears with N fresh ideas.
3. See which ideas were regenerated via the `improvement_hint` displayed inline.
4. Continue working while regeneration runs (non-blocking SSE streaming).

Verification: generate ideas for a campaign, regenerate a single idea with a hint, regenerate a batch without a hint, confirm old ideas remain, confirm new ideas appear in a new generation group with `improvement_hint` populated.

## What We're NOT Doing

- No lineage tracking — regenerated ideas are independent rows; no `regenerated_from_id` FK
- No new `idea_source` enum value — regenerated ideas use `source: "auto"`
- No DB migration — `improvement_hint` column and `idea_regeneration` operation type already exist
- No batch-size selector on regeneration — always matches the original batch count
- No status restrictions on which ideas can be regenerated — available for all statuses

## Implementation Approach

Follow the proven pattern from S-05 (manual idea creation): add a third service factory (`createRegenerationService`) that builds a regeneration-specific prompt including the original idea(s) + optional hint + fresh fragments, reuses `IdeaOutputSchema` for output, and persists via an extended `persistIdeas` that sets `improvement_hint`. A single endpoint handles both single and batch regeneration — when `idea_id` is provided, it filters to that one idea; otherwise it uses all ideas from the given `generation_number`.

## Critical Implementation Details

**Prompt design:** The regeneration prompt must include the full structured original idea(s) so the LLM can meaningfully improve specific aspects. The hint (when present) acts as directed feedback ("make the hook stronger", "focus on data points"). Without a hint, the LLM should produce genuinely different takes on the same source material. Fresh fragment retrieval ensures new ideas can reference material the original batch may have missed.

---

## Phase 1: Backend — Regeneration service + prompts

### Overview

Add the regeneration prompt templates and a `createRegenerationService` factory that follows the established async-generator pattern. Wire it into the `AIContext` so the endpoint can consume it.

### Changes Required:

#### 1. Regeneration prompt templates

**File**: `src/lib/ai/prompts/regeneration.ts` (new)

**Intent**: System + user prompt builders for the regeneration path. The system prompt instructs the LLM to regenerate/improve existing ideas using optional user feedback. The user prompt renders the original idea(s) as structured data, the campaign context, the hint (if any), and freshly retrieved fragments.

**Contract**:

- `buildRegenerationSystemPrompt(profile: ResolvedProfile): string` — same signature as `buildGenerationSystemPrompt`. Embeds business profile, instructs model to produce improved variations of existing ideas. Output schema is the same `IdeaOutputJsonSchema`.
- `buildRegenerationUserPrompt(params: RegenerationUserPromptParams): string` — params include `originalIdeas` (array of serialized idea objects), `campaignTitle/Goal/Description`, `batchSize`, `fragments`, `hint?`. Renders original ideas as a numbered "## Original Ideas" section, the hint as a "## Improvement Direction" section (when present), and fragments as the standard "## Source Fragments" section.
- Export `RegenerationUserPromptParams` interface.

#### 2. Extend service with regeneration factory

**File**: `src/lib/ai/generation/service.ts`

**Intent**: Add `createRegenerationService` following the same shape as `createGenerationService`. It fetches original ideas from the DB, performs fresh fragment retrieval, builds regeneration prompts, calls the LLM, validates output, and persists results with `improvement_hint` populated.

**Contract**:

- `createRegenerationService(deps: GenerationServiceDeps)` — returns `{ run(params): AsyncGenerator<GenerationProgressEvent> }`.
- `run` params: `{ generationNumber: number; ideaId?: string; hint?: string; model?: string; bgOpId: string }`.
- The generator fetches source ideas from the DB: when `ideaId` is set, filter to that single idea (batch_size = 1); otherwise fetch all ideas matching `campaignId + generationNumber` (batch_size = count).
- Fresh fragment retrieval uses seed queries derived from the original ideas' working titles and key points (not re-deriving from campaign documents — the original ideas are the retrieval anchor).
- Calls `callLLM` with `IdeaOutputJsonSchema` and validates with `parseAndValidate`.
- Persists via `persistIdeas` (reused), then separately updates each inserted idea to set `improvement_hint`.

**Intent for `persistIdeas` change**: The existing `persistIdeas` function needs a minor extension to accept and set `improvement_hint` on inserted rows.

**Contract**: Add an optional `improvementHint?: string` parameter to `persistIdeas`. When provided, include `improvement_hint: improvementHint` in the insert payload. This is a backwards-compatible change — existing callers pass no hint, which defaults to null.

#### 3. Wire into AI context

**File**: `src/lib/ai/index.ts`

**Intent**: Expose `createRegenerationService` on the `AIContext` interface so API endpoints can use it.

**Contract**:

- Add `createRegenerationService(config: { campaignId: string }): ReturnType<typeof createRegenService>` to the `AIContext` interface and the `initializeAI` return object, following the same pattern as the existing `createGenerationService` and `createStructuringService` entries.

#### 4. Re-export prompt builders

**File**: `src/lib/ai/prompts/index.ts`

**Intent**: Barrel-export the new regeneration prompt builders for consistency.

**Contract**: Add `export { buildRegenerationSystemPrompt, buildRegenerationUserPrompt } from "./regeneration"` alongside the existing generation and structuring exports.

### Success Criteria:

#### Automated Verification:

- TypeScript compiles: `npx astro sync && npm run lint`
- Imports resolve: `createRegenerationService` is accessible from `@/lib/ai`
- Prompt builders produce valid strings with all expected sections

#### Manual Verification:

- Review prompt text for clarity and correct instruction to the LLM

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Backend — API endpoint

### Overview

Add `POST /api/ai/regenerate-ideas` that validates the request, fetches source ideas, creates a `background_operations` row with `type: "idea_regeneration"`, and streams regeneration progress via SSE.

### Changes Required:

#### 1. Regeneration endpoint

**File**: `src/pages/api/ai/regenerate-ideas.ts` (new)

**Intent**: API endpoint for idea regeneration, following the pattern established by `generate-ideas.ts` and `structure-idea.ts`. Validates auth and campaign ownership, resolves source ideas, and delegates to `createRegenerationService`.

**Contract**:

- `POST /api/ai/regenerate-ideas`
- Body schema (Zod): `{ campaign_id: z.uuid(), generation_number: z.number().int().min(1), idea_id: z.uuid().optional(), hint: z.string().max(200).optional() }`
- Validates `user` from `context.locals`, `OPENROUTER_API_KEY`, and Supabase client (same guards as `generate-ideas.ts`)
- Verifies campaign ownership: `campaigns.id = campaign_id AND user_id = user.id`
- Verifies source ideas exist: queries `ideas` matching `campaign_id + generation_number` (and `id = idea_id` when provided). Returns 404 if no ideas found.
- Inserts `background_operations` row with `type: "idea_regeneration"`, `status: "pending"`, `input_ref: { campaign_id, generation_number, idea_id, hint }`
- Creates regeneration service via `ai.createRegenerationService({ campaignId })`, calls `.run({ generationNumber, ideaId, hint, bgOpId })`
- Wraps in `trackedEvents()` generator (same pattern as `generate-ideas.ts:84-108`) that transitions background operation through `in_progress -> completed/failed`
- Returns `createSSEResponse(trackedEvents())`
- `jsonError` helper identical to existing endpoints

### Success Criteria:

#### Automated Verification:

- TypeScript compiles: `npx astro sync && npm run lint`
- Endpoint file exists at correct path and exports `POST`

#### Manual Verification:

- Test with `curl` or Postman: POST to `/api/ai/regenerate-ideas` with valid body returns SSE stream
- Verify `background_operations` row is created with correct type and transitions through statuses
- Verify new ideas appear in DB with correct `generation_number` and `improvement_hint`
- Verify original ideas are unchanged

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Frontend — Regeneration UI controls

### Overview

Add a `RegenerateForm` React component for both single-idea and batch regeneration, integrate it into the campaign detail page, and display `improvement_hint` on regenerated ideas.

### Changes Required:

#### 1. RegenerateForm component

**File**: `src/components/campaigns/RegenerateForm.tsx` (new)

**Intent**: Reusable React island for triggering idea regeneration with optional hint. Handles both single-idea (when `ideaId` is set) and batch (when `ideaId` is omitted) modes. Follows the same SSE consumption + progress display pattern as `GenerateIdeasPanel`.

**Contract**:

- Props: `{ campaignId: string; generationNumber: number; ideaId?: string; label?: string }`
- State machine: `"idle" | "editing" | "generating" | "error"`
- In `"idle"`: renders a "Regenerate" button (text from `label` prop, defaults to "Regenerate"). Click transitions to `"editing"`.
- In `"editing"`: renders an optional hint textarea (max 200 chars, placeholder "Optional: describe how to improve...") with character counter, "Cancel" button (returns to idle), and "Regenerate" submit button.
- On submit: POSTs to `/api/ai/regenerate-ideas` with `{ campaign_id, generation_number, idea_id?, hint? }`. Sets state to `"generating"`.
- In `"generating"`: renders spinner + phase label (same `PHASE_LABELS` map as `GenerateIdeasPanel`).
- On `"done"`: `window.location.reload()`.
- In `"error"`: renders error message + "Try Again" button (returns to `"editing"` to preserve hint text).
- Uses `consumeSSE` from `@/lib/ai/sse-client` and `AbortController` for cancellation.
- Styling: consistent with existing purple-accent glassmorphism (border-white/10, bg-white/5, text-purple-*).

#### 2. Integrate into campaign detail page

**File**: `src/pages/campaigns/[id].astro`

**Intent**: Mount `RegenerateForm` in two locations: (1) in each generation group header for batch regeneration, and (2) at the bottom of each expanded idea detail for single-idea regeneration. Also display `improvement_hint` when present on an idea.

**Contract**:

- Import `RegenerateForm` component at the top alongside existing component imports.
- **Generation group header** (`[id].astro:187`): After the "Generation #N" `<h3>`, add `<RegenerateForm campaignId={id} generationNumber={group.generationNumber} label="Regenerate batch" client:visible />`. Wrap the heading and button in a flex container.
- **Expanded idea detail** (`[id].astro:217-339`): After the `<IdeaPublication>` component (line 338), add `<RegenerateForm campaignId={id} generationNumber={idea.generation_number} ideaId={idea.id} client:visible />`.
- **Improvement hint display**: After the "Your description" blockquote section (line 227), add a conditional block: when `idea.improvement_hint` is truthy, render a section with label "Improvement hint" and the hint text in a styled blockquote (same pattern as `original_description` display but with a different accent color, e.g., `border-amber-400/40`).
- Add `improvement_hint` to the ideas query select list (line 43).

### Success Criteria:

#### Automated Verification:

- TypeScript compiles: `npx astro sync && npm run lint`
- No accessibility warnings from `jsx-a11y` lint rules
- Build succeeds: `npm run build` (requires env vars)

#### Manual Verification:

- Single idea regeneration: expand an idea, click "Regenerate", enter a hint, submit. Verify spinner shows, page reloads, new generation group appears with 1 idea containing the improvement hint.
- Batch regeneration: click "Regenerate batch" in a generation header, submit without hint. Verify new generation group appears with same count as original batch.
- Verify old ideas remain in their original generation groups.
- Verify `improvement_hint` is displayed on regenerated ideas.
- Error handling: disconnect network mid-regeneration, verify error state + "Try Again" button.
- Verify the form cancels cleanly (Cancel button returns to idle without side effects).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- No test framework configured (per AGENTS.md). Skip.

### Integration Tests:

- No test framework configured. Skip.

### Manual Testing Steps:

1. Navigate to a campaign with existing ideas (at least one generation group with multiple ideas).
2. **Single idea regeneration with hint**: expand any draft idea, click "Regenerate", type "focus on data-driven arguments" (hint), click "Regenerate". Verify SSE progress, page reload, new Generation #N+1 with 1 idea, `improvement_hint` visible on the new idea.
3. **Single idea regeneration without hint**: expand another idea, click "Regenerate", leave hint empty, click "Regenerate". Verify a new idea appears.
4. **Batch regeneration with hint**: click "Regenerate batch" in a generation header, type "shorter hooks", submit. Verify new generation group with same idea count as original.
5. **Batch regeneration without hint**: same flow, no hint.
6. **Error resilience**: trigger regeneration, then kill the dev server mid-stream. Verify the error state renders with "Try Again".
7. **Original ideas preserved**: after all regenerations, confirm original generation groups are untouched.
8. **Background operations**: check `background_operations` table in Supabase — verify `idea_regeneration` rows with correct status transitions and `input_ref` metadata.

## Performance Considerations

- Fresh fragment retrieval adds one round of vector + FTS search per regeneration (same cost as initial generation). Acceptable for current usage volumes.
- Single-idea regeneration is more token-efficient than batch since it passes only 1 idea to the prompt.
- No caching of fragment retrieval results — each regeneration gets fresh fragments, which is intentional (documents may have been added/changed since original generation).

## References

- PRD: FR-017 (`prd.md:117`), FR-018 (`prd.md:119`)
- Roadmap: S-06 (`roadmap.md:41, 193-203`)
- Existing generation service: `src/lib/ai/generation/service.ts:303-404`
- Existing structuring service: `src/lib/ai/generation/service.ts:411-507`
- Generation prompts: `src/lib/ai/prompts/generation.ts`
- Structuring prompts: `src/lib/ai/prompts/structuring.ts`
- Output schemas: `src/lib/ai/prompts/schemas.ts`
- AI context wiring: `src/lib/ai/index.ts`
- Generate endpoint pattern: `src/pages/api/ai/generate-ideas.ts`
- Campaign detail page: `src/pages/campaigns/[id].astro`
- GenerateIdeasPanel (UI pattern): `src/components/campaigns/GenerateIdeasPanel.tsx`
- IdeaActions: `src/components/campaigns/IdeaActions.tsx`
- S-05 archived plan: `context/archive/2026-07-11-manual-idea-creation/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Backend — Regeneration service + prompts

#### Automated

- [x] 1.1 TypeScript compiles after adding regeneration prompts and service — b8e6fe8
- [x] 1.2 Imports resolve: createRegenerationService accessible from @/lib/ai — b8e6fe8

#### Manual

- [ ] 1.3 Review prompt text for clarity and correct LLM instruction

### Phase 2: Backend — API endpoint

#### Automated

- [x] 2.1 TypeScript compiles after adding regenerate-ideas endpoint
- [x] 2.2 Endpoint file exists and exports POST

#### Manual

- [ ] 2.3 Test endpoint with curl: valid body returns SSE stream
- [ ] 2.4 Verify background_operations row created with correct type and status transitions
- [ ] 2.5 Verify new ideas in DB with correct generation_number and improvement_hint
- [ ] 2.6 Verify original ideas unchanged

### Phase 3: Frontend — Regeneration UI controls

#### Automated

- [ ] 3.1 TypeScript compiles after adding RegenerateForm and page changes
- [ ] 3.2 No jsx-a11y lint warnings
- [ ] 3.3 Build succeeds

#### Manual

- [ ] 3.4 Single idea regeneration with hint produces new generation group with 1 idea
- [ ] 3.5 Batch regeneration produces new generation group with same count as original
- [ ] 3.6 Old ideas remain in original generation groups
- [ ] 3.7 Improvement hint displayed on regenerated ideas
- [ ] 3.8 Error handling: error state renders with Try Again button
