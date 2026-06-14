# Idea Review & Copy (S-03) Implementation Plan

## Overview

Let the user move generated ideas through their lifecycle (draft → accepted → published, with archived/declined as exits) and copy an accepted idea's full structured content as markdown. The persistence layer already supports this end-to-end; this slice adds the application-layer wiring: a transition-validating status endpoint, a small per-idea interactive island, and a markdown serializer.

## Current State Analysis

- **Schema is complete — no migration needed.** `idea_status` enum already has all five states and `ideas.status` defaults to `'draft'` with an auto-bumping `updated_at` trigger (`supabase/migrations/20260606094848_create_application_schema.sql:18,158,166-168`). The status index `idx_ideas_campaign_status` exists at `:163`.
- **Ideas render read-only, server-side.** `src/pages/campaigns/[id].astro:172-296` renders each idea as a native `<details>` card. The status pill is hardcoded slate at `:182-184`. The conditional field-rendering block (`:188-292`) enumerates every structured field with its human label — the canonical reference for the markdown serializer.
- **Idea + refs data is already loaded on the page.** The page selects all content columns (`:37-44`) and batch-fetches fragment references joined to document titles into `fragRefsByIdeaId` (`:48-69`). This data can be passed straight to a client island as props.
- **No idea mutation endpoints exist** — only `generate-ideas.ts` (insert). JSON-API convention (auth → 401, null supabase → 503, Zod body validation, `jsonError` helper) is in `src/pages/api/ai/generate-ideas.ts:14-118`. The `[id]` dynamic-route param pattern is in `src/pages/api/campaigns/[id]/documents.ts:11`.
- **React island pattern** is `GenerateIdeasPanel.tsx` — `fetch` then `window.location.reload()` on success; inline error state for feedback.
- **TS types** are generated in `src/db/database.types.ts` — `idea_status` union at `:467`, runtime `Constants.public.Enums.idea_status` array at `:605`, table `Row`/`Update` at `:312-388`.
- **Missing UI primitives:** no clipboard usage, no dropdown-menu/select/toast shadcn components. `Badge`/`Button` exist; radix umbrella + `lucide-react` are installed.

### Key Discoveries:

- Schema, enum, and structured fields already exist — the slice is pure app-layer wiring (`...schema.sql:18,137-191`).
- Campaign status uses a `statusLabel`/`statusClass` record-map pill pattern (`[id].astro:88-102`) — the natural template for status-aware idea badges.
- `Constants.public.Enums.idea_status` (`database.types.ts:605`) gives a runtime list of valid statuses for endpoint validation without re-declaring values.
- `key_quotes` is `NOT NULL default '{}'` (always an array); `key_points` is nullable. Serializer and rendering must treat them differently (already handled in the SSR block at `:196,207`).

## Desired End State

On a campaign page, each idea card shows a color-coded status badge and a row of action buttons reflecting only the legal next transitions. Clicking an action updates the badge and available actions instantly (optimistic), persisting via a JSON `PATCH`. Accepted and published ideas expose a "Copy as markdown" button that writes the full structured idea (all populated fields + sources) to the clipboard and briefly confirms. Illegal transitions are rejected by the server. Verify by: generating ideas, accepting one, copying it (paste shows complete markdown), publishing, archiving, un-archiving, and confirming a declined draft can return to draft.

## What We're NOT Doing

- **No schema/migration changes** — the enum, column, trigger, and indexes already exist.
- **No FR-019 publication metadata** (URL, platform, date, note) — that is slice S-08. "Published" here is status-only.
- **No global toast system** — feedback is inline per-island. A separate roadmap slice is added for the app-wide toast system (Phase 4).
- **No RLS** — ownership stays enforced in application code via `.eq("user_id", user.id)`; RLS is slice F-03.
- **No new shadcn components** (dropdown-menu, select, sonner) — actions are plain buttons matching existing styling.
- **No bulk actions** — per-idea only.
- **No idea field editing** — status transitions and copy only.

## Implementation Approach

A single shared module (`src/lib/ideas/`) owns the two pieces of domain logic that both server and client need: the transition map and the markdown serializer. The endpoint imports the transition map to validate; the island imports both to compute legal actions and to copy. The SSR idea card keeps rendering the body (fast, no JS), and a small `IdeaActions` island is mounted per card to own the interactive surface (badge + action buttons + copy). Optimistic local state in the island makes review snappy; the server remains the source of truth and rejects illegal moves.

## Critical Implementation Details

