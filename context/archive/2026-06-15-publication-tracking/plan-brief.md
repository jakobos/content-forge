# Publication Tracking (S-08) — Plan Brief

> Full plan: `context/changes/publication-tracking/plan.md`

## What & Why

FR-019: let users attach publication metadata — URL, platform name, publish date, optional note — to an idea once it reaches `published` status, closing the lifecycle loop from raw material to a recorded, published post. The data layer already exists; this slice makes it usable.

## Starting Point

The `publications` table is already in the schema (1:1 with `ideas`, unique `idea_id`, CASCADE on idea delete) and generated TS types are present — but nothing loads, writes, or displays it. Idea lifecycle (S-03) is complete: `accepted → published → archived` transitions work via an optimistic, no-reload `IdeaActions` island.

## Desired End State

A `published` idea's expanded card body shows a Publication section: a compact summary (clickable URL, platform, formatted date, note) with Edit/Remove, or an "Add publication details" form when empty. Saving validates input and upserts the single publication row; Remove deletes it. The section is hidden whenever the idea is not published, and the API rejects writes to ideas the user does not own or that are not published.

## Key Decisions Made

| Decision            | Choice                                                     | Why (1 sentence)                                                                               | Source |
| ------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------ |
| Capture flow        | Separate "Publication details" action on published ideas   | Decouples metadata from the publish transition; all fields are optional so users fill in later | Plan   |
| Edit/remove         | Upsert (edit) + clear-all (delete)                         | Covers correction and full removal cleanly against the unique single row                       | Plan   |
| Validation          | All optional; validate http(s) URL + date when present     | Low friction matching the nullable schema while preventing broken links/dates                  | Plan   |
| Un-publish behavior | Persist row in DB but hide form/display unless `published` | Keeps lifecycle simple; re-publish shows an empty form                                         | Plan   |
| Display             | Compact summary in card body + clickable URL (new tab)     | Matches the existing labeled-section rendering; keeps the collapsed summary clean              | Plan   |

## Scope

**In scope:** shared Zod schema/types; `PUT`/`DELETE` endpoint with ownership + published-state guards; SSR batch-load of publication rows; `IdeaPublication` island (display + form); `IdeaActions` reload on published-boundary transitions.

**Out of scope:** schema/migrations; adding `user_id` to `publications`; metadata for non-published ideas; auto-filling `published_at`; persisting form across un-publish; global toasts (S-11); multiple publications per idea.

## Architecture / Approach

`src/lib/ideas/publication.ts` holds the Zod schema + types shared by endpoint and form. `src/pages/api/ideas/[id]/publication.ts` exposes `PUT` (upsert on `idea_id`) and `DELETE` (clear), each verifying idea ownership (scoped by `user_id`, since `publications` has no `user_id`) and `published` state. The campaign page batch-loads publication rows into a Map and mounts a new `IdeaPublication` island in each card body, gated on `published`. `IdeaActions` reloads only when a transition enters/leaves `published` so the body section stays correct without a shared state layer.

## Phases at a Glance

| Phase                   | What it delivers                                                            | Key risk                                                              |
| ----------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1. Endpoint + schema    | Shared Zod schema and `PUT`/`DELETE` endpoint with ownership + state guards | Ownership must be derived via the parent idea (no `user_id` on table) |
| 2. Island + page wiring | Display/edit island, SSR load, card mount, boundary reload                  | Cross-island status sync — solved by reload on published-boundary     |

**Prerequisites:** S-03 (idea lifecycle with `published` state) — done. `publications` table — exists.
**Estimated effort:** ~1 session across 2 phases (low complexity, no migration).

## Open Risks & Assumptions

- Assumes a page reload on the publish/un-publish transition is acceptable UX (the publish action is infrequent); all other transitions remain optimistic.
- Assumes deriving ownership through the parent idea is sufficient isolation in the absence of RLS (consistent with the rest of the app pre-F-03).
- `published_at` stored as `timestamptz` from a date-only input; time component is unused.

## Success Criteria (Summary)

- A published idea can have URL/platform/date/note added, edited, and removed, with a clickable link rendered.
- Invalid URLs/dates are rejected; the section is hidden for non-published ideas; the API rejects unowned/non-published targets.
- No regressions to status transitions, copy-as-markdown, or the rest of the campaign page.
