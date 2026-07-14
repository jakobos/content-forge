# Data Authorization (RLS) Implementation Plan

## Overview

Enable Row-Level Security on all 9 application tables so the database enforces per-user data isolation as defense-in-depth alongside the existing application-level ownership checks. A single Supabase migration adds RLS + full CRUD policies. No application code changes required -- the Supabase client already uses the anon key and all queries already scope by `user_id`.

**Revision note**: Previous attempt was reverted. The failure was NOT caused by RLS -- it was a Supabase version mismatch (`column users.banned_until does not exist`). This revision uses `supabase migration up` (incremental) instead of `supabase db reset` to avoid triggering version-related schema rebuilds.

## Current State Analysis

- **9 application tables**, zero RLS policies. Security relies entirely on `.eq("user_id", user.id)` in every API endpoint and page query.
- **5 tables have a direct `user_id` column**: `business_profiles`, `campaigns`, `documents`, `ideas`, `background_operations`.
- **4 tables derive ownership** via FK chains: `document_versions` (via `documents`), `document_embeddings` (via `document_versions` -> `documents`), `idea_fragment_references` (via `ideas`), `publications` (via `ideas`).
- **2 RPC functions** (`match_document_chunks`, `search_document_chunks`) are `LANGUAGE sql STABLE` -- INVOKER by default, so they will respect RLS on underlying tables with no changes needed.
- **Supabase client** uses the anon key (`SUPABASE_KEY`), which respects RLS. The `createServerClient` from `@supabase/ssr` passes the user's JWT via cookies, so `auth.uid()` resolves correctly in policies.
- **Middleware** extracts the user from the JWT on every request (`supabase.auth.getUser()`) and sets `context.locals.user`.
- **No triggers on user creation**: Signup only creates a row in `auth.users`. No application tables are touched. `business_profiles` handles missing rows gracefully via hardcoded defaults in `src/lib/ai/generation/profile.ts:36-37`.

### Key Discoveries:

- Every archived change (F-01, S-01, F-02, S-03, S-08) explicitly deferred RLS to F-03 with consistent language
- The test plan (`context/foundation/test-plan.md:44`) rates the missing RLS as High severity / Medium likelihood
- The roadmap constraint (`roadmap.md:292`) blocks multi-user deployment until F-03 lands
- RPC functions join `document_embeddings -> document_versions -> documents` and filter by `campaign_id` but not `user_id` -- under RLS, the `documents` table policy will enforce ownership transitively through those joins
- Application-level `.eq("user_id", user.id)` guards are consistent across all 12 data endpoints -- no gaps found
- `publications` table has no `user_id` column (design decision from S-08); ownership is derived through parent `ideas`
- Previous `banned_until` error is a Supabase CLI/image version mismatch, unrelated to RLS policies

## Desired End State

All 9 application tables have RLS enabled with SELECT, INSERT, UPDATE, and DELETE policies scoped to the authenticated user. An authenticated user can only read, create, modify, or delete rows they own -- either directly (via `user_id = auth.uid()`) or transitively (via FK chain to a parent table with `user_id`). Unauthenticated requests (where `auth.uid()` is null) receive empty result sets and cannot insert, update, or delete any rows.

**Verification:** `npm run lint` and `npm run build` pass. The migration applies cleanly via `supabase migration up`. Existing app functionality works unchanged when tested manually (campaign CRUD, document creation, idea generation, publication tracking).

## What We're NOT Doing

- **App-level audit**: Not modifying or auditing existing endpoint ownership checks. They're consistent and correct; RLS adds defense-in-depth alongside them.
- **Schema changes**: Not adding `user_id` to tables that derive ownership (document_versions, document_embeddings, idea_fragment_references, publications). Sub-select policies handle derived ownership.
- **RPC function changes**: Not modifying `match_document_chunks` or `search_document_chunks`. They're INVOKER by default; RLS on the underlying tables handles isolation.
- **PostgREST role revocation**: Not revoking anon role access. RLS per-table is sufficient -- unauthenticated calls get no rows.
- **SQL verification script**: Not writing automated RLS tests. Verification is manual.
- **Performance optimization**: Not denormalizing `user_id` onto `document_embeddings`. Current scale is small; existing indexes cover the sub-select join path.
- **Supabase version fix**: Not fixing the `banned_until` version mismatch in this change. That's a separate CLI/image issue.

## Implementation Approach

One migration file enables RLS and creates policies for all 9 tables at once. A companion down-migration script (not a Supabase migration -- a manual rollback SQL file) disables RLS and drops all policies if needed.

**Policy design pattern:**

- **Direct ownership** (5 tables): `(select auth.uid()) = user_id` in USING/WITH CHECK clauses.
- **Derived ownership** (4 tables): `EXISTS (SELECT 1 FROM parent_table WHERE ...)` sub-select tracing up the FK chain to a table with `user_id`.
- All policies target the `authenticated` role (`TO authenticated`).
- INSERT policies use `WITH CHECK` to enforce `user_id = auth.uid()` on new rows.
- UPDATE policies use both `USING` (existing row) and `WITH CHECK` (new row) to prevent ownership transfer.
- `auth.uid()` is wrapped in `(select auth.uid())` per Supabase best practice (sub-select caching).

