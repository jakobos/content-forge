<!-- PLAN-REVIEW-REPORT -->
# Plan Review: First Gated Generation

- **Plan**: `context/changes/first-gated-generation/plan.md`
- **Mode**: Deep
- **Date**: 2026-06-12
- **Verdict**: REVISE -> SOUND after triage (both FAILs resolved; F4/F5 skipped as minor)
- **Findings**: 2 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS (F6 fixed) |
| Lean Execution | PASS |
| Architectural Fitness | WARNING (F3 fixed; F5 skipped) |
| Blind Spots | WARNING (F1 fixed; F4 skipped) |
| Plan Completeness | PASS (F2 fixed) |

## Grounding

8/8 paths confirmed, 4/4 symbols confirmed, brief<->plan consistent

## Findings

### F1 -- Embedding timing contradicts itself; fire-and-forget impossible on Cloudflare Workers

- **Severity**: CRITICAL
- **Impact**: HIGH -- architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Phase 1 + Critical Implementation Details: Timing & lifecycle
- **Detail**: The "Critical Implementation Details: Timing & lifecycle" section says two contradictory things. Paragraph 1: "must happen after the redirect response is sent -- not before" (fire-and-forget). Paragraph 2 and Phase 1 contract: "happens synchronously before the redirect." More critically: fire-and-forget is impossible on Cloudflare Workers. After `return context.redirect(...)` in an Astro API route, no further code executes. The Workers runtime may terminate the isolate after the Response is returned. The only safe post-response pattern is `waitUntil()`, which isn't exposed by Astro's APIContext directly (requires `context.locals.runtime.ctx.waitUntil()` via the Cloudflare adapter -- unverified if Astro exposes this). Code evidence: `src/pages/api/campaigns/[id]/documents.ts:90` ends with `return context.redirect(...)`.
- **Fix A**: Embed synchronously before the redirect (await)
  - Strength: Simplest. Document is immediately searchable. No runtime tricks. Matches Phase 1 contract's actual words.
  - Tradeoff: Adds 2-5s to document creation. User waits longer for the redirect. Acceptable for MVP per plan's own note.
  - Confidence: HIGH -- standard sequential async/await, no platform quirks.
  - Blind spot: None significant.
- **Fix B**: Use Cloudflare waitUntil() via Astro adapter
  - Strength: Non-blocking -- user gets immediate redirect. Embedding runs in background. True fire-and-forget.
  - Tradeoff: Must verify that `context.locals.runtime.ctx.waitUntil()` is available in Astro Cloudflare adapter. If not, this approach is impossible. Adds platform coupling.
  - Confidence: MEDIUM -- Astro Cloudflare adapter documentation unclear on `runtime.ctx` availability.
  - Blind spot: Whether Astro's Cloudflare adapter exposes `waitUntil`.
- **Decision**: FIXED via Fix A

### F2 -- Progress section missing 10 manual verification items

- **Severity**: CRITICAL
- **Impact**: LOW -- quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: ## Progress (all phases)
- **Detail**: The Progress section consolidates/drops manual verification bullets. Per convention, every Success Criteria bullet must have a matching `- [ ] N.M <title>` in Progress. Counts: Phase 1 (4 manual bullets, 3 progress items, 1 missing), Phase 2 (5 manual bullets, 3 progress items, 2 missing), Phase 3 (8 manual bullets, 5 progress items, 3 missing), Phase 4 (9 manual bullets, 5 progress items, 4 missing). Automated sections are consistent. /10x-implement will fail to parse a malformed Progress section.
- **Fix**: Add the 10 missing `- [ ]` items to the Progress section, one per Success Criteria bullet, with sequential numbering.
- **Decision**: FIXED

### F3 -- Fragment references resolved by document title are fragile

- **Severity**: WARNING
- **Impact**: MEDIUM -- real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 2, Change 4 (Persist ideas endpoint), step 6b
- **Detail**: The persist endpoint resolves `document_version_id` by matching the LLM's `source_references[].document_title` against `documents.title` in the campaign. LLMs commonly modify titles (added attribution, case changes, truncation). On mismatch, `document_version_id` is set to null -- the quote_snippet survives but loses its provenance link. The plan acknowledges the fallback but doesn't mitigate the root cause.
- **Fix A (Recommended)**: Pass document IDs through tool results
  - Strength: The `search_documents` tool already returns `documentVersionId` per search result. If the LLM includes this ID in its output alongside the quote, the persist endpoint can resolve by ID (exact) instead of title (fuzzy). The schema adds an optional `document_version_id` field to source_references.
  - Tradeoff: Prompt must instruct the LLM to echo back the document_version_id from search results. LLMs sometimes drop non-natural-language fields.
  - Confidence: MEDIUM -- depends on prompt compliance.
  - Blind spot: Whether the LLM reliably echoes opaque IDs.
- **Fix B**: Use fuzzy title matching with Levenshtein distance
  - Strength: Tolerates minor title variations without changing the prompt or schema.
  - Tradeoff: Adds a string similarity dependency. False positives if two documents have similar titles.
  - Confidence: MEDIUM -- string matching libraries exist but add complexity.
  - Blind spot: Threshold tuning for match quality.
- **Decision**: FIXED via Fix A (verified `search_documents` returns `documentVersionId`; resolution order ID -> title -> null with campaign-ownership validation)

### F4 -- No transaction for bulk idea persistence

- **Severity**: WARNING
- **Impact**: LOW -- quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2, Change 4 (Persist ideas endpoint), step 6
- **Detail**: The persist endpoint inserts ideas in a loop (one per idea). If the 3rd insert of 5 fails, ideas 1-2 are committed and 3-5 are lost. No rollback, no transaction. The client sees an error but the DB has partial data. On retry, generation_number increments and the partial batch persists alongside the retried batch.
- **Fix**: Wrap the insert loop in a Supabase RPC function (or use Postgres function) that inserts all ideas + fragment references in a single transaction. Alternatively, batch all idea inserts into a single `.insert([...])` call and all fragment references into another single `.insert([...])` call (Supabase handles these as single SQL statements, each atomic).
- **Decision**: SKIPPED

### F5 -- Client-side barrel imports may pull in server runner code

- **Severity**: OBSERVATION
- **Impact**: LOW -- quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 3, Change 2 (GenerateIdeasPanel)
- **Detail**: If the React component imports `parseStructuredOutput` from `@/lib/ai/runner` (the barrel), it transitively pulls in `runner.ts` which imports `resolveProvider` from the provider registry. While technically browser-safe (no node/server APIs), this bundles unnecessary server-side code in the client JS.
- **Fix**: Import directly from `@/lib/ai/runner/output-parser` and use `import type` for `RunnerStreamEvent` from `@/lib/ai/runner/types`. Note this in Phase 3's contracts.
- **Decision**: SKIPPED

### F6 -- Phase 3 criterion 3.7 unverifiable until Phase 4

- **Severity**: OBSERVATION
- **Impact**: LOW -- quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Phase 3, Success Criteria 3.7
- **Detail**: Criterion 3.7: "After generation, ideas are persisted and page reloads with saved ideas." The idea display is built in Phase 4. At end of Phase 3, the page reload shows nothing (no display code). The implementer must verify persistence via DB inspection, not UI.
- **Fix**: Reword 3.7 to "After generation, ideas are persisted to the database (verify via Supabase Dashboard)" and move the visual verification to Phase 4.
- **Decision**: FIXED (criterion now Progress 3.9 after F2 renumber)
