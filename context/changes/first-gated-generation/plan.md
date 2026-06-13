# First Gated Generation Implementation Plan

## Overview

Build the north star feature (S-02): users can generate structured post ideas from campaign documents via AI. This connects the existing AI generation pipeline (F-02) to a user-facing flow on the campaign detail page -- a "Generate Ideas" button triggers generation, SSE streaming shows real-time progress, and persisted ideas appear in an expandable card layout. Documents are auto-embedded on creation so RAG search works seamlessly. Hardcoded profile defaults stand in until the business profile wizard (S-04) lands.

## Current State Analysis

- **AI pipeline (F-02) is fully operational**: Provider abstraction (OpenRouter), agent runner with tool calling, embeddings, hybrid RAG search, SSE streaming, background operations tracking. The `/api/ai/generate` endpoint accepts `system_prompt` + `user_prompt` + `campaign_id` and streams `RunnerStreamEvent` items.
- **Campaign CRUD (S-01) is live**: Campaign list, create, detail page with source documents and user insights. Documents are persisted with version tracking.
- **Schema supports ideas**: The `ideas` table has rich columns (working_title, hook, key_points, key_quotes, plus 6 dynamic optional fields). `idea_fragment_references` links ideas to document chunks. `background_operations` tracks generation jobs. All TypeScript types are generated.
- **Zero idea UI exists**: No pages, no React components, no idea display logic. The campaign detail page ends after the document sections.
- **Documents are not auto-embedded**: The embedding pipeline works but document creation doesn't trigger it. The `search_documents` tool returns nothing for un-embedded documents.
- **No idea persistence code**: Nothing in the codebase inserts into the `ideas` or `idea_fragment_references` tables.

### Key Discoveries:

- The document creation endpoint (`src/pages/api/campaigns/[id]/documents.ts:80`) doesn't return the `document_version_id` after insert -- needs `.select("id").single()` to get the version UUID for embedding.
- The generate endpoint (`src/pages/api/ai/generate.ts`) already creates `background_operations` rows and tracks status transitions (pending -> in_progress -> completed/failed). No changes needed to the endpoint itself.
- The `search_documents` tool in `src/lib/ai/tools/definitions/search-documents.ts:51-68` needs a `campaign_id` parameter injected at init time via `initializeAI()` -- it's already wired this way.
- The `parseStructuredOutput()` utility (`src/lib/ai/runner/output-parser.ts`) strips markdown fences and validates against a Zod schema -- ready for parsing LLM idea output.
- `key_quotes` is `NOT NULL DEFAULT '{}'` in SQL but `string[]` (not optional) in the TypeScript Insert type -- must always be provided, at least as `[]`.
- The campaign detail page uses a glassmorphism style (white/10 borders, white/5 backgrounds, backdrop-blur-xl) and `<details>` elements for collapsible sections.

## Desired End State

After this plan is complete:
- When a user adds a document to a campaign, it is automatically chunked and embedded (fire-and-forget) so RAG search works by the time they generate ideas.
- On the campaign detail page, a "Generate Ideas" button appears in the campaign header card. The button is disabled with a message when no documents exist.
- Clicking "Generate Ideas" opens an inline generation panel with a batch size selector (1-10, default 5). Clicking "Generate" starts SSE-streamed generation with progress phases visible to the user.
- When generation completes, the client parses the structured JSON output and calls a persist endpoint that saves ideas + fragment references to the database.
- Generated ideas appear in a new "Ideas" section above the documents sections. Each idea is an expandable card: collapsed shows working_title and hook; expanded shows all populated fields and source references.
- The page reloads after persistence to show the saved ideas server-rendered.
- `npm run lint` and `npm run build` pass.

## What We're NOT Doing

- **Idea lifecycle management** (accept/decline/archive) -- that's S-03.
- **Business profile wizard** -- S-04. We use hardcoded defaults in the system prompt.
- **Manual idea creation** (user-described ideas) -- S-05.
- **Idea regeneration** -- S-06.
- **RLS policies** -- F-03.
- **Background operations dashboard** -- S-09. We track operations in the DB but don't expose a status UI.
- **Markdown copy-to-clipboard** -- S-03.
- **Mobile-specific responsive optimization** beyond basic responsive layout.

## Implementation Approach

Bottom-up across 4 phases: (1) wire embedding into document creation so the RAG foundation works, (2) build the prompt templates and persist endpoint, (3) build the generation UI (React component consuming SSE), (4) build the idea display. Each phase produces testable artifacts with clear automated and manual verification.

