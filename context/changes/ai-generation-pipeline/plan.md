# AI Generation Pipeline Implementation Plan

## Overview

Build the foundational AI generation infrastructure (F-02) for ContentForge. This includes a full multi-provider LLM abstraction layer with an OpenRouter Responses API adapter, a document embedding pipeline with paragraph-based chunking, hybrid RAG search (pgvector + Postgres full-text search with RRF fusion), a tools interface with registry and execution loop, a multi-step agent runner with streaming and configurable round-trip limits, and JSON API endpoints under `/api/ai/`. This foundation enables all downstream AI features: S-02 (first gated generation), S-05 (manual idea creation), S-06 (idea regeneration), and S-09 (background operations status).

## Current State Analysis

- **Schema (F-01) is deployed**: 9 tables including `document_embeddings` with `vector(1536)`, `background_operations` with AI operation types, `ideas` with structured fields, `idea_fragment_references` for provenance. TypeScript types generated in `src/db/database.types.ts`.
- **Zero AI code exists**: No LLM client, no embedding logic, no provider abstraction, no agent runner. No AI-related npm dependencies (no `zod`, no AI SDKs).
- **Existing API pattern is form-based redirects**: All 5 endpoints parse `formData()` and return `context.redirect()`. AI endpoints will establish a new JSON API pattern.
- **Supabase client returns `null`** when env vars missing (`src/lib/supabase.ts:7-9`). Same pattern needed for OpenRouter API key.
- **Cloudflare Workers runtime**: `nodejs_compat` enabled, no Queues/Workflows/Durable Objects configured. AI operations will run synchronously with streaming SSE responses.
- **No vector index** on `document_embeddings.embedding` -- only a GIN index on `metadata` jsonb. Sequential scan for similarity search until index is added.
- **Astro env schema** in `astro.config.mjs:18-22` uses `envField` for typed server secrets. `OPENROUTER_API_KEY` needs to be added.

## Desired End State

After this plan is complete:
- An `OPENROUTER_API_KEY` environment variable powers all AI operations.
- A provider abstraction layer (`src/lib/ai/providers/`) supports registering multiple LLM providers. An OpenRouter adapter uses the Responses API to call models like `anthropic/claude-sonnet-4-20250514`.
- Documents added to campaigns are automatically chunked (paragraph-based) and embedded via OpenRouter's embeddings endpoint, stored in `document_embeddings` with both vector and tsvector columns.
- A hybrid RAG search combines pgvector cosine similarity and Postgres full-text search via Supabase RPC functions, merged with Reciprocal Rank Fusion.
- A tools interface allows defining tools (e.g., `search_documents`, `get_business_profile`) that the LLM can call during generation.
- An agent runner executes multi-step generation loops: LLM calls tools, receives results, and iterates until producing structured output -- with a configurable max of 10 round-trips.
- JSON API endpoints under `/api/ai/` support streaming SSE responses and write to `background_operations` for status tracking.
- `npm run lint` and `npm run build` pass with all new code.

### Key Discoveries:

- Supabase JS client communicates over HTTPS to PostgREST -- no raw TCP connections, no connection pooling needed from Workers.
- pgvector queries must use Supabase RPC (Postgres functions) since PostgREST doesn't support `<=>` operator directly.
- `astro:env/server` provides typed access to server secrets; adding `OPENROUTER_API_KEY` requires `astro.config.mjs` change + `npx astro sync`.
- OpenRouter Responses API is stateless and beta -- full conversation history must be included per request; response format uses `output[]` array with `message`/`reasoning`/`function_call` items.
- OpenRouter also supports the `/embeddings` endpoint for `openai/text-embedding-3-small` at 1536 dimensions, matching the existing schema.

## What We're NOT Doing

- **No UI components**: This is infrastructure only. No React components, no pages, no forms. S-02 builds the generation UI.
- **No prompt engineering**: Prompt templates for idea generation belong to S-02. This plan builds the pipeline that S-02 feeds prompts into.
- **No Cloudflare Queues/Workflows**: Generation runs synchronously with streaming. If future load requires true async, that's a separate change.
- **No RLS policies**: F-03 handles authorization. AI endpoints will filter by `user_id` application-side.
- **No second provider adapter**: Only OpenRouter. Additional providers (direct OpenAI, Gemini) can be added later by implementing the Provider interface.
- **No document upload parsing**: Documents are plain text per PRD. No PDF/DOCX parsing.