- **Cloudflare Workers cannot run code after the Response is returned** (see the note at `documents.ts:96-99`). The status endpoint must complete its DB update before returning — straightforward here since there's no post-response work.
- **Clipboard requires a secure context and a user gesture.** `navigator.clipboard.writeText` runs inside the button's click handler (already a gesture). Production is HTTPS (`content-forge.jakub-skwara-js.workers.dev`) so the secure-context requirement holds; guard for `navigator.clipboard` being undefined and surface an error state rather than throwing.
- **The IdeaActions island mounts inside the card's `<summary>`** (`[id].astro` opens `<summary>` at :176, closes at :186; the status pill it replaces is at :182-184). The action bar must stay visible while the card is collapsed, and content placed _after_ `<summary>` is hidden until the card is open — so the island has to live inside `<summary>`. Consequence: every interactive element in the island must `e.stopPropagation()` on click, otherwise the click bubbles to the `<details>` and toggles it open/closed on every action.

## Phase 1: Shared idea domain lib

### Overview

Create pure, testable functions for lifecycle transitions and markdown serialization in a new `src/lib/ideas/` module. No I/O, no React — usable from both the endpoint and the island.

### Changes Required:

#### 1. Transition map

**File**: `src/lib/ideas/lifecycle.ts` (new)

**Intent**: Define the allowed lifecycle edges as the single source of truth, plus helpers to query them. Both the endpoint (validation) and the island (which buttons to show) consume this.

**Contract**: Export an `IdeaStatus` type alias (from `Enums<"idea_status">`), an `ALLOWED_TRANSITIONS: Record<IdeaStatus, IdeaStatus[]>` map, `canTransition(from, to): boolean`, and `nextStatuses(from): IdeaStatus[]`. The edges are:

```
draft     → [accepted, declined]
accepted  → [published, archived, declined]
published → [archived]
archived  → [accepted]
declined  → [draft]
```

#### 2. Markdown serializer

**File**: `src/lib/ideas/markdown.ts` (new)

**Intent**: Convert an idea plus its fragment references into a complete markdown document covering every populated structured field, mirroring the labels used in the SSR card. Pure function.

**Contract**: `ideaToMarkdown(idea: IdeaForMarkdown, refs: FragmentRef[]): string`. Define minimal input interfaces (the content fields selected at `[id].astro:40` + a ref shape of `{ documentTitle, quoteSnippet }`). Output: `# {working_title}`, then sections for Hook, Key Points (bullet list), Key Quotes (blockquotes), Proposed Flow, Insights & Conclusions, Call to Action, Storytelling Angle, Target Audience, Content Format, and Sources — each emitted only when the field is non-empty. Treat `key_points` as nullable and `key_quotes` as an always-present array (may be empty).

### Success Criteria:

#### Automated Verification:

- `npx astro sync` succeeds
- Type checking passes: `npm run lint`
- Prettier formatting passes: `npm run format`

#### Manual Verification:

- `canTransition` returns false for an illegal edge (e.g. `draft → published`) and true for a legal one (`draft → accepted`)
- `ideaToMarkdown` output for a fully-populated idea contains every section; for a minimal idea (title only) contains just the title heading

**Implementation Note**: After this phase and automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Status mutation endpoint

### Overview

Add a JSON `PATCH` endpoint that validates ownership and the requested transition, then updates `ideas.status`.

### Changes Required:

#### 1. Status endpoint

**File**: `src/pages/api/ideas/[id]/status.ts` (new)

**Intent**: Accept a target status for an idea, verify the idea belongs to the authenticated user, enforce the transition map, and persist. Return the new status as JSON. Mirrors the auth/null-supabase/Zod/`jsonError` conventions from `generate-ideas.ts`.

**Contract**: `export const PATCH: APIRoute`. Reads `context.params.id` (idea id). Auth guard → 401; null supabase → 503. Zod body `{ status: z.enum(Constants.public.Enums.idea_status) }`; invalid JSON → 400. Fetch the idea's current `status` scoped by `.eq("id", id).eq("user_id", user.id).maybeSingle()`; not found → 404. If `!canTransition(current, target)` → 400 with a message. Else persist with the update **row-scoped**: `.update({ status: target }).eq("id", id).eq("user_id", user.id)` (the trigger bumps `updated_at`) and return `{ ok: true, status: target }`. The `.eq` scoping is mandatory — there are no RLS policies, so an unscoped `.update()` would rewrite every idea's status. Reuse a local `jsonError(message, status)` helper.

