<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: AI Generation Pipeline

- **Plan**: context/changes/ai-generation-pipeline/plan.md
- **Scope**: All phases (1–7 of 7)
- **Date**: 2026-06-10
- **Verdict**: REJECTED
- **Findings**: 3 critical  7 warnings  1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — IDOR via LLM-controlled tool arguments

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: src/lib/ai/tools/definitions/get-business-profile.ts:59 / src/lib/ai/index.ts:47-61
- **Detail**: Both LLM-callable tools accept identity parameters from LLM-generated arguments with no ownership gate. `get_business_profile` accepts `user_id` from the LLM and queries `business_profiles` for any UUID — an attacker crafts a `system_prompt` (which is user-supplied in generate.ts body) instructing the LLM to call the tool with a victim's user ID, exfiltrating brand profile data. `search_documents` accepts `campaign_id` from the LLM with no ownership check — same vector allows retrieval of another user's document content.
- **Fix A ⭐ Recommended**: Bind identity into tool handlers via closure at construction time; ignore LLM-supplied identity params
  - Strength: Architectural fix — LLM args can never escalate privileges regardless of prompt. Consistent with principle of least authority for tool handlers. search.ts:44-56 already shows the ownership-query pattern to copy.
  - Tradeoff: generate.ts must extract user.id before initializeAI() and pass it into tool construction; requires threading user context into createGetBusinessProfileTool factory signature.
  - Confidence: HIGH — standard pattern for capability-based security in agentic systems.
  - Blind spot: The search service ownership check in search.ts:44-56 uses the same pattern already — use that as the template.
- **Fix B**: Add runtime ownership validation inside each tool handler
  - Strength: Less refactoring — doesn't change factory signatures.
  - Tradeoff: Defense is inside the tool execution loop, after the LLM has already been called; duplicates ownership logic across handlers rather than preventing the issue structurally.
  - Confidence: MED — correct at runtime but leaves the API surface open at the tool-definition level.
  - Blind spot: Easy to forget on future tool additions.
- **Decision**: FIXED via Fix A — identity bound via closure; user_id and campaign_id removed from LLM-visible tool schemas; userId/campaignId threaded into initializeAI config.

### F2 — No campaign ownership check in generate.ts

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/ai/generate.ts:46
- **Detail**: campaign_id is read from the request body (line 14) and stored directly into background_operations.input_ref (line 53) without verifying the authenticated user owns that campaign. Any authenticated user can trigger AI generation attributed to any campaign UUID they discover, and have background_operations rows appear in another user's operation history. search.ts:44-56 has the correct pattern for this; generate.ts is missing an equivalent check.
- **Fix**: Add the ownership query before line 46, mirroring search.ts:44-56: query campaigns with `.eq("id", campaign_id).eq("user_id", user.id)`, return 403 JSON if the campaign is not found or not owned.
  - Strength: Exact same Supabase query already written in search.ts — copy the pattern; narrow, one-function change.
  - Tradeoff: One extra DB round-trip per generation request.
  - Confidence: HIGH — identical guard works in search.ts.
  - Blind spot: None significant.
- **Decision**: FIXED — ownership query added before background_operations insert, mirroring search.ts pattern.

### F3 — No document version ownership check in embed.ts

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/ai/embed.ts:40
- **Detail**: embed.ts accepts any document_version_id after only checking context.locals.user is non-null. Any authenticated user can supply another user's document_version_id, causing: (a) the existing embeddings for that document version to be deleted (service.ts:34-37), (b) arbitrary attacker-controlled content to be embedded in its place. This is both data destruction and data injection on another user's asset.
- **Fix**: Before calling embedDocument, join document_versions → documents → campaigns and check campaigns.user_id = user.id. Return 403 if ownership fails. A single Supabase query: `.from("document_versions").select("documents!inner(campaigns!inner(user_id))")` then verify user_id.
  - Strength: Closes the data-destruction vector entirely; one query, one guard.
  - Tradeoff: One extra DB round-trip per embed request.
  - Confidence: HIGH — ownership-join pattern is viable given the FK chain document_versions → documents → campaigns.
  - Blind spot: Verify the FK chain in database.types.ts before writing the join.
- **Decision**: FIXED — document_versions → documents ownership join added; 403 returned if user_id mismatch.

### F4 — Pre-stream auth errors return HTTP 200 in generate.ts

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/ai/generate.ts:22-32
- **Detail**: Errors before the stream starts (Unauthorized, AI not configured, DB not configured) are returned via createSSEErrorResponse(), emitting HTTP 200 with Content-Type: text/event-stream. embed.ts and search.ts return proper 401/503 JSON for equivalent pre-execution errors. Browser EventSource reconnects on non-200 only — a 200 error body keeps the client connected waiting for more events.
- **Fix A ⭐ Recommended**: Return proper HTTP status JSON for pre-stream errors; switch to SSE error format only after the stream has started
  - Strength: Aligns with embed.ts and search.ts patterns; fixes browser EventSource reconnect behavior.
  - Tradeoff: Client must handle both JSON (pre-stream) and SSE (mid-stream) error formats — but this is already the case since embed/search are JSON.
  - Confidence: HIGH — embed.ts:14-24 is the reference pattern.
  - Blind spot: None significant.
- **Fix B**: Document that generate.ts intentionally uses SSE errors throughout
  - Strength: Uniform error format for the generate endpoint.
  - Tradeoff: Still violates HTTP semantics (401 as 200); breaks any HTTP-level monitoring or middleware that reads status codes.
  - Confidence: LOW — HTTP semantics violation is a real operational cost.
  - Blind spot: Whether future middleware (e.g. Cloudflare WAF rules) keys on status code for rate limiting.