## Implementation Approach

Bottom-up: types and abstractions first, then concrete implementations, then integration endpoints. Each phase produces testable artifacts. The provider abstraction follows the checklist in `context/docs/providers-implementation-checklist.md`. The tools interface follows `context/docs/tools-interface-checklist.md`. The embedding and RAG layer uses Supabase RPC functions for vector and full-text search, merged with Reciprocal Rank Fusion.

## Critical Implementation Details

- **Timing & lifecycle**: The embedding pipeline hooks into document creation. The existing POST `/api/campaigns/[id]/documents` endpoint creates documents but does NOT call the embedding pipeline -- that wiring happens in Phase 4 but the actual hook-up into the existing endpoint is deferred to S-01's revision or a follow-up. For F-02, the embedding service is callable but not auto-triggered.
- **State sequencing**: The agent runner must accumulate function_call arguments across streaming deltas before dispatching tool execution. OpenRouter streams `function_call_arguments.delta` events incrementally -- the runner must buffer the full JSON string before parsing.

---

## Phase 1: Environment & Dependencies

### Overview

Add the OpenRouter API key to the environment schema, install zod for schema validation, and update configuration files. This phase establishes the foundation for all subsequent phases.

### Changes Required:

#### 1. Astro env schema

**File**: `astro.config.mjs`

**Intent**: Add `OPENROUTER_API_KEY` as an optional server secret so AI features degrade gracefully when the key is missing, matching the existing Supabase pattern.

**Contract**: New `envField.string()` entry in the `env.schema` object alongside `SUPABASE_URL` and `SUPABASE_KEY`.

#### 2. Environment example files

**File**: `.env.example`

**Intent**: Document the new environment variable so developers know to set it.

**Contract**: Add `OPENROUTER_API_KEY=` line.

#### 3. Install zod

**Intent**: Add zod as a production dependency for validating LLM responses, tool arguments, and API request bodies.

**Contract**: `npm install zod` -- adds to `dependencies` in `package.json`.

#### 4. Regenerate Astro types

**Intent**: Run `npx astro sync` so TypeScript recognizes the new `OPENROUTER_API_KEY` import from `astro:env/server`.

**Contract**: `.astro/` directory updated with new env types.

### Success Criteria:

#### Automated Verification:

- `npx astro sync` completes without errors
- `npm run lint` passes
- `npm run build` passes (with dummy/missing OPENROUTER_API_KEY -- should not break build)
- `import { OPENROUTER_API_KEY } from "astro:env/server"` resolves in TypeScript

#### Manual Verification:

- `.env.example` contains all three env vars

---

## Phase 2: Provider Abstraction Layer

### Overview

Build the complete multi-provider LLM abstraction per `context/docs/providers-implementation-checklist.md`. This includes core types, provider registry, and the OpenRouter Responses API adapter.

### Changes Required:

#### 1. Core type definitions

**File**: `src/lib/ai/providers/types.ts`

**Intent**: Define the Provider interface, ProviderRequest, ProviderResponse, ProviderInputItem, ProviderOutputItem, ProviderStreamEvent, ProviderUsage, and FinishReason types. These are the contracts that all providers implement and all consumers depend on.

**Contract**: All types from Section 1 of `context/docs/providers-implementation-checklist.md`. Key interfaces: `Provider` (with `name`, `generate`, `stream`), `ProviderRequest` (with `model`, `instructions`, `input`, `tools`, `stream`, `temperature`, `maxTokens`, `signal`), `ProviderStreamEvent` discriminated union (text_delta, text_done, function_call_delta, function_call_done, reasoning_delta, reasoning_done, done, error). Also export `isAbortError()` and `throwIfAborted()` helpers.

#### 2. Provider registry

**File**: `src/lib/ai/providers/registry.ts`

**Intent**: Implement the provider registry that stores, retrieves, and resolves providers by name. Supports the `"provider:model"` string format for model resolution.

