---
date: 2026-06-29T16:39:19+02:00
researcher: claude-opus-4-6
git_commit: 9c8d397
branch: master
repository: jakobos/content-forge
topic: "Risk #1: Fragment provenance -- can generated ideas contain hallucinated or orphan fragment references?"
tags: [research, codebase, generation, provenance, fragment-tagging, test-plan-risk-1]
status: complete
last_updated: 2026-06-29
last_updated_by: claude-opus-4-6
---

# Research: Risk #1 -- Fragment Provenance and Validation

**Date**: 2026-06-29T16:39:19+02:00
**Researcher**: claude-opus-4-6
**Git Commit**: 9c8d397
**Branch**: master
**Repository**: jakobos/content-forge

## Research Question

From `context/foundation/test-plan.md` Risk #1:

> AI generation produces ideas disconnected from campaign documents -- generated ideas contain no real fragment references, or cite fragments that don't exist in the uploaded documents.

**Grounding targets** (from Risk Response Guidance):
1. Entry point for generation
2. Fragment tagging logic
3. How provenance is resolved/validated
4. What happens to unresolved tags

## Summary

The deterministic generation pipeline has a **structural provenance gap**. Ideas can pass all validation (JSON Schema structured output + Zod schema) and still be persisted with **zero valid fragment references** in the database. The gap arises because:

1. The LLM is instructed via natural language to cite tags from the provided set, but **no schema-level constraint** prevents it from inventing tags.
2. Unmatched tags are **silently dropped** during persistence -- no error, no log, no metric.
3. Ideas are inserted into the database **before** their fragment references are resolved, and no post-insertion check verifies that at least one reference survived.

This is the exact failure mode Risk #1 describes: an idea appears "complete" to the user but has no traceable connection to any source document.

## Detailed Findings

### 1. Generation Entry Point

The generation endpoint is `POST /api/ai/generate-ideas` (`src/pages/api/ai/generate-ideas.ts:14`).

**Request flow:**
- Input: `{ campaign_id: uuid, batch_size: 1..10, default 5 }` -- no prompts from client
- Guards: auth (`:16`), API key (`:20`), supabase (`:24`), Zod validation (`:37`), campaign ownership query (`:44`)
- Creates `background_operations` row with status `pending` (`:59-68`)
- Initializes AI context and generation service (`:78-81`)
- Wraps `generationService.run()` in `trackedEvents()` which manages `background_operations` lifecycle (`:84-108`)
- Returns SSE via `createSSEResponse()` (`:110`)

**Service step sequence** (`src/lib/ai/generation/service.ts:205-299`):

| Step | Lines | Event | Action |
|------|-------|-------|--------|
| 1 | `:213-219` | `retrieving` | Fetch campaign meta + documents |
| 2 | `:221-227` | -- | `deriveSeedQueries()` -- deterministic, no LLM |
| 3 | `:229-233` | -- | `retrieveTaggedFragments()` -- search, RRF, tag |
| 4 | `:238-239` | -- | `resolveBusinessProfile()` |
| 5 | `:241-252` | -- | Write debug info to `background_operations.input_ref` |
| 6 | `:254-262` | -- | Build system + user prompts |
| 7 | `:264-272` | `generating` | Single structured-output LLM call |
| 8 | `:274-286` | -- | Parse + Zod validate (retry once on failure) |
| 9 | `:288-292` | `saving` | Auto-increment generation_number + persist ideas |
| 10 | `:294-295` | `done` | Yield idea IDs |

### 2. Fragment Tagging Logic

**Seed query derivation** (`src/lib/ai/generation/retrieval.ts:37`):
- One query from campaign title+goal+description (always present)
- One query per document (title + first 200 chars of lead text)
- Hard cap: `MAX_SEED_QUERIES = 12`, deduped by exact string match
- Purely rule-based, no LLM involved

**Search + merge** (`retrieval.ts:118`):
- Fan-out: all seed queries searched concurrently via `Promise.all` (`:129-131`)
- Per-seed limit: `PER_SEED_LIMIT = 10` results each (`:13`)
- Cross-query merge: iterative pairwise RRF using `reciprocalRankFusion` from `src/lib/ai/search/rrf.ts:26`
- Dedup key: `${documentVersionId}:${chunkIndex}` (`:101`)
- Cap: `MAX_FRAGMENTS = 20` (`:11`)

**Tag assignment** (`retrieval.ts:154-155`):
- Sequential: `F${i+1}` in merged-rank order, 1-indexed
- Each `TaggedFragment` carries: `{ tag, chunkText, documentVersionId, documentTitle, chunkIndex }`
- Valid tag range for any given call: `F1` through `F20` at most

**Tag map** built at `service.ts:236`:
```
Map<string, string>: "F1" -> "uuid-of-document-version", "F2" -> ...
```

Stored in `background_operations.input_ref` for debugging (`:248-249`).

### 3. Prompt Injection

**System prompt** (`src/lib/ai/prompts/generation.ts:37`):
- Instructs: "fragments are tagged [F1], [F2], etc. You must cite them by tag in each idea's source_references"
- Shows example JSON with `"tag": "F1"` (`:58`)
- Rule: "Every idea MUST cite at least one fragment tag" (`:68`)