## Critical Implementation Details

### Timing & lifecycle

Auto-embedding in the document creation endpoint happens **synchronously before the redirect** (awaited). On Cloudflare Workers, no code runs after `return context.redirect(...)` -- the isolate may terminate once the Response is returned -- so a true fire-and-forget call after the redirect is not possible, and `ctx.waitUntil()` is not reliably exposed through Astro's `APIContext`. Therefore the endpoint awaits `embeddingService.embedDocument(...)` before redirecting. Embedding a typical document takes 2-5 seconds; the user sees a brief loading state while the form submits, then lands on the campaign page with the document already embedded and immediately searchable. Embedding failures are caught and swallowed (document creation still succeeds); the generate endpoint will work with whatever embeddings exist.

### State sequencing

The generation flow has strict ordering: (1) client calls `/api/ai/generate` with prompts, (2) SSE streams progress, (3) the `runner_done` event contains the final LLM output, (4) client parses the structured JSON from the output text, (5) client calls `/api/ai/ideas` to persist parsed ideas, (6) on success, client triggers page reload to show server-rendered ideas. Steps 4-6 happen on the client after the SSE stream ends -- the generate endpoint itself does NOT persist ideas.

---

## Phase 1: Auto-Embed on Document Creation

### Overview

Wire the embedding pipeline into the document creation endpoint so that every new document is automatically chunked and embedded. This ensures RAG search returns results when the user generates ideas.

### Changes Required:

#### 1. Return document_version_id from version insert

**File**: `src/pages/api/campaigns/[id]/documents.ts`

**Intent**: The current version insert discards the auto-generated UUID. We need it to call the embedding service.

**Contract**: Change the `document_versions` insert to include `.select("id").single()` so it returns the version's `id`. Store in a `version` variable.

#### 2. Add synchronous embedding before the redirect

**File**: `src/pages/api/campaigns/[id]/documents.ts`

**Intent**: After inserting the document and version, call the embedding service to chunk and embed the document content. This is awaited before the redirect (a true post-response fire-and-forget is not possible on Workers). Embedding failure must not cause document creation to appear failed.

**Contract**: Import `OPENROUTER_API_KEY` from `astro:env/server` and `createEmbeddingClient`, `createEmbeddingService` from `@/lib/ai/embeddings`. After the version insert succeeds, guard on `OPENROUTER_API_KEY` being defined. If defined, create the embedding client and service, call `embeddingService.embedDocument(version.id, content)`. Wrap in try/catch -- failures are silently ignored (document creation still succeeds). Optionally create a `background_operations` row with type `document_ingestion` to track embedding status. The embedding call happens synchronously before the redirect -- this adds 2-5 seconds but guarantees the document is searchable immediately.

### Success Criteria:

#### Automated Verification:

- `npx astro sync` completes
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- Adding a source document to a campaign completes (redirect back to campaign page works)
- After adding a document, querying `document_embeddings` in Supabase Dashboard shows new rows with the document's version ID
- Adding a document when `OPENROUTER_API_KEY` is not set still works (document created, no embeddings)
- The `background_operations` table shows a `document_ingestion` row with status `completed` (or `failed` with error_message)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Prompt Templates & Persist Endpoint

### Overview

Build the system and user prompt templates that instruct the LLM to produce structured idea JSON, the Zod schema for validating LLM output, and the `/api/ai/ideas` endpoint that persists parsed ideas and fragment references to the database.

### Changes Required:

#### 1. Idea output Zod schema

**File**: `src/lib/ai/prompts/schemas.ts` (new)

**Intent**: Define a Zod schema for the structured JSON output the LLM produces. This schema is used by the persist endpoint to validate incoming idea data and by the client to parse the LLM's text output.

**Contract**: Export `IdeaOutputSchema` -- a Zod object with:
- `ideas`: array of objects, each with:
  - `working_title`: string (required)
  - `hook`: string (optional)
  - `key_points`: string array (optional)
  - `key_quotes`: string array (required, at least 1 quote per idea -- these are direct quotes from source documents)
  - `proposed_flow`: string (optional)
  - `insights_conclusions`: string (optional)
  - `call_to_action`: string (optional)
  - `storytelling_angle`: string (optional)
  - `target_audience_note`: string (optional)
  - `content_format_suggestion`: string (optional)
  - `source_references`: array of objects `{ document_version_id: string (optional), document_title: string, quote_snippet: string }` (required, at least 1 per idea). `document_version_id` is the opaque ID echoed back from a `search_documents` result; `document_title` remains as a human-readable fallback.
