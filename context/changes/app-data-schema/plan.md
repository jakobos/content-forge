# Application Data Schema Implementation Plan

## Overview

Design and deploy the Supabase application data schema for all ContentForge domain entities -- business profiles, campaigns, documents (with versioning), ideas (with all known fields as columns), fragment references, publications, document embeddings (pgvector), and background operations. Establish the migration workflow (`supabase migration new` / `supabase db push`), generate TypeScript types from the deployed schema, and wire them into the Supabase client for type-safe queries in all downstream slices.

## Current State Analysis

The project is in a **pre-schema state**:
- Supabase is wired for auth only (`src/lib/supabase.ts` creates a per-request SSR client that returns `null` when env vars are missing)
- No migration files, SQL files, or `supabase/migrations/` directory exist
- No domain model TypeScript types exist anywhere in `src/`
- `createServerClient` uses the default `Database = any` generic -- no compile-time query safety
- `supabase/config.toml` targets Postgres 17, has `schema_paths = []` (standard migration workflow), and `[storage.vector] enabled = false`
- Supabase CLI is installed as devDep (`supabase@^2.23.4`)
- No npm scripts for migration or type generation

### Key Discoveries:

- `createServerClient<Database>` accepts a generic type parameter at `node_modules/@supabase/ssr/dist/module/createServerClient.d.ts:8` -- wiring the generated type gives full inference on `.from("table").select("*")`
- `supabase gen types --linked --schema public` outputs TypeScript to stdout; redirect to file
- `supabase migration new <name>` creates timestamped SQL files in `supabase/migrations/`; `supabase db push` applies pending migrations to the linked remote
- `supabase/config.toml:5` has `project_id = "10x-astro-starter"` -- may need updating to match actual hosted project ref
- Astro Locals (`src/env.d.ts`) currently only has `user: User | null` -- downstream slices will need `supabase` on locals but that's out of scope here

## Desired End State

After this plan is complete:
1. All domain tables exist in the hosted Supabase Postgres instance with correct columns, types, constraints, indexes, and FK relationships
2. pgvector extension is enabled; `document_embeddings` table is ready for F-02 to populate
3. A generated `src/db/database.types.ts` file provides the `Database` type
4. `createServerClient<Database>` in `src/lib/supabase.ts` uses the generated type -- all downstream `.from()` calls get type inference
5. `npm run db:types` script regenerates types from the linked project
6. The migration file is committed to git so `supabase db push` is reproducible
7. Existing auth flow is unbroken -- `npm run build` and `npm run lint` pass

**Verification:** `npx supabase migration list` shows the migration applied remotely. `npm run build` succeeds. `npm run lint` passes. The generated types file contains interfaces for all domain tables.

## What We're NOT Doing

- **RLS policies** -- deferred to F-03 (data-authorization). Tables ship without row-level security; only auth protects routes.
- **API endpoints or UI** -- no CRUD routes, no pages, no components. Schema only.
- **Seed data** -- no seed.sql for development data (can be added later).
- **Supabase Edge Functions** -- not needed for schema.
- **Local Supabase dev environment** (`supabase start`) -- not required for migration push; implementer can set up if desired.
- **Indexes on embedding vectors** -- F-02 will add HNSW/IVFFlat indexes when the embedding dimension and query pattern are decided.

## Implementation Approach

Single SQL migration file containing all DDL: extension enablement, enum types, all tables, indexes, and constraints. This is deployed via `supabase db push` to the linked hosted instance. After deployment, TypeScript types are generated and wired into the client. The migration is atomic -- if any statement fails, the entire migration rolls back.

## Critical Implementation Details

### Timing & lifecycle

The `supabase link --project-ref <ref>` step must happen before `supabase db push` or `supabase gen types --linked`. The implementer needs the Supabase project reference ID from the dashboard (or from the user). If the project isn't linked yet, this is a blocking prerequisite.

### State sequencing

The migration SQL must create enums before tables that reference them, and parent tables before child tables (FK ordering). The order is: extensions -> enums -> business_profiles -> campaigns -> documents -> document_versions -> document_embeddings -> ideas -> idea_fragment_references -> publications -> background_operations.

---

## Phase 1: Migration Infrastructure

### Overview

Set up the Supabase migration workflow: link to hosted project, add npm scripts, verify the pipeline works with an empty migration.

### Changes Required:

#### 1. Link Supabase project

**Intent**: Connect the local project to the hosted Supabase instance so `db push` and `gen types --linked` work.

**Contract**: `supabase link --project-ref <ref>` stores the link locally. The project ref comes from the Supabase dashboard URL. This is a manual CLI step, not a file change.

#### 2. Add npm scripts to package.json

**File**: `package.json`

**Intent**: Add `db:push` and `db:types` scripts so the migration and type generation workflow is a single command.