### Success Criteria:

#### Automated Verification:

- `npx astro sync` succeeds
- Type checking passes: `npm run lint`
- `npm run build` succeeds

#### Manual Verification:

- `PATCH /api/ideas/<id>/status` with a legal transition returns 200 `{ ok, status }` and the DB row updates
- An illegal transition returns 400 and the row is unchanged
- An idea id owned by another user (or nonexistent) returns 404
- Unauthenticated request returns 401

**Implementation Note**: Pause for manual confirmation after automated verification passes.

---

## Phase 3: IdeaActions island & card wiring

### Overview

Add a per-idea React island providing the status badge, transition buttons (optimistic), and the copy-as-markdown action. Wire it into the campaign page, replacing the hardcoded status pill.

### Changes Required:

#### 1. Status badge styling

**File**: `src/lib/ideas/lifecycle.ts` (extend) or co-located in the island

**Intent**: Provide a status → label and status → CSS-class mapping for the five idea statuses, mirroring the campaign `statusClass` pattern.

**Contract**: Export `IDEA_STATUS_LABEL: Record<IdeaStatus, string>` and `IDEA_STATUS_CLASS: Record<IdeaStatus, string>` (Tailwind utility strings consistent with `[id].astro:95-100` styling — e.g. accepted=green, published=purple, archived=gray, declined=red, draft=slate).

#### 2. IdeaActions island

**File**: `src/components/campaigns/IdeaActions.tsx` (new)

**Intent**: Own the interactive surface for one idea — render the current status badge, the buttons for each legal next status (from `nextStatuses`), and a Copy button when status is `accepted` or `published`. Update optimistically on success, roll back on error; show inline transient feedback ("Copied!", error text).

