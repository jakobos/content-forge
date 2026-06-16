# Publication Tracking (S-08) Implementation Plan

## Overview

Let the user attach, edit, and clear publication metadata (URL, platform name, publish date, optional note) on an idea that has reached `published` status. The persistence layer already exists — an empty `publications` table 1:1 with `ideas`. This slice is pure app-layer wiring: a shared validation schema, an upsert/clear JSON endpoint, an SSR data load, and a per-card React island that displays the metadata and hosts the edit form, gated to the `published` state.

## Current State Analysis

- **Schema is complete — no migration needed.** The `publications` table already exists (`supabase/migrations/20260606094848_create_application_schema.sql:182-191`): `id`, `idea_id uuid NOT NULL UNIQUE REFERENCES ideas(id) ON DELETE CASCADE`, `url text`, `platform_name text`, `published_at timestamptz`, `note text`, `created_at`. All metadata columns are nullable; the row dies only when the idea is deleted (CASCADE).
- **Generated types are present.** `publications` `Row`/`Insert`/`Update` exist at `src/db/database.types.ts:389-423`. No `npx astro sync` regeneration of DB types required (no schema change), but `astro sync` is still run for Astro type generation.
- **`publications` has no `user_id` column.** Ownership cannot be enforced directly on the table. It must be derived by first fetching the parent idea scoped to `user_id` (the same pattern the status endpoint uses).
- **Idea lifecycle from S-03 is complete.** `accepted → published` and `published → archived` are the only edges touching `published` (`src/lib/ideas/lifecycle.ts:9-15`). The status endpoint `src/pages/api/ideas/[id]/status.ts` is the canonical convention: auth → 401, null-supabase → 503, Zod body, fetch-scoped-by-`user_id` → 404, and a **mandatory `.eq("user_id", user.id)` row scope on every write** because there is no RLS.
- **`IdeaActions` island** (`src/components/campaigns/IdeaActions.tsx`) owns the per-idea interactive surface and lives **inside the card's `<summary>`**. It updates status optimistically with **no page reload**. Every interactive element calls `e.stopPropagation()` to avoid toggling the `<details>` disclosure.
- **Campaign page** (`src/pages/campaigns/[id].astro`) batch-loads ideas (`:38-45`) and fragment refs (`:58-70`) but **does not load publications**. Idea cards render a labeled-section body (`:196-300`) — the canonical pattern for the publication display section. The island is mounted in `<summary>` at `:183-192`.
- **No publication endpoint exists.** Only the status mutation endpoint and the generation endpoints are present.
- **API conventions** (`src/pages/api/ai/generate-ideas.ts:14-118`, `status.ts:80-85`): local `jsonError(message, status)` helper returning `{ ok: false, error }`; Zod `safeParse`; `createClient(context.request.headers, context.cookies)`.
- **Island fetch pattern** (`IdeaActions.tsx:35-52`, `GenerateIdeasPanel.tsx`): `fetch` → on `!res.ok` read `{ error }` from body → throw; inline transient feedback state.

### Key Discoveries:

- The `publications` table is empty and ready; the unique `idea_id` constraint makes this a natural **upsert on `idea_id`** (`supabase ... .upsert(row, { onConflict: "idea_id" })`).
- Ownership + state must be verified by reading the idea first: `select("status").eq("id", ideaId).eq("user_id", user.id).maybeSingle()` → 404 if absent, 409/400 if `status !== "published"`.
- Status changes client-side without reload (`IdeaActions` is optimistic). Because the publication UI is gated on `published` and rendered in the SSR body, a transition that **crosses** the published boundary must trigger a reload so the body section appears/disappears and the freshly-loaded publication row is available.
- `published_at` is `timestamptz`; the form uses a native `<input type="date">` (date-only). Convert empty → `null`; convert a `YYYY-MM-DD` string to a date the DB accepts.

## Desired End State

On a campaign page, an idea in `published` status shows a "Publication" section in its expanded card body. If no metadata exists yet, the section offers an "Add publication details" affordance that opens a form (URL, platform name, publish date, note). Saving validates input (well-formed http(s) URL and a valid date when provided; all fields optional) and upserts the single `publications` row. Existing metadata renders as a compact summary with a clickable URL (opens in a new tab), platform, formatted date, and note, plus "Edit" and "Remove" actions. "Remove" deletes the row. The form and section are hidden whenever the idea is not `published`. Direct API calls are rejected for ideas the user does not own, that do not exist, or that are not `published`. Verify by: publishing an idea, adding details, confirming the clickable link and formatted display, editing a field, removing the row, archiving (section disappears), and re-publishing (section reappears empty until re-entered, per the "hide while not published" decision).

## What We're NOT Doing

