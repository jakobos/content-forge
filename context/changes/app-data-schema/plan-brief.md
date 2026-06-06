# Application Data Schema -- Plan Brief

> Full plan: `context/changes/app-data-schema/plan.md`

## What & Why

ContentForge needs its domain data layer. The app currently has Supabase wired for auth only -- no tables, migrations, or typed queries exist. This plan creates the complete application schema (9 tables, 7 enums, pgvector extension) and establishes the migration + type generation workflow so every downstream slice starts with typed, structured data access.

## Starting Point

Supabase is operational for auth (`signIn`, `signUp`, `signOut`, `getUser`). The client factory at `src/lib/supabase.ts` returns `SupabaseClient | null` with `Database = any`. No `supabase/migrations/` directory, no SQL files, no domain model TypeScript types. Supabase CLI is installed as devDep; `config.toml` targets Postgres 17.

## Desired End State

All domain tables exist in the hosted Supabase instance. pgvector is enabled with an embeddings table ready for F-02. A generated `Database` type provides compile-time type safety on every `.from()` call. `npm run db:types` regenerates types. `npm run db:push` deploys migrations. The existing auth flow is unbroken.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
|---|---|---|
| Document versioning | Separate `document_versions` table | Clean separation; fragment references point to immutable version rows; main table stays lean for listing. |
| Document types (source vs insight) | Single table with `type` enum discriminator | One table simplifies queries and generation pipeline; only one nullable column (`source_url`) for the type difference. |
| Idea dynamic fields | All known fields as nullable columns | Finite set of AI-selectable fields; full column-level type safety and indexability; schema changes only if new field types are added. |
| pgvector scope | Enable extension + embeddings table now | F-02 can start embedding storage immediately without a migration; dimension defaults to 1536. |
| Background operations | Generic `background_operations` table now | Unified async tracking from the start; S-09 and every async feature share one table. |
| Batch grouping | `generation_number` integer on ideas | Simplest model; no extra table; filtering by generation is a WHERE clause. |
| Migration workflow | Supabase CLI (`migration new` + `db push`) | Standard, git-versioned, reproducible; migrations tracked in remote history table. |
| TypeScript types | Generate now + wire into client | Every downstream slice gets type-safe queries from day one. |

## Scope

**In scope:**
- SQL migration with all 9 domain tables, 7 enums, pgvector extension, indexes, FK constraints, updated_at triggers
- Migration workflow setup (link project, npm scripts)
- TypeScript type generation and client wiring
- CI pipeline verification (astro sync, lint, build)

**Out of scope:**
- RLS policies (F-03)
- API endpoints or UI
- Seed data
- Vector indexes (HNSW/IVFFlat -- deferred to F-02)
- Local Supabase dev environment

## Architecture / Approach

Single atomic SQL migration containing all DDL. Tables follow FK ordering: extensions -> enums -> business_profiles -> campaigns -> documents -> document_versions -> document_embeddings -> ideas -> idea_fragment_references -> publications -> background_operations. After deployment, types are generated from the live schema and wired into the existing Supabase client factory via the `Database` generic parameter.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Migration Infrastructure | Linked project, npm scripts, `src/db/` directory | Project ref needed from dashboard; if not linked, nothing else works. |
| 2. Core Schema Migration | All 9 tables, 7 enums, pgvector, indexes, triggers | Schema design locks column names for all downstream slices; errors are expensive. |
| 3. TypeScript Type Generation & Verification | Generated `Database` type, typed Supabase client, CI pass, auth confirmed | Generated file must be excluded from Prettier and ESLint; import path must use `@/` alias. |

**Prerequisites:** Supabase project reference ID (from dashboard URL). `SUPABASE_URL` and `SUPABASE_KEY` env vars for type generation.
**Estimated effort:** ~1 session, single phase chain.

## Open Risks & Assumptions

- Embedding dimension defaulted to 1536 (OpenAI ada-002); F-02 may need to ALTER if a different model is chosen.
- The set of "dynamic" idea fields (proposed_flow, key_quotes, insights_conclusions, call_to_action, storytelling_angle, target_audience_note, content_format_suggestion) is a best guess from the PRD. If AI generation in F-02 needs more fields, a migration adds them.
- No RLS until F-03 -- tables are world-readable to any authenticated Supabase client. Acceptable because the app has no multi-user data access yet.

## Success Criteria (Summary)

- All 9 domain tables exist with correct types, constraints, and relationships
- `npm run build` and `npm run lint` pass with no regressions
- Downstream slices (S-01, F-02, F-03) can start without needing their own schema migrations
