---
project: ContentForge
version: 1
status: draft
created: 2026-05-31
updated: 2026-06-02
prd_version: 1
main_goal: speed
top_blocker: time
---

# Roadmap: ContentForge

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Solo experts who build personal brands through social media have no tool that bridges raw material (reports, notes, insights) to structured, on-brand post ideas -- while persisting brand context, connecting strategy to individual posts, and producing skeletons instead of finished prose. ContentForge closes that gap: it transforms source documents into structured post ideas (title, hook, key points, fragment references) informed by a persistent business profile and grouped under campaign-level strategy.

## North star

**S-02: First gated generation** -- user can generate structured post ideas from campaign documents with hardcoded profile defaults. This is the smallest end-to-end slice that proves the core product hypothesis -- the one flow whose success or failure determines whether everything else matters.

> "North star" here means the smallest end-to-end slice whose successful delivery proves the core product hypothesis -- placed first because everything else only matters if this works.

## At a glance

| ID | Change ID | Outcome (user can ...) | Prerequisites | PRD refs | Status |
|---|---|---|---|---|---|
| F-01 | app-data-schema | (foundation) Supabase application tables landed for all domain entities | -- | FR-004, FR-008, FR-012 | ready |
| F-02 | ai-generation-pipeline | (foundation) AI generation infrastructure operational | F-01 | FR-012, FR-014, FR-021 | proposed |
| F-03 | data-authorization | (foundation) RLS policies and API authorization enforced on all application tables | F-01 | Access Control, Guardrails | proposed |
| S-01 | campaign-document-crud | create campaigns and add documents | F-01, F-03 | US-01, FR-004, FR-005, FR-008, FR-009 | proposed |
| S-02 | first-gated-generation | generate structured post ideas from campaign documents (hardcoded profile) | F-01, F-02, S-01 | US-01, FR-012, FR-014 | proposed |
| S-03 | idea-review-and-copy | review ideas (accept/decline), copy in markdown | S-02 | FR-015, FR-016 | proposed |
| S-04 | business-profile-wizard | complete and edit a business profile that influences generation | F-01, F-03 | FR-001, FR-002, FR-003 | proposed |
| S-05 | manual-idea-creation | describe an idea and get a structured version enriched with campaign documents | F-02, S-01 | US-02, FR-013 | proposed |
| S-06 | idea-regeneration | regenerate ideas with optional improvement hints | F-02, S-02 | FR-017, FR-018 | proposed |
| S-07 | campaign-document-lifecycle | manage campaign and document lifecycles with full state machines | S-01 | FR-006, FR-007, FR-010, FR-011 | proposed |
| S-08 | publication-tracking | record publication details on published ideas | S-03 | FR-019 | proposed |
| S-09 | background-ops-status | see status of pending operations, get notified on completion/failure | F-02, F-03 | FR-021 | proposed |
| S-10 | account-deletion | permanently delete account and all associated data | F-01, F-03 | FR-020 | proposed |

## Streams

Navigation aid -- groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme | Chain | Note |
|---|---|---|---|
| A | Core generation | `F-01` → `F-03` → `S-01` → `S-02` → `S-03` → `S-08` | North star path -- auth gates every data slice; fastest route to proving the transformation works. |
| B | AI extensions | `F-02` → `S-05` / `S-06` / `S-09` | AI pipeline and downstream features; joins Stream A at `S-02` via `F-02` prerequisite. `S-09` also requires `F-03`. |
| C | Profile, lifecycle & account | `S-04` / `S-07` / `S-10` | `S-04` and `S-10` require `F-03` from Stream A; `S-07` joins Stream A at `S-01`. |

## Baseline