- **No schema/migration changes** — the `publications` table, unique constraint, and CASCADE already exist.
- **No `user_id` added to `publications`** — ownership stays derived from the parent idea in application code (consistent with the no-RLS posture; RLS is slice F-03).
- **No metadata for non-published ideas** — the form/display and the endpoint both gate on `status === "published"`.
- **No auto-population of `published_at`** on the publish transition — the user enters the date explicitly; the transition stays status-only (S-03 behavior unchanged except the boundary reload).
- **No persistence of the form across un-publish** — the row remains in the DB (CASCADE-only delete) but is not surfaced while the idea is not published; re-publishing shows an empty form per the chosen "hide while not published" behavior.
- **No global toast system** — feedback is inline per-island, matching S-03 (the app-wide toast system is slice S-11).
- **No new shadcn components** — plain buttons/inputs styled to match existing card UI.
- **No multi-platform / multiple publications per idea** — the unique `idea_id` constraint enforces exactly one publication row per idea.

## Implementation Approach

A shared module `src/lib/ideas/publication.ts` owns the Zod schema and TypeScript types for publication input, consumed by both the endpoint (server validation) and the island (the form payload type). The endpoint `src/pages/api/ideas/[id]/publication.ts` exposes `PUT` (upsert) and `DELETE` (clear), each verifying idea ownership and `published` state before writing, and row-scoping by re-deriving ownership through the idea. The SSR campaign page batch-loads existing publication rows into a `Map<ideaId, PublicationRow>` and passes each idea's row (or null) plus its current status to a new `IdeaPublication` island mounted in the card body. The island gates itself on `published`, renders the compact display when a row exists, and toggles an inline form for add/edit; it upserts/clears via `fetch` then reloads to reflect the new state. `IdeaActions` gains a single behavioral tweak: after a successful transition where the previous or target status is `published`, it reloads the page so the body publication section is rendered/removed with fresh SSR data.

## Critical Implementation Details

- **Ownership has no shortcut.** `publications` has no `user_id`, so both `PUT` and `DELETE` must first `select` the parent idea scoped by `.eq("id", ideaId).eq("user_id", user.id)` and 404 when absent. The subsequent `upsert`/`delete` is keyed on `idea_id` — which is only reachable here after that ownership check — so an attacker cannot target another user's idea.
- **Cross-island state.** `IdeaActions` (in `<summary>`) owns live status; `IdeaPublication` (in the body) is gated on SSR status. They are not wired to a shared store. The reload-on-published-boundary in `IdeaActions` is the deliberate, minimal coupling that keeps the body section correct without a shared state layer. Reload only fires when `previous === "published" || target === "published"`; all other transitions remain optimistic and reload-free as before.
- **Date handling.** `<input type="date">` yields `""` or `YYYY-MM-DD`. Map `""` → `null`; a present value validates as a real date and is sent as-is (Postgres accepts `YYYY-MM-DD` for `timestamptz`). Display formats `published_at` with `toLocaleDateString` guarded against `null`.
- **Workers post-response constraint.** As noted in `documents.ts:96-99`, no work may run after the `Response` is returned; both handlers complete their DB write before responding (no post-response work here).

## Phase 1: Publication endpoint + shared schema

### Overview

Create the shared validation schema/types and the upsert/clear JSON endpoint, with ownership and published-state enforcement.

### Changes Required:

#### 1. Shared publication schema + types

**File**: `src/lib/ideas/publication.ts` (new)

**Intent**: Single source of truth for the publication input shape and its validation, importable by both the endpoint and the form island. Pure module, no I/O.

**Contract**: Export a Zod schema `PublicationInputSchema` with all-optional fields: `url` (empty string or valid http/https URL → normalize empty to `undefined`/`null`), `platform_name` (string, trimmed, max length e.g. 200), `published_at` (empty or a valid date string), `note` (string, max length e.g. 2000). Export the inferred type `PublicationInput` and a `PublicationRow` type alias from `Tables<"publications">`. URL validation accepts only `http:`/`https:` protocols (use `z.string().url()` plus a protocol refinement, or a `.refine`). The schema must treat blank strings as cleared values so an "edit that empties a field" persists `null`.

#### 2. Publication endpoint (upsert + clear)

**File**: `src/pages/api/ideas/[id]/publication.ts` (new)

**Intent**: `PUT` upserts the single publication row for a published idea the user owns; `DELETE` removes it. Mirrors the auth / null-supabase / Zod / `jsonError` conventions of `status.ts`.

**Contract**: `export const PUT: APIRoute` and `export const DELETE: APIRoute`.