**Contract**: Two new entries in the `"scripts"` block:
- `"db:push": "supabase db push"` -- apply pending migrations to linked remote
- `"db:types": "supabase gen types --linked --schema public > src/db/database.types.ts"` -- generate TypeScript types from remote schema

#### 3. Create src/db/ directory

**File**: `src/db/` (new directory)

**Intent**: Establish a home for database-related TypeScript files (generated types, future query helpers).

**Contract**: Directory exists at `src/db/`. The generated `database.types.ts` will land here.

### Success Criteria:

#### Automated Verification:

- `npx supabase migration list` connects to the linked project without error
- `npm run db:push` runs without error (no migrations to apply yet)

#### Manual Verification:

- Supabase dashboard shows the project is linked (migration history table exists)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Core Schema Migration

### Overview

Write and apply the DDL migration containing all domain tables, enums, pgvector extension, indexes, and FK constraints.

### Changes Required:

#### 1. Create migration file

**File**: `supabase/migrations/<timestamp>_create_application_schema.sql`

**Intent**: Define the complete application data schema in a single atomic migration. Created via `npx supabase migration new create_application_schema`, then populated with DDL.

**Contract**: The migration SQL must create the following in order:

**Extensions:**
- `vector` (pgvector)

**Enum types:**
- `document_type`: `source_document`, `user_insight`
- `campaign_status`: `draft`, `active`, `completed`, `archived`
- `document_status`: `active`, `archived`, `deleted`
- `idea_status`: `draft`, `accepted`, `published`, `archived`, `declined`
- `idea_source`: `auto`, `manual`
- `operation_type`: `profile_processing`, `document_ingestion`, `idea_generation`, `idea_regeneration`
- `operation_status`: `pending`, `in_progress`, `completed`, `failed`

**Tables (in FK order):**

1. **`business_profiles`** (1:1 with auth.users)
   - `id` uuid PK default `gen_random_uuid()`
   - `user_id` uuid NOT NULL UNIQUE references `auth.users(id)` ON DELETE CASCADE
   - `brand_goal` text
   - `audience` text
   - `tone_of_voice` text
   - `archetype` text
   - `keywords` text[] (array of strings)
   - `preferred_formats` text[] (array of strings)
   - `resources` text
   - `pain_points` text
   - `transformation` text
   - `delivered_value` text
   - `created_at` timestamptz NOT NULL default `now()`
   - `updated_at` timestamptz NOT NULL default `now()`

2. **`campaigns`**
   - `id` uuid PK default `gen_random_uuid()`
   - `user_id` uuid NOT NULL references `auth.users(id)` ON DELETE CASCADE
   - `title` text NOT NULL
   - `description` text (nullable -- short campaign description)
   - `goal` text
   - `theme` text
   - `status` `campaign_status` NOT NULL default `'draft'`
   - `created_at` timestamptz NOT NULL default `now()`
   - `updated_at` timestamptz NOT NULL default `now()`

3. **`documents`**
   - `id` uuid PK default `gen_random_uuid()`
   - `campaign_id` uuid NOT NULL references `campaigns(id)` ON DELETE CASCADE
   - `user_id` uuid NOT NULL references `auth.users(id)` ON DELETE CASCADE
   - `type` `document_type` NOT NULL
   - `title` text NOT NULL
   - `content` text NOT NULL (current version content)
   - `source_url` text (nullable -- only for source_document type)
   - `current_version` integer NOT NULL default `1`
   - `status` `document_status` NOT NULL default `'active'`
   - `created_at` timestamptz NOT NULL default `now()`
   - `updated_at` timestamptz NOT NULL default `now()`

4. **`document_versions`** (immutable snapshots)
   - `id` uuid PK default `gen_random_uuid()`
   - `document_id` uuid NOT NULL references `documents(id)` ON DELETE CASCADE
   - `version_number` integer NOT NULL
   - `content` text NOT NULL
   - `created_at` timestamptz NOT NULL default `now()`
   - UNIQUE constraint on (`document_id`, `version_number`)

5. **`document_embeddings`** (pgvector -- for F-02)
   - `id` uuid PK default `gen_random_uuid()`
   - `document_version_id` uuid NOT NULL references `document_versions(id)` ON DELETE CASCADE
   - `chunk_index` integer NOT NULL (position within the document)
   - `chunk_text` text NOT NULL (the text fragment)
   - `embedding` vector(1536) NOT NULL (OpenAI ada-002 dimension; F-02 can alter if different model chosen)
   - `metadata` jsonb (nullable -- flexible filtering metadata for RAG queries, e.g., document_id, campaign_id, doc_type)
   - `created_at` timestamptz NOT NULL default `now()`
   - UNIQUE constraint on (`document_version_id`, `chunk_index`)