- Also export the inferred TypeScript type `IdeaOutput`.

#### 2. System prompt template

**File**: `src/lib/ai/prompts/generation.ts` (new)

**Intent**: Define the system prompt and user prompt templates for batch idea generation. The system prompt embeds hardcoded business profile defaults and instructs the LLM on output format. The user prompt injects campaign context and batch size.

**Contract**: Export `buildGenerationSystemPrompt()` returning a string with:
- Role definition (content strategist / post idea generator)
- Hardcoded profile defaults: professional tone, broad B2B audience, thought leadership focus, expertise-driven archetype
- Output format instructions: produce a JSON object matching the `IdeaOutputSchema` structure
- Constraints: every idea must reference specific document fragments via the `search_documents` tool, `key_quotes` must contain actual quotes from documents (not fabricated), each idea must be distinct and non-overlapping
- Provenance instruction: each `search_documents` result includes a `documentVersionId`. The LLM must copy that exact ID verbatim into the `document_version_id` field of every `source_reference` derived from that result (alongside the human-readable `document_title`). This lets the persist endpoint resolve provenance by ID rather than by fragile title matching.
- Tool usage instructions: use `search_documents` to find relevant content, use `get_business_profile` to check if a real profile exists (fall back to defaults if empty)

Export `buildGenerationUserPrompt(params: { campaignTitle: string, campaignGoal: string | null, campaignDescription: string | null, batchSize: number })` returning a string that instructs the LLM to generate `batchSize` structured post ideas for the campaign, using documents found via `search_documents`.

#### 3. Prompts barrel export

**File**: `src/lib/ai/prompts/index.ts` (new)

**Intent**: Barrel export for the prompts module.

**Contract**: Exports `buildGenerationSystemPrompt`, `buildGenerationUserPrompt`, `IdeaOutputSchema`, and the `IdeaOutput` type.

#### 4. Persist ideas endpoint

**File**: `src/pages/api/ai/ideas.ts` (new)

**Intent**: JSON API endpoint that accepts parsed idea data (matching `IdeaOutputSchema`) and persists it to the `ideas` and `idea_fragment_references` tables. Called by the client after generation completes.

**Contract**: `POST /api/ai/ideas` with JSON body:
```
{
  campaign_id: string (UUID),
  generation_number: number (optional, auto-determined if omitted),
  ideas: IdeaOutput["ideas"]
}
```

Flow:
1. Auth guard (`context.locals.user`).
2. Supabase client guard.
3. Zod validation of body.
4. Campaign ownership verification.
5. If `generation_number` not provided, query `MAX(generation_number)` from `ideas` table for this campaign and increment by 1.
6. For each idea in the array:
   a. Insert into `ideas` with `campaign_id`, `user_id`, `generation_number`, `source: "auto"`, `status: "draft"`, and all idea fields from the input.
   b. For each `source_reference`, resolve `document_version_id` in this priority order: (1) if the reference carries a `document_version_id`, validate it belongs to a `document_versions` row whose parent `documents.campaign_id` matches this campaign, and use it directly (exact match); (2) otherwise fall back to matching `document_title` against `documents` in this campaign (join through `documents` -> `document_versions` to find the latest version); (3) if neither resolves, insert the fragment reference with `document_version_id: null` and `quote_snippet` preserved. The campaign-ownership validation on the echoed ID prevents a hallucinated or cross-campaign ID from being persisted. Insert into `idea_fragment_references` with `idea_id`, `document_version_id`, `quote_snippet`.
7. Return JSON `{ ok: true, idea_ids: string[] }`.

### Success Criteria:

#### Automated Verification:

- `npx astro sync` completes
- `npm run lint` passes
- `npm run build` passes
- Files exist: `src/lib/ai/prompts/schemas.ts`, `src/lib/ai/prompts/generation.ts`, `src/lib/ai/prompts/index.ts`, `src/pages/api/ai/ideas.ts`

#### Manual Verification:

- Calling `POST /api/ai/ideas` with valid idea data inserts rows into `ideas` table and `idea_fragment_references` table
- The `generation_number` auto-increments correctly (first batch = 1, second batch = 2)
- Invalid input returns a structured error response
- Duplicate document titles resolve correctly to `document_version_id`
- Unmatched document titles still create fragment references with `document_version_id: null`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Generation UI

### Overview

Build the React component that sits on the campaign detail page: a "Generate Ideas" button with gating, a batch size selector, an SSE stream consumer with progress phases, and idea persistence on completion. This phase also modifies the campaign detail Astro page to include the new component.