**Apply method:** `supabase migration up` (incremental). Do NOT use `supabase db reset` -- it triggers a full schema rebuild that may expose version mismatches in the auth schema.

---

## Phase 1: RLS Migration

### Overview

Write the Supabase migration that enables RLS on all 9 tables and creates full CRUD policies. Write a companion down-migration for rollback.

### Changes Required:

#### 1. Up-migration

**File**: `supabase/migrations/<timestamp>_enable_rls_all_tables.sql`

**Intent**: Enable RLS on every application table and create SELECT/INSERT/UPDATE/DELETE policies that enforce per-user data isolation. This is the core deliverable of F-03.

**Contract**: The migration must:

- Call `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY` for all 9 tables
- Create named policies per operation per table (naming convention: `<table>_<operation>_own` e.g. `campaigns_select_own`)
- Use `TO authenticated` on all policies
- Use `(select auth.uid())` (subquery-wrapped) in all policy expressions

Policy specifications per table:

**Direct ownership tables** (`user_id` column present):

| Table                   | SELECT USING                    | INSERT WITH CHECK               | UPDATE USING                    | UPDATE WITH CHECK               | DELETE USING                    |
| ----------------------- | ------------------------------- | ------------------------------- | ------------------------------- | ------------------------------- | ------------------------------- |
| `business_profiles`     | `(select auth.uid()) = user_id` | `(select auth.uid()) = user_id` | `(select auth.uid()) = user_id` | `(select auth.uid()) = user_id` | `(select auth.uid()) = user_id` |
| `campaigns`             | same                            | same                            | same                            | same                            | same                            |
| `documents`             | same                            | same                            | same                            | same                            | same                            |
| `ideas`                 | same                            | same                            | same                            | same                            | same                            |
| `background_operations` | same                            | same                            | same                            | same                            | same                            |

**Derived ownership tables** (no `user_id` -- ownership via FK chain):

| Table                      | FK chain                                                                          | Policy expression                                                                                                                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `document_versions`        | `document_versions.document_id -> documents.id`                                   | `EXISTS (SELECT 1 FROM documents WHERE documents.id = document_versions.document_id AND documents.user_id = (select auth.uid()))`                                                                                          |
| `document_embeddings`      | `document_embeddings.document_version_id -> document_versions.id -> documents.id` | `EXISTS (SELECT 1 FROM document_versions JOIN documents ON documents.id = document_versions.document_id WHERE document_versions.id = document_embeddings.document_version_id AND documents.user_id = (select auth.uid()))` |
| `idea_fragment_references` | `idea_fragment_references.idea_id -> ideas.id`                                    | `EXISTS (SELECT 1 FROM ideas WHERE ideas.id = idea_fragment_references.idea_id AND ideas.user_id = (select auth.uid()))`                                                                                                   |
| `publications`             | `publications.idea_id -> ideas.id`                                                | `EXISTS (SELECT 1 FROM ideas WHERE ideas.id = publications.idea_id AND ideas.user_id = (select auth.uid()))`                                                                                                               |

For derived-ownership tables:

- SELECT uses the sub-select expression in USING
- INSERT uses the same expression in WITH CHECK
- UPDATE uses the same expression in both USING and WITH CHECK
- DELETE uses the same expression in USING

#### 2. Down-migration (rollback script)

**File**: `supabase/migrations/_rollback/rollback_rls.sql`

**Intent**: Provide a ready-to-run rollback script that disables RLS and drops all policies. Not a Supabase migration -- a manual script to execute via `psql` or the Supabase SQL editor if policies break production.

**Contract**: For each of the 9 tables, drop all 4 policies by name, then `ALTER TABLE <table> DISABLE ROW LEVEL SECURITY`. Order: drop policies first, then disable RLS.

### Success Criteria:

#### Automated Verification:

- Migration SQL is syntactically valid (applied via `supabase migration up`)
- Rollback SQL is syntactically valid (reviewed, not applied)

#### Manual Verification:

- Migration file reviewed: correct table names, policy names, expressions match the contract above

**Implementation Note**: After writing both files, proceed directly to Phase 2 for application and verification.

---

## Phase 2: Apply & Verify

### Overview

Apply the migration to the local Supabase instance with `supabase migration up`, regenerate types, and run the CI gate.

### Changes Required:

#### 1. Apply migration locally

**Intent**: Run the migration against the local Supabase instance to enable RLS and create all policies.

**Contract**: `supabase migration up` (NOT `db reset`). Expect clean output with no policy conflicts or syntax errors.

#### 2. Regenerate database types

**File**: `src/db/database.types.ts`