What's already in place in the codebase as of 2026-05-31 (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present -- Astro 6 + React 19 + Tailwind CSS v4 + shadcn/ui; file-based routing under `src/pages/`
- **Backend / API:** present -- Astro API routes (auth-only: signin, signup, signout) + middleware (`src/middleware.ts`)
- **Data:** partial -- Supabase JS client wired for auth only; no schema, migrations, or data queries
- **Auth:** present -- Supabase Auth via `@supabase/ssr`; session verification + `PROTECTED_ROUTES` middleware
- **Deploy / infra:** present -- Cloudflare Workers (`wrangler.jsonc`) + GitHub Actions CI (`.github/workflows/ci.yml`)
- **Observability:** absent -- no logging library, error tracking, or metrics

## Foundations

### F-01: Application data schema

- **Outcome:** (foundation) Supabase application tables landed for all domain entities -- business profiles, campaigns, documents (with versions), ideas, fragment references; pgvector extension enabled for document embeddings.
- **Change ID:** app-data-schema
- **PRD refs:** FR-004, FR-008, FR-012
- **Unlocks:** F-03, S-01, S-02, S-03, S-04, S-05, S-06, S-07, S-08, S-09, S-10
- **Prerequisites:** --
- **Parallel with:** --
- **Blockers:** --
- **Unknowns:** --
- **Risk:** Schema design locks column names and relationships that every downstream slice depends on. Getting this wrong means migrations in every later slice. Mitigated by designing from PRD FRs and user stories, not from speculation.
- **Status:** ready

### F-02: AI generation pipeline

- **Outcome:** (foundation) AI generation infrastructure operational -- LLM integration (API connection, prompt templates for structured idea output), document fragment extraction via pgvector embeddings, and async processing pattern (non-blocking job initiation with status tracking).
- **Change ID:** ai-generation-pipeline
- **PRD refs:** FR-012, FR-014, FR-021
- **Unlocks:** S-02, S-05, S-06, S-09
- **Prerequisites:** F-01
- **Parallel with:** F-03, S-01, S-04, S-10
- **Blockers:** --
- **Unknowns:** --
- **Risk:** Prompt engineering quality directly determines whether generated ideas are on-brand and fragment-referenced. Early testing with real documents is essential; bad prompts discovered late invalidate the north star.
- **Status:** proposed

### F-03: Data authorization

- **Outcome:** (foundation) Row-Level Security policies enabled on all application tables ensuring users access only their own data; API endpoint authorization patterns established so every server route verifies ownership before returning or mutating rows.
- **Change ID:** data-authorization
- **PRD refs:** Access Control, Guardrails (source material privacy)
- **Unlocks:** S-01, S-04, S-09, S-10 (directly); all other slices transitively
- **Prerequisites:** F-01
- **Parallel with:** F-02
- **Blockers:** --
- **Unknowns:** --
- **Risk:** RLS policies that are too permissive ship a data leak; policies that are too restrictive break every downstream slice silently (queries return empty sets instead of errors). Must be verified with multi-user test scenarios before any slice lands.
- **Status:** proposed

## Slices

### S-01: Campaign & document CRUD

- **Outcome:** user can create campaigns (with goal/theme), view a campaign list, add source documents (title + text + optional link) and user insights (title + text) to a campaign
- **Change ID:** campaign-document-crud
- **PRD refs:** US-01, FR-004, FR-005, FR-008, FR-009
- **Prerequisites:** F-01, F-03
- **Parallel with:** F-02, S-04, S-10
- **Blockers:** --
- **Unknowns:**
  - What are the campaign's "additional attributes" beyond goal/theme? -- Owner: user. Block: no.
- **Risk:** This is the data-entry surface that feeds the north star. If campaign/document UX is clunky, generation won't get exercised. Keep forms minimal for speed.
- **Status:** proposed

### S-02: First gated generation

- **Outcome:** user can generate structured post ideas from campaign documents -- AI analyzes documents and produces ideas with working title, hook, key points, source references, and dynamic optional fields; generation uses hardcoded profile defaults (profile wizard deferred to S-04)
- **Change ID:** first-gated-generation
- **PRD refs:** US-01, FR-012, FR-014
- **Prerequisites:** F-01, F-02, S-01
- **Parallel with:** S-04, S-07, S-10, S-09
- **Blockers:** --
- **Unknowns:**
  - How many ideas does a batch generation produce? -- Owner: user. Block: no.
