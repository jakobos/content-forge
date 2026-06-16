<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Deterministic Generation Workflow

- **Plan**: context/changes/deterministic-generation-workflow/plan.md
- **Scope**: All 6 Phases (full plan)
- **Date**: 2026-06-13
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical | 4 warnings | 6 observations

## Verdicts

| Dimension | Verdict |
|---|---|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Automated Checks

| Check | Result |
|---|---|
| `npx astro sync` | PASS (2.11s) |
| `npm run lint` | PASS (exit 0) |
| `npm run build` | PASS (9.63s) |
| `runner/` deleted | PASS |
| `tools/` deleted | PASS |
| `generate.ts` deleted | PASS |
| `ideas.ts` deleted | PASS |
| `rg` dead refs | PASS (two matches are `/generate-ideas`, not `/generate`) |

Manual checks (1.4–1.5, 2.5–2.7, 3.5–3.7, 4.5–4.10, 5.5–5.11, 6.6–6.7) remain pending as expected.

## Findings

### F1 — GenerateIdeasPanel: no AbortController, no unmount cleanup

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/campaigns/GenerateIdeasPanel.tsx:23–53
- **Detail**: handleGenerate() is a plain async function — no AbortController, no signal passed to fetch(). If the component unmounts mid-generation (user navigates away), the fetch + SSE loop runs to completion, firing state updates on a dead component. There is no user-facing cancel path.
- **Fix A ⭐ Recommended**: Add AbortController ref + signal to fetch
  - Add `const abortRef = useRef<AbortController | null>(null);`. Create a controller in handleGenerate, assign to abortRef.current, pass `signal: ctrl.signal` to fetch(). Optionally expose a Cancel button that calls `abortRef.current?.abort()`.
  - Strength: Propagates abort through the SSE loop (reader.read() rejects on AbortError). ProviderRequest.signal already exists in types.ts:86 for server-side propagation.
  - Tradeoff: background_operations row lands in `failed` state on abort — which is correct.
  - Confidence: HIGH — straightforward for this component shape.
  - Blind spot: consumeSSE itself doesn't accept a signal; fetch abort propagates implicitly via reader.read() rejection.
- **Fix B**: Wrap in useEffect with cleanup flag
  - Convert button-click to a useEffect driven by a `generating` flag.
  - Strength: React-idiomatic lifecycle.
  - Tradeoff: Higher refactor cost; AbortController ref achieves the same with less structural change.
  - Confidence: MEDIUM.
  - Blind spot: Same as Fix A.
- **Decision**: FIXED via Fix A

### F2 — service.ts: fragment reference insert errors silently dropped

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/ai/generation/service.ts:172–182
- **Detail**: The inner for-loop that inserts `idea_fragment_references` does not capture the Supabase return value. A FK violation, constraint error, or DB outage silently discards the error, leaving a persisted idea with zero source references — the UI shows the idea but Sources is empty with no indication of why. Contrast: the idea insert at line 143 correctly checks `{ data, error }` and throws on error. The fragment ref insert is the only unchecked DB write in persistIdeas.
- **Fix**: Capture and check the error — `const { error: refError } = await supabase.from("idea_fragment_references").insert({...}); if (refError) throw new Error(refError.message);` Decide whether to throw (refs required) or warn+continue (refs best-effort).
  - Strength: Consistent with the idea insert pattern (line 165). Makes failures surface as an error event and a `failed` background_operations row.
  - Tradeoff: One FK mismatch aborts the entire generation if refs are treated as required.
  - Confidence: HIGH — identical check one loop up in the same file.
  - Blind spot: None significant.
- **Decision**: FIXED (throw on error)

### F3 — schemas.ts: z.string().optional() rejects null from strict structured output

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/ai/prompts/schemas.ts:12–23
- **Detail**: IdeaSchema uses z.string().optional() for hook and all other optional fields. z.string().optional() accepts `undefined` but rejects `null`. When strict structured output is enabled (adapter.ts:116 passes `strict: true`), OpenAI-family models on OpenRouter return `null` for absent optional fields rather than omitting the key. Receiving `{ "hook": null }` causes safeParse to fail, burning the one retry (service.ts:266–276) and returning an error event. Current default is Claude which omits absent fields, so it works today; failure is latent.
- **Fix A ⭐ Recommended**: Add .nullable() to all optional fields in IdeaSchema and update IdeaOutputJsonSchema to match:
  - `hook: z.string().optional().nullable()` (and similarly for all other optional strings and `key_points: z.array(...).optional().nullable()`). In IdeaOutputJsonSchema: `"hook": { "type": ["string", "null"] }`.
  - Strength: Handles both missing-key and null-value; makes generation work across OpenAI-family models. JSON schema accurately signals allowed types.
  - Tradeoff: TypeScript types include `null`; callers may need null guards (most in [id].astro already use optional chaining).
  - Confidence: HIGH — known structured-output behaviour across OpenAI, Gemini, OpenRouter.
  - Blind spot: Verify key_points (array type) also needs .nullable() if the model returns null for an absent array.