**Intent**: Regenerate Supabase types to stay in sync. RLS doesn't change column types, but regenerating after any migration is standard practice.

**Contract**: Run `npx supabase gen types typescript --local > src/db/database.types.ts`. Diff should be minimal or empty.

#### 3. Run CI gate

**Intent**: Confirm lint and build pass.

**Contract**: `npx astro sync && npm run lint && npm run build` -- all exit 0.

### Success Criteria:

#### Automated Verification:

- `supabase migration up` completes without errors
- Types regenerated: `src/db/database.types.ts` is up to date
- `npx astro sync` exits 0
- `npm run lint` exits 0
- `npm run build` exits 0

#### Manual Verification:

- App loads locally and core flows work: sign in, view campaigns, create a document, trigger idea generation
- Rollback script reviewed: the down-migration SQL is syntactically correct and would cleanly reverse the up-migration
- If a second test user is available: verify user B cannot see user A's campaigns, documents, or ideas via the UI

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- No test framework configured. No unit tests.

### Integration Tests:

- No test framework configured. No integration tests.

### Manual Testing Steps:

1. After migration, sign in and verify the campaign list loads (SELECT policy works)
2. Create a new campaign (INSERT policy works)
3. Add a document to the campaign (INSERT policy on documents + document_versions works)
4. Trigger idea generation (INSERT on background_operations + ideas works; RPC functions respect RLS on embeddings)
5. Change an idea's status (UPDATE policy works)
6. Copy an idea to markdown (SELECT through idea_fragment_references works)
7. If second user available: sign in as user B, confirm user A's data is invisible

## Performance Considerations

- **Direct-ownership policies** (5 tables): O(1) -- simple equality check on indexed `user_id` column.
- **Derived-ownership policies** (4 tables): Sub-select joins through FK chain. All join columns are indexed (FK indexes on `document_id`, `document_version_id`, `idea_id`). At current scale ("small" per PRD), this is negligible.
- **RPC functions**: `match_document_chunks` and `search_document_chunks` join through `document_embeddings -> document_versions -> documents`. Under RLS, the `documents` table policy adds a `user_id` check to the join. The existing index `idx_documents_campaign_status` covers `campaign_id` but not `user_id` alone -- however, the `auth.users` FK constraint on `user_id` creates an implicit index, and query volumes are low.
- **Worst case**: `document_embeddings` is the largest table. Its policy sub-selects through 2 joins. If this becomes a bottleneck at scale, denormalizing `user_id` onto `document_embeddings` is the escape hatch (decided against for now).

## Migration Notes

- **Forward migration**: Single SQL file, idempotent (policies are `CREATE POLICY` not `CREATE OR REPLACE` -- will fail if run twice, which is correct for Supabase migrations).
- **Apply method**: `supabase migration up` (incremental). Do NOT use `supabase db reset` -- it triggers a full schema rebuild that may expose version mismatches in the auth schema (`banned_until` column error).
- **Rollback**: Manual SQL script in `supabase/migrations/_rollback/rollback_rls.sql`. Run via `psql` or Supabase SQL editor. Drops all policies by name, then disables RLS on each table.
- **No data migration**: RLS doesn't modify data. Enabling it only changes access control.
- **Deployment order**: Migration must be applied to production Supabase before or simultaneously with the app deploy. Since the app already scopes all queries by `user_id`, enabling RLS won't change behavior for correctly-scoped queries -- it only blocks incorrectly-scoped ones.

## References

- Supabase RLS docs: `CREATE POLICY` with `(select auth.uid())` pattern
- Schema migration: `supabase/migrations/20260606094848_create_application_schema.sql`
- RPC functions: `supabase/migrations/20260607120000_add_search_functions.sql`
- Supabase client: `src/lib/supabase.ts` (anon key, `createServerClient`)
- Middleware auth: `src/middleware.ts:6-25`
- Roadmap entry: `context/foundation/roadmap.md:99-110`
- Test plan risk: `context/foundation/test-plan.md:44`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: RLS Migration

#### Automated

- [x] 1.1 Migration SQL written and syntactically valid
- [x] 1.2 Rollback SQL written and syntactically valid

#### Manual

- [x] 1.3 Migration file reviewed (correct tables, policy names, expressions)

### Phase 2: Apply & Verify

#### Automated

- [ ] 2.1 `supabase migration up` completes without errors
- [ ] 2.2 Types regenerated (`src/db/database.types.ts` up to date)
- [ ] 2.3 `npx astro sync` exits 0
- [ ] 2.4 `npm run lint` exits 0
- [ ] 2.5 `npm run build` exits 0

#### Manual

- [ ] 2.6 App loads locally and core flows work (sign in, campaigns, documents, idea generation)
- [ ] 2.7 Rollback script reviewed (down-migration SQL is syntactically correct)
- [ ] 2.8 Cross-user isolation verified (user B cannot see user A's data) -- if second test user available
