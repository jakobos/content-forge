# Manual Idea Creation Implementation Plan

## Overview

Add the ability for users to describe a post idea in their own words and have the AI structure it into the standard idea format, enriched with relevant fragments from campaign documents. This is the second idea-creation path alongside batch generation (S-02), addressing US-02 / FR-013.

## Current State Analysis

The batch generation pipeline (`src/lib/ai/generation/service.ts`) is a deterministic, linear workflow: derive seed queries from campaign metadata/documents -> hybrid search for fragments -> assemble prompts -> single structured-output LLM call -> persist ideas. It produces 1-10 ideas per run with `source: "auto"`.

The database schema already supports manual ideas: `ideas.source` enum has `'manual'`, `ideas.original_description` column exists, both designed in F-01. The campaign detail page (`src/pages/campaigns/[id].astro`) does not yet query these columns. The `GenerateIdeasPanel` React island handles batch generation with SSE streaming.

## Desired End State

A user on the campaign detail page can click "Describe your own idea", type a description (min 20 chars) into an inline textarea, and submit. The system uses their description as the primary seed query for fragment retrieval, then calls the LLM with a structuring prompt (not the batch discovery prompt) to produce a single structured idea. The idea is persisted with `source: "manual"` and `original_description` populated. The original description appears as a blockquote above the structured fields in the idea card. The entire flow uses SSE streaming with the same progress phases as batch generation, ending with a page reload.

### Key Discoveries:

- `persistIdeas()` at `service.ts:139` hardcodes `source: "auto"` and skips ideas with zero resolved fragment references — both need parameterization for manual ideas
- `IdeaOutputSchema` at `schemas.ts:10` requires `source_references.min(1)` and `key_quotes.min(1)` — manual ideas need a relaxed schema since fragments may not match
- `[id].astro:42-43` selects a fixed set of idea columns — does not include `source` or `original_description`
- `retrieveTaggedFragments()` at `retrieval.ts:118` accepts arbitrary seed queries — the user's description can be passed directly as a seed query
- `GenerateIdeasPanel.tsx` renders idle/generating/error states — the form needs a fourth state (`"composing"`) for the description input

## What We're NOT Doing

- No new `operation_type` enum — reusing `idea_generation` for manual ideas (no DB migration)
- No client-side DOM insertion of the new idea — using the established `window.location.reload()` pattern
- No AI quality pre-check on the user's description — just a 20-char minimum
- No separate route or modal — inline form within the existing `GenerateIdeasPanel`
- No changes to the markdown export (`ideaToMarkdown`) — manual ideas already populate the same fields

---

## Phase 1: Backend — Structuring Service and API Endpoint

### Overview

Create the manual idea structuring pipeline: a relaxed output schema, dedicated prompt builders, a structuring service function, and an API endpoint. Shares retrieval, profile resolution, and SSE infrastructure with batch generation.

### Changes Required:

#### 1. Manual idea output schema

**File**: `src/lib/ai/prompts/schemas.ts`

**Intent**: Add a `ManualIdeaSchema` that makes `source_references` and `key_quotes` optional (min 0), since the user's description may not match any document fragments. Wrap in a `ManualIdeaOutputSchema` containing a single idea (not an array). Add a corresponding `ManualIdeaOutputJsonSchema` for native structured output.

**Contract**: New exports `ManualIdeaSchema`, `ManualIdeaOutputSchema`, `ManualIdeaOutputJsonSchema`, `ManualIdeaOutput` type. The schema wraps `{ idea: ManualIdeaSchema }` (singular, not `ideas` array). All content fields (hook, key_points, etc.) remain identical to `IdeaSchema`. The difference: `key_quotes` becomes `z.array(z.string())` (no `.min(1)`), `source_references` becomes `z.array(SourceReferenceSchema)` (no `.min(1)`).

#### 2. Structuring prompt builders

**File**: `src/lib/ai/prompts/structuring.ts` (new file)

**Intent**: Create system and user prompt builders for the manual structuring path. The system prompt reuses the business profile injection pattern but instructs the LLM to **structure a user-provided concept** rather than discover ideas from documents. The user prompt includes the user's description as primary context, with campaign metadata and retrieved fragments as supporting material.

