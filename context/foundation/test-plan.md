# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (sections 1-5); cookbook patterns at the bottom (section 6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see section 8).
>
> Last updated: 2026-06-25

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost x signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the
   team is worried about X, and the failure would surface somewhere in
   area Y" carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* -- drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact x likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* -- never a specific file as "where the failure lives" (that is
research's job, see section 1 principle 3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence -- not anchor) |
|---|------------------------|--------|------------|--------------------------------|
| 1 | AI generation produces ideas disconnected from campaign documents -- generated ideas contain no real fragment references, or cite fragments that don't exist in the uploaded documents | High | High | Interview Q1; PRD FR-012/FR-014 ("each idea traces back to specific document fragments"); archive: deterministic-generation-workflow -- fragment provenance depends on tag resolution, hallucinated tags silently dropped; hot-spot dir `src/lib/ai` (7 commits/30d) |
| 2 | AI generation ignores business profile context -- ideas are generic, don't reflect tone/audience/keywords from the profile | High | High | Interview Q1; PRD success criteria ("Generated ideas clearly reflect the business profile -- not generic AI output"); roadmap S-04 (profile wizard not yet wired -- currently hardcoded defaults) |
| 3 | Data leaks between users -- any authenticated user can read/modify another user's campaigns, documents, or ideas via a direct API call because no RLS exists | High | Medium | Archive: all 7 plans note "no RLS"; roadmap F-03 (data-authorization) status: proposed; hot-spot dir `src/pages/api/ai` (10 commits/30d) |
| 4 | AI workflow fails silently or produces malformed output -- generation endpoint returns 200 but ideas are truncated, structurally invalid, or empty; user sees "generation complete" with garbage or nothing | High | Medium | Interview Q2 ("AI workflow reliability"); archive: deterministic-generation-workflow -- structured-output support on OpenRouter `/responses` never confirmed; batch of 10 ideas risks truncation |
| 5 | Workers runtime divergence breaks production -- code works in local dev but fails on deployed Workers due to runtime differences (missing APIs, env var handling, request lifecycle) | Medium | Medium | Interview Q2 ("deployment to Workers is my weak point"); tech-stack.md: Cloudflare Workers deployment; archive: ai-generation-pipeline -- Workers `nodejs_compat` mode constraints |

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|------|-----------------------------|----------------|--------------------------------------|-----------------------|-----------------------|
| #1 | Generated ideas contain `source_references` that resolve to real fragment IDs from the campaign's documents; zero hallucinated/orphan references | "The LLM returned references, so they must be valid" -- tag resolution can silently drop invalid refs | Entry point for generation, fragment tagging logic, how provenance is resolved/validated, what happens to unresolved tags | Integration test (generation service with seeded docs) | Asserting reference count > 0 without verifying references resolve to actual document content |
| #2 | Generated ideas reflect profile fields (tone, audience, keywords) -- measurable via prompt context assembly, not by judging prose quality | "Profile is passed to the prompt, so it must influence output" -- hardcoded defaults may still be in the code path | How profile data flows from DB to prompt assembly; whether S-04 (profile wizard) is wired or still hardcoded | Integration test (prompt assembly with profile fixture) | Testing LLM output quality with AI-as-judge when a deterministic check on prompt assembly would catch the real failure |
| #3 | An API call with User A's auth token cannot read/mutate User B's campaigns, documents, or ideas | "We always add `.eq('user_id', ...)` so it's fine" -- one missed scope = full exposure; no RLS safety net | Every API endpoint, ownership scoping pattern, which endpoints are protected | Integration test (two-user scenario against API endpoints) | Testing only happy-path (own data accessible) without testing cross-user denial |
| #4 | Generation endpoint returns structurally valid ideas matching the expected schema, or returns a clear error -- never silent garbage | "It returned 200, so it worked" -- 200 with truncated/malformed JSON is the actual failure mode | Structured output parsing, error handling, truncation detection, retry logic | Unit test (output parser with malformed/truncated fixtures) | Mocking the LLM response as always-valid; the test must include malformed inputs |
| #5 | The build succeeds on Workers and critical API routes respond correctly in the deployed environment | "It builds, so it works" -- build success doesn't catch runtime API differences | Which Node.js APIs are used that may not exist in Workers; env var access patterns; request lifecycle | Build verification + smoke test (deployed endpoint health check) | Full e2e suite when a build + targeted smoke catches the real failure class |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|-----------|-----------------|---------------|------------|--------|---------------|
| 1 | Test infrastructure + critical-path coverage | Bootstrap Vitest; defend Risk #1 and #4 -- fragment provenance and output validation | #1, #4 | unit + integration | not started | -- |
| 2 | Data authorization testing | Defend Risk #3 -- cross-user data access denial at every API endpoint | #3 | integration | not started | -- |
| 3 | AI workflow integration | Defend Risk #2 -- verify profile context reaches prompt assembly and generation produces coherent output end-to-end | #2 | integration | not started | -- |
| 4 | Quality gates + deployment verification | Defend Risk #5 -- CI test step, build verification, deployed smoke test; lock the floor | #5 | CI wiring, smoke test | not started | -- |