**Contract**: Exports `registerProvider(provider)`, `getProvider(name)`, `listProviders()`, `parseModelString(modelString)`, `resolveProvider(modelString)` per Section 2 of the checklist.

#### 3. OpenRouter adapter

**File**: `src/lib/ai/providers/openrouter/adapter.ts`

**Intent**: Implement the Provider interface for OpenRouter's Responses API. Handles input mapping (our types to Responses API format), output mapping (Responses API format to our types), streaming via SSE, and tool calling.

**Contract**: Factory function `createOpenRouterProvider(config: OpenRouterConfig): Provider`. Config includes `apiKey`, optional `name` (default `"openrouter"`), optional `baseUrl` (default `"https://openrouter.ai/api/v1"`), optional `defaultModel`. The `generate` method POSTs to `/responses` with `stream: false`. The `stream` method POSTs with `stream: true` and yields `ProviderStreamEvent` items by parsing SSE lines. Input mapping converts `ProviderInputItem[]` to the Responses API `input` array format (message items with `type: "message"`, `role`, `content` array of `input_text`/`output_text`). Function calls map to `type: "function_call"` / `type: "function_call_output"` items in the input array.

#### 4. OpenRouter adapter re-export

**File**: `src/lib/ai/providers/openrouter/index.ts`

**Intent**: Barrel export for the OpenRouter provider module.

**Contract**: Re-exports `createOpenRouterProvider` and `OpenRouterConfig`.

#### 5. Provider initialization

**File**: `src/lib/ai/providers/index.ts`

**Intent**: Barrel export for the providers module and a factory function that creates and registers the OpenRouter provider if the API key is available.

**Contract**: Exports all types from `types.ts`, registry functions from `registry.ts`, and `createOpenRouterProvider` from `openrouter/`. Also exports `initializeProviders(config: { openrouterApiKey?: string })` which conditionally creates and registers the OpenRouter provider.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes with all new files
- `npm run build` passes
- TypeScript compiles without errors -- all provider types are consistent

#### Manual Verification:

- Provider can be instantiated with a test API key
- `resolveProvider("openrouter:anthropic/claude-sonnet-4-20250514")` returns the correct provider and model

---

## Phase 3: Tools Interface

### Overview

Build the tools interface per `context/docs/tools-interface-checklist.md`. This includes types, registry, and initial tool definitions that the agent runner will use during generation.

### Changes Required:

#### 1. Tool type definitions

**File**: `src/lib/ai/tools/types.ts`

**Intent**: Define ToolResult, ToolHandler, ToolType, FunctionTool (definition sent to LLM), Tool (full definition + handler), and ToolRegistry interface.

**Contract**: All types from Section 1 of `context/docs/tools-interface-checklist.md`. `ToolResult` is `{ ok: true; output: string } | { ok: false; error: string }`. `ToolHandler` is `(args: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolResult>`. `Tool` combines `type: ToolType`, `definition: FunctionTool`, `handler: ToolHandler`.

#### 2. Tool registry factory

**File**: `src/lib/ai/tools/registry.ts`

**Intent**: Implement `createToolRegistry()` that returns a `ToolRegistry` instance using a `Map<string, Tool>` for O(1) lookup.

**Contract**: `register(tool)`, `get(name)`, `list()` (returns `FunctionTool[]`), `execute(name, args, signal?)` with three error cases (tool not found, signal aborted, handler threw).

#### 3. Search documents tool

**File**: `src/lib/ai/tools/definitions/search-documents.ts`

**Intent**: Define a tool that lets the LLM search campaign documents using the hybrid RAG search (built in Phase 5). The tool accepts a query string and campaign_id, returns relevant document chunks with similarity scores.

**Contract**: Tool name `search_documents`. Parameters: `query` (string, required), `campaign_id` (string, required), `limit` (number, optional, default 10). Handler calls the hybrid search service (Phase 5). Output is JSON string of matched chunks with text, document title, similarity score.

#### 4. Get business profile tool

**File**: `src/lib/ai/tools/definitions/get-business-profile.ts`

**Intent**: Define a tool that lets the LLM retrieve the user's business profile for brand-aligned generation.