- Both: auth guard → 401; null supabase → 503; read `context.params.id` (idea id), missing → 400.
- Both: fetch parent idea `select("status").eq("id", ideaId).eq("user_id", user.id).maybeSingle()`; DB error → 500; not found → 404; if `idea.status !== "published"` → 409 with a message ("Idea is not published").
- `PUT`: parse body with `PublicationInputSchema` (invalid JSON → 400; invalid input → 400). Upsert `{ idea_id: ideaId, url, platform_name, published_at, note }` with `onConflict: "idea_id"`, mapping blank/omitted fields to `null`. DB error → 500. Return `{ ok: true }` (optionally the saved row).
- `DELETE`: `delete().eq("idea_id", ideaId)` (idea ownership already verified above). DB error → 500. Return `{ ok: true }`.
- Reuse a local `jsonError(message, status)` helper identical in shape to `status.ts:80-85`.

### Success Criteria:

#### Automated Verification:

- `npx astro sync` succeeds
- Type checking + lint passes: `npm run lint`
- Prettier formatting passes: `npm run format`
- `npm run build` succeeds

#### Manual Verification:

- `PUT /api/ideas/<published-id>/publication` with a valid body returns 200 and creates the row; a second `PUT` updates the same row (no duplicate — unique `idea_id` holds)
- `PUT` with a malformed URL or invalid date returns 400 and writes nothing
- `PUT`/`DELETE` against a non-`published` idea returns 409
- `PUT`/`DELETE` against another user's or a nonexistent idea returns 404
- `DELETE` removes the row; a subsequent `GET` of the page shows no metadata
- Unauthenticated request returns 401

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Publication island + page wiring

### Overview

Add the `IdeaPublication` island (gated display + add/edit/remove form), batch-load existing publication rows in the campaign page SSR, mount the island in each idea card body, and make `IdeaActions` reload when a transition crosses the `published` boundary.

### Changes Required:

#### 1. IdeaPublication island

**File**: `src/components/campaigns/IdeaPublication.tsx` (new)

**Intent**: Own the publication surface for one idea: render nothing unless the idea is `published`; show a compact metadata summary when a row exists, an "Add publication details" trigger when it does not, and an inline form for add/edit. Upsert via `PUT` and clear via `DELETE`, then reload to reflect new state.