## 4. Stack

The classic test base for this project. No test infrastructure exists today.

| Layer | Tool | Version | Notes |
|-------|------|---------|-------|
| unit + integration | none yet -- see Phase 1 | -- | Vitest recommended (Astro ecosystem, TypeScript-native) |
| API mocking | none yet -- see Phase 1 | -- | MSW or direct Supabase test helpers TBD during research |
| e2e | none yet -- not in rollout scope | -- | Defer until rollout proves need beyond integration tests |
| accessibility | none yet -- not in rollout scope | -- | `jsx-a11y` ESLint rules already active |

**Stack grounding tools (current session):**
- Docs: Context7 -- available for Astro, Vitest, Supabase, Cloudflare docs; checked: 2026-06-25
- Search: Exa.ai -- available for discovery and current status; checked: 2026-06-25
- Runtime/browser: none -- not available in current session
- Provider/platform: none -- not available in current session

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required for Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate | Where | Required? | Catches |
|------|-------|-----------|---------|
| `astro sync` + lint + typecheck | local + CI | required (already wired) | syntactic / type drift |
| unit + integration tests | local + CI | required after Phase 1 | logic regressions in generation pipeline and data access |
| build on Workers | CI | required (already wired) | compilation and bundling failures |
| deployed smoke test | post-merge | recommended after Phase 4 | Workers runtime divergence, env var issues |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD -- see Phase N."

### 6.1 Adding a unit test

TBD -- see Phase 1. Will cover output parser validation and fragment provenance checking patterns.

### 6.2 Adding an integration test

TBD -- see Phase 1. Will cover generation service with seeded documents and profile fixtures.

### 6.3 Adding an API authorization test

TBD -- see Phase 2. Will cover two-user cross-access denial pattern for API endpoints.

### 6.4 Adding a test for prompt assembly

TBD -- see Phase 3. Will cover profile-context-in-prompt verification pattern.

### 6.5 Per-rollout-phase notes

(After each phase lands, `/10x-implement` appends a 2-3 line note here capturing anything surprising the rollout phase taught.)

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **shadcn/ui components** -- third-party primitives, not product code. Re-evaluate if custom component wrappers grow complex. (Source: interview Q5.)
- **Auth flows (signin/signup/signout)** -- Supabase handles the auth logic; we only wire it. Re-evaluate if custom auth logic is added beyond the Supabase SDK. (Source: interview Q5.)
- **Snapshot tests for page layouts** -- high churn from Tailwind changes, low signal. Re-evaluate if visual regression becomes a real problem. (Source: interview Q5.)

## 8. Freshness Ledger

- Strategy (sections 1-5) last reviewed: 2026-06-25
- Stack versions last verified: 2026-06-25
- AI-native tool references last verified: 2026-06-25

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- section 7 negative-space no longer matches what the team believes.
