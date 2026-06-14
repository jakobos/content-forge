# First Gated Generation -- Plan Brief

> Full plan: `context/changes/first-gated-generation/plan.md`

## What & Why

Build the north star feature: users can generate structured post ideas from campaign documents via AI. This is the smallest end-to-end slice that proves ContentForge's core hypothesis -- that a persistent brand context + campaign strategy + RAG-powered document analysis can produce useful, on-brand post idea skeletons. Everything else in the roadmap only matters if this works.

## Starting Point

The full infrastructure stack is in place. F-01 delivered the database schema (9 tables including `ideas`, `idea_fragment_references`). F-02 delivered the AI pipeline (OpenRouter provider, agent runner with tool calling, hybrid RAG search, SSE streaming). S-01 delivered campaign and document CRUD. What's missing: no UI triggers generation, no prompt templates exist, documents aren't auto-embedded, and nothing persists ideas to the database.

## Desired End State

A user with a campaign containing documents can click "Generate Ideas", select a batch size (1-10), watch real-time progress as the AI searches their documents and generates ideas, and see the resulting structured ideas (title, hook, key points, quotes, source references) appear as expandable cards on the campaign detail page. Documents are automatically embedded when created, so RAG search works seamlessly.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Idea persistence location | Separate `/api/ai/ideas` endpoint | Separation of concerns -- generation and persistence are independently testable and retryable. | Plan |
| Document embedding trigger | Auto-embed on document creation | No manual step, no "forgot to embed" failure mode -- documents are always searchable. | Plan |
| Batch size | User-configurable (1-10) | Flexibility for different use cases without prompt engineering complexity. | Plan |
| Progress UX | Phase indicators + streaming text | Reduces perceived wait time for 30-120s generation; leverages existing SSE event structure. | Plan |
| Ideas layout | New section above documents | Ideas are the primary output; documents are inputs -- output gets visual priority. | Plan |
| Generate button placement | Campaign header card with gating | Prominent, discoverable; disabled when no documents exist. | Plan |
| Idea card format | Expandable cards | Clean overview at a glance; details on demand; matches existing `<details>` pattern. | Plan |
| Profile defaults | Hardcoded in system prompt | Simple, contained, easy to swap when S-04 lands. | Plan |

## Scope

**In scope:**
- Auto-embedding documents on creation (fire-and-forget)
- System + user prompt templates with hardcoded profile defaults
- `/api/ai/ideas` persist endpoint (ideas + fragment references)
- React generation panel (button, batch size, SSE consumer, progress, persist, reload)
- Idea display section (expandable cards, grouped by generation batch)
- Generation gating (disabled when no documents)

**Out of scope:**
- Idea lifecycle management (accept/decline) -- S-03
- Business profile wizard -- S-04
- Manual idea creation -- S-05
- Idea regeneration -- S-06
- RLS policies -- F-03
- Background operations dashboard -- S-09

## Architecture / Approach

The flow is: user clicks "Generate Ideas" -> React component builds prompts from campaign data, calls `POST /api/ai/generate` with SSE streaming -> agent runner uses `search_documents` tool (RAG search) and `get_business_profile` tool -> LLM produces structured JSON -> client parses output with Zod schema -> client calls `POST /api/ai/ideas` to persist -> page reloads with server-rendered ideas. Documents are auto-embedded at creation time so RAG search has data to work with.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Auto-embed on doc creation | Documents embedded on creation, RAG search works | Embedding adds 2-5s to doc creation; acceptable for MVP. |
| 2. Prompt templates & persist endpoint | Prompt engineering + idea persistence API | Prompt quality determines idea quality -- core product risk. |
| 3. Generation UI | React panel: button, progress, SSE consumer, persist | SSE parsing on client side is complex; error state handling. |
| 4. Idea display | Expandable idea cards with source references | Server-side query + rendering must handle large idea counts. |

**Prerequisites:** F-01 (done), F-02 (done), S-01 (done). `OPENROUTER_API_KEY` configured.
**Estimated effort:** ~2-3 sessions across 4 phases.

## Open Risks & Assumptions

- Prompt quality is the core product risk. If generated ideas aren't on-brand or fragment-referenced, the north star fails. Early testing with real documents is essential.
- The hardcoded profile defaults (professional tone, broad audience) may produce generic ideas. This is acceptable -- S-04 (business profile wizard) solves this.
- Embedding adds 2-5 seconds to document creation. If this is unacceptable, the pattern can be changed to non-blocking in a follow-up.
- LLM structured output parsing is fragile -- different models format JSON differently. The `parseStructuredOutput` utility handles common cases (code fences, etc.) but edge cases may appear.

## Success Criteria (Summary)

- User can generate structured post ideas from campaign documents in one click
- Generated ideas reference specific document fragments (not hallucinated sources)
- Ideas display as expandable cards with all structured fields and source references
- The full flow works end-to-end: add documents -> generate -> see ideas