- **Risk:** This is the north star -- the entire product rests on this slice producing useful, on-brand, fragment-referenced ideas. If generation quality is poor, no downstream slice matters. Validate with real documents early.
- **Status:** proposed

### S-03: Idea review & copy

- **Outcome:** user can manage idea lifecycle (draft, accepted, published, archived, declined) and copy an accepted idea's full structured content in markdown
- **Change ID:** idea-review-and-copy
- **PRD refs:** FR-015, FR-016
- **Prerequisites:** S-02
- **Parallel with:** S-05, S-06, S-07, S-09
- **Blockers:** --
- **Unknowns:** --
- **Risk:** This is the output surface -- where the user extracts value. Copy-to-clipboard must work cleanly across browsers. Lifecycle state machine must not lose ideas.
- **Status:** proposed

### S-04: Business profile wizard

- **Outcome:** user can complete a business profile wizard (brand goal, audience, tone, archetype, keywords, formats, resources, pain points, transformation, delivered value) and edit it afterward; profile data feeds into idea generation instead of hardcoded defaults
- **Change ID:** business-profile-wizard
- **PRD refs:** FR-001, FR-002, FR-003
- **Prerequisites:** F-01, F-03
- **Parallel with:** S-01, S-10, F-02
- **Blockers:** --
- **Unknowns:** --
- **Risk:** 10-field wizard is high-friction onboarding. The PRD resolved this ("the wizard IS the value proposition") but for speed, the wizard is deferred behind the north star -- generation ships first with hardcoded defaults.
- **Status:** proposed

### S-05: Manual idea creation

- **Outcome:** user can describe an idea in their own words and get a structured post idea enriched with relevant fragments from campaign documents
- **Change ID:** manual-idea-creation
- **PRD refs:** US-02, FR-013
- **Prerequisites:** F-02, S-01
- **Parallel with:** S-02, S-07, S-09
- **Blockers:** --
- **Unknowns:** --
- **Risk:** Reuses generation pipeline from F-02 but with a different prompt path (structuring vs. discovering). Prompt divergence from S-02 must be managed.
- **Status:** proposed

### S-06: Idea regeneration

- **Outcome:** user can regenerate a single idea or an entire batch with an optional improvement hint (up to 200 chars); previous ideas stay alongside new ones
- **Change ID:** idea-regeneration
- **PRD refs:** FR-017, FR-018
- **Prerequisites:** F-02, S-02
- **Parallel with:** S-03, S-05, S-07
- **Blockers:** --
- **Unknowns:** --
- **Risk:** Regeneration must preserve old ideas alongside new ones -- data model must support multiple generations per campaign. This should be designed in F-01's schema.
- **Status:** proposed

### S-07: Campaign & document lifecycle

- **Outcome:** user can edit campaign details (flags existing ideas for review), manage campaign lifecycle (draft/active/completed/archived), edit documents (versioned content -- old versions preserved for fragment references), and manage document lifecycle (active/archived/deleted with placeholder for deleted fragment references)
- **Change ID:** campaign-document-lifecycle
- **PRD refs:** FR-006, FR-007, FR-010, FR-011
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-04, S-05, S-09
- **Blockers:** --
- **Unknowns:** --
- **Risk:** Document versioning and fragment reference integrity under edits/deletes is the hardest data integrity problem in the product. Schema design in F-01 must account for this.
- **Status:** proposed

### S-08: Publication tracking

- **Outcome:** user can attach publication metadata (URL, platform name, publish date, optional note) to a published idea
- **Change ID:** publication-tracking
- **PRD refs:** FR-019
- **Prerequisites:** S-03
- **Parallel with:** S-06, S-05, S-07
- **Blockers:** --
- **Unknowns:** --
- **Risk:** Low complexity. Depends on idea lifecycle from S-03 having a "published" state.
- **Status:** proposed

