<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Application Data Schema

- **Plan**: context/changes/app-data-schema/plan.md
- **Mode**: Deep
- **Date**: 2026-06-06
- **Verdict**: SOUND (after fixes)
- **Findings**: [1 critical] [2 warnings] [2 observations]

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS (after F3 fix) |
| Blind Spots | PASS (after F1 fix) |
| Plan Completeness | PASS (after F2, F5 fixes) |

## Grounding

6/6 paths verified, 4/4 symbols confirmed, brief matches plan on phases/decisions/scope.

## Findings

### F1 -- NOT NULL + ON DELETE SET NULL contradiction

- **Severity**: CRITICAL
- **Impact**: LOW -- quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2, table 7 (idea_fragment_references), line 223
- **Detail**: `document_version_id` was declared NOT NULL but with ON DELETE SET NULL. Contradictory constraints -- runtime error on delete.
- **Fix**: Made `document_version_id` nullable, kept ON DELETE SET NULL.
- **Decision**: FIXED

### F2 -- Generated types file will fail ESLint strict rules

- **Severity**: WARNING
- **Impact**: MEDIUM -- real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 3, change 3 (lint/format scope)
- **Detail**: Plan excluded generated types from Prettier but included in ESLint strict checking. Supabase generated types commonly trigger strictTypeChecked rules.
- **Fix A (Applied)**: Exclude from both Prettier and ESLint. Generated code is machine output; TypeScript still type-checks imports.
- **Decision**: FIXED (Fix A)

### F3 -- ideas.source uses text instead of enum

- **Severity**: WARNING
- **Impact**: LOW -- quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 2, table 6 (ideas), line 201
- **Detail**: All other constrained-value columns use enums, but `ideas.source` was plain text. Breaks pattern, loses DB-level validation.
- **Fix**: Added `idea_source` enum ('auto', 'manual'), typed the column accordingly.
- **Decision**: FIXED

### F4 -- Phase 4 largely duplicates Phase 3 verification

- **Severity**: OBSERVATION
- **Impact**: LOW -- quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 4 vs Phase 3
- **Detail**: Phase 4 automated checks were identical to Phase 2 + Phase 3. Only new item was auth flow test.
- **Fix**: Merged Phase 4 into Phase 3; added auth flow test to Phase 3 manual criteria.
- **Decision**: FIXED

### F5 -- updated_at trigger approach underspecified

- **Severity**: OBSERVATION
- **Impact**: LOW -- quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2, Trigger section
- **Detail**: "moddatetime-style or BEFORE UPDATE function" left implementer to decide; moddatetime needs an unlisted extension.
- **Fix**: Specified BEFORE UPDATE function approach (no extension dependency).
- **Decision**: FIXED
