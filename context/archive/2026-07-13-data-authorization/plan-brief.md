# Data Authorization (RLS) -- Plan Brief

> Full plan: `context/changes/data-authorization/plan.md`

## What & Why

Enable Row-Level Security (RLS) on all 9 application tables so the database enforces per-user data isolation as defense-in-depth alongside the existing application-level ownership checks. Today, security relies entirely on `.eq("user_id", user.id)` in every API endpoint -- a single missed filter is a data leak. RLS closes that gap. This is F-03 from the roadmap, a prerequisite for multi-user deployment.

**Revision note**: Previous attempt was reverted due to a Supabase version mismatch (`banned_until` column error), not an RLS issue. This revision uses `supabase migration up` instead of `supabase db reset`.

## Starting Point

The app has 9 Supabase tables with zero RLS policies. All 12 data-access endpoints already scope queries by `user_id` at the application level (consistent, no gaps found). The Supabase client uses the anon key (RLS-compatible). Two RPC functions are INVOKER by default. No triggers fire on user creation -- signup only touches `auth.users`.

## Desired End State

Every table enforces per-user isolation at the database level. An authenticated user can only read, create, modify, or delete rows they own -- directly (`user_id = auth.uid()`) or transitively (via FK chain to a parent table with `user_id`). Unauthenticated requests get nothing. The app works unchanged because all queries already scope by `user_id`.

## Key Decisions Made

| Decision          | Choice                                                          | Why                                                                         | Source         |
| ----------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------- |
| Scope             | RLS only, no app-level audit                                    | App-level checks are consistent; RLS adds defense-in-depth                  | Plan           |
| Derived ownership | Sub-select policies (`EXISTS (SELECT 1 FROM parent WHERE ...)`) | No schema changes; standard Supabase pattern                                | Plan           |
| Policy target     | `TO authenticated` only                                         | App requires auth for all data access; `postgres`/`service_role` bypass RLS | Plan           |
| Apply method      | `supabase migration up` (NOT `db reset`)                        | Avoids full schema rebuild that triggered `banned_until` version mismatch   | Plan (revised) |
| RPC functions     | No changes (INVOKER default)                                    | RLS on underlying tables handles isolation through joins                    | Plan           |
| Rollback          | Companion down-migration script                                 | Ready-to-run SQL via psql/SQL editor                                        | Plan           |
| Testing           | Manual verification only                                        | No test framework; verify via lint + build + manual app testing             | Plan           |

## Scope

**In scope:** RLS migration for all 9 tables (5 direct-ownership + 4 derived-ownership), companion down-migration script, type regeneration, lint + build verification.

**Out of scope:** App-level endpoint audit, schema changes, RPC function modifications, PostgREST role revocation, automated RLS tests, Supabase version fix.

## Architecture / Approach

Single SQL migration file. Two policy patterns:

- **5 direct-ownership tables** (`business_profiles`, `campaigns`, `documents`, `ideas`, `background_operations`): `(select auth.uid()) = user_id` in USING/WITH CHECK clauses.
- **4 derived-ownership tables** (`document_versions`, `document_embeddings`, `idea_fragment_references`, `publications`): `EXISTS (SELECT 1 FROM parent WHERE ... = (select auth.uid()))` sub-select tracing the FK chain.

All policies target `TO authenticated`. Each table gets 4 named policies (SELECT, INSERT, UPDATE, DELETE). No application code changes.

## Phases at a Glance

| Phase             | What it delivers                                                        | Key risk                                                                           |
| ----------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1. RLS Migration  | Migration SQL + rollback script                                         | Policy sub-selects on derived tables could be too restrictive if FK chain is wrong |
| 2. Apply & Verify | Migration applied via `migration up`, types regenerated, CI gate passes | Silent empty results if a policy blocks a legitimate query                         |

**Prerequisites:** Local Supabase running, existing data accessible for manual testing.
**Estimated effort:** ~1 session.

## Open Risks & Assumptions

- **Silent failures**: An overly restrictive policy returns empty sets, not errors. Relies on manual testing of each flow post-migration.
- **RPC function behavior**: Assumption that INVOKER + table-level RLS correctly filters through the join chain. If the functions bypass RLS, vector search would return cross-user data.
- **`banned_until` error**: Unrelated to RLS, but may still appear in Studio dashboard. Does not affect app functionality or RLS correctness. Fix separately via `supabase stop && supabase start` to pull fresh images.

## Success Criteria (Summary)

- `npm run lint` and `npm run build` pass with the migration applied
- Core app flows work unchanged: campaign CRUD, document creation, idea generation, publication tracking
- Cross-user isolation: a second user cannot see or modify another user's data (if a second test user is available)