### S-09: Background operations status

- **Outcome:** user can see the status of all pending operations (profile processing, document ingestion, idea generation, idea regeneration) and is notified when each completes or fails; failed operations can be retried
- **Change ID:** background-ops-status
- **PRD refs:** FR-021
- **Prerequisites:** F-02, F-03
- **Parallel with:** S-01, S-04, S-05, S-07
- **Blockers:** --
- **Unknowns:** --
- **Risk:** Requires a unified view across multiple async operation types. The async pattern from F-02 must expose a consistent status interface.
- **Status:** proposed

### S-10: Account deletion

- **Outcome:** user can permanently delete their account and all associated data (profile, campaigns, documents, ideas)
- **Change ID:** account-deletion
- **PRD refs:** FR-020
- **Prerequisites:** F-01, F-03
- **Parallel with:** S-01, S-04, F-02
- **Blockers:** --
- **Unknowns:** --
- **Risk:** Cascading deletes across all domain tables plus Supabase Auth user. Must not leave orphaned data. Test with populated accounts.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID | Suggested issue title | Ready for `/10x-plan` | Notes |
|---|---|---|---|---|
| F-01 | app-data-schema | Design and deploy Supabase application data schema | yes | Run `/10x-plan app-data-schema` |
| F-02 | ai-generation-pipeline | Build AI generation pipeline with async processing | no | Blocked by F-01 |
| F-03 | data-authorization | RLS policies and API authorization on all application tables | no | Blocked by F-01 |
| S-01 | campaign-document-crud | Campaign & document CRUD pages | no | Blocked by F-01, F-03 |
| S-02 | first-gated-generation | First gated generation (north star) | no | Blocked by F-01, F-02, S-01 |
| S-03 | idea-review-and-copy | Idea review lifecycle & markdown copy | no | Blocked by S-02 |
| S-04 | business-profile-wizard | Business profile wizard & edit form | no | Blocked by F-01 |
| S-05 | manual-idea-creation | Manual idea creation with AI structuring | no | Blocked by F-02, S-01 |
| S-06 | idea-regeneration | Single and batch idea regeneration with hints | no | Blocked by F-02, S-02 |
| S-07 | campaign-document-lifecycle | Campaign & document lifecycle management | no | Blocked by S-01 |
| S-08 | publication-tracking | Publication metadata on published ideas | no | Blocked by S-03 |
| S-09 | background-ops-status | Background operations status dashboard | no | Blocked by F-02 |
| S-10 | account-deletion | Account and data deletion | no | Blocked by F-01 |

## Open Roadmap Questions

1. **What are the campaign's "additional attributes" beyond goal/theme?** -- Owner: user. Block: S-01 (non-blocking -- campaigns work with just goal/theme; attributes enrich generation).
2. **How many ideas does a batch generation produce?** -- Owner: user. Block: S-02 (non-blocking -- can default to a reasonable number).
3. **What exactly is a "visual suggestion" (secondary criterion)?** -- Owner: user. Block: roadmap-wide (non-blocking -- secondary criterion, not in any slice).

## Parked

- **Auto-publishing to social platforms** -- Why parked: PRD Non-Goal. No LinkedIn/X API integration in MVP.
- **Image/graphic generation** -- Why parked: PRD Non-Goal. Visual suggestions are text-only.
- **PDF/DOCX parsing** -- Why parked: PRD Non-Goal. Plain text input only.
- **Team/collaboration features** -- Why parked: PRD Non-Goal. Single-user experience.
- **Content calendar / scheduling** -- Why parked: PRD Non-Goal. No timeline view or publication scheduling.
- **Observability infrastructure** -- Why parked: speed priority. No NFR gates observability for launch. Baseline reports absent; add post-launch.

## Done

(Empty on first generation. `/10x-archive` appends entries here when changes are archived.)