### Changes Required:

#### 1. SSE client utility

**File**: `src/lib/ai/sse-client.ts` (new)

**Intent**: Client-side utility for consuming SSE streams from the generate endpoint. Parses `data:` lines, handles `[DONE]` sentinel, and yields typed events.

**Contract**: Export `async function* consumeSSE(response: Response): AsyncGenerator<RunnerStreamEvent>`. Reads the response body as a stream, splits on `\n\n`, parses `data:` lines as JSON, yields each event. Stops on `[DONE]`. Also export the `RunnerStreamEvent` type re-exported from the runner types (or a simplified client-side version with the event types the UI cares about).

#### 2. Generation panel React component

**File**: `src/components/campaigns/GenerateIdeasPanel.tsx` (new)

**Intent**: React component that orchestrates the full generation flow: gating check, batch size selection, SSE stream consumption, progress display, output parsing, idea persistence, and page reload.

**Contract**: Props: `campaignId: string`, `campaignTitle: string`, `campaignGoal: string | null`, `campaignDescription: string | null`, `hasDocuments: boolean`. The component has these states:

- **Idle**: Shows "Generate Ideas" button (disabled if `!hasDocuments` with message "Add documents first"). Batch size selector (1-10, default 5).
- **Generating**: Button disabled, progress panel visible. Shows phase indicators derived from SSE events:
  - `round_trip_start` -> "Analyzing documents..." / "Generating ideas..." (based on round trip number)
  - `tool_call_start` (name=search_documents) -> "Searching documents..."
  - `tool_call_start` (name=get_business_profile) -> "Reading profile..."
  - `tool_call_end` -> "Processing results..."
  - `text_delta` -> accumulate and display streaming text
  - `runner_done` -> move to Persisting state
  - `runner_error` -> move to Error state
- **Persisting**: Progress shows "Saving ideas...". Parse the final text output using `parseStructuredOutput` with `IdeaOutputSchema`. Call `POST /api/ai/ideas` with the parsed ideas. On success, trigger `window.location.reload()` to show server-rendered ideas.
- **Error**: Show error message with a "Try Again" button that resets to Idle.

Uses `client:load` hydration directive. Import `IdeaOutputSchema` and `parseStructuredOutput` from library code. Import `buildGenerationSystemPrompt` and `buildGenerationUserPrompt` from the prompts module.

#### 3. Update campaign detail page

**File**: `src/pages/campaigns/[id].astro`

**Intent**: Add the GenerateIdeasPanel component to the campaign detail page, in the campaign header card area.

**Contract**: Import `GenerateIdeasPanel` and render it with `client:load` inside the campaign header card section. Pass `campaignId`, `campaignTitle`, `campaignGoal`, `campaignDescription`, and `hasDocuments` (derived from `sourceDocs.length + insights.length > 0`). Position the component below the campaign info, within or just after the header card.

### Success Criteria:

#### Automated Verification:

- `npx astro sync` completes
- `npm run lint` passes
- `npm run build` passes
- Files exist: `src/lib/ai/sse-client.ts`, `src/components/campaigns/GenerateIdeasPanel.tsx`

#### Manual Verification:

- On a campaign with no documents, the "Generate Ideas" button is disabled with "Add documents first" message
- On a campaign with documents, clicking "Generate Ideas" starts SSE streaming
- Progress phases display in real-time: "Searching documents...", "Generating ideas...", streaming text visible
- When generation completes, "Saving ideas..." appears briefly
- After persistence, ideas are saved to the database (verify via Supabase Dashboard -- the `ideas` table shows new rows for this campaign). The page reloads, but the visual idea display is built and verified in Phase 4.
- On generation error, error message displays with "Try Again" button
- The batch size selector (1-10) works and the number of generated ideas matches the selected count
- Generation can be triggered multiple times (generation_number increments)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Idea Display

### Overview

Build the idea display section on the campaign detail page: fetch ideas server-side in Astro frontmatter, render them in expandable cards above the document sections, grouped by generation batch.

### Changes Required:

#### 1. Fetch ideas in campaign detail frontmatter

**File**: `src/pages/campaigns/[id].astro`

**Intent**: Query the `ideas` table and `idea_fragment_references` for this campaign in the page frontmatter so ideas are server-rendered.

