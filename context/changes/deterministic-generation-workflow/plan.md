# Deterministic Generation Workflow Implementation Plan

## Overview

Replace the non-deterministic, LLM-driven agent loop that currently powers idea generation (F-02) with a **fixed, server-orchestrated pipeline**. Instead of letting the model decide whether and when to call `search_documents` / `get_business_profile` across up to 10 round-trips, the server deterministically: (1) derives rule-based seed queries and retrieves document fragments via the existing hybrid search, (2) injects those tagged fragments plus the business profile into a single structured-output LLM call, and (3) validates and persists the result server-side. SSE remains, but only to stream coarse progress phases — the server now owns parsing and persistence.

"Deterministic" here describes the **workflow control flow** (fixed step count, server-controlled retrieval and persistence — no agentic branching). It does **not** mean reproducible output: ideas stay creative (higher temperature, no seed/cache).

This change supersedes the unbuilt UI phases of the in-flight S-02 `first-gated-generation` and retires the agent runner, the tool layer, and the old generate/persist endpoints.

## Current State Analysis

The generation path today is agentic and non-deterministic:

- **Agent runner** (`src/lib/ai/runner/runner.ts:18`) loops up to `DEFAULT_MAX_ROUND_TRIPS = 10` (`runner.ts:11`). The **LLM decides** whether to call `search_documents` / `get_business_profile`; it may not search, may search redundantly, or may emit a `document_version_id` it never received.
- **Generate endpoint** (`src/pages/api/ai/generate.ts:19`) accepts client-supplied `system_prompt` + `user_prompt` (`generate.ts:12`), runs the loop, and streams `RunnerStreamEvent`s via `createSSEResponse` (`generate.ts:120`). It records a `background_operations` row (`generate.ts:70`) and transitions its status (`generate.ts:95`,`generate.ts:110`).
- **Persistence is client-driven**: the browser parses the final LLM text and POSTs to `/api/ai/ideas` (`src/pages/api/ai/ideas.ts:12`), which resolves provenance by **echoed ID first, then fragile title matching** (`ideas.ts:100`,`ideas.ts:123`).
- **Provider** (`src/lib/ai/providers/openrouter/adapter.ts:225`) implements both `generate()` (non-streaming, `adapter.ts:233`) and `stream()` (`adapter.ts:251`) against the `/responses` endpoint. `buildRequestBody` (`adapter.ts:164`) has **no `response_format` field** — native JSON-schema structured output is not wired.
- **Search service** (`src/lib/ai/search/service.ts:42`) exposes `search(query, campaignId, { limit, strategy })` returning `SearchResult[]` with `chunkText`, `documentVersionId`, `chunkIndex`, `score`, `matchedBy` (`service.ts:7`). RRF helper lives at `src/lib/ai/search/rrf.ts`.
- **Prompts/schema (S-02, landed)**: `buildGenerationSystemPrompt()` / `buildGenerationUserPrompt()` (`src/lib/ai/prompts/generation.ts:15`,`generation.ts:72`) instruct the model to **call tools** — these instructions are now wrong for a deterministic pipeline. `IdeaOutputSchema` / `IdeaSchema` / `SourceReferenceSchema` (`src/lib/ai/prompts/schemas.ts:28`) are reusable with tightening.
- **AI wiring** (`src/lib/ai/index.ts:27`) builds provider + embeddings + search + tool registry + runner. Tools are wired at `index.ts:51`-`index.ts:71`.
- **S-02 UI does not exist**: `src/lib/ai/sse-client.ts` and `src/components/campaigns/GenerateIdeasPanel.tsx` are absent (verified). The campaign detail page `src/pages/campaigns/[id].astro` has no Ideas section. S-02 Phase 1 (auto-embed on document creation) **is** landed.

### Key Discoveries:

- The provider already has a non-streaming `generate()` (`adapter.ts:233`) — usable directly for a single deterministic call, but we keep `stream()` to preserve coarse SSE progress (Transport decision).
- `ProviderRequest` (`src/lib/ai/providers/types.ts:63`) is the single place to add a `responseFormat` field; `buildRequestBody` (`adapter.ts:164`) is the single place to serialize it.
- **Structured-output transport risk**: OpenRouter's structured-outputs docs demonstrate `response_format: { type: "json_schema", json_schema: { name, strict, schema } }` on the **Chat Completions** API. The `/responses` reference the adapter uses lists `model/input/stream/max_output_tokens/temperature/top_p` and does **not** explicitly document `response_format`. Support on `/responses` must be verified; fallback is prompt-instructed JSON + server-side Zod parse with one retry (Failure-mode decision already covers the retry).
- Search returns `documentVersionId` already (`service.ts:9`) — fragment tagging can map a short tag (e.g., `F1`, `F2`) to the real `documentVersionId`, eliminating title matching entirely.
- The persist logic in `ideas.ts:64`-`ideas.ts:154` (idea insert + fragment-reference insert + `generation_number` auto-increment at `ideas.ts:52`) is the reusable core to move into the server-side pipeline; the title-matching fallback (`ideas.ts:123`) is dropped in favour of tag resolution.
- `key_quotes` is `NOT NULL DEFAULT '{}'` in SQL but required `string[]` in the Insert type — always provide at least `[]` (carried from S-02).
- The campaign detail page uses glassmorphism styling (`white/10` borders, `white/5` backgrounds, `<details>` collapsibles) — the Ideas UI must match.

## Desired End State

After this plan is complete:

- A user on the campaign detail page clicks **Generate Ideas** (batch size 1-10, default 5). The client POSTs to a single deterministic endpoint with just `campaign_id` + `batch_size` — **no prompts are sent from the client**.
- The server: derives rule-based seed queries (one per campaign document + one from goal/theme), runs hybrid search per seed, RRF-merges and dedupes into a capped fragment set, tags each fragment, fetches the business profile (or hardcoded defaults), and issues **one** structured-output LLM call that returns all N ideas with tag citations.
- The server validates the output against the schema (one auto-retry on failure, then a clean failure), resolves each cited tag to a real `document_version_id`, and persists ideas + fragment references — all server-side, tracked in `background_operations`.
- The client receives coarse SSE progress phases (retrieving / generating / saving) and, on completion, reloads to show the server-rendered Ideas section above Source Documents.
- The agent runner, tool layer, old `/api/ai/generate`, and the client-called `/api/ai/ideas` persist path are deleted; `ai/index.ts` no longer wires tools or a runner.
- `npx astro sync`, `npm run lint`, and `npm run build` pass.

## What We're NOT Doing

- **Reproducible / cached output** — explicitly rejected; ideas are creative.
- **Multi-step or fan-out LLM generation** — single call returns the whole batch.
- **Auto-chunking large batches into multiple calls** — single call with generous `max_output_tokens`; batch capped at 10.
- **Business profile wizard (S-04)** — server injects hardcoded defaults (now from a single server-side source, ready for S-04 to swap in real data).
- **Idea lifecycle (accept/decline/archive), markdown copy (S-03)**; **manual idea creation (S-05)**; **regeneration (S-06)**; **background-ops dashboard (S-09)**; **RLS (F-03)**.
- **Keeping the agent runner/tools as dead code** — they are deleted (Cleanup decision).
- **Cloudflare Queues/Workflows** — generation stays synchronous-with-SSE within a single request.
- **Reworking the embedding pipeline or document auto-embed** — S-02 Phase 1 stands as-is.

## Implementation Approach

Bottom-up across 6 phases. Phase 1 unlocks structured output at the provider layer (the riskiest dependency) and proves the transport early. Phases 2-3 build the deterministic retrieval + context-assembly primitives. Phase 4 composes them into the orchestrating service and endpoint with server-side persistence. Phase 5 builds the user-facing UI and idea display. Phase 6 deletes the superseded agentic machinery once the new path is proven. Each phase is independently verifiable via lint/build plus manual checks.

## Critical Implementation Details

### State sequencing

The deterministic flow has a fixed server-side order with no LLM-driven branching: (1) verify campaign ownership, (2) create `background_operations` row (`pending` -> `in_progress`), (3) derive seed queries, (4) run hybrid search per seed and RRF-merge/dedupe/cap, (5) tag fragments and fetch profile, (6) assemble prompt and issue one structured-output call, (7) validate output (retry once on failure), (8) resolve tags -> `document_version_id` and persist ideas + fragment references, (9) mark operation `completed`/`failed`. SSE phase events are emitted between these steps; the stream ends after persistence, so the client only reloads — it never parses or persists.

### Debug & observability

Because retrieval is now server-controlled, the set of fragments fed to the model is fully knowable server-side. The generation service should attach the tag->`documentVersionId` map and the seed-query list to the `background_operations.input_ref` (or a debug field) so a failed or low-quality generation can be diagnosed without replaying the LLM call.

### Structured-output transport (verify-then-fallback)