**Contract**: Props carry `ideaId: string`, `status: IdeaStatus`, and `publication: PublicationRow | null`. Returns `null` when `status !== "published"`. When `publication` is present, render platform name, a clickable `url` (`<a target="_blank" rel="noopener noreferrer">`) when set, a `published_at` formatted via `toLocaleDateString` (guard `null`), and `note`, plus "Edit" and "Remove" buttons. The form (toggled by local `useState`) holds `url`, `platform_name`, `published_at` (`<input type="date">`), `note`, pre-filled from `publication` when editing. Submit `PUT`s `PublicationInput` (matching the `IdeaActions` fetch+error-body pattern); "Remove" `DELETE`s. On success, `window.location.reload()` (the body re-renders with fresh SSR data — consistent with `GenerateIdeasPanel`'s reload). On `!res.ok`, surface the server `error` inline. Disable controls while a request is in flight. This island is mounted in the card **body** (after `<summary>`), so `e.stopPropagation()` is not required, but inputs should not submit the surrounding `<details>`.

#### 2. SSR batch-load of publication rows

**File**: `src/pages/campaigns/[id].astro`

**Intent**: Load existing publication rows for the page's ideas so each card can render its metadata without a client round-trip.

**Contract**: After the ideas query (`:47`), if `ideaIds.length > 0`, query `publications` `select("idea_id, url, platform_name, published_at, note").in("idea_id", ideaIds)` and build a `Map<string, PublicationRow>` keyed by `idea_id`. Mirrors the existing `fragRefsByIdeaId` batching (`:56-70`).

#### 3. Mount island in the card body

**File**: `src/pages/campaigns/[id].astro`

**Intent**: Render `IdeaPublication` inside each idea card's body section so published ideas show/edit their metadata.

**Contract**: Inside the card body `<div>` (around `:196-300`, e.g. after the Sources block at `:282-300`), mount `<IdeaPublication ideaId={idea.id} status={idea.status} publication={publicationsByIdeaId.get(idea.id) ?? null} client:visible />`. Use `client:visible` to match the per-card hydration strategy of `IdeaActions`.

#### 4. Reload IdeaActions on published-boundary transitions

**File**: `src/components/campaigns/IdeaActions.tsx`

**Intent**: After a successful status transition that enters or leaves `published`, reload the page so the body publication section is rendered/removed with correct SSR data.

**Contract**: In `handleTransition`, after the `fetch` succeeds (inside the `try`, before `finally`), if `previous === "published" || target === "published"`, call `window.location.reload()`. All other transitions keep the current optimistic, reload-free behavior. The in-flight guard and `stopPropagation` behavior are unchanged.

### Success Criteria:

#### Automated Verification:

- `npx astro sync` succeeds
- Type checking + lint passes: `npm run lint` (no `react-compiler` or `jsx-a11y` errors)
- Prettier formatting passes: `npm run format`
- `npm run build` succeeds

#### Manual Verification:

- A `published` idea card shows the Publication section; non-published ideas show nothing
- "Add publication details" opens the form; saving valid input persists and the card shows the compact summary with a clickable link (new tab), platform, formatted date, and note
- "Edit" pre-fills existing values; saving updates the same row; blanking a field clears it
- "Remove" deletes the row and the card returns to the "Add" affordance
- Malformed URL / invalid date shows an inline error and does not persist
- Publishing an accepted idea reloads and reveals the Publication section; archiving a published idea reloads and hides it; re-publishing shows an empty form
- No console errors; no regressions to generation, status transitions, copy, documents, or insights

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

No test framework is configured (per AGENTS.md) — verification is via `npx astro sync` → `npm run lint` → `npm run build` plus the manual steps below.

### Manual Testing Steps:

1. Generate ideas, accept one, then publish it.
2. Confirm the card reloads and the expanded body shows a "Publication" section with an "Add publication details" affordance.
3. Add details: a valid URL, platform name, a date, and a note → save → confirm the compact summary renders with a clickable link (opens new tab), the platform, the formatted date, and the note.
4. Edit: change the URL, blank the note → save → confirm the row updated and the note cleared.
5. Remove → confirm the section returns to the "Add" affordance and the DB row is gone.
6. Enter a malformed URL (`not a url`) and an invalid date → confirm inline error, nothing persisted.
7. Archive the published idea → confirm reload and the section disappears. Un-archive to accepted, publish again → confirm an empty form (no stale metadata surfaced).
8. Via devtools, `PUT` to a non-published or other-user idea → confirm 409/404 respectively.
9. Confirm no regressions in generation, status transitions, copy-as-markdown, documents, and insights.

## Performance Considerations

Negligible. One added batch query per page load (`publications ... .in("idea_id", ideaIds)`, indexed by the unique `idea_id`). Single-row upsert/delete per user action. Islands are lightweight and hydrate on visibility; batch sizes are ≤10 ideas per generation.

## Migration Notes

None. No schema changes — the `publications` table already exists.

## References

- Roadmap slice: `context/foundation/roadmap.md:217-227` (S-08)
- PRD: `context/foundation/prd.md:121` (FR-019)
- Schema (publications): `supabase/migrations/20260606094848_create_application_schema.sql:182-191`
- Generated types (publications): `src/db/database.types.ts:389-423`
- Status endpoint convention: `src/pages/api/ideas/[id]/status.ts:1-85`
- JSON-API convention: `src/pages/api/ai/generate-ideas.ts:14-118`
- Island fetch + inline-feedback pattern: `src/components/campaigns/IdeaActions.tsx:25-71`
- Reload-on-success pattern: `src/components/campaigns/GenerateIdeasPanel.tsx`
- Idea card body + labeled sections: `src/pages/campaigns/[id].astro:196-300`
- Batch-load pattern: `src/pages/campaigns/[id].astro:56-70`
- S-03 (prior slice): `context/changes/idea-review-and-copy/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Publication endpoint + shared schema

#### Automated

- [x] 1.1 `npx astro sync` succeeds — 6e4a7c9
- [x] 1.2 Type checking + lint passes: `npm run lint` — 6e4a7c9
- [x] 1.3 Prettier formatting passes: `npm run format` — 6e4a7c9
- [x] 1.4 `npm run build` succeeds — 6e4a7c9

#### Manual

- [ ] 1.5 `PUT` creates then updates the same row (unique `idea_id` holds)
- [ ] 1.6 `PUT` with malformed URL/date returns 400, writes nothing
- [ ] 1.7 `PUT`/`DELETE` on non-published idea returns 409
- [ ] 1.8 `PUT`/`DELETE` on other-user/nonexistent idea returns 404
- [ ] 1.9 `DELETE` removes the row
- [ ] 1.10 Unauthenticated request returns 401

### Phase 2: Publication island + page wiring

#### Automated

- [x] 2.1 `npx astro sync` succeeds
- [x] 2.2 Type checking + lint passes: `npm run lint`
- [x] 2.3 Prettier formatting passes: `npm run format`
- [x] 2.4 `npm run build` succeeds

#### Manual

- [ ] 2.5 Published cards show the section; non-published show nothing
- [ ] 2.6 Add → persists and renders compact summary with clickable link, platform, date, note
- [ ] 2.7 Edit pre-fills and updates same row; blanking a field clears it
- [ ] 2.8 Remove deletes the row and restores the "Add" affordance
- [ ] 2.9 Malformed URL/date shows inline error, no persist
- [ ] 2.10 Publish reveals section (reload); archive hides it; re-publish shows empty form
- [ ] 2.11 No console errors; no regressions elsewhere