**Contract**: Tool name `get_business_profile`. Parameters: `user_id` (string, required). Handler queries `business_profiles` table via Supabase. Output is JSON string of profile fields (tone_of_voice, audience, keywords, archetype, etc.).

#### 5. Tools barrel exports

**File**: `src/lib/ai/tools/definitions/index.ts`
**File**: `src/lib/ai/tools/index.ts`

**Intent**: Barrel exports for tool definitions and the tools module.

**Contract**: `definitions/index.ts` exports `searchDocumentsTool` and `getBusinessProfileTool`. Root `index.ts` exports all types, `createToolRegistry`, and all tool definitions.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` passes
- Tool JSON schemas are valid (each has `type: 'object'`, `properties`, `required`)

#### Manual Verification:

- `createToolRegistry()` can register both tools and `list()` returns their definitions

**Implementation Note**: The `search_documents` tool depends on the hybrid search service from Phase 5. During Phase 3, the handler can be a stub that returns `{ ok: false, error: "Search service not initialized" }`. It gets wired to the real search service in Phase 5 or Phase 6.

---

## Phase 4: Embedding Pipeline

### Overview

Build the document chunking and embedding pipeline. When a document is created or updated, its content is split into paragraph-based chunks and each chunk is embedded via OpenRouter's embeddings API, then stored in `document_embeddings`.

### Changes Required:

#### 1. Text chunking utility

**File**: `src/lib/ai/embeddings/chunker.ts`

**Intent**: Split document text into paragraph-based chunks suitable for embedding. Handles merging short paragraphs and splitting overly long ones to stay within reasonable token limits (~500 tokens per chunk).

**Contract**: Export `chunkText(text: string, options?: { maxTokensPerChunk?: number }): Array<{ index: number; text: string }>`. Splits on double newlines (`\n\n`). Merges consecutive chunks that are below a minimum size threshold. Splits single paragraphs exceeding `maxTokensPerChunk` at sentence boundaries. Returns array of `{ index, text }` objects with sequential chunk indices.

#### 2. Embedding client

**File**: `src/lib/ai/embeddings/client.ts`

**Intent**: Call OpenRouter's embeddings endpoint to generate vector embeddings for text chunks. Uses the same OpenRouter API key as the provider layer.

**Contract**: Export `createEmbeddingClient(apiKey: string)` returning an object with `embed(text: string): Promise<number[]>` and `embedBatch(texts: string[], batchSize?: number): Promise<number[][]>`. Uses `POST https://openrouter.ai/api/v1/embeddings` with model `openai/text-embedding-3-small`. Returns 1536-dimensional float arrays. Includes retry logic with exponential backoff (max 3 retries).

#### 3. Embedding service

**File**: `src/lib/ai/embeddings/service.ts`

**Intent**: Orchestrate the full embedding pipeline: chunk a document's content, generate embeddings, and store them in `document_embeddings` via Supabase. Also handles re-embedding when document content changes (delete old embeddings for the version, insert new ones).

**Contract**: Export `createEmbeddingService(supabase: SupabaseClient, embeddingClient: EmbeddingClient)` returning `{ embedDocument(documentVersionId: string, content: string): Promise<void> }`. Internally: chunks the content, batches embedding calls, inserts rows into `document_embeddings` with `document_version_id`, `chunk_index`, `chunk_text`, `embedding` (as string-encoded array), and populates `metadata` with `{ token_count }`.

#### 4. Embeddings barrel export

**File**: `src/lib/ai/embeddings/index.ts`

**Intent**: Barrel export for the embeddings module.

