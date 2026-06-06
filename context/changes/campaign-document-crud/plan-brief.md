# Campaign & Document CRUD -- Plan Brief

> Full plan: `context/changes/campaign-document-crud/plan.md`

## What & Why

Build the campaign and document CRUD pages -- the data-entry surface that feeds the north star (idea generation from campaign documents). Users need to create campaigns, add source documents and user insights before they can generate ideas. This is the first data feature and establishes patterns for all downstream slices.

## Starting Point

Auth is working (sign in/up/out), the full schema is deployed (F-01 complete), and TypeScript types are generated. But there are no data pages -- the dashboard is a placeholder, only `button.tsx` exists from shadcn/ui, and no Supabase data queries exist anywhere in the app.

## Desired End State

Authenticated users have a campaigns section (`/campaigns`) where they can create campaigns (title + goal + description), see all their campaigns as cards with metadata, drill into a campaign detail page, and add source documents or user insights via inline forms. The full CRUD flow works end-to-end using the PRG pattern.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
|---|---|---|
| Routing structure | `/campaigns`, `/campaigns/new`, `/campaigns/[id]` | REST-ful, clean, extensible -- each route is self-explanatory. |
| Post-create destination | Redirect to campaign detail | Natural next step is adding documents to the new campaign. |
| Document display | Inline on detail page | Everything in one place, fewer page transitions for MVP. |
| Document types UX | Two distinct forms (source doc / insight) | Clear mental model -- user knows which type they're adding. |
| Text input | Fixed-height textarea, 20k char limit | Keeps page layout predictable; limit prevents abuse. |
| Campaign list metadata | Title + goal + status + 2 doc type counts | Enough context to pick which campaign to work on. |
| Campaign create fields | Title (required) + goal + description | Minimal friction; theme column unused for now. |
| Form pattern | PRG (full page reload) | Consistent with auth forms, works without JS, no client state. |

## Scope

**In scope:**
- Campaign list page with empty state
- Campaign create form and API
- Campaign detail page with document list
- Add source document form and API
- Add user insight form and API
- shadcn/ui component installation (card, input, textarea, badge, label)
- Route protection and navigation updates

**Out of scope:**
- Document ingestion/embeddings (F-02)
- Campaign editing/lifecycle (S-07)
- Document editing/versioning/deletion (S-07)
- RLS policies (F-03)
- Idea generation (S-02)
- Background operations (S-09)

## Architecture / Approach

Standard Astro SSR pattern: pages query Supabase in frontmatter for reads, React form components hydrate with `client:load` for interactivity, form POSTs go to Astro API endpoints which mutate data and redirect (PRG). No client-side state management. Ownership checks in API endpoints since RLS is deferred.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. UI Foundation | shadcn components, route protection, nav | Low -- mostly running CLI commands and small edits |
| 2. Campaign List & Create | List page, create form, create API | Campaign count query performance (mitigated by existing indexes) |
| 3. Campaign Detail & Docs | Detail page, 2 document forms, document API | Ownership verification without RLS -- must be correct |

**Prerequisites:** F-01 (app-data-schema) implemented, auth working
**Estimated effort:** ~2-3 sessions across 3 phases

## Open Risks & Assumptions

- No RLS means ownership checks are in application code only -- bugs here are data leaks (F-03 will fix)
- Campaign "additional attributes" beyond goal/theme deferred -- may need form updates in S-07
- No pagination -- assumes users have < 50 campaigns and < 100 documents per campaign in MVP

## Success Criteria (Summary)

- User can go from zero campaigns to having a campaign with multiple documents in one session
- Campaign list provides enough context to navigate without clicking into every campaign
- Document addition is fast and frictionless (no blocking, clear feedback)