**Contract**: Props carry the idea id, initial status, and the full idea content + refs needed for `ideaToMarkdown`. Local `useState` holds current status, a transient UI flag, and an in-flight flag. Status buttons call `PATCH /api/ideas/{id}/status` (matching `GenerateIdeasPanel`'s fetch + error-body pattern at `GenerateIdeasPanel.tsx:32-42`); on 200 set new status, on failure restore previous + show error. **While a PATCH is pending, disable the action buttons** (in-flight guard) so rapid double-clicks can't fire conflicting transitions computed from stale optimistic state. Copy button calls `ideaToMarkdown(...)` then `navigator.clipboard.writeText(...)` inside the click handler, guarding for missing clipboard API; shows "Copied!" for ~2s. No reload. **Every interactive element in this island must call `e.stopPropagation()` on click** — the island renders inside the card's `<summary>` (see wiring change #3 and Critical Implementation Details), so unhandled clicks would bubble up and toggle the `<details>` disclosure.

#### 3. Wire island into the campaign page

**File**: `src/pages/campaigns/[id].astro`

**Intent**: Replace the static status pill (`:182-184`) with the `IdeaActions` island, passing the idea fields and its resolved refs. Map `fragRefsByIdeaId` entries to the serializer's `{ documentTitle, quoteSnippet }` shape.

**Contract**: Import and mount `<IdeaActions ... client:visible />` inside each idea card. Use `client:visible` (not `client:load`) — a generation batch is ≤10 ideas across multiple generations, so per-idea islands are mounted in a loop; deferring hydration until each card scrolls into view avoids hydrating dozens of islands upfront. Build the refs prop from `fragRefsByIdeaId.get(idea.id)` (document title from `ref.document_versions?.documents.title`, snippet from `ref.quote_snippet`). The SSR card body (`:188-292`) is unchanged.

### Success Criteria:

#### Automated Verification:

- `npx astro sync` succeeds
- Type checking + lint passes: `npm run lint` (no `react-compiler` or `jsx-a11y` errors)
- `npm run build` succeeds

#### Manual Verification:

- Each idea card shows a color-coded badge matching its status
- Only legal next-status buttons appear; clicking one updates badge + buttons instantly without reload
- A failed request rolls the badge back and shows an error
- Copy button appears only for accepted/published ideas; clicking copies complete markdown (verified by pasting) and shows "Copied!"
- Full review flow works: draft→accepted→published→archived→accepted, and declined→draft
- No console errors; no regressions to generation panel or document/insight sections

**Implementation Note**: Pause for manual confirmation after automated verification passes.

---

## Phase 4: Roadmap update — global toast slice

### Overview

Record the deferred app-wide toast notification system as a new roadmap slice so the inline-feedback decision in this slice is traceable.

### Changes Required:

#### 1. Add slice to roadmap

**File**: `context/foundation/roadmap.md`

**Intent**: Add a new slice (e.g. S-11 `global-toast-notifications`) capturing a workspace-wide toast/notification system, noting it generalizes the inline feedback used in S-03 and would back S-09 (background-ops status) notifications. Add it to the "At a glance" table and the Slices section with appropriate prerequisites and a `proposed` status.

**Contract**: One new table row + one `### S-11:` slice block following the existing slice format (Outcome, Change ID, PRD refs, Prerequisites, Parallel with, Risk, Status). No PRD FR maps directly — note it as a UX/infrastructure enabler.

### Success Criteria:

#### Automated Verification:

- Roadmap table row and slice block are present and well-formed (markdown renders)

#### Manual Verification:

- The new slice reads coherently alongside existing slices and references S-03/S-09

---

## Testing Strategy

No test framework is configured (per AGENTS.md) — verification is via lint/build plus manual steps.

### Manual Testing Steps:

1. Generate a batch of ideas on a campaign.
2. Confirm each card shows a draft badge and only Accept/Decline actions.
3. Accept an idea → badge turns green, actions become Publish/Archive/Decline, Copy appears.
4. Click Copy → paste into an editor → confirm all populated fields + sources are present and correctly formatted.
5. Publish → Archive → Un-archive (back to accepted). Decline a draft, then return it to draft.
6. Use browser devtools to send an illegal transition directly → confirm 400 and unchanged UI after reload.
7. Confirm no regressions in generation, documents, and insights sections.

## Performance Considerations

Negligible — one indexed single-row update per action (`idx_ideas_campaign_status`), no new queries on page load (data already fetched). Islands are lightweight and mounted per idea; batch sizes are ≤10.

## Migration Notes

None. No schema changes.

## References

- Roadmap slice: `context/foundation/roadmap.md:155-165` (S-03)
- PRD: `context/foundation/prd.md:113-116` (FR-015, FR-016)
- Schema: `supabase/migrations/20260606094848_create_application_schema.sql:18,137-191`
- Idea display + field labels: `src/pages/campaigns/[id].astro:172-296`
- JSON-API convention: `src/pages/api/ai/generate-ideas.ts:14-118`
- Island/fetch pattern: `src/components/campaigns/GenerateIdeasPanel.tsx:32-59`
- Status pill record-map pattern: `src/pages/campaigns/[id].astro:88-102`
- Generated types + enum constant: `src/db/database.types.ts:467,605`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared idea domain lib

#### Automated

- [x] 1.1 `npx astro sync` succeeds — 4ba1fad
- [x] 1.2 Type checking passes: `npm run lint` — 4ba1fad
- [x] 1.3 Prettier formatting passes: `npm run format` — 4ba1fad

#### Manual

- [ ] 1.4 `canTransition` rejects illegal edge, allows legal edge
- [ ] 1.5 `ideaToMarkdown` emits all sections for full idea, title-only for minimal

### Phase 2: Status mutation endpoint

#### Automated

- [x] 2.1 `npx astro sync` succeeds
- [x] 2.2 Type checking passes: `npm run lint`
- [x] 2.3 `npm run build` succeeds

#### Manual

- [ ] 2.4 Legal transition returns 200 and updates row
- [ ] 2.5 Illegal transition returns 400, row unchanged
- [ ] 2.6 Other-user/nonexistent idea returns 404
- [ ] 2.7 Unauthenticated returns 401

### Phase 3: IdeaActions island & card wiring

#### Automated

- [ ] 3.1 `npx astro sync` succeeds
- [ ] 3.2 Type checking + lint passes: `npm run lint`
- [ ] 3.3 `npm run build` succeeds

#### Manual

- [ ] 3.4 Badge color matches status on each card
- [ ] 3.5 Only legal actions shown; click updates instantly, no reload
- [ ] 3.6 Failed request rolls back badge + shows error
- [ ] 3.7 Copy shown only for accepted/published; copies complete markdown + "Copied!"
- [ ] 3.8 Full review flow works (incl. un-archive and declined→draft)
- [ ] 3.9 No console errors; no regressions elsewhere

### Phase 4: Roadmap update — global toast slice

#### Automated

- [ ] 4.1 Roadmap table row + slice block present and well-formed

#### Manual

- [ ] 4.2 New slice reads coherently and references S-03/S-09