**Contract**: Exports `chunkText`, `createEmbeddingClient`, `createEmbeddingService`.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` passes
- TypeScript types align with `document_embeddings` table schema in `database.types.ts`

#### Manual Verification:

- Given a test document text, `chunkText()` produces reasonable paragraph-based chunks
- Given a test API key, `embedBatch()` returns 1536-dimensional arrays from OpenRouter
- Given a Supabase client, `embedDocument()` inserts rows into `document_embeddings`

---

## Phase 5: Hybrid RAG Search

### Overview

Build the hybrid retrieval system that combines pgvector cosine similarity search with Postgres full-text search (tsvector), merged via Reciprocal Rank Fusion. This includes a Supabase migration for the tsvector column and RPC functions, plus the TypeScript search service.

### Changes Required:

#### 1. Supabase migration -- tsvector column + search functions

**File**: `supabase/migrations/<timestamp>_add_search_functions.sql`

**Intent**: Add a generated `fts` tsvector column to `document_embeddings` for full-text search, create GIN indexes for both FTS and vector search, and create RPC functions for vector similarity search, full-text search, and a combined hybrid search.

**Contract**: Migration adds:
- `ALTER TABLE document_embeddings ADD COLUMN fts tsvector GENERATED ALWAYS AS (to_tsvector('english', chunk_text)) STORED;`
- `CREATE INDEX document_embeddings_fts ON document_embeddings USING gin (fts);`
- `CREATE INDEX document_embeddings_embedding_idx ON document_embeddings USING hnsw (embedding vector_cosine_ops);` (HNSW index for vector search performance)
- RPC function `match_document_chunks(query_embedding vector(1536), match_threshold float, match_count int, filter_campaign_id uuid DEFAULT NULL)` that returns `(id, document_version_id, chunk_index, chunk_text, similarity)` sorted by cosine similarity
- RPC function `search_document_chunks(search_query text, result_limit int DEFAULT 20, filter_campaign_id uuid DEFAULT NULL)` that returns `(id, document_version_id, chunk_index, chunk_text, rank)` using `websearch_to_tsquery`

#### 2. Regenerate database types

**Intent**: Run the Supabase type generation to pick up the new RPC functions and tsvector column.

**Contract**: `npx supabase gen types typescript --local > src/db/database.types.ts` (or equivalent command matching project setup).

#### 3. Reciprocal Rank Fusion utility

**File**: `src/lib/ai/search/rrf.ts`

**Intent**: Implement the RRF algorithm that merges ranked results from vector and full-text search into a single ranked list.

**Contract**: Export `reciprocalRankFusion<T>(vectorResults: RankedResult<T>[], ftsResults: RankedResult<T>[], k?: number): RRFResult<T>[]`. Uses `k=60` default. Each result carries `id`, `rrfScore`, `vectorRank | null`, `ftsRank | null`, `matchedBy: ("vector" | "fts")[]`. Sorted by `rrfScore` descending.

#### 4. Search service

**File**: `src/lib/ai/search/service.ts`

**Intent**: Orchestrate hybrid search by calling both Supabase RPC functions (vector and FTS), merging results with RRF, and enriching with document metadata.

**Contract**: Export `createSearchService(supabase: SupabaseClient, embeddingClient: EmbeddingClient)` returning `{ search(query: string, campaignId: string, options?: { limit?: number; strategy?: "hybrid" | "vector" | "fts" }): Promise<SearchResult[]> }`. `SearchResult` includes `chunkText`, `documentVersionId`, `chunkIndex`, `score`, `matchedBy`. The service embeds the query string, calls both RPC functions, applies RRF, and returns top-K results.

#### 5. Search barrel export

**File**: `src/lib/ai/search/index.ts`

**Intent**: Barrel export for the search module.

**Contract**: Exports `reciprocalRankFusion`, `createSearchService`, and related types.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db push` (or `supabase migration up`)
- `npm run lint` passes
- `npm run build` passes
- Database types regenerated successfully

#### Manual Verification:

- With seeded document embeddings, `match_document_chunks` RPC returns ranked results
- With seeded document chunks, `search_document_chunks` RPC returns FTS-ranked results
- `createSearchService(...).search("test query", campaignId)` returns merged hybrid results

**Implementation Note**: After this phase, wire the `search_documents` tool handler (Phase 3 stub) to the real search service.

---

## Phase 6: Agent Runner

### Overview

Build the multi-step agent runner that orchestrates LLM generation with tool calling. The runner manages the conversation loop: send messages to the LLM, dispatch tool calls, feed results back, and iterate until the LLM produces a final response or the round-trip limit is reached. Supports streaming via async iterables.

### Changes Required:

#### 1. Agent runner types

**File**: `src/lib/ai/runner/types.ts`

