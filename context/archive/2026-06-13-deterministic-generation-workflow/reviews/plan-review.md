<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Deterministic Generation Workflow

- **Plan**: context/changes/deterministic-generation-workflow/plan.md
- **Mode**: Deep
- **Date**: 2026-06-13
- **Verdict**: REVISE
- **Findings**: 1 critical, 2 warnings, 1 observation

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | WARNING |
| Blind Spots           | WARNING |
| Plan Completeness     | PASS    |

## Grounding

12/12 paths ✓, schema-consumer/SSE/profile-table symbols ✓, brief↔plan ✓. Progress↔Phase: 6/6 phases mapped, criteria↔checkboxes consistent ✓.

## Findings

### F1 — Phase 3 schema change breaks ideas.ts build; deletion not until Phase 6

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real ordering tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 3 (schemas.ts) vs Phase 6 (delete ideas.ts)
- **Detail**: Phase 3 rewrites `SourceReferenceSchema` to `{ tag, quote_snippet }`, dropping `document_version_id` and `document_title` (schemas.ts:3). The sole consumer of those fields is `src/pages/api/ai/ideas.ts` (reads `idea.source_references` / `ref.document_version_id` / `ref.document_title` at ideas.ts:97,100,105,123,129), which is a compiled API route not deleted until Phase 6. After the Phase 3 edit those property accesses are type errors and `npm run build` (astro check / tsc compiles all pages) fails — so Phase 3's own automated gate (3.3) can never go green, violating the plan's "each phase independently verifiable via lint/build" invariant.
- **Fix A ⭐ Recommended**: Delete ideas.ts in Phase 3, alongside the schema change.
  - Strength: ideas.ts is dead once server-side persistence lands (Phase 4) and its logic is copied into the service anyway; removing it with the schema change keeps every phase buildable. generate.ts is untouched by the schema and can still wait for Phase 6.
  - Tradeoff: Splits "retire old endpoints" cleanup across two phases.
  - Confidence: HIGH — ideas.ts is the sole consumer (grep-verified); no UI calls it (sse-client/panel don't exist yet).
  - Blind spot: None significant — prompts/index.ts re-export only needs the type to exist.
- **Fix B**: Make Phase 3 schema backward-compatible (keep fields optional), remove in Phase 6.
  - Strength: Keeps all deletion in Phase 6.
  - Tradeoff: Carries `document_version_id?`/`document_title?` as dead optional fields through Phases 3-5; native structured-output schema advertises fields the pipeline ignores.
  - Confidence: HIGH — compiles, but propagates cruft.
  - Blind spot: Strict JSON-schema mode may reject the superfluous fields (see F2).
- **Decision**: FIXED via Fix A — ideas.ts deletion moved into Phase 3; Phase 6 + Progress updated.

### F2 — Strict structured-output vs. 8 optional fields; Phase 1 probe unrepresentative

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; the de-risking step may miss the risk
- **Dimension**: Blind Spots
- **Location**: Phase 1 (verification probe) + Phase 3 (IdeaOutputJsonSchema)
- **Detail**: IdeaSchema has 8 `.optional()` fields (schemas.ts:14-23). OpenAI/OpenRouter `json_schema` structured output with `strict:true` requires every property in `required` and `additionalProperties:false` — no truly optional properties. So `IdeaOutputJsonSchema` must run `strict:false` (weaker guarantee, undercutting the "near-eliminates parse failures" decision) or model optionals as nullable+required (model emits explicit nulls). Phase 1's probe uses "a trivial responseFormat schema" (plan line 106); a trivial all-required schema passes while hiding this optional-field behaviour, so Phase 1 can report PASS yet Phase 4 still hits the problem — the probe won't exercise the risk it exists to retire.
- **Fix**: Decide the strict/optional policy in Phase 3 (recommend `strict:true` + optionals modeled as nullable+required, Zod accepting null) and have the Phase 1 probe use a schema representative of IdeaOutputSchema (≥1 optional field) instead of a trivial one.
  - Strength: Surfaces the real failure mode at the cheapest phase.
  - Tradeoff: Slightly more work in the Phase 1 probe.
  - Confidence: MED — exact `/responses` strict semantics unverified (what Phase 1 checks), but the optional-field constraint is well-documented on the underlying API.
  - Blind spot: Whether `/responses` enforces strict identically to Chat Completions is unknown until the probe runs.
- **Decision**: SKIPPED

### F3 — System-prompt transport channel into provider.generate() unspecified

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 4 — generation service (build prompts → provider.generate)
- **Detail**: buildGenerationSystemPrompt returns a string, but Phase 4 doesn't say how it reaches the model. ProviderRequest has a dedicated `instructions` field (serialized to body.instructions, adapter.ts:170). If the system prompt is instead passed as a system-role input message, mapInputItems rewrites it to role:"user" with a "[System]: " prefix (adapter.ts:115-120) — a degraded path. The old runner used systemInstructions → request.instructions (generate.ts:88).
- **Fix**: In Phase 4, specify the system prompt routes through `ProviderRequest.instructions` (not as an input message); the user prompt is the sole input item.
- **Decision**: FIXED — Phase 4 service contract now specifies system prompt via request.instructions.

### F4 — Abort signal not threaded into the generation service

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 4 — service.run(params: { batchSize }) / endpoint
- **Detail**: The old path forwards context.request.signal into runner.run (generate.ts:102) so a client disconnect aborts the in-flight LLM call. Phase 4's `run(params)` takes only `batchSize` — no AbortSignal — so a long single generate() call keeps running (and billing) after the client navigates away. Separately, GenerationProgressEvent has no declared home file.
- **Fix**: Thread context.request.signal through run() into provider.generate(), and name the file that declares GenerationProgressEvent (likely service.ts, re-exported by sse-client.ts).
- **Decision**: SKIPPED
