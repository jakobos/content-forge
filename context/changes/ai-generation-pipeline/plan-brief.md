# AI Generation Pipeline -- Plan Brief

> Full plan: `context/changes/ai-generation-pipeline/plan.md`

## What & Why

Build the foundational AI generation infrastructure (F-02) for ContentForge -- the multi-provider LLM abstraction, document embedding pipeline, hybrid RAG search, tool-calling agent loop, and streaming API endpoints that enable all downstream AI features. Without this foundation, the north star (S-02: first gated generation) and every subsequent AI slice cannot function.

## Starting Point

F-01 (application data schema) is deployed: `document_embeddings` with `vector(1536)`, `background_operations` with AI operation types, `ideas` with structured fields, `idea_fragment_references` for provenance. Zero AI implementation code exists -- no LLM client, no embedding logic, no async processing, no AI-related npm dependencies. Existing API endpoints are form-based with redirect responses. The Cloudflare Workers runtime has `nodejs_compat` but no Queues/Workflows configured.

## Desired End State

A complete AI pipeline where: documents are automatically chunked and embedded; hybrid search (vector + full-text + RRF fusion) retrieves relevant fragments; an agent runner loops through LLM calls and tool executions to produce structured ideas; streaming SSE endpoints deliver real-time progress to the frontend; and `background_operations` tracks all AI work. All wired through a provider abstraction that supports future model/provider swaps.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Provider abstraction depth | Full abstraction from checklist | Enables future provider swaps without refactoring consumers. |
| API endpoint | OpenRouter Responses API (beta) | User preference; supports reasoning, tool calling, and structured output natively. |
| Tools interface | Included with full agent loop | Idea generation benefits from multi-step LLM reasoning with document search tools. |
| Async strategy | Synchronous with streaming SSE | Zero new infrastructure needed; real-time progress; CPU time is mostly I/O wait. |
| Embedding timing | Eager (on document creation) | Embeddings always ready when generation runs; no cold-start delay. |
| Chunking strategy | Paragraph-based | Semantically coherent chunks that respect document structure. |
| RAG search | Hybrid: pgvector + Postgres FTS + RRF | Best retrieval quality -- catches both semantic and keyword matches. |
| Agent loop | Full loop, max 10 round-trips | LLM can search, analyze, and iterate; safety cap prevents runaway costs. |
| Output format | JSON structured output via Zod schemas | Type-safe parsing with validation; handles common LLM output quirks. |
| Default model | anthropic/claude-sonnet-4-20250514 via OpenRouter | Strong instruction following and structured output quality. |
| Embedding model | openai/text-embedding-3-small | 1536 dims matches existing schema; $0.02/1M tokens. |
| API pattern | JSON endpoints under /api/ai/ | Clean separation from existing form-based CRUD pattern. |
| FTS index | Included in F-02 migration | Hybrid search needs both vector and FTS ready when foundation ships. |

## Scope

**In scope:** Provider types + registry + OpenRouter adapter, tool types + registry + search_documents/get_profile tools, embedding client + chunker + service, hybrid RAG search with RPC functions + RRF, agent runner with streaming + round-trip limits + structured output parsing, JSON API endpoints (/api/ai/embed, /api/ai/generate, /api/ai/search), Supabase migration for tsvector + HNSW index + RPC functions, background_operations tracking, zod dependency.

**Out of scope:** UI components (S-02), prompt templates for idea generation (S-02), Cloudflare Queues/Workflows, RLS policies (F-03), second provider adapter, document upload parsing, auto-triggered embedding from document CRUD endpoints.

## Architecture / Approach

```
API Layer (/api/ai/*)
  |
  v
AI Service (src/lib/ai/index.ts) -- initializes and wires all subsystems
  |
  +-- Provider Abstraction (src/lib/ai/providers/)
  |     +-- Types + Registry
  |     +-- OpenRouter Adapter (Responses API)
  |
  +-- Tools (src/lib/ai/tools/)
  |     +-- Registry + Types
  |     +-- search_documents (calls Search Service)
  |     +-- get_business_profile (calls Supabase)
  |
  +-- Embeddings (src/lib/ai/embeddings/)
  |     +-- Chunker (paragraph-based)
  |     +-- Client (OpenRouter /embeddings)
  |     +-- Service (chunk + embed + store)
  |
  +-- Search (src/lib/ai/search/)
  |     +-- RRF fusion
  |     +-- Service (vector RPC + FTS RPC + merge)
  |
  +-- Runner (src/lib/ai/runner/)
        +-- Agent loop (stream, dispatch tools, iterate)
        +-- Output parser (JSON + Zod validation)
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Environment & Dependencies | OPENROUTER_API_KEY in env schema, zod installed | Minimal risk |
| 2. Provider Abstraction Layer | Full Provider interface, registry, OpenRouter adapter | OpenRouter Responses API beta may have undocumented edge cases |
| 3. Tools Interface | ToolRegistry, tool types, search_documents + get_profile tools | Tool handlers are stubs until Phase 5 wires search |
| 4. Embedding Pipeline | Paragraph chunker, embedding client, Supabase storage | OpenRouter embeddings endpoint rate limits or latency |
| 5. Hybrid RAG Search | Migration (tsvector, HNSW index, RPC functions), RRF, search service | Migration must be backward-compatible; HNSW index build time on large tables |
| 6. Agent Runner | Multi-step loop with streaming, tool dispatch, output parsing | Streaming SSE complexity; round-trip accumulation; JSON parsing from LLM |
| 7. API Endpoints & Integration | /api/ai/embed, /api/ai/generate (SSE), /api/ai/search, wiring | Integration of all subsystems; error propagation across layers |

**Prerequisites:** F-01 deployed (done), OPENROUTER_API_KEY available for testing.
**Estimated effort:** ~4-5 sessions across 7 phases.

## Open Risks & Assumptions

- OpenRouter Responses API is beta -- breaking changes possible. Mitigation: adapter isolates the API; switching to Chat Completions is a one-adapter change.
- Cloudflare Workers CPU time for streaming agent loops -- I/O wait shouldn't count against CPU limit, but complex JSON parsing across many round-trips might approach limits.
- No test framework -- all verification is manual + lint + build. Bugs may surface late.
- HNSW index build on `document_embeddings` may be slow for large existing datasets (should be empty at this point).
- Tool handler dependency on search service creates a Phase 3 → Phase 5 stub gap.

## Success Criteria (Summary)

- A document can be embedded and retrieved via hybrid search through the API
- An agent runner can loop through tool calls and produce structured output via streaming SSE
- `npm run lint` and `npm run build` pass with all new code