**Intent**: Define types for the agent runner configuration, execution context, and output. Includes Zod schemas for structured LLM output validation.

**Contract**: Export `AgentRunnerConfig` (model string, max round-trips, temperature, system instructions, tools list), `AgentRunnerContext` (provider, tool registry, supabase client, user_id), `AgentRunnerResult` (final output items, usage totals, round-trip count, tool calls log). Also export `RunnerStreamEvent` extending `ProviderStreamEvent` with additional lifecycle events (`tool_call_start`, `tool_call_end`, `round_trip_start`, `round_trip_end`, `runner_done`, `runner_error`).

#### 2. Agent runner implementation

**File**: `src/lib/ai/runner/runner.ts`

**Intent**: Implement the agent loop. The runner calls the provider's `stream` method, processes events, dispatches tool calls to the tool registry, accumulates tool results, and re-submits to the LLM until no more tool calls are made or the round-trip limit is reached.

**Contract**: Export `createAgentRunner(config: AgentRunnerConfig, context: AgentRunnerContext)` returning `{ run(input: ProviderInputItem[]): AsyncIterable<RunnerStreamEvent> }`. The `run` method:
1. Sends initial input to the provider via `stream()`
2. Collects the response -- if it contains `function_call` output items, dispatches each to `toolRegistry.execute()`
3. Appends function_call and function_result items to the conversation history
4. Re-submits to the provider for the next round-trip
5. Repeats until: (a) response has no function calls (natural completion), or (b) round-trip count reaches `config.maxRoundTrips` (default 10)
6. On max round-trips, forces one final provider call with instructions to produce output without tool calls
7. Yields `RunnerStreamEvent` items throughout for streaming to clients

#### 3. Structured output parser

**File**: `src/lib/ai/runner/output-parser.ts`

**Intent**: Parse and validate the LLM's final text output as structured JSON using Zod schemas. Handles common LLM output issues (markdown code fences around JSON, trailing commas, etc.).

**Contract**: Export `parseStructuredOutput<T>(text: string, schema: z.ZodSchema<T>): { ok: true; data: T } | { ok: false; error: string }`. Strips markdown code fences, attempts `JSON.parse`, then validates with the Zod schema. Returns typed result or descriptive error.

#### 4. Runner barrel export

**File**: `src/lib/ai/runner/index.ts`

**Intent**: Barrel export for the runner module.