6. **`ideas`**
   - `id` uuid PK default `gen_random_uuid()`
   - `campaign_id` uuid NOT NULL references `campaigns(id)` ON DELETE CASCADE
   - `user_id` uuid NOT NULL references `auth.users(id)` ON DELETE CASCADE
   - `generation_number` integer NOT NULL default `1` (increments per regeneration within campaign)
   - `source` `idea_source` NOT NULL default `'auto'` (distinguishes auto-generated vs manual-description)
   - `original_description` text (nullable -- only for manual ideas, FR-013)
   - `improvement_hint` text (nullable -- populated when idea came from regeneration with hint, FR-017)
   - Core fixed fields:
     - `working_title` text NOT NULL
     - `hook` text
     - `key_points` text[] (array)
     - `key_quotes` text[] NOT NULL default '{}' (always required -- grounds ideas in source material)
   - Dynamic optional fields (all nullable -- AI selects which to populate):
     - `proposed_flow` text
     - `insights_conclusions` text
     - `call_to_action` text
     - `storytelling_angle` text
     - `target_audience_note` text
     - `content_format_suggestion` text
   - `status` `idea_status` NOT NULL default `'draft'`
   - `created_at` timestamptz NOT NULL default `now()`
   - `updated_at` timestamptz NOT NULL default `now()`

7. **`idea_fragment_references`** (join between ideas and document chunks)
   - `id` uuid PK default `gen_random_uuid()`
   - `idea_id` uuid NOT NULL references `ideas(id)` ON DELETE CASCADE
   - `document_version_id` uuid references `document_versions(id)` ON DELETE SET NULL (nullable -- set to null when source version is deleted)
   - `chunk_index` integer (nullable -- null means reference to whole document version, not a specific chunk)
   - `quote_snippet` text (nullable -- the extracted text shown to user; preserved even if source is deleted)
   - `created_at` timestamptz NOT NULL default `now()`

8. **`publications`** (1:1 optional with ideas in "published" status)
   - `id` uuid PK default `gen_random_uuid()`
   - `idea_id` uuid NOT NULL UNIQUE references `ideas(id)` ON DELETE CASCADE
   - `url` text
   - `platform_name` text
   - `published_at` timestamptz
   - `note` text
   - `created_at` timestamptz NOT NULL default `now()`

9. **`background_operations`** (async job tracking)
   - `id` uuid PK default `gen_random_uuid()`
   - `user_id` uuid NOT NULL references `auth.users(id)` ON DELETE CASCADE
   - `type` `operation_type` NOT NULL
   - `status` `operation_status` NOT NULL default `'pending'`
   - `input_ref` jsonb (nullable -- polymorphic reference to input entity, e.g., `{"campaign_id": "..."}`)
   - `output_ref` jsonb (nullable -- polymorphic reference to output, e.g., `{"idea_ids": ["..."]}`)
   - `error_message` text (nullable -- populated on failure)
   - `model_name` text (nullable -- which LLM model was used, e.g., "gpt-4o")
   - `input_tokens` integer (nullable -- LLM input token count)
   - `output_tokens` integer (nullable -- LLM output token count)
   - `estimated_cost_cents` integer (nullable -- cost in cents, avoids floats)
   - `started_at` timestamptz
   - `completed_at` timestamptz
   - `created_at` timestamptz NOT NULL default `now()`

**Indexes:**
- `campaigns`: index on `(user_id, status)`
- `documents`: index on `(campaign_id, status)`
- `document_versions`: index on `(document_id, version_number)`
- `document_embeddings`: GIN index on `metadata` (for JSONB filter queries during RAG)
- `ideas`: index on `(campaign_id, status)`, index on `(campaign_id, generation_number)`
- `idea_fragment_references`: index on `(idea_id)`
- `background_operations`: index on `(user_id, status)`, index on `(user_id, type, status)`

**Trigger:**
- `updated_at` auto-update trigger on `business_profiles`, `campaigns`, `documents`, `ideas` -- a `BEFORE UPDATE` function (`set_updated_at()`) that sets `NEW.updated_at = now()` and returns `NEW`. One shared function, four `CREATE TRIGGER` statements. No extension dependency.

### Success Criteria:

#### Automated Verification:

- `npm run db:push` applies the migration without error
- `npx supabase migration list` shows the migration as applied on remote

#### Manual Verification:

- Supabase Dashboard Table Editor shows all 9 tables with correct columns and types
- Attempting to insert a row with an invalid enum value fails (e.g., campaign with status `'bogus'`)
- FK cascade works: deleting a campaign deletes its documents and ideas

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: TypeScript Type Generation

### Overview

Generate the `Database` type from the deployed schema and wire it into the Supabase client so all downstream slices get type-safe queries.

### Changes Required:

#### 1. Generate types file

**File**: `src/db/database.types.ts` (new, generated)

