# Deterministic Generation Workflow — Plan Brief

> Full plan: `context/changes/deterministic-generation-workflow/plan.md`

## What & Why

Replace the non-deterministic, LLM-driven agent loop that powers idea generation with a **fixed, server-orchestrated pipeline**: rule-based multi-query retrieval → single structured-output LLM call → server-side validation + persistence. Today the model decides whether/when to search across up to 10 round-trips, so cost, latency, and provenance are unpredictable and persistence is fragile (client-side parse + title matching). "Deterministic" means the **workflow control flow** is fixed — not the output. Ideas stay creative.

## Starting Point

F-02's AI pipeline is live: provider abstraction over OpenRouter `/responses`, an agent runner (`runner.ts`) with tool-calling, embeddings, and hybrid RAG search. S-02 `first-gated-generation` is mid-implementation: auto-embed (Phase 1) landed, plus prompts, schema, and a client-called persist endpoint (`/api/ai/ideas`) — but **no generation UI exists yet**. The provider has an unused non-streaming `generate()` and no `response_format` support.

## Desired End State

A user clicks Generate Ideas (batch 1-10) on the campaign page; the client sends only `campaign_id` + `batch_size`. The server derives seed queries, retrieves and tags fragments, injects them plus the business profile into one structured LLM call, validates (one retry), resolves tags to real `document_version_id`s, and persists ideas + references — all server-side, tracked in `background_operations`. SSE streams coarse progress; the page reloads to a server-rendered Ideas section. The agent runner, tools, and old endpoints are deleted.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Interpretation | Replace agent loop with fixed pipeline | Predictable cost/latency/provenance; de-risks the north star. | Plan |
| Disposition | Replace the agentic path (not parallel) | One coherent generation path; no dual maintenance. | Plan |
| Retrieval | Multi-query fan-out + RRF merge | Covers heterogeneous documents better than one search. | Plan |
| Seed queries | One per document + one per goal/theme (capped) | Rule-based, deterministic, guarantees document coverage. | Plan |
| Structured output | Native `response_format` json_schema (verify on `/responses`) | Near-eliminates parse failures; schema is authoritative. | Plan |
| Pipeline shape | Single LLM call returns the whole batch | Cheapest, fastest, fixed step count. | Plan |
| Transport | Keep SSE for coarse progress; persist server-side | Preserves progress UX while server owns persistence. | Plan |
| Profile | Server fetches profile (or defaults), injects into prompt | Deterministic, single source, S-04-ready. | Plan |
| Provenance | Server tags fragments; LLM cites tags; server validates | Kills fragile title matching; rejects hallucinated refs. | Plan |
| Determinism | Workflow deterministic; output creative (higher temp, no cache) | LLMs aren't bit-reproducible; ideas should be creative. | Plan |
| Failure mode | One auto-retry, then fail with clear error | Absorbs transient hiccups without runaway cost. | Plan |
| S-02 relationship | Supersede unbuilt S-02 phases; rebuild generate path + UI here | No throwaway double-build; UI never shipped. | Plan |
| Cleanup | Delete runner, tools, `/api/ai/generate`, `/api/ai/ideas` | Smallest surface, no dead code, clear intent. | Plan |
| Batch | Cap 1-10 (default 5), generous max tokens, prompt for distinctness | Single call stays viable with predictable bounds. | Plan |

## Scope

**In scope:** Provider `responseFormat` support; deterministic retrieval + fragment tagging; rewritten prompts/schema + server-side profile resolver; generation service + new `/api/ai/generate-ideas` endpoint with server-side persistence; generation panel + server-rendered idea display; deletion of runner/tools/old endpoints.

**Out of scope:** Reproducible/cached output; multi-step or fan-out generation; auto-chunking large batches; business profile wizard (S-04); idea lifecycle/copy (S-03); manual idea creation (S-05); regeneration (S-06); ops dashboard (S-09); RLS (F-03); Queues/Workflows; embedding pipeline changes.

## Architecture / Approach

```
Client (campaign_id + batch_size)
  -> POST /api/ai/generate-ideas  (SSE: retrieving/generating/saving/done)
       -> Generation Service (src/lib/ai/generation/service.ts)
            1. fetch campaign docs -> deriveSeedQueries (rule-based)
            2. retrieveTaggedFragments (hybrid search per seed -> RRF -> dedupe -> cap -> tag)
            3. resolveBusinessProfile (row or defaults)
            4. build prompts (inject tagged fragments + profile)
            5. ONE structured-output provider.generate() call (creative temp)
            6. validate (IdeaOutputSchema; one retry) 
            7. resolve tags -> document_version_id; persist ideas + fragment refs
       -> background_operations tracks pending/in_progress/completed/failed
Campaign page renders persisted ideas server-side on reload.
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Provider structured output | `responseFormat` on `ProviderRequest` + adapter; verified on `/responses` | `/responses` may not honour `response_format` — fallback to prompt+parse |
| 2. Retrieval + tagging | Rule-based seed queries, RRF fan-out, capped + tagged fragments | Query count vs. coverage tuning |
| 3. Prompts, schema, profile | Tool-free prompt with injected fragments/profile; tag-based schema | Keeping JSON schema in sync with Zod |
| 4. Generation service + endpoint | Orchestrator + `/api/ai/generate-ideas`, server-side persist + SSE | Composing all subsystems; retry/error propagation |
| 5. UI + idea display | Generate panel (server persists, client reloads) + Ideas section | SSE consumption; styling parity |
| 6. Retire agentic path | Delete runner, tools, old endpoints; unwire init | Stray imports breaking build |

**Prerequisites:** F-02 pipeline live (done), S-02 Phase 1 auto-embed landed (done), `OPENROUTER_API_KEY` available for testing.
**Estimated effort:** ~3-4 sessions across 6 phases.

## Open Risks & Assumptions

- **Structured-output transport (highest):** OpenRouter docs show `response_format` on Chat Completions, not explicitly on `/responses`. Phase 1 verifies; fallback is prompt-instructed JSON + Zod parse with one retry.
- Single-call batch could truncate for very content-rich campaigns at batch size 10 — mitigated by generous `max_output_tokens` and the cap.
- No test framework — verification is manual + lint + build; bugs may surface late.
- Deleting `/api/ai/ideas` is safe only because no UI shipped against it (verified).

## Success Criteria (Summary)

- User generates on-brand, fragment-grounded ideas through one deterministic server flow; provenance resolves to real document versions with no title matching.
- Generation uses exactly one LLM call per batch; cost/latency are predictable.
- The agent runner, tools, and old endpoints are gone; `lint` + `build` clean.