**Contract**: Exports `createAgentRunner`, `parseStructuredOutput`, and all types.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` passes
- TypeScript compiles all runner types without errors

#### Manual Verification:

- Agent runner can complete a simple generation (no tools) -- provider streams text, runner yields events, returns result
- Agent runner dispatches a tool call, receives the result, and continues to the next round-trip
- Agent runner respects max round-trip limit and produces output
- `parseStructuredOutput` correctly parses valid JSON and rejects invalid input

---

## Phase 7: API Endpoints & Integration

### Overview

Create JSON API endpoints under `/api/ai/` that expose the AI pipeline to the frontend. Wire up all components: provider initialization, tool registry, embedding service, search service, and agent runner. Establish the streaming SSE response pattern and background_operations tracking.

### Changes Required:

#### 1. AI service initialization

**File**: `src/lib/ai/index.ts`

**Intent**: Top-level barrel export and initialization function that wires all AI subsystems together. Creates provider, embedding client, search service, tool registry with real tool implementations, and provides a factory for agent runners.

**Contract**: Export `initializeAI(config: { openrouterApiKey: string; supabase: SupabaseClient })` returning `AIContext` with `provider`, `embeddingService`, `searchService`, `toolRegistry`, `createRunner(options)`. Also export `type AIContext`. This is the single entry point that downstream API routes use.

#### 2. Embed document endpoint

**File**: `src/pages/api/ai/embed.ts`

**Intent**: JSON API endpoint to trigger embedding for a specific document version. Called after document creation/update. Returns immediately with the embedding result (synchronous since embedding is fast -- a few seconds for typical documents).

**Contract**: `POST /api/ai/embed` with JSON body `{ document_version_id: string, content: string }`. Returns JSON `{ ok: true, chunks_count: number }` or `{ ok: false, error: string }`. Requires authenticated user (checks `context.locals.user`). Creates a `background_operations` row with type `document_ingestion`.

#### 3. Generate ideas endpoint (streaming)

**File**: `src/pages/api/ai/generate.ts`

**Intent**: JSON API endpoint to run idea generation via the agent runner with streaming SSE response. This is the core generation endpoint that S-02 will call.

**Contract**: `POST /api/ai/generate` with JSON body `{ campaign_id: string, model?: string, system_prompt: string, user_prompt: string }`. Returns `text/event-stream` SSE response. Each SSE event is a JSON-serialized `RunnerStreamEvent`. Creates a `background_operations` row with type `idea_generation`, updates status throughout (pending -> in_progress -> completed/failed). Requires authenticated user. Uses `anthropic/claude-sonnet-4-20250514` as default model if none specified.

#### 4. Search documents endpoint

**File**: `src/pages/api/ai/search.ts`

**Intent**: JSON API endpoint to perform hybrid RAG search on campaign documents. Useful for testing search quality and for manual idea creation (S-05) to find relevant fragments.

**Contract**: `POST /api/ai/search` with JSON body `{ campaign_id: string, query: string, limit?: number, strategy?: "hybrid" | "vector" | "fts" }`. Returns JSON `{ results: SearchResult[] }`. Requires authenticated user. Verifies campaign ownership.

#### 5. SSE streaming utility

**File**: `src/lib/ai/streaming.ts`

**Intent**: Utility functions for creating Server-Sent Events responses from async iterables. Handles SSE formatting, error events, and connection cleanup.

**Contract**: Export `createSSEResponse(events: AsyncIterable<unknown>): Response` that creates a `Response` with `Content-Type: text/event-stream`, reads from the async iterable, formats each item as `data: ${JSON.stringify(item)}\n\n`, and sends `data: [DONE]\n\n` on completion. Also export `createSSEErrorResponse(error: string): Response` for immediate error responses.

### Success Criteria:

#### Automated Verification:

- `npx astro sync` completes
- `npm run lint` passes
- `npm run build` passes
- All API routes are valid Astro API routes (export `POST` as `APIRoute`)

#### Manual Verification:

- `POST /api/ai/embed` with a document version ID successfully chunks and embeds the content
- `POST /api/ai/search` returns hybrid search results for a query against embedded documents
- `POST /api/ai/generate` streams SSE events showing the agent's tool calls and final generation
- `background_operations` rows are created and updated with correct status transitions
- Errors (missing API key, invalid campaign, LLM failure) return structured JSON error responses

---

## Testing Strategy

### Unit Tests:

No test framework is configured per AGENTS.md. Verification is via lint, build, and manual testing.

### Integration Tests:

Not applicable -- no test runner.

### Manual Testing Steps:

1. Set `OPENROUTER_API_KEY` in `.env` and `.dev.vars`
2. Start dev server with `npm run dev`
3. Create a campaign and add a document via existing UI
4. Call `POST /api/ai/embed` with the document version ID -- verify chunks appear in `document_embeddings`
5. Call `POST /api/ai/search` with a query -- verify hybrid results returned
6. Call `POST /api/ai/generate` with campaign ID and prompts -- verify streaming SSE events, tool calls, and final output
7. Check `background_operations` table for status tracking rows
8. Test error cases: missing API key, invalid campaign ID, malformed request body

## Performance Considerations

- **Embedding latency**: Embedding a typical document (1-5 pages) should take 2-10 seconds via OpenRouter. Batching chunks reduces round-trips.
- **Vector search index**: The HNSW index on `document_embeddings.embedding` (added in Phase 5 migration) ensures vector search doesn't degrade to sequential scan as the table grows.
- **Agent loop duration**: With max 10 round-trips, generation could take 30-120 seconds for complex multi-tool workflows. SSE streaming ensures the user sees progress throughout.
- **Concurrent requests**: Each Worker invocation handles one request. OpenRouter rate limits apply at the account level. No request-level rate limiting implemented in F-02.

## Migration Notes

- Phase 5 adds a Supabase migration for `fts` tsvector column, GIN index, HNSW vector index, and two RPC functions. This is additive and backward-compatible.
- Existing `document_embeddings` rows (if any) will have `fts` populated automatically by the `GENERATED ALWAYS AS` column.
- No data migration needed -- the table should be empty since no embedding code existed before.

## References

- Provider checklist: `context/docs/providers-implementation-checklist.md`
- OpenRouter Responses API: `context/docs/openrouter-responses-api.md`
- Tools interface: `context/docs/tools-interface-checklist.md`
- Tools best practices: `context/docs/tools-creation-checklist.md`
- pgvector docs: `context/docs/pgvector.md`
- RAG boilerplate (reference pattern): `context/docs/boilerplate-plan.md`
- F-01 plan: `context/changes/app-data-schema/plan.md`
- Schema migration: `supabase/migrations/20260606094848_create_application_schema.sql`
- Supabase client: `src/lib/supabase.ts`
- Existing API pattern: `src/pages/api/campaigns/index.ts`
- Astro env schema: `astro.config.mjs:18-22`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Environment & Dependencies

#### Automated

- [x] 1.1 `npx astro sync` completes without errors — 44096a2
- [x] 1.2 `npm run lint` passes — 44096a2
- [x] 1.3 `npm run build` passes — 44096a2

#### Manual

- [x] 1.4 `.env.example` contains all three env vars — 44096a2

### Phase 2: Provider Abstraction Layer

#### Automated

- [x] 2.1 `npm run lint` passes with all new files — 728ae94
- [x] 2.2 `npm run build` passes — 728ae94
- [x] 2.3 TypeScript compiles without errors — 728ae94

#### Manual

- [x] 2.4 Provider can be instantiated with a test API key — 728ae94
- [x] 2.5 `resolveProvider("openrouter:anthropic/claude-sonnet-4-20250514")` returns correct provider and model — 728ae94

### Phase 3: Tools Interface

#### Automated

- [x] 3.1 `npm run lint` passes — 113736e
- [x] 3.2 `npm run build` passes — 113736e
- [x] 3.3 Tool JSON schemas are valid — 113736e

#### Manual

- [x] 3.4 `createToolRegistry()` registers both tools and `list()` returns definitions — 113736e

### Phase 4: Embedding Pipeline

#### Automated

- [x] 4.1 `npm run lint` passes
- [x] 4.2 `npm run build` passes
- [x] 4.3 TypeScript types align with `document_embeddings` schema

#### Manual

- [x] 4.4 `chunkText()` produces reasonable paragraph-based chunks
- [x] 4.5 `embedBatch()` returns 1536-dimensional arrays from OpenRouter
- [x] 4.6 `embedDocument()` inserts rows into `document_embeddings`

### Phase 5: Hybrid RAG Search

#### Automated

- [ ] 5.1 Migration applies cleanly
- [ ] 5.2 `npm run lint` passes
- [ ] 5.3 `npm run build` passes
- [ ] 5.4 Database types regenerated successfully

#### Manual

- [ ] 5.5 `match_document_chunks` RPC returns ranked results
- [ ] 5.6 `search_document_chunks` RPC returns FTS-ranked results
- [ ] 5.7 Hybrid search returns merged results

### Phase 6: Agent Runner

#### Automated

- [ ] 6.1 `npm run lint` passes
- [ ] 6.2 `npm run build` passes

#### Manual

- [ ] 6.3 Simple generation (no tools) completes and streams events
- [ ] 6.4 Tool call dispatch works and continues conversation
- [ ] 6.5 Max round-trip limit is respected
- [ ] 6.6 `parseStructuredOutput` validates correctly

### Phase 7: API Endpoints & Integration

#### Automated

- [ ] 7.1 `npx astro sync` completes
- [ ] 7.2 `npm run lint` passes
- [ ] 7.3 `npm run build` passes

#### Manual

- [ ] 7.4 `POST /api/ai/embed` chunks and embeds document content
- [ ] 7.5 `POST /api/ai/search` returns hybrid search results
- [ ] 7.6 `POST /api/ai/generate` streams SSE events with tool calls and final output
- [ ] 7.7 `background_operations` rows created with correct status transitions
- [ ] 7.8 Error cases return structured JSON error responses