**Intent**: Run `npm run db:types` to generate the TypeScript `Database` interface from the live Supabase schema. This file is committed to git and regenerated after schema changes.

**Contract**: The file exports a `Database` type with a `public` schema containing interfaces for all 9 tables plus enum types. Generated by the `db:types` npm script defined in Phase 1.

#### 2. Wire Database type into Supabase client

**File**: `src/lib/supabase.ts`

**Intent**: Pass the generated `Database` type as a generic parameter to `createServerClient` so all `.from()` calls get type inference.

**Contract**: Import `type { Database } from "@/db/database.types"` and change `createServerClient(...)` to `createServerClient<Database>(...)`. Return type becomes `SupabaseClient<Database> | null`.

#### 3. Exclude generated types from lint and format

**File**: `.prettierignore` (new) and `eslint.config.js`

**Intent**: Exclude the generated types file from both Prettier and ESLint. Generated code is machine output -- linting it is noise. TypeScript still type-checks imports from the file regardless of ESLint coverage.

**Contract**:
- Create `.prettierignore` with `src/db/database.types.ts`
- Add an ignore entry in `eslint.config.js` for `src/db/database.types.ts` (flat config: `{ ignores: ["src/db/database.types.ts"] }` block)

### Success Criteria:

#### Automated Verification:

- `npx astro sync` completes without error
- `npm run lint` passes (no type errors from the new import)
- `npm run build` succeeds
- TypeScript resolves `Database["public"]["Tables"]` with all 9 table names

#### Manual Verification:

- In an editor, typing `supabase.from("` shows autocomplete for all table names (business_profiles, campaigns, documents, etc.)
- Visit the running dev server; sign-in/sign-up flow works as before (auth unbroken by `supabase.ts` change)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Unit Tests:

No test framework is configured (per AGENTS.md). No unit tests for this change.

### Integration Tests:

None -- schema-only change. Integration testing happens via `supabase db push` success and type generation.

### Manual Testing Steps:

1. Run `npx supabase migration list` and verify the migration shows as applied
2. Open Supabase Dashboard Table Editor -- confirm all 9 tables exist with correct columns
3. Insert a test row into `campaigns` via Dashboard SQL editor -- verify defaults (uuid, timestamps, status) work
4. Delete the test campaign -- verify cascade deletes related documents
5. Run `npm run build` -- verify no TypeScript or build errors
6. Start dev server (`npm run dev`) -- verify auth signin/signup flow still works
7. In editor, verify `.from("campaigns").select("*")` shows type inference for campaign columns

## Performance Considerations

- No performance concerns at schema creation time
- Indexes are designed for the query patterns implied by the PRD (user-scoped listings, campaign-scoped document/idea lookups, operation status dashboards)
- pgvector embedding indexes (HNSW/IVFFlat) are deferred to F-02 when query patterns and data volume are known

## Migration Notes

- This is the first migration -- no existing data to migrate
- The migration is forward-only; rollback would be `DROP` statements (not expected to be needed before any data exists)
- Future schema changes will be additional migration files, not edits to this one
- `supabase db push` tracks applied migrations via the `supabase_migrations.schema_migrations` table

## References

- PRD: `context/foundation/prd.md` -- FR-004, FR-008, FR-012, FR-014, FR-015, FR-019, FR-021
- Roadmap: `context/foundation/roadmap.md` -- F-01 (lines 70-81)
- Supabase client: `src/lib/supabase.ts`
- `createServerClient` generic signature: `node_modules/@supabase/ssr/dist/module/createServerClient.d.ts:8`
- Supabase config: `supabase/config.toml`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` -- <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Migration Infrastructure

#### Automated

- [x] 1.1 `npx supabase migration list` connects to linked project without error
- [x] 1.2 `npm run db:push` runs without error

#### Manual

- [ ] 1.3 Supabase dashboard confirms project is linked

### Phase 2: Core Schema Migration

#### Automated

- [ ] 2.1 `npm run db:push` applies migration without error
- [ ] 2.2 `npx supabase migration list` shows migration as applied

#### Manual

- [ ] 2.3 Dashboard Table Editor shows all 9 tables with correct columns
- [ ] 2.4 Invalid enum insert fails
- [ ] 2.5 FK cascade works (delete campaign -> deletes documents and ideas)

### Phase 3: TypeScript Type Generation & Verification

#### Automated

- [ ] 3.1 `npx astro sync` completes without error
- [ ] 3.2 `npm run lint` passes
- [ ] 3.3 `npm run build` succeeds
- [ ] 3.4 `Database["public"]["Tables"]` resolves with all 9 table names

#### Manual

- [ ] 3.5 Editor autocomplete shows all table names on `.from("`
- [ ] 3.6 Auth signin/signup flow works on dev server (unbroken by supabase.ts change)