Phase 1 must empirically confirm whether `/responses` honours `response_format: { type: "json_schema", ... }`. Decision rule: if a probe request returns schema-conformant JSON, wire it through `buildRequestBody`. If `/responses` rejects or ignores it, the generation service falls back to prompt-instructed JSON + server-side `IdeaOutputSchema.safeParse` with one auto-retry (Failure-mode decision). Routing the single deterministic call through Chat Completions is a documented secondary fallback but is out of scope unless the primary fails — keep the provider abstraction intact.

---

## Phase 1: Provider Structured-Output Support

### Overview

Add JSON-schema structured-output capability to the provider abstraction and empirically verify it works against the OpenRouter `/responses` endpoint, so downstream phases can rely on schema-conformant output (with a documented prompt-and-parse fallback).

### Changes Required:

#### 1. Add `responseFormat` to the provider request contract

**File**: `src/lib/ai/providers/types.ts`

**Intent**: Give every adapter a way to request schema-constrained JSON output.

**Contract**: Add an optional `responseFormat` field to `ProviderRequest`. Shape mirrors OpenRouter's structured-outputs contract: `{ type: "json_schema"; jsonSchema: { name: string; strict?: boolean; schema: Record<string, unknown> } }`. Export a named type for it.

#### 2. Serialize `responseFormat` in the OpenRouter adapter

**File**: `src/lib/ai/providers/openrouter/adapter.ts`

**Intent**: Translate the abstract `responseFormat` into the wire body for `/responses` and confirm the endpoint honours it.

**Contract**: In `buildRequestBody` (`adapter.ts:164`), when `request.responseFormat` is present, add `response_format: { type: "json_schema", json_schema: { name, strict, schema } }` to the body. No streaming-parser changes are required (structured output still arrives as `response.content_part.delta` text). Add a brief code comment recording the verification result and the prompt-and-parse fallback path.

#### 3. Verification probe

**File**: ad-hoc (manual) — no committed file.

**Intent**: Confirm `/responses` returns schema-conformant JSON before downstream phases depend on it.

**Contract**: Issue a minimal `generate()` call with a trivial `responseFormat` schema against a real model and inspect the output. Record pass/fail in the change notes. If fail, the generation service (Phase 4) uses the prompt-and-parse fallback.

### Success Criteria:

#### Automated Verification:

- `npx astro sync` completes
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- A `generate()` call with a `responseFormat` schema returns valid JSON matching the schema (or the fallback decision is recorded in change notes if `/responses` does not honour it)
- Existing generate flow (pre-cleanup) still builds and runs

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Deterministic Retrieval & Fragment Tagging

### Overview

Build a server-side retrieval module that derives rule-based seed queries, runs the existing hybrid search per seed, merges results via RRF, dedupes, caps the set, and assigns each surviving fragment a stable reference tag mapped to its real `document_version_id`.

### Changes Required:

#### 1. Seed-query derivation

**File**: `src/lib/ai/generation/retrieval.ts` (new)

**Intent**: Produce a deterministic, rule-based set of seed queries — one per campaign document (from title/first content) plus one from campaign goal+theme — with a hard cap on query count to bound cost for large campaigns.

**Contract**: Export `deriveSeedQueries(input: { campaignTitle: string; campaignGoal: string | null; campaignDescription: string | null; documents: { title: string; leadText: string }[] }): string[]`. Rules: always include a goal/theme query; include one query per document (title + short lead) up to a `MAX_SEED_QUERIES` cap (constant, e.g., 12); dedupe identical strings. No LLM involved.

#### 2. Multi-query fan-out + RRF merge + tagging

**File**: `src/lib/ai/generation/retrieval.ts`

**Intent**: Run hybrid search for each seed query, merge across queries with RRF, dedupe by `documentVersionId`+`chunkIndex`, cap the fragment set, and assign each fragment a stable tag.

**Contract**: Export `retrieveTaggedFragments(searchService, campaignId, seedQueries, options?): Promise<TaggedFragment[]>` where `TaggedFragment = { tag: string; chunkText: string; documentVersionId: string; documentTitle: string; chunkIndex: number }`. Run `searchService.search(query, campaignId, { limit })` per seed; merge all result lists with `reciprocalRankFusion` (reuse `src/lib/ai/search/rrf.ts`); dedupe on `documentVersionId:chunkIndex`; cap to `MAX_FRAGMENTS` (constant); assign tags `F1..Fn` in merged-rank order. Tag-to-`documentVersionId` mapping is derivable from the returned array (the persist step reuses it).

**Contract (note)**: `documentTitle` is fetched alongside fragments (join through `document_versions` -> `documents`) for human-readable prompt context and display, but provenance resolution uses the tag->`documentVersionId` map, never the title.

### Success Criteria:

#### Automated Verification:

- `npx astro sync` completes
- `npm run lint` passes
- `npm run build` passes
- File exists: `src/lib/ai/generation/retrieval.ts`

#### Manual Verification:

- For a campaign with multiple documents, `retrieveTaggedFragments` returns a deduped, tag-labelled fragment set covering more than one document
- Seed-query count is capped for a campaign with many documents
- Each returned fragment's `tag` maps to exactly one real `documentVersionId`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Prompts, Schema & Profile Injection

### Overview

Rewrite the generation prompt for the deterministic pipeline — remove all tool-usage instructions, inject the tagged fragments and the business profile directly, and require tag citations. Provide a single server-side profile source and tighten the schema for native structured output.

### Changes Required:

#### 1. Server-side profile resolver

**File**: `src/lib/ai/generation/profile.ts` (new)

**Intent**: One deterministic place to obtain the business profile, falling back to hardcoded defaults when absent (ready for S-04 to swap in real data).

**Contract**: Export `resolveBusinessProfile(supabase, userId): Promise<ResolvedProfile>` returning a normalized profile object (tone, audience, brand goal, archetype, keywords). On missing row or query error, return the hardcoded defaults currently embedded in `generation.ts:18`-`generation.ts:23`. Export the `ResolvedProfile` type.

#### 2. Rewrite generation prompt builders

**File**: `src/lib/ai/prompts/generation.ts`

**Intent**: Replace tool-driven instructions with context-injection instructions: the model receives fragments and profile inline and must cite fragment tags rather than echo IDs.

**Contract**: Change `buildGenerationSystemPrompt(profile: ResolvedProfile)` to embed the resolved profile and instruct: produce raw JSON matching the schema; ground every idea in the provided fragments; cite supporting fragments by their `tag` in each `source_reference`; `key_quotes` must be verbatim from provided fragment text; ideas must be distinct and non-overlapping. Remove all `search_documents` / `get_business_profile` references (`generation.ts:27`-`generation.ts:30`, `generation.ts:62`, `generation.ts:92`-`generation.ts:93`). Change `buildGenerationUserPrompt` to accept `{ campaignTitle, campaignGoal, campaignDescription, batchSize, fragments: TaggedFragment[] }` and render the tagged fragment block (each as `[F1] (<documentTitle>): <chunkText>`).

#### 3. Tighten the output schema for tag-based provenance

**File**: `src/lib/ai/prompts/schemas.ts`

**Intent**: Make `source_references` carry a fragment `tag` and provide a JSON Schema object for native structured output.

**Contract**: Update `SourceReferenceSchema` (`schemas.ts:3`) to `{ tag: string; quote_snippet: string }` (drop `document_version_id` echo and `document_title`; the server owns the tag map). Keep `IdeaSchema` / `IdeaOutputSchema` otherwise. Export a plain JSON Schema constant (`IdeaOutputJsonSchema`) derived from / kept in sync with `IdeaOutputSchema`, suitable for the provider's `responseFormat.jsonSchema.schema` (Phase 1). Update the inferred `IdeaOutput` type accordingly.

#### 4. Prompts barrel update

**File**: `src/lib/ai/prompts/index.ts`

**Intent**: Re-export the new/changed symbols.

**Contract**: Ensure `buildGenerationSystemPrompt`, `buildGenerationUserPrompt`, `IdeaOutputSchema`, `IdeaSchema`, `IdeaOutputJsonSchema`, and `IdeaOutput` are exported.

#### 5. Delete the superseded client persist endpoint

**File**: `src/pages/api/ai/ideas.ts`

**Intent**: The `SourceReferenceSchema` change in step 3 drops `document_version_id` and `document_title`, but `ideas.ts` is the sole consumer of those fields (`ideas.ts:97`,`ideas.ts:100`,`ideas.ts:105`,`ideas.ts:123`,`ideas.ts:129`). As a compiled API route it would fail `npm run build` the moment the schema changes, so it must be removed in the same phase. Server-side persistence replaces it in Phase 4; no UI ever shipped against it.

**Contract**: Delete `src/pages/api/ai/ideas.ts`. Verify no code imports it or POSTs to `/api/ai/ideas` (the new panel uses `/api/ai/generate-ideas`). `generate.ts` is untouched by the schema change and stays until Phase 6.

### Success Criteria:

#### Automated Verification:

- `npx astro sync` completes
- `npm run lint` passes
- `npm run build` passes
- Files exist: `src/lib/ai/generation/profile.ts`; updated `prompts/generation.ts`, `prompts/schemas.ts`
- File removed: `src/pages/api/ai/ideas.ts`

#### Manual Verification:

- `buildGenerationUserPrompt` renders the tagged fragment block readably with one entry per fragment
- System prompt contains the resolved profile and no tool-usage instructions
- `IdeaOutputJsonSchema` matches `IdeaOutputSchema` field-for-field (spot check)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Deterministic Generation Service & Endpoint

### Overview

Compose retrieval, profile, prompt, structured call, validation, and persistence into a single server-orchestrated service exposed by a new endpoint. SSE streams coarse progress phases; the server owns parsing and persistence; `background_operations` tracks the run.

### Changes Required:

#### 1. Generation service

**File**: `src/lib/ai/generation/service.ts` (new)

**Intent**: The deterministic orchestrator — fixed step sequence, one LLM call, server-side validate + persist, emitting coarse progress events.

**Contract**: Export `createGenerationService(deps: { provider; searchService; supabase; userId; campaignId })` with an async-generator `run(params: { batchSize: number }): AsyncGenerator<GenerationProgressEvent>`. Step order matches "State sequencing": fetch campaign documents (title + lead) -> `deriveSeedQueries` -> `retrieveTaggedFragments` -> `resolveBusinessProfile` -> build prompts -> single structured-output `provider.generate(...)` call with `responseFormat` (pass the system prompt via `ProviderRequest.instructions` — **not** as a system-role input message, which `mapInputItems` downgrades to a `[System]:`-prefixed user message at `adapter.ts:115`-`adapter.ts:120`; the user prompt is the sole `input` item, matching the old runner's `systemInstructions` -> `request.instructions` path at `generate.ts:88`) (creative temperature, e.g. ~0.8; generous `maxTokens`) -> validate with `IdeaOutputSchema.safeParse`; on failure retry the call once, then throw a clean error -> resolve each `source_reference.tag` to a `documentVersionId` via the tag map (drop unmatched tags) -> persist ideas + fragment references (reuse the insert + `generation_number` auto-increment logic from `ideas.ts:52`-`ideas.ts:154`, tag-resolution replacing title matching). Yield `GenerationProgressEvent`s: `retrieving`, `generating`, `saving`, `done` (with persisted idea ids), `error`. If `responseFormat` is unsupported (Phase 1 result), use prompt-instructed JSON + parse with the same one-retry policy.

#### 2. Deterministic generate endpoint

**File**: `src/pages/api/ai/generate-ideas.ts` (new)

**Intent**: The single client-facing entry point; accepts only `campaign_id` + `batch_size`, runs the service, streams progress, tracks the operation.

**Contract**: `POST /api/ai/generate-ideas`. Body: `{ campaign_id: uuid, batch_size: int 1..10 (default 5) }` — **no prompts from client**. Flow: auth guard; `OPENROUTER_API_KEY` guard; supabase guard; Zod validate; verify campaign ownership (pattern from `generate.ts:48`); create `background_operations` row (`type: "idea_generation"`, store seed-query/tag-map debug info in `input_ref`); wrap `service.run()` in a tracked async generator that transitions `in_progress` -> `completed`/`failed` (pattern from `generate.ts:94`-`generate.ts:118`); return `createSSEResponse(...)`. Reuse `src/lib/ai/streaming.ts`.

#### 3. Wire the generation service into AI init

**File**: `src/lib/ai/index.ts`

**Intent**: Expose `createGenerationService` from the AI context; stop constructing the tool registry and runner for this path (full removal happens in Phase 6).

**Contract**: Add a `createGenerationService(config)` factory to the returned `AIContext` (composing the existing `provider`, `searchService`, `supabase`, `userId`, `campaignId`). Leave the runner/tool wiring in place only until Phase 6 deletes it.

### Success Criteria:

#### Automated Verification:

- `npx astro sync` completes
- `npm run lint` passes
- `npm run build` passes
- Files exist: `src/lib/ai/generation/service.ts`, `src/pages/api/ai/generate-ideas.ts`

#### Manual Verification:

- `POST /api/ai/generate-ideas` with a valid campaign streams `retrieving` -> `generating` -> `saving` -> `done` phases
- Ideas and fragment references are persisted server-side (verify rows in `ideas` and `idea_fragment_references` in Supabase Dashboard) with no client persist call
- Fragment references resolve to real `document_version_id`s (no nulls when tags are cited correctly); unmatched tags are dropped without error
- `generation_number` auto-increments across repeated runs
- A forced invalid-output scenario triggers exactly one retry, then a clean `error` event and a `failed` operation
- `background_operations` row records seed queries / tag map for debugging

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Generation UI & Idea Display

### Overview

Build the user-facing generation panel (batch selector + coarse progress, server persists so the client only reloads) and the server-rendered Ideas section on the campaign detail page.

### Changes Required:

#### 1. SSE client utility

**File**: `src/lib/ai/sse-client.ts` (new)

**Intent**: Consume the progress SSE stream on the client.

**Contract**: Export `async function* consumeSSE(response: Response): AsyncGenerator<GenerationProgressEvent>`. Read the body stream, split on `\n\n`, parse `data:` lines as JSON, yield events, stop on `[DONE]`. Re-export the `GenerationProgressEvent` type (client-relevant variants).

#### 2. Generation panel component

**File**: `src/components/campaigns/GenerateIdeasPanel.tsx` (new)

**Intent**: Orchestrate the client side of the deterministic flow: gating, batch selection, progress display, reload on completion. No client-side parsing or persistence.

**Contract**: Props: `{ campaignId: string; hasDocuments: boolean }`. States: **Idle** (Generate Ideas button — disabled with "Add documents first" when `!hasDocuments`; batch size selector 1-10, default 5); **Generating** (POST to `/api/ai/generate-ideas`, consume SSE, map phases to labels: `retrieving` -> "Searching documents...", `generating` -> "Generating ideas...", `saving` -> "Saving ideas..."); on `done` -> `window.location.reload()`; on `error` -> **Error** state with a Try Again button resetting to Idle. Hydrate with `client:load`. The client sends only `campaign_id` + `batch_size`.

#### 3. Campaign detail page: panel + server-rendered ideas

**File**: `src/pages/campaigns/[id].astro`

**Intent**: Mount the panel and render persisted ideas server-side above Source Documents.

**Contract**: Import and render `GenerateIdeasPanel` (`client:load`) in the campaign header card with `campaignId` and `hasDocuments` (derived from source docs + insights count). In frontmatter, query `ideas` for the campaign ordered by `generation_number` desc then `created_at` asc, and batch-query `idea_fragment_references` (joined to `document_versions` -> `documents` for titles) grouped by `idea_id`. Render an Ideas `<section>` above Source Documents: count badge; empty state ("No ideas yet..."); group by `generation_number` ("Generation #N"); each idea a `<details>` card (collapsed: `working_title` + hook preview + status badge; expanded: hook, key_points list, key_quotes blockquote, non-null optional fields with labels, source references as document title + quote snippet). Match the existing glassmorphism styling.

### Success Criteria:

#### Automated Verification:

- `npx astro sync` completes
- `npm run lint` passes
- `npm run build` passes
- Files exist: `src/lib/ai/sse-client.ts`, `src/components/campaigns/GenerateIdeasPanel.tsx`

#### Manual Verification:

- On a campaign with no documents, the button is disabled with "Add documents first"
- On a campaign with documents, generating streams progress phases and, on completion, the page reloads showing new ideas
- Ideas appear above Source Documents, grouped by generation number (most recent first)
- Collapsed cards show title + hook; expanded cards show all populated fields and source references with document titles
- Error path shows the error message with a working Try Again button
- Batch size selector controls the number of ideas produced
- Ideas are server-rendered (no client fetch waterfall)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 6: Retire the Agentic Path

### Overview

Delete the agent runner, the tool layer, and the superseded endpoints now that the deterministic pipeline is proven, and unwire them from AI initialization.

### Changes Required:

#### 1. Delete runner and tools

**Files**: `src/lib/ai/runner/` (entire dir: `runner.ts`, `types.ts`, `output-parser.ts`, `index.ts`), `src/lib/ai/tools/` (entire dir: `registry.ts`, `types.ts`, `definitions/`, `index.ts`)

**Intent**: Remove the non-deterministic generation machinery and the tool layer it drove.

**Contract**: Delete both directories. Confirm no remaining imports reference them (the new generation service does not).

#### 2. Delete superseded endpoint

**File**: `src/pages/api/ai/generate.ts`

**Intent**: Remove the old client-prompt SSE endpoint (the client-called persist endpoint `ideas.ts` was already deleted in Phase 3 alongside the schema change; persistence is now server-side in the generation service).

**Contract**: Delete the file. Verify no client code references `/api/ai/generate` (the new panel uses `/api/ai/generate-ideas`).

#### 3. Unwire tools/runner from AI init

**File**: `src/lib/ai/index.ts`

**Intent**: Stop importing and constructing the tool registry and runner.

**Contract**: Remove `createToolRegistry`, tool-definition imports, `createAgentRunner` import, the `toolRegistry` construction (`index.ts:48`-`index.ts:71`), and `createRunner` from `AIContext` (`index.ts:20`,`index.ts:78`). Keep `provider`, `embeddingService`, `searchService`, and the new `createGenerationService`. `userId`/`campaignId` config remains (used by the generation service).

#### 4. Prune now-dead exports

**Files**: `src/lib/ai/prompts/generation.ts` (and any leftover tool-era helpers)

**Intent**: Remove references to deleted symbols and any output-parser usage.

**Contract**: Ensure no module imports `output-parser`, `runner`, or `tools`. Remove dead re-exports.

### Success Criteria:

#### Automated Verification:

- `npx astro sync` completes
- `npm run lint` passes (no unused-import or unresolved-import errors)
- `npm run build` passes
- Directories removed: `src/lib/ai/runner/`, `src/lib/ai/tools/`; file removed: `src/pages/api/ai/generate.ts` (`ideas.ts` already removed in Phase 3)
- `rg -n "runner|toolRegistry|/api/ai/generate\b|/api/ai/ideas|output-parser" src` returns no live references

#### Manual Verification:

- End-to-end generation still works via `/api/ai/generate-ideas` after deletions
- The campaign detail page generates and displays ideas with no console/network errors referencing removed endpoints

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Unit Tests:

No test framework is configured (per AGENTS.md). Skip.

### Integration Tests:

Not applicable — no test runner.

### Manual Testing Steps:

1. Sign in; open a campaign with multiple embedded documents.
2. Click Generate Ideas (batch size 3); observe `retrieving` -> `generating` -> `saving` phases.
3. On reload, verify 3 ideas appear above Source Documents, grouped under Generation #1.
4. Expand an idea; verify key_points, key_quotes, optional fields, and source references with real document titles.
5. In Supabase Dashboard, verify `idea_fragment_references` rows have non-null `document_version_id`s for cited fragments.
6. Generate again (batch size 2); verify Generation #2 appears above #1 and `generation_number` incremented.
7. Open a campaign with no documents; verify the button is disabled with "Add documents first".
8. Remove `OPENROUTER_API_KEY`; verify a clean error path (503/error event), no partial writes.
9. Inspect a `background_operations` row; confirm seed queries / tag map are recorded.
10. Run `npx astro sync`, `npm run lint`, `npm run build` — all clean.

## Performance Considerations

- **Retrieval fan-out**: query count is capped (`MAX_SEED_QUERIES`); each search embeds its query and runs two RPCs. For large campaigns this is the main added cost vs. the single agentic search — the cap bounds it. Searches can be issued concurrently (`Promise.all`) to limit wall-clock impact.
- **Single LLM call**: replaces up to 10 round-trips — strictly cheaper and lower-latency than the agent loop. Generous `max_output_tokens` covers a 10-idea batch; the batch cap prevents truncation.
- **Generation duration**: dominated by the one LLM call (tens of seconds). Coarse SSE phases preserve perceived progress without per-token streaming complexity.
- **Idea display**: server-rendered with the existing `idx_ideas_campaign_status` index; fragment references batched (no N+1).
- **Workers CPU**: I/O-bound (search RPCs + one LLM call); no multi-round-trip JSON accumulation, reducing CPU pressure vs. the runner.

## Migration Notes

No schema changes — F-01 provides all required tables/columns/indexes/enums. The `source_references` shape change is confined to the LLM contract and the in-memory tag map; the `idea_fragment_references` table (`idea_id`, `document_version_id`, `quote_snippet`) is unchanged. Deleting `/api/ai/ideas` removes a client-facing endpoint — safe because no UI shipped against it (S-02 UI never built).

## References

- Roadmap: `context/foundation/roadmap.md` (F-02 lines 84-95, S-02 lines 126-137)
- PRD: `context/foundation/prd.md` (FR-012 line 105, FR-014 line 109, US-01 lines 48-60)
- Superseded S-02 plan: `context/changes/first-gated-generation/plan.md`
- F-02 plan (pipeline): `context/changes/ai-generation-pipeline/plan.md`
- Agent runner (to delete): `src/lib/ai/runner/runner.ts`
- Generate endpoint (to delete): `src/pages/api/ai/generate.ts`
- Persist endpoint (to absorb + delete): `src/pages/api/ai/ideas.ts`
- Provider adapter: `src/lib/ai/providers/openrouter/adapter.ts`
- Provider types: `src/lib/ai/providers/types.ts`
- Search service: `src/lib/ai/search/service.ts`; RRF: `src/lib/ai/search/rrf.ts`
- Prompts/schema: `src/lib/ai/prompts/generation.ts`, `src/lib/ai/prompts/schemas.ts`
- AI init: `src/lib/ai/index.ts`
- Campaign detail page: `src/pages/campaigns/[id].astro`
- OpenRouter structured outputs: https://openrouter.ai/docs/guides/features/structured-outputs

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Provider Structured-Output Support

#### Automated

- [x] 1.1 `npx astro sync` completes — 88f59e9
- [x] 1.2 `npm run lint` passes — 88f59e9
- [x] 1.3 `npm run build` passes — 88f59e9

#### Manual

- [ ] 1.4 `generate()` with a `responseFormat` schema returns schema-conformant JSON (or fallback recorded in change notes)
- [ ] 1.5 Existing generate flow still builds and runs

### Phase 2: Deterministic Retrieval & Fragment Tagging

#### Automated

- [x] 2.1 `npx astro sync` completes — 06bfd5d
- [x] 2.2 `npm run lint` passes — 06bfd5d
- [x] 2.3 `npm run build` passes — 06bfd5d
- [x] 2.4 File exists: `src/lib/ai/generation/retrieval.ts` — 06bfd5d

#### Manual

- [ ] 2.5 Returns a deduped, tag-labelled fragment set covering multiple documents
- [ ] 2.6 Seed-query count is capped for a many-document campaign
- [ ] 2.7 Each fragment `tag` maps to exactly one real `documentVersionId`

### Phase 3: Prompts, Schema & Profile Injection

#### Automated

- [x] 3.1 `npx astro sync` completes — 8797597
- [x] 3.2 `npm run lint` passes — 8797597
- [x] 3.3 `npm run build` passes — 8797597
- [x] 3.4 Files exist: `src/lib/ai/generation/profile.ts`; updated `prompts/generation.ts`, `prompts/schemas.ts`; removed `src/pages/api/ai/ideas.ts` — 8797597

#### Manual

- [ ] 3.5 User prompt renders the tagged fragment block readably
- [ ] 3.6 System prompt contains the resolved profile and no tool-usage instructions
- [ ] 3.7 `IdeaOutputJsonSchema` matches `IdeaOutputSchema` (spot check)

### Phase 4: Deterministic Generation Service & Endpoint

#### Automated

- [x] 4.1 `npx astro sync` completes — f69d542
- [x] 4.2 `npm run lint` passes — f69d542
- [x] 4.3 `npm run build` passes — f69d542
- [x] 4.4 Files exist: `src/lib/ai/generation/service.ts`, `src/pages/api/ai/generate-ideas.ts` — f69d542

#### Manual

- [ ] 4.5 Endpoint streams `retrieving` -> `generating` -> `saving` -> `done`
- [ ] 4.6 Ideas + fragment references persisted server-side (no client persist call)
- [ ] 4.7 Fragment references resolve to real `document_version_id`s; unmatched tags dropped without error
- [ ] 4.8 `generation_number` auto-increments across runs
- [ ] 4.9 Invalid output triggers exactly one retry, then clean `error` + `failed` operation
- [ ] 4.10 `background_operations` records seed queries / tag map

### Phase 5: Generation UI & Idea Display

#### Automated

- [x] 5.1 `npx astro sync` completes — 93884a2
- [x] 5.2 `npm run lint` passes — 93884a2
- [x] 5.3 `npm run build` passes — 93884a2
- [x] 5.4 Files exist: `src/lib/ai/sse-client.ts`, `src/components/campaigns/GenerateIdeasPanel.tsx` — 93884a2

#### Manual

- [ ] 5.5 Button disabled with "Add documents first" when no documents
- [ ] 5.6 Generating streams phases; page reloads showing new ideas on completion
- [ ] 5.7 Ideas render above Source Documents, grouped by generation number (newest first)
- [ ] 5.8 Collapsed cards show title + hook; expanded show all fields + source references
- [ ] 5.9 Error path shows message with working Try Again button
- [ ] 5.10 Batch size selector controls number of ideas
- [ ] 5.11 Ideas are server-rendered (no client fetch waterfall)

### Phase 6: Retire the Agentic Path

#### Automated

- [x] 6.1 `npx astro sync` completes
- [x] 6.2 `npm run lint` passes
- [x] 6.3 `npm run build` passes
- [x] 6.4 `runner/` and `tools/` dirs removed; `generate.ts` endpoint removed (`ideas.ts` already removed in Phase 3)
- [x] 6.5 `rg -n "runner|toolRegistry|/api/ai/generate\b|/api/ai/ideas|output-parser" src` returns no live references

#### Manual

- [ ] 6.6 End-to-end generation still works via `/api/ai/generate-ideas` after deletions
- [ ] 6.7 Campaign detail page generates + displays ideas with no errors referencing removed endpoints