**Contract**: After the existing documents query, add a query for ideas: `supabase.from("ideas").select("*").eq("campaign_id", id).order("generation_number", { ascending: false }).order("created_at", { ascending: true })`. Also query `idea_fragment_references` for all idea IDs, joining with `document_versions` and `documents` to get document titles. Group fragment references by `idea_id` in TypeScript.

#### 2. Ideas section in page template

**File**: `src/pages/campaigns/[id].astro`

**Intent**: Render the "Ideas" section above the Source Documents section. Shows expandable idea cards, grouped by generation batch.

**Contract**: After the campaign header card and GenerateIdeasPanel, before the Source Documents section, add an "Ideas" `<section>`:
- Section header: "Ideas" with count badge
- If no ideas: empty state message "No ideas yet. Generate ideas from your documents."
- If ideas exist: group by `generation_number` (descending). For each generation group, show a subtle header "Generation #N" with count.
- Each idea renders as a `<details>` element (matching existing collapsible pattern):
  - **Summary (collapsed)**: working_title + hook preview (first 100 chars) + status badge
  - **Expanded content**:
    - Full hook text
    - Key points as a bulleted list
    - Key quotes in a styled blockquote area
    - Optional fields (only rendered if non-null): proposed_flow, insights_conclusions, call_to_action, storytelling_angle, target_audience_note, content_format_suggestion -- each with a label
    - Source references section: list of document titles with quote snippets

#### 3. Idea card styling

**File**: `src/pages/campaigns/[id].astro` (inline styles, same file)

**Intent**: Style idea cards consistently with the existing glassmorphism design. Use the same white/10 borders, white/5 backgrounds, and text color scheme.

**Contract**: Idea cards follow the same styling as document cards:
- Outer `<details>`: `rounded-xl border border-white/10 bg-white/5`
- Summary: `cursor-pointer p-4 text-sm font-medium` with working_title in `text-white` and hook in `text-blue-100/60`
- Expanded content: `border-t border-white/10 p-4 space-y-4`
- Key points: `list-disc list-inside text-sm text-blue-100/70`
- Key quotes: `border-l-2 border-purple-400/40 pl-3 text-sm italic text-blue-100/50`
- Optional fields: label in `text-xs text-blue-100/40 uppercase tracking-wider`, value in `text-sm text-blue-100/70`
- Source references: `text-xs text-blue-100/40` with document title in `text-purple-300`

### Success Criteria:

#### Automated Verification:

- `npx astro sync` completes
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- Campaign detail page with generated ideas shows the "Ideas" section above "Source Documents"
- Ideas are grouped by generation number (most recent first)
- Collapsed idea cards show working_title and hook preview
- Expanding an idea shows all populated fields (key_points, key_quotes, optional fields)
- Source references show document titles and quote snippets
- Empty campaign (no ideas) shows "No ideas yet" message
- Idea status badges display with correct styling
- Page loads quickly (ideas are server-rendered, not client-fetched)
- Multiple generation batches are visually distinguished

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Unit Tests:

No test framework configured (per AGENTS.md). Skip.

### Integration Tests:

Not applicable -- no test runner.

### Manual Testing Steps:

1. Sign in, navigate to an existing campaign with documents
2. Verify documents were auto-embedded (check `document_embeddings` table in Supabase Dashboard)
3. Add a new document -- verify it gets auto-embedded (new rows appear in `document_embeddings`)
4. Click "Generate Ideas" with batch size 3 -- verify progress phases display
5. After generation completes, verify ideas appear in the "Ideas" section
6. Expand an idea card -- verify all fields display correctly
7. Verify source references link to actual document content
8. Generate again (batch size 2) -- verify generation_number increments and new ideas appear above old ones
9. Test with a campaign with no documents -- verify button is disabled
10. Test error handling: remove `OPENROUTER_API_KEY` from env, try to generate -- verify error message
11. Run `npm run lint` and `npm run build` to confirm clean CI

## Performance Considerations

- **Embedding latency**: Auto-embedding adds 2-5 seconds to document creation. This is acceptable for MVP since documents are typically added one at a time. If this becomes a bottleneck, consider non-blocking embedding in a future slice.
- **Generation duration**: 30-120 seconds depending on batch size and document volume. SSE streaming ensures the user sees progress throughout. The progress phases UI mitigates perceived wait time.
- **Idea query**: The `idx_ideas_campaign_status` index covers the campaign detail page's ideas query. Fragment references are fetched in a single batched query, not N+1.
- **Page load**: Ideas are server-rendered in Astro frontmatter -- no client-side fetch waterfall. The React component only hydrates for the generation panel.

## Migration Notes

