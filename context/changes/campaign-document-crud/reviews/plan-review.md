<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Campaign & Document CRUD Implementation Plan

- **Plan**: context/changes/campaign-document-crud/plan.md
- **Mode**: Deep
- **Date**: 2026-06-06
- **Verdict**: REVISE
- **Findings**: [1 critical] [2 warnings] [0 observations]

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS |
| Plan Completeness | FAIL |

## Grounding

6/6 paths verified, 5/5 symbols verified, brief-plan consistent.

## Findings

### F1 — Progress section missing 1:1 mapping with Success Criteria

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: ## Progress (line 280)
- **Detail**: The Progress section consolidated multiple Success Criteria bullets into single items and dropped others entirely. Phase 1 had 7 criteria but only 5 progress items; Phase 2 had 10 criteria but 7 items; Phase 3 had 13 criteria but 9 items.
- **Fix**: Expand Progress to have one `- [ ]` item per Success Criteria bullet.
- **Decision**: FIXED — Progress section expanded to 1:1 mapping with all criteria bullets.

### F2 — Topbar only renders on homepage; campaign pages have no nav

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 1, Item 3 — Update Topbar navigation
- **Detail**: Topbar.astro was only used on the homepage (index.astro via Welcome.astro). Layout.astro had no navigation. Campaign pages would have no nav, no sign-out.
- **Fix A ⭐ Recommended**: Include Topbar in Layout.astro for all pages
  - Strength: Single change gives every page consistent nav.
  - Tradeoff: Dashboard's inline sign-out becomes redundant.
  - Confidence: HIGH — Topbar conditional logic already covers both states.
  - Blind spot: Auth pages might want different chrome.
- **Fix B**: Add Topbar to campaign pages only
  - Strength: Minimal blast radius.
  - Tradeoff: Nav inconsistent; problem repeats with every new page set.
  - Confidence: MEDIUM.
  - Blind spot: Dashboard remains isolated.
- **Decision**: FIXED via Fix A — Phase 1 updated to include Topbar in Layout.astro, remove from Welcome.astro, remove dashboard inline sign-out.

### F3 — Document count aggregation approach unspecified

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2, Item 1 — Campaign list page
- **Detail**: Plan said "separate count query grouped by campaign_id and type" but Supabase JS has no GROUP BY. First data query in codebase — no precedent.
- **Fix**: Add sentence specifying fetch + TypeScript grouping approach.
- **Decision**: FIXED — Contract updated with explicit fetch-and-group-in-TS approach.