- **Decision**: FIXED via Fix A — pre-stream errors now return proper JSON status codes (401/503/400/500); createSSEErrorResponse removed from generate.ts.

### F5 — AbortSignal not threaded through agent runner

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/ai/runner/runner.ts:21 / src/pages/api/ai/generate.ts:65
- **Detail**: runner.ts run() has no signal parameter. The runner builds ProviderRequest objects without a signal (runner.ts:47-53). generate.ts never passes context.request.signal to the runner. When the HTTP client disconnects, the runner continues all remaining round-trips and tool calls, burning OpenRouter API quota for a request nobody is receiving.
- **Fix**: Add signal?: AbortSignal to run() in runner.ts, thread it into each ProviderRequest build and into toolRegistry.execute() calls. In generate.ts, pass context.request.signal to runner.run().
  - Strength: ProviderRequest.signal is already in the type (types.ts) — the plumbing exists, just not connected.
  - Tradeoff: Must update runner.ts interface and all run() call sites (generate.ts only, currently).
  - Confidence: HIGH — ProviderRequest.signal is already in the type; adapter already passes it through to fetch().
  - Blind spot: Check whether Cloudflare Workers request.signal fires on client disconnect; it should for HTTP/1.1 but worth verifying.
- **Decision**: FIXED — signal?: AbortSignal added to runner.run(); threaded into ProviderRequest and toolRegistry.execute(); generate.ts passes context.request.signal.

### F6 — Non-atomic delete+insert in embedding service

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: src/lib/ai/embeddings/service.ts:33-68
- **Detail**: embedDocument deletes all existing embeddings (lines 34-37) then calls the OpenRouter API and inserts new ones (line 64). If the embedding API call or insert fails after the delete, the document version is left with zero embeddings with no recovery path. The service comment says it's "safe to call multiple times" but a mid-operation failure produces a permanently empty state — subsequent searches return no results for that document until the caller retries.
- **Fix A ⭐ Recommended**: Invert operation order — insert new embeddings first, then delete old ones only after insert succeeds
  - Strength: Preserves search functionality on failure; if insert fails, old rows still exist.
  - Tradeoff: Schema change may be needed to distinguish old vs new rows if (document_version_id, chunk_index) has a unique constraint. Verify uniqueness constraints in the migration SQL before committing.
  - Confidence: MED — depends on schema details.
  - Blind spot: Haven't confirmed the uniqueness constraints on document_embeddings.
- **Fix B**: Document the atomicity gap and add a status flag on document_versions
  - Strength: No schema change to document_embeddings; observable state for callers.
  - Tradeoff: Doesn't prevent the gap — just makes it detectable. Requires a follow-up retry mechanism.
  - Confidence: MED — punts the reliability problem downstream.
  - Blind spot: Who triggers the retry?
- **Decision**: FIXED via Fix A — inverted to embed-first upsert (ON CONFLICT document_version_id,chunk_index) then delete stale tail chunks; old rows remain intact on embedding API failure.

### F7 — Sequential vector + FTS calls in hybrid search

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/ai/search/service.ts:61-80
- **Detail**: In hybrid strategy, the vector RPC and FTS RPC are awaited sequentially, doubling Supabase round-trip latency for every hybrid search call. This is called once per tool invocation inside the agent loop, multiplying the cost.
- **Fix**: Replace sequential awaits with Promise.all — the two RPCs are independent and can run concurrently.
- **Decision**: SKIPPED

### F8 — Embedding client retries non-retryable 4xx errors

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/ai/embeddings/client.ts:31-44
- **Detail**: withRetry retries on any thrown error including 400 Bad Request and 401 Unauthorized. A bad API key would burn through 3 retries with 0/1/2s delays before surfacing the error.
- **Fix**: In callEmbeddingsApi, check response.status before throwing — if 4xx (except 429), throw immediately without entering the retry wrapper. Only retry on 429, 5xx, and network errors.
- **Decision**: SKIPPED

### F9 — Raw internal errors exposed to client in embed.ts

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/ai/embed.ts:74-81
- **Detail**: Caught exceptions are returned directly as error messages, potentially exposing Supabase error details, table/column names, or OpenRouter API response bodies. Same issue in search.ts:66. Additionally, embed.ts has no upper bound on content length (z.string().min(1) accepts megabytes), allowing a single request to burn arbitrary API quota.
- **Fix**: Log the full error server-side; return a generic "Embedding failed" / "Search failed" message. Add z.string().min(1).max(500_000) (or cost-appropriate limit) on the content field.
- **Decision**: FIXED — content max(500_000) added to embed.ts BodySchema; catch blocks return generic "Embedding failed"/"Search failed" to client; internal error stored in background_operations.error_message only.

### F10 — Factory pattern drift for getBusinessProfileTool

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/ai/tools/definitions/get-business-profile.ts
- **Detail**: Plan specified a static export getBusinessProfileTool. Actual is a factory createGetBusinessProfileTool(supabase). The plan's spec was self-contradictory (a static export cannot query Supabase without injection) — this deviation is correct and architecturally sound. All consumers handle it correctly. Noting for plan accuracy.
- **Fix**: Update plan.md Phase 3 "Changes Required" to document the factory pattern as the actual contract.
- **Decision**: SKIPPED