**User prompt** (`generation.ts:78-112`):
- Fragment format: `[F1] (Document Title): chunk text content` (`:101`)
- Final instruction: `"Cite fragment tags (F1, F2, ...) in source_references -- do not invent tags not listed above."` (`:108`)
- Empty fragments case: renders `"(No fragments found -- generate ideas based on campaign context alone.)"` (`:98`)

**Tag format inconsistency**: Prompt renders tags with brackets `[F1]`, but the schema example shows `"tag": "F1"` without brackets. The system prompt instruction says "cite them by tag" without specifying the exact format. If the LLM returns `"[F1]"` instead of `"F1"`, `tagMap.get("[F1]")` would return `undefined` and the reference is silently dropped.

### 4. Schema Validation

**SourceReferenceSchema** (`src/lib/ai/prompts/schemas.ts:3-8`):
```
{ tag: z.string(), quote_snippet: z.string() }
```
- `tag` is **unconstrained** `z.string()` -- no regex, no enum, no `.refine()`

**IdeaSchema** (`schemas.ts:10-27`):
- `source_references: z.array(SourceReferenceSchema).min(1)` -- at least one per idea
- `key_quotes: z.array(z.string()).min(1)` -- at least one quote

**IdeaOutputSchema** (`schemas.ts:29-31`):
- `{ ideas: z.array(IdeaSchema) }` -- **no `.min()` on ideas array** -- empty array passes

**IdeaOutputJsonSchema** (`schemas.ts:40-81`):
- Mirrors Zod. `tag` is `{ type: "string" }` (`:65`), no `pattern` constraint.
- `additionalProperties: false` everywhere, `strict: true` in usage

**Structured output** (`service.ts:118-125`):
- `responseFormat` sent with `strict: true` and `schema: IdeaOutputJsonSchema`
- `strict: true` enforces JSON **structure** (property names, types, required fields)
- It does **not** constrain string **values** -- `"tag": "HALLUCINATED"` passes

### 5. Provenance Resolution (The Gap)

**parseAndValidate** (`service.ts:91-106`):
- Strips markdown code fences (`:93-95`)
- `JSON.parse` then `IdeaOutputSchema.safeParse` (`:99, :104`)
- Returns `null` on any failure; no Zod error details surfaced

**Retry** (`service.ts:275-286`):
- On parse/validate failure, retries LLM call with **identical prompts**
- If retry also fails, throws `"LLM output failed schema validation after retry"`
- No diagnostic info preserved

**persistIdeas** (`service.ts:139-196`):
- Ideas inserted one at a time via Supabase `.insert().select("id").single()` (`:150-170`)
- For each idea, source_references resolved against tagMap (`:179-185`):
  ```
  const documentVersionId = tagMap.get(ref.tag) ?? null;
  if (!documentVersionId) return null; // Silent drop
  ```
- Nulls filtered out (`:185`)
- `if (refsToInsert.length > 0)` guards the insert (`:187`) -- zero valid refs = no insert, no error
- **The idea row is already persisted** at this point -- orphan idea exists in the database

**No transaction**: each insert is an independent Supabase HTTP call (`:149-196`). Partial writes are possible if an error occurs mid-batch.

### 6. Failure Mode: Complete Path to an Orphan Idea

1. Server retrieves fragments F1-F12, builds `tagMap = {F1: uuid1, ..., F12: uuid12}`
2. LLM outputs `source_references: [{ tag: "F15", quote_snippet: "..." }]`
3. JSON Schema structured output: **passes** (tag is a string)
4. Zod safeParse: **passes** (tag is a string, array has >= 1 item)
5. `persistIdeas`: idea row inserted successfully
6. Tag resolution: `tagMap.get("F15")` -> `undefined` -> `null` -> filtered out
7. `refsToInsert.length === 0` -> fragment reference insert skipped
8. Result: idea in `ideas` table with zero rows in `idea_fragment_references`

### 7. Additional Edge Cases

**Empty fragments + schema contradiction**: When no documents are found, the prompt says "generate ideas based on campaign context alone" (`:98`), but `source_references.min(1)` still requires at least one ref. The LLM is forced to produce a tag, but the tag map is empty, so all refs are silently dropped.

**Zero-idea output**: `IdeaOutputSchema` has no `.min(1)` on the `ideas` array. The LLM could return `{ ideas: [] }`, which passes all validation and persists nothing -- though this is a separate concern from Risk #1.

**Non-atomic generation_number**: `autoIncrementGenerationNumber` (`service.ts:68-85`) reads MAX then increments, acknowledged as racy for concurrent requests.

## Code References