**Contract**:

- `buildStructuringSystemPrompt(profile: ResolvedProfile): string` — same signature as `buildGenerationSystemPrompt`. Instructions differ: "You are structuring a user-provided idea description into a formatted post idea" rather than "Generate N distinct ideas."
- `buildStructuringUserPrompt(params: StructuringUserPromptParams): string` — params include `description: string`, `campaignTitle`, `campaignGoal`, `campaignDescription`, `fragments: TaggedFragment[]`. The prompt renders the user's description prominently, then campaign context, then fragments as optional enrichment. Fragment citation instructions: "If source fragments are provided, cite relevant ones in source_references. If none are relevant, omit source_references." The `key_quotes` instruction: "Include verbatim quotes from fragments if citing them. If not citing fragments, this field may be empty."

#### 3. Structuring service

**File**: `src/lib/ai/generation/service.ts`

**Intent**: Add a `createStructuringService` factory function alongside the existing `createGenerationService`. It follows the same async-generator pattern yielding `GenerationProgressEvent` events, but uses the user's description as the seed query, calls the structuring prompts, produces a single idea, and persists with `source: "manual"` and `original_description`.

**Contract**:

- `createStructuringService(deps: GenerationServiceDeps)` — same deps type as `createGenerationService`.
- Returns `{ run(params): AsyncGenerator<GenerationProgressEvent> }` where `params` has `description: string`, `model?: string`, `bgOpId: string`.
- The `run()` generator follows the same 9-step pipeline but with these differences:
  - Step 2: Use the user's description as the single seed query (skip `deriveSeedQueries`)
  - Step 5: Call `buildStructuringSystemPrompt` and `buildStructuringUserPrompt` instead of the generation variants
  - Step 7: Validate against `ManualIdeaOutputSchema` instead of `IdeaOutputSchema`
  - Step 8: Call a new `persistManualIdea` helper (or parameterize `persistIdeas`) that sets `source: "manual"`, populates `original_description`, and allows zero fragment references

The `persistManualIdea` helper inserts a single idea row with `source: "manual"`, `original_description: description`, and the resolved fragment references (if any). Unlike `persistIdeas`, it does NOT skip the idea when `resolvedRefs.length === 0` — manual ideas are valid without enrichment.

The `callLLM` helper needs a second schema parameter or a variant that uses `ManualIdeaOutputJsonSchema` as the response format constraint.

#### 4. AI context wiring

**File**: `src/lib/ai/index.ts`

**Intent**: Expose `createStructuringService` through the `AIContext` interface so the API endpoint can access it.

**Contract**: Add `createStructuringService(config: { campaignId: string }): ReturnType<typeof createStructService>` to the `AIContext` interface. Implementation mirrors `createGenerationService` — passes the same deps to `createStructuringService` from `generation/service.ts`.

#### 5. API endpoint

**File**: `src/pages/api/ai/structure-idea.ts` (new file)

**Intent**: Create a `POST /api/ai/structure-idea` endpoint that accepts a campaign ID and user description, creates a background operation, runs the structuring service, and returns an SSE stream. Follows the exact pattern of `generate-ideas.ts`.

**Contract**:

- Zod body schema: `{ campaign_id: z.uuid(), description: z.string().min(20).max(2000) }`
- Auth check, API key check, Supabase client check — identical to `generate-ideas.ts`
- Campaign ownership check — identical
- Background operation: `type: "idea_generation"`, `status: "pending"`, `input_ref: { campaign_id, description }` (description stored for debug/audit)
- Initializes AI context, creates structuring service, wraps in `trackedEvents()` generator, returns `createSSEResponse()`
- The `trackedEvents()` generator transitions the background operation through `pending -> in_progress -> completed/failed`, identical to `generate-ideas.ts`

### Success Criteria:

#### Automated Verification:

- Types check: `npx astro sync && npm run lint`
- Build succeeds: `npm run build`
- New endpoint responds to POST with SSE stream (manual curl test)

#### Manual Verification:

