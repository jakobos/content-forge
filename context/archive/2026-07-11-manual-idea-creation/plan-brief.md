# Manual Idea Creation — Plan Brief

> Full plan: `context/changes/manual-idea-creation/plan.md`

## What & Why

Add a second idea-creation path: the user describes a post idea in their own words, and the AI structures it into the standard idea format enriched with relevant document fragments. This addresses US-02 / FR-013 — "User can manually describe an idea — AI generates a structured version based on that description + campaign documents." Batch generation discovers ideas from documents; manual creation structures a user-provided concept using the same documents as supporting material.

## Starting Point

The batch generation pipeline (`src/lib/ai/generation/service.ts`) is a deterministic 9-step workflow: seed queries -> hybrid search -> prompts -> LLM call -> persist. It produces 1-10 ideas with `source: "auto"`. The DB schema already has `ideas.source` (`'auto'`/`'manual'`), `ideas.original_description`, and the `idea_source` enum — all designed for this feature from F-01. The campaign page does not yet query or display these columns.

## Desired End State

The user clicks "Describe your own idea" in the campaign header, types a description (20-2000 chars), and submits. The system uses their description as a seed query for fragment retrieval, calls the LLM with a structuring prompt, and persists a single structured idea with `source: "manual"` and `original_description` populated. The idea appears in the same list as batch-generated ideas, with a "Manual" badge and the original description shown as a blockquote above the structured fields.

## Key Decisions Made

| Decision                     | Choice                                    | Why (1 sentence)                                                                                       |
| ---------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Fragment retrieval strategy  | Always retrieve, graceful degradation     | Simplest pipeline — single code path; if no fragments match, the idea is structured without enrichment |
| UI placement                 | Inline in GenerateIdeasPanel              | Both idea-creation entry points co-located, matches existing UI patterns                               |
| Original description display | Subtle blockquote above structured fields | Clearly separated from AI output, always visible, minimal UI work                                      |
| Output schema                | Separate ManualIdeaOutputSchema           | Clean contract — manual ideas don't need to fabricate source_references when no fragments matched      |
| Operation tracking           | Reuse `idea_generation` type              | No DB migration needed, S-09 picks it up automatically                                                 |
| Completion UX                | SSE with page reload                      | Consistent UX between both creation paths, reuses all existing SSE infrastructure                      |
| Document precondition        | Required, same as batch                   | Consistent behavior; fragments are what differentiates ContentForge from plain AI                      |
| Input validation             | Minimum 20 characters                     | Simple, predictable; LLM handles vague input well                                                      |

## Scope

**In scope:**

- New Zod/JSON schemas for single manual idea output (optional source_references)
- New prompt builders for structuring (vs. discovering)
- New `createStructuringService` factory function
- New `POST /api/ai/structure-idea` endpoint
- Inline form in `GenerateIdeasPanel` with textarea + character count
- "Manual" badge and original description blockquote on idea cards
- Updated empty state text

**Out of scope:**

- New `operation_type` enum / DB migration
- Client-side DOM insertion (using page reload)
- AI quality pre-check on descriptions
- Separate route or modal for the form
- Changes to markdown export

## Architecture / Approach

Parallel structuring service alongside batch generation, sharing retrieval, profile resolution, SSE infrastructure, and persistence helpers. The user's description becomes the single seed query for `retrieveTaggedFragments()`. A new prompt pair instructs the LLM to structure (not discover). A relaxed output schema (`ManualIdeaOutputSchema`) wraps a single idea with optional source references. The `GenerateIdeasPanel` gains a `"composing"` state for the inline form, then reuses the existing SSE consumption flow.

## Phases at a Glance

| Phase       | What it delivers                                 | Key risk                                                                                                  |
| ----------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| 1. Backend  | Structuring service + API endpoint with SSE      | Prompt quality — structuring prompt must produce useful output from vague descriptions                    |
| 2. Frontend | Manual idea form + display with badge/blockquote | Panel state management — adding `"composing"` state to the existing component without breaking batch flow |

**Prerequisites:** F-02 (AI pipeline) and S-01 (campaign CRUD) — both done.
**Estimated effort:** ~1-2 sessions across 2 phases.

## Open Risks & Assumptions

- Prompt quality for structuring is untested — the LLM may produce lower-quality structures from vague user descriptions compared to batch generation from rich documents. Mitigated by graceful degradation (still produces a structured idea, just less enriched).
- Single seed query from user description may return poor fragment matches. Accepted: the idea is still persisted without enrichment per the "always retrieve, graceful degradation" decision.

## Success Criteria (Summary)

- User can describe an idea, submit it, and see a structured result with the same fields as batch-generated ideas
- Original description is preserved and visible alongside the structured output
- The flow does not block the UI — SSE streaming with progress phases
- Manual ideas follow the same lifecycle (accept, decline, copy, publish) as auto-generated ideas