- `src/pages/api/ai/generate-ideas.ts:14` - POST endpoint, input validation, SSE wrapper
- `src/lib/ai/generation/service.ts:202-299` - Generation service factory and `run()` orchestrator
- `src/lib/ai/generation/service.ts:91-106` - `parseAndValidate` -- JSON parse + Zod
- `src/lib/ai/generation/service.ts:111-133` - `callLLM` -- structured output config
- `src/lib/ai/generation/service.ts:139-196` - `persistIdeas` -- tag resolution + silent drop at `:181-182`
- `src/lib/ai/generation/service.ts:236` - Tag map construction
- `src/lib/ai/generation/retrieval.ts:37` - `deriveSeedQueries`
- `src/lib/ai/generation/retrieval.ts:118` - `retrieveTaggedFragments`
- `src/lib/ai/generation/retrieval.ts:154-155` - Tag assignment (`F${i+1}`)
- `src/lib/ai/prompts/generation.ts:37` - System prompt tag citation instructions
- `src/lib/ai/prompts/generation.ts:101` - Fragment rendering format in user prompt
- `src/lib/ai/prompts/generation.ts:108` - "Do not invent tags" instruction
- `src/lib/ai/prompts/generation.ts:98` - Empty fragments fallback text
- `src/lib/ai/prompts/schemas.ts:3-8` - SourceReferenceSchema (`tag: z.string()`)
- `src/lib/ai/prompts/schemas.ts:26` - `source_references.min(1)` constraint
- `src/lib/ai/prompts/schemas.ts:29-31` - IdeaOutputSchema (no `.min()` on ideas array)
- `src/lib/ai/prompts/schemas.ts:40-81` - IdeaOutputJsonSchema (JSON Schema mirror)
- `src/lib/ai/search/service.ts:46` - `search()` method
- `src/lib/ai/search/rrf.ts:26` - `reciprocalRankFusion`
- `src/lib/ai/generation/profile.ts` - `resolveBusinessProfile` with fallback defaults

## Architecture Insights

### Validation layer summary

| Layer | Location | What it checks | What it misses |
|-------|----------|----------------|----------------|
| JSON Schema (API-side, `strict: true`) | Provider/OpenRouter | Structure, types, required fields | String values -- any string passes for `tag` |
| Zod (server-side) | `parseAndValidate` | Same + `.min(1)` on arrays | Same -- `z.string()` accepts any string |
| Tag resolution (server-side) | `persistIdeas` | Maps tag to `documentVersionId` | Silently drops unmatched; no minimum surviving refs |

### Design intent vs. current state

The deterministic pipeline was designed to eliminate the agentic loop's non-determinism. It succeeded at making the **workflow** deterministic (fixed steps, no LLM-driven branching). But it introduced a new failure mode: the server owns retrieval and tagging, but it **trusts the LLM to echo tags correctly** and has no enforcement when it doesn't.

The tag map is the correct provenance mechanism -- the gap is not in the design but in the **absence of a post-resolution guard** that rejects or flags ideas with zero surviving references.

### Testable surface for Risk #1

The cheapest test that provides a real signal (per test-plan strategy):

1. **Unit test**: `persistIdeas` with a fixture where all `source_reference.tag` values are outside the tag map. Assert: the function should either reject the idea or surface an observable signal (not silently persist an orphan).
2. **Unit test**: `parseAndValidate` with output containing tags matching `/^F\d+$/` but with numbers outside the valid range. Assert: currently passes (confirms the gap exists for the test to guard against after a fix).
3. **Integration test**: `createGenerationService` with seeded documents, mock LLM returning known-bad tags, verify no orphan ideas in the database after `run()` completes.

## Historical Context (from prior changes)

- `context/archive/2026-06-13-deterministic-generation-workflow/plan.md` - The archived plan that built this pipeline. Phase 4 (service.ts:254) explicitly specifies "resolve each `source_reference.tag` to a `documentVersionId` via the tag map (drop unmatched tags)" -- the silent-drop behavior is **by design**, not a bug. The plan did not include a minimum-surviving-refs guard.
- `context/archive/2026-06-13-deterministic-generation-workflow/plan.md:30` - Notes that tag resolution "eliminat[es] title matching entirely" (replacing the old fragile title-matching fallback from `ideas.ts:123`). The tag system is strictly better than what it replaced, but the "drop unmatched" policy trades correctness for resilience -- the risk is orphan ideas rather than hard failures.

## Open Questions

1. **Should `persistIdeas` enforce a minimum surviving-reference count per idea?** The current silent-drop policy means orphan ideas are invisible. Options: (a) skip persisting the idea entirely, (b) persist but flag it, (c) fail the whole batch.
2. **Should the tag format inconsistency be fixed?** The prompt renders `[F1]` but the schema example shows `"F1"`. In practice, LLMs seem to handle this correctly (the pipeline is in production), but it's an unnecessary ambiguity. Normalizing tags in `persistIdeas` (strip brackets) would be a cheap defense.
3. **Should Zod validation be tightened with `.refine()`?** A dynamic Zod schema that constrains `tag` to the actual tag set would catch hallucinated tags before persistence. However, this requires building the schema at runtime per request, which adds complexity.
4. **What is the observed hallucination rate in production?** The `background_operations.input_ref` stores the tag map. Comparing it against persisted `idea_fragment_references` for existing generations would reveal whether this is a theoretical or practical problem.
