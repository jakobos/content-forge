# Idea Regeneration — Plan Brief

> Full plan: `context/changes/idea-regeneration/plan.md`

## What & Why

Users need to regenerate ideas — both individual ideas and entire batches — with an optional improvement hint (up to 200 chars). The current system is generate-once: if an idea isn't quite right, the only option is to generate a fresh batch and hope for better results. FR-017 and FR-018 require directed regeneration where old ideas stay alongside new ones.

## Starting Point

The generation pipeline has two proven service factories (`createGenerationService` for batch, `createStructuringService` for manual). The DB is pre-provisioned: `improvement_hint` column exists but is unused, `idea_regeneration` operation type is in the enum but never inserted. SSE streaming, fragment retrieval, and `background_operations` tracking are all operational. No regeneration code exists.

## Desired End State

A user expands any idea and clicks "Regenerate" with an optional hint like "focus on data points" — a new idea appears in a fresh generation group. They can also click "Regenerate batch" in a generation header to regenerate the entire batch with the same count. Old ideas remain untouched. The `improvement_hint` is visible on regenerated ideas so the user remembers what they asked for.

## Key Decisions Made

| Decision                       | Choice                                      | Why                                                                                       | Source |
| ------------------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------- | ------ |
| Prompt context                 | Original idea(s) + hint + fresh fragments   | LLM needs to see what it's improving; hint directs the improvement                        | Plan   |
| Batch count on regeneration    | Same count as original batch                | Predictable — user gets a fresh batch of equal size                                       | Plan   |
| Single idea regeneration count | Exactly 1 new idea                          | Clear mental model — "try again on this one"                                              | Plan   |
| Lineage tracking               | No tracking (hint + generation_number only) | Zero migration; generation_number ordering + hint is sufficient signal                    | Plan   |
| Single idea UI placement       | Expanded idea detail area                   | User sees full idea before deciding to regenerate                                         | Plan   |
| Batch UI placement             | Generation group header                     | Directly associated with the batch being regenerated                                      | Plan   |
| Endpoint design                | One endpoint, batch-only model              | Unified: always takes generation_number; idea_id filters to 1 idea within that generation | Plan   |
| DB migration needed            | No                                          | `improvement_hint` and `idea_regeneration` already in schema                              | Plan   |

## Scope

**In scope:** Regeneration prompt templates, `createRegenerationService` factory, `POST /api/ai/regenerate-ideas` endpoint, `RegenerateForm` React component, campaign detail page integration (single + batch controls), `improvement_hint` display.

**Out of scope:** Lineage tracking (no `regenerated_from_id` FK), new `idea_source` enum value, DB migration, batch-size selector on regeneration, status restrictions on regeneratable ideas.

## Architecture / Approach

New `createRegenerationService` follows the established async-generator pattern: fetch original ideas -> derive seed queries from their content -> retrieve fresh fragments -> build regeneration prompt (original ideas + hint + fragments) -> single structured-output LLM call -> validate -> persist with `improvement_hint`. One endpoint (`POST /api/ai/regenerate-ideas`) handles both modes via `idea_id` filtering. The `RegenerateForm` component is reused in two mount points on the SSR campaign page.

```
POST /api/ai/regenerate-ideas
  -> validate { campaign_id, generation_number, idea_id?, hint? }
  -> verify campaign ownership
  -> background_operations INSERT (type: idea_regeneration)
  -> createRegenerationService.run()
     -> fetch source ideas (by generation_number + optional idea_id)
     -> derive seed queries from idea content
     -> retrieve fresh tagged fragments
     -> resolve business profile
     -> build regeneration prompts (original ideas + hint + fragments)
     -> LLM call (IdeaOutputJsonSchema)
     -> validate + retry once
     -> persist ideas (improvement_hint populated)
  -> SSE stream (retrieving -> generating -> saving -> done)
```

## Phases at a Glance

| Phase                                      | What it delivers                                             | Key risk                                                                              |
| ------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| 1. Backend: Regeneration service + prompts | Prompt templates + `createRegenerationService` + wiring      | Prompt quality — if the LLM just paraphrases the original, regeneration adds no value |
| 2. Backend: API endpoint                   | `POST /api/ai/regenerate-ideas` with SSE streaming           | Source idea resolution logic (single vs batch filtering)                              |
| 3. Frontend: Regeneration UI controls      | `RegenerateForm` component + page integration + hint display | Component reusability across two mount points with different modes                    |

**Prerequisites:** F-02 (AI generation pipeline) and S-02 (first gated generation) — both done.
**Estimated effort:** ~2 sessions across 3 phases.

## Open Risks & Assumptions

- **Prompt anchoring risk:** Including the full original idea in the prompt may cause the LLM to produce minor variations rather than genuinely different takes. Mitigated by explicit prompt instructions to produce distinct improvements, and the hint provides direction. May need prompt tuning after real-world testing.
- **Fragment retrieval for single idea:** Deriving seed queries from a single idea's content (vs. multiple documents) may yield fewer or lower-quality fragments. Acceptable — the original idea's source references provide a fallback context.
- **Concurrency:** Same `generation_number` race condition documented in `autoIncrementGenerationNumber` (service.ts:74-79) applies. Accepted as non-critical for solo-user MVP.

## Success Criteria (Summary)

- User can regenerate a single idea with an optional hint; new idea appears in a new generation group, old idea stays.
- User can regenerate an entire batch; new batch has the same count, old batch stays.
- Regeneration is non-blocking (SSE streaming, page reload on completion).
- `improvement_hint` is stored and displayed on regenerated ideas.