No schema changes needed -- F-01 already provides all required tables, columns, indexes, and enums.

## References

- F-01 plan (schema): `context/changes/app-data-schema/plan.md`
- F-02 plan (AI pipeline): `context/changes/ai-generation-pipeline/plan.md`
- S-01 plan (campaign CRUD): `context/changes/campaign-document-crud/plan.md`
- PRD refs: US-01 (lines 48-60), FR-012 (line 105), FR-014 (line 109)
- Roadmap: `context/foundation/roadmap.md` (S-02, lines 126-137)
- Generate endpoint: `src/pages/api/ai/generate.ts`
- Campaign detail page: `src/pages/campaigns/[id].astro`
- Document creation endpoint: `src/pages/api/campaigns/[id]/documents.ts`
- Embedding service: `src/lib/ai/embeddings/service.ts`
- Agent runner: `src/lib/ai/runner/runner.ts`
- Output parser: `src/lib/ai/runner/output-parser.ts`
- Database types: `src/db/database.types.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Auto-Embed on Document Creation

#### Automated

- [x] 1.1 `npx astro sync` completes — 05e8c35
- [x] 1.2 `npm run lint` passes — 05e8c35
- [x] 1.3 `npm run build` passes — 05e8c35

#### Manual

- [x] 1.4 Adding a source document completes (redirect back to campaign page works) — 05e8c35
- [x] 1.5 Adding a document creates embedding rows in `document_embeddings` with the version ID — 05e8c35
- [x] 1.6 Adding a document without `OPENROUTER_API_KEY` still creates the document (no embeddings) — 05e8c35
- [x] 1.7 `background_operations` row tracks embedding status (`completed` or `failed`) — 05e8c35

### Phase 2: Prompt Templates & Persist Endpoint

#### Automated

- [x] 2.1 `npx astro sync` completes
- [x] 2.2 `npm run lint` passes
- [x] 2.3 `npm run build` passes
- [x] 2.4 Files exist: `src/lib/ai/prompts/schemas.ts`, `src/lib/ai/prompts/generation.ts`, `src/lib/ai/prompts/index.ts`, `src/pages/api/ai/ideas.ts`

#### Manual

- [ ] 2.5 `POST /api/ai/ideas` with valid data inserts ideas and fragment references
- [ ] 2.6 `generation_number` auto-increments correctly (first batch = 1, second = 2)
- [ ] 2.7 Invalid input returns structured error response
- [ ] 2.8 Duplicate document titles resolve correctly to `document_version_id`
- [ ] 2.9 Unmatched document titles still create fragment references with `document_version_id: null`

### Phase 3: Generation UI

#### Automated

- [ ] 3.1 `npx astro sync` completes
- [ ] 3.2 `npm run lint` passes
- [ ] 3.3 `npm run build` passes
- [ ] 3.4 Files exist: `src/lib/ai/sse-client.ts`, `src/components/campaigns/GenerateIdeasPanel.tsx`

#### Manual

- [ ] 3.5 "Generate Ideas" button disabled with "Add documents first" when no documents exist
- [ ] 3.6 Clicking "Generate Ideas" starts SSE streaming
- [ ] 3.7 Progress phases display in real-time (searching, generating, streaming text)
- [ ] 3.8 "Saving ideas..." appears when generation completes
- [ ] 3.9 After persistence, ideas are saved to the database (verify via Supabase Dashboard); page reloads (visual display verified in Phase 4)
- [ ] 3.10 Error state shows message with "Try Again" button
- [ ] 3.11 Batch size selector (1-10) controls number of generated ideas
- [ ] 3.12 Generation can be triggered multiple times (`generation_number` increments)

### Phase 4: Idea Display

#### Automated

- [ ] 4.1 `npx astro sync` completes
- [ ] 4.2 `npm run lint` passes
- [ ] 4.3 `npm run build` passes

#### Manual

- [ ] 4.4 Ideas section appears above Source Documents with expandable cards
- [ ] 4.5 Ideas grouped by generation number (most recent first)
- [ ] 4.6 Collapsed idea cards show working_title and hook preview
- [ ] 4.7 Expanded card shows all populated fields (key_points, key_quotes, optional fields)
- [ ] 4.8 Source references show document titles and quote snippets
- [ ] 4.9 Empty state displays "No ideas yet" message when no ideas exist
- [ ] 4.10 Idea status badges display with correct styling
- [ ] 4.11 Page loads quickly (ideas are server-rendered, not client-fetched)
- [ ] 4.12 Multiple generation batches are visually distinguished