- POST to `/api/ai/structure-idea` with a valid campaign_id and description returns an SSE stream with `retrieving`, `generating`, `saving`, `done` events
- The persisted idea has `source: 'manual'`, `original_description` populated, and correct structured fields
- When fragments match, `idea_fragment_references` rows are created; when no fragments match, the idea is still persisted with zero references
- Background operation row transitions through `pending -> in_progress -> completed`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Frontend — Manual Idea Form and Display

### Overview

Extend the campaign detail page to support manual idea creation: add an inline form in `GenerateIdeasPanel`, update the ideas query to include `source`/`original_description`, and render the original description for manual ideas.

### Changes Required:

#### 1. Extend GenerateIdeasPanel with manual creation form

**File**: `src/components/campaigns/GenerateIdeasPanel.tsx`

**Intent**: Add a "Describe your own idea" button that reveals an inline textarea form. The form submits to `/api/ai/structure-idea` and consumes the SSE stream using the same `consumeSSE` helper. The panel's state machine gains a `"composing"` state for the form view.

**Contract**:

- New state: `PanelState = "idle" | "composing" | "generating" | "error"`
- In `"idle"` state: add a second button "Describe your own idea" next to the existing "Generate Ideas" button. Same disabled logic (`!hasDocuments`), same styling variant.
- In `"composing"` state: render a `<textarea>` (min 20 chars, max 2000) with a "Structure Idea" submit button and a "Cancel" button. Textarea uses the same glassmorphism styling as existing inputs (`border-white/10 bg-white/5`).
- On submit: POST to `/api/ai/structure-idea` with `{ campaign_id, description }`, transition to `"generating"`, consume SSE, reload on `"done"` — reusing the same `consumeSSE` + `handleGenerate` pattern with a different endpoint and body.
- Client-side validation: description.trim().length >= 20 before enabling submit. Show character count.
- Error state: same as existing — show error message + "Try Again" button, "Try Again" returns to `"composing"` (not `"idle"`) so the user's description is preserved.
- The `generating` state rendering (spinner + phase label) is shared between batch and manual flows — no change needed.

#### 2. Update campaign page ideas query

**File**: `src/pages/campaigns/[id].astro`

**Intent**: Add `source` and `original_description` to the ideas SELECT so the template can distinguish manual ideas and render the original description.

**Contract**: The `.select()` call at line 42-44 adds `, source, original_description` to the column list. The `IdeaRow` type alias at line 89 automatically picks up the new columns from the query return type.

#### 3. Render original description for manual ideas

**File**: `src/pages/campaigns/[id].astro`

**Intent**: For ideas with `source === "manual"` and a non-null `original_description`, render a blockquote at the top of the idea's expanded detail section (inside the `<details>` element, before the Hook field). Also show a small "Manual" badge on the summary row to distinguish manual from auto-generated ideas.

**Contract**:

- Badge: A `<span>` with classes matching the existing badge style (`rounded-full bg-blue-500/20 px-2 py-0.5 text-xs font-medium text-blue-300`) placed after the working title in the summary row. Only rendered when `idea.source === "manual"`.
- Blockquote: Rendered as the first child of the detail `<div>` (before the Hook section). Uses `border-l-2 border-blue-400/40 pl-3 text-sm text-blue-100/60 italic` styling. Prefixed with a tiny label "Your description" in uppercase tracking-wide style (matching existing field labels).
- Only rendered when `idea.source === "manual" && idea.original_description`.

#### 4. Update empty state text

**File**: `src/pages/campaigns/[id].astro`

**Intent**: Update the empty state message to mention both idea creation paths.

**Contract**: Change line 181 from `"No ideas yet. Use Generate Ideas above to create your first batch."` to `"No ideas yet. Generate ideas from your documents or describe your own above."`.

### Success Criteria:

#### Automated Verification:

- Types check: `npx astro sync && npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- "Describe your own idea" button appears next to "Generate Ideas" in the campaign header
- Both buttons are disabled when the campaign has no documents
- Clicking "Describe your own idea" reveals an inline textarea form with character count
- Submitting a description (>= 20 chars) triggers the SSE flow: spinner with phase labels, then page reload
- After reload, the new idea appears in the ideas list with a "Manual" badge
- Expanding the manual idea shows the original description blockquote above the structured fields
- The structured fields (working title, hook, key points, etc.) are populated by the AI
- If fragments were found, source references appear; if not, the idea appears without sources
- Error handling works: submitting fails gracefully, "Try Again" preserves the description
- Empty state text mentions both creation paths

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Unit Tests:

No test framework is configured in this project.

### Integration Tests:

No test framework is configured.

### Manual Testing Steps:

1. Navigate to a campaign with documents. Verify both "Generate Ideas" and "Describe your own idea" buttons are visible and enabled.
2. Navigate to a campaign with no documents. Verify both buttons are disabled.
3. Click "Describe your own idea". Type fewer than 20 characters — verify submit is disabled.
4. Type a description >= 20 chars (e.g., "A post comparing traditional consulting with AI-augmented advisory services"). Submit.
5. Verify the SSE progress phases display ("Searching documents...", "Generating ideas...", "Saving ideas...").
6. After page reload, verify the new idea appears with a "Manual" badge and the original description blockquote.
7. Expand the idea — verify structured fields are populated (working title, hook, key points, etc.).
8. If the description matched document content, verify source references appear.
9. Test error case: disconnect network mid-generation, verify error state with "Try Again" preserving the description.
10. Verify the idea follows the standard lifecycle — accept, decline, copy to markdown, publish all work as normal via `IdeaActions`.

## Performance Considerations

- Manual idea creation produces 1 idea per LLM call (vs. up to 10 for batch). The retrieval step uses a single seed query instead of up to 12. Total latency should be lower than batch generation.
- The `window.location.reload()` on completion re-fetches all campaign data. Acceptable for current scale (solo user, moderate idea counts).

## Migration Notes

No database migrations needed. The `ideas.source`, `ideas.original_description`, and `idea_source` enum were all created in F-01's migration (`20260606094848_create_application_schema.sql`).

## References

- PRD: US-02, FR-013 (`context/foundation/prd.md:62-73, 107`)
- Roadmap: S-05 (`context/foundation/roadmap.md:181-191`)
- Batch generation service: `src/lib/ai/generation/service.ts`
- Generation prompts: `src/lib/ai/prompts/generation.ts`
- Output schemas: `src/lib/ai/prompts/schemas.ts`
- Retrieval: `src/lib/ai/generation/retrieval.ts`
- AI context wiring: `src/lib/ai/index.ts`
- Batch generation endpoint: `src/pages/api/ai/generate-ideas.ts`
- Campaign detail page: `src/pages/campaigns/[id].astro`
- Generate panel component: `src/components/campaigns/GenerateIdeasPanel.tsx`
- SSE infrastructure: `src/lib/ai/streaming.ts`, `src/lib/ai/sse-client.ts`
- Archived F-04 plan: `context/archive/2026-06-13-deterministic-generation-workflow/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Backend — Structuring Service and API Endpoint

#### Automated

- [x] 1.1 Types check passes (npx astro sync && npm run lint) — aa8be4c
- [x] 1.2 Build succeeds (npm run build) — aa8be4c

#### Manual

- [x] 1.3 POST to /api/ai/structure-idea returns SSE stream with correct event sequence — aa8be4c
- [x] 1.4 Persisted idea has source 'manual' and original_description populated — aa8be4c
- [x] 1.5 Fragment references created when fragments match; idea persisted without refs when none match — aa8be4c
- [x] 1.6 Background operation row transitions through pending -> in_progress -> completed — aa8be4c

### Phase 2: Frontend — Manual Idea Form and Display

#### Automated

- [x] 2.1 Types check passes (npx astro sync && npm run lint) — f203486
- [x] 2.2 Build succeeds (npm run build) — f203486

#### Manual

- [x] 2.3 Describe your own idea button appears and respects hasDocuments gate — f203486
- [x] 2.4 Inline form with textarea, character count, and submit/cancel works correctly — f203486
- [x] 2.5 SSE flow triggers and page reloads on completion — f203486
- [x] 2.6 Manual idea displays with Manual badge and original description blockquote — f203486
- [x] 2.7 Structured fields and source references render correctly — f203486
- [x] 2.8 Error handling preserves description text — f203486
- [x] 2.9 Empty state text updated — f203486