- **Fix B**: Preprocess to strip null before safeParse
  - Strip null → undefined from parsed JSON before calling safeParse. Single change point.
  - Strength: No schema changes.
  - Tradeoff: Hides the contract; callers can't tell what's allowed.
  - Confidence: MEDIUM.
  - Blind spot: None.
- **Decision**: FIXED via Fix A

### F4 — service.ts: N+1 round-trips for fragment reference inserts

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/ai/generation/service.ts:172–182
- **Detail**: Fragment refs are inserted one at a time in a nested for-loop inside the per-idea loop. 10 ideas × 3 refs = 30 sequential Supabase round-trips for refs alone, adding ~300ms–1500ms to the saving phase. Contrast: [id].astro batch-fetches all fragment refs in a single `.in("idea_id", ideaIds)` call (line 60).
- **Fix**: Collect all refs per idea and batch-insert: `const refsToInsert = idea.source_references.filter(ref => tagMap.get(ref.tag)).map(ref => ({ idea_id: insertedIdea.id, document_version_id: tagMap.get(ref.tag)!, quote_snippet: ref.quote_snippet })); if (refsToInsert.length > 0) { const { error } = await supabase.from("idea_fragment_references").insert(refsToInsert); if (error) throw new Error(error.message); }`
- **Decision**: FIXED

### F5 — providers/index.ts barrel not mentioned in plan

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/lib/ai/providers/index.ts
- **Detail**: A barrel re-export module (initializeProviders + all sub-module types/factories) appears in the diff but not in the plan. It enables `import ... from "@/lib/ai/providers"` in service.ts and index.ts. Structurally necessary and non-breaking.
- **Fix**: Document in the plan as a one-line addendum under Phase 1.
- **Decision**: SKIPPED

### F6 — retrieval.ts: supabase parameter not in plan's export signature

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/ai/generation/retrieval.ts:118
- **Detail**: The plan's contract for retrieveTaggedFragments omits a supabase parameter, but the implementation adds it as the second argument to fetch document titles for the TaggedFragment type (which the plan requires to carry documentTitle). Necessary given the plan's own type definition — the plan signature was incomplete. All callers pass it correctly.
- **Fix**: No code change needed. Acceptable to note in plan as addendum.
- **Decision**: FIXED (addendum added to plan.md Phase 2)

### F7 — service.ts: race condition in generation_number increment

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Reliability
- **Location**: src/lib/ai/generation/service.ts:68–78
- **Detail**: autoIncrementGenerationNumber reads max(generation_number) and adds 1 in application code. Two concurrent generate-ideas requests for the same campaign (double-click, two tabs) would both read the same max and both produce generation N+1, causing two batches to display under the same "Generation #N" heading. Not a data-integrity blocker; ideas are still saved correctly.
- **Fix**: Accept as a known edge case with a comment, or move the increment to a Postgres function/RPC for atomic behaviour.
- **Decision**: FIXED (comment added to autoIncrementGenerationNumber)

### F8 — ai/index.ts: userId ?? "" makes userId silently optional

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/ai/index.ts:51
- **Detail**: `userId: config.userId ?? ""` — if a future caller omits userId, ideas would be inserted with user_id = "" (invalid UUID). The current endpoint always passes a real user.id, so no live path hits this, but the config type allows omission.
- **Fix**: Remove the optional mark: `userId: string` (not `userId?: string`) in the config type. Two-character fix.
- **Decision**: FIXED

### F9 — [id].astro: `as unknown as FragRef` bypasses inference

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/campaigns/[id].astro:64
- **Detail**: `const typed = ref as unknown as FragRef` coerces the Supabase join result to a hand-written interface. If the nested join shape changes (document_versions → documents), the cast silently produces undefined at runtime instead of a compile error. The optional chain at line 281 already guards null access.
- **Fix**: Use a Supabase-generated QueryResult type, or add a runtime shape guard. At minimum, document the cast with a comment.
- **Decision**: SKIPPED
