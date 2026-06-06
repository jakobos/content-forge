# Campaign & Document CRUD Implementation Plan

## Overview

Build the campaign and document CRUD pages -- the data-entry surface that feeds idea generation (the north star). Users can create campaigns (with title, goal, description), view a campaign list with metadata, and add source documents or user insights to campaigns. This is the first data feature in the app and establishes CRUD patterns for all downstream slices (S-02 through S-10).

## Current State Analysis

- **Schema (F-01):** Fully implemented. Tables `campaigns`, `documents`, `document_versions` are live with TypeScript types generated at `src/db/database.types.ts`.
- **Auth:** Working -- Supabase Auth via middleware, protected routes, session management.
- **UI:** Only `button.tsx` exists from shadcn/ui. No data-fetching pages. Dashboard is a placeholder.
- **API pattern:** PRG (Post-Redirect-Get) established by auth endpoints. Form data parsing, Supabase client with null-check, redirect on success/error.
- **No RLS:** Route-level auth only (F-03 deferred). API endpoints must verify user ownership manually.

### Key Discoveries:

- Middleware `PROTECTED_ROUTES` uses `startsWith` matching (`src/middleware.ts:18`) -- adding `"/campaigns"` covers all sub-routes
- Supabase client returns `null` when env vars missing (`src/lib/supabase.ts:7-9`) -- every API endpoint must handle this
- Auth forms use React 19's `useFormStatus()` for pending state (`src/components/auth/SubmitButton.tsx:12`)
- Astro pages can query Supabase in frontmatter (server-side) -- no API needed for reads
- `Database` type is already wired into the Supabase client (`src/lib/supabase.ts:4,10`) -- queries are fully typed

## Desired End State

After this plan is complete:
- Authenticated users can navigate to `/campaigns` and see a list of their campaigns (title, goal, status badge, source doc count, insight count)
- Users can create a new campaign with title (required), goal (optional), description (optional) and land on the campaign detail page
- On the campaign detail page, users see campaign info and a list of documents (grouped by type)
- Users can add a source document (title + content + optional URL) or a user insight (title + content) via distinct forms
- Empty states guide users with clear CTAs
- The Topbar shows a "Campaigns" link for authenticated users
- All forms use the PRG pattern (POST to API endpoint -> redirect back)

## What We're NOT Doing

- Document ingestion/chunking/embeddings (F-02)
- Campaign lifecycle management -- status changes, editing campaigns (S-07)
- Document editing or versioning UI (S-07)
- Document archiving/deletion (S-07)
- RLS policies (F-03)
- Idea generation or display (S-02)
- Business profile (S-04)
- Background operations status (S-09)
- Mobile-specific responsive optimization (beyond basic responsive layout)

## Implementation Approach

Follow the established PRG pattern: Astro pages do server-side data fetching in frontmatter, React form components hydrate with `client:load`, form submissions POST to Astro API endpoints which redirect back. This keeps the architecture consistent with auth flows and avoids client-side state management.

Campaign list uses a Supabase query with aggregated document counts. Campaign detail fetches the campaign + its documents in the page frontmatter. API endpoints validate auth, parse form data, perform mutations, and redirect.

---

## Phase 1: UI Foundation

### Overview

Add required shadcn/ui components, update route protection, and wire navigation so authenticated users can reach the campaigns section.

### Changes Required:

#### 1. Add shadcn/ui components

**Commands to run:**
```bash
npx shadcn@latest add card input textarea badge label
```

**Intent**: Install the UI primitives needed for campaign cards, forms, and status badges. These are standard shadcn/ui components used throughout the remaining phases.

**Contract**: Components land in `src/components/ui/` following the existing `button.tsx` pattern (cva variants, `cn()` utility, forwardRef).

#### 2. Update route protection

**File**: `src/middleware.ts`

**Intent**: Add `/campaigns` to the protected routes array so all campaign pages require authentication.

**Contract**: `PROTECTED_ROUTES` array includes `"/campaigns"` -- this covers `/campaigns`, `/campaigns/new`, `/campaigns/[id]` via `startsWith` matching.

#### 3. Include Topbar in Layout and add Campaigns link

**Files**: `src/layouts/Layout.astro`, `src/components/Topbar.astro`

**Intent**: Move Topbar into the shared Layout so all pages get consistent navigation. Add a "Campaigns" link visible to authenticated users.

**Contract**:
- `Layout.astro`: Import and render `Topbar` inside `<body>` above `<slot />`, wrapped in a container with appropriate padding.
- `Topbar.astro`: Add a link to `/campaigns` in the authenticated user's nav links (alongside existing "Dashboard" link).
- Remove Welcome.astro's direct Topbar import (it inherits from Layout now).
- Dashboard page: remove inline sign-out form (Topbar provides sign-out).

### Success Criteria:

#### Automated Verification:

- shadcn components installed: files exist at `src/components/ui/{card,input,textarea,badge,label}.tsx`
- Lint passes: `npm run lint`
- Build passes: `npm run build`
- Middleware updated: `"/campaigns"` in PROTECTED_ROUTES

#### Manual Verification:

- Unauthenticated users visiting `/campaigns` get redirected to `/auth/signin`
- Topbar shows "Campaigns" link when signed in
- Topbar does not show "Campaigns" link when signed out
- Topbar appears on all pages (homepage, dashboard, auth pages, future campaign pages)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Campaign List & Create

### Overview

Build the campaign list page (with empty state), the campaign create page with a form, and the API endpoint for campaign creation. After creating a campaign, the user lands on the campaign detail page.

### Changes Required:

#### 1. Campaign list page

**File**: `src/pages/campaigns/index.astro`

**Intent**: Display the user's campaigns as cards showing title, goal (truncated), status badge, and document counts (source docs + insights). Show a friendly empty state with CTA when no campaigns exist.

**Contract**: Astro page. Frontmatter queries Supabase for campaigns where `user_id` matches `Astro.locals.user.id`, ordered by `updated_at desc`. Document counts: fetch all documents where `campaign_id` is in the user's campaign IDs (single query selecting `campaign_id, type` only), then group by `campaign_id` + `type` in TypeScript to produce per-campaign counts. Renders campaign cards or empty state. Links each card to `/campaigns/[id]`. Has a "New Campaign" button/link to `/campaigns/new`.

#### 2. Campaign create page

**File**: `src/pages/campaigns/new.astro`

**Intent**: Render the campaign creation form. Reads `?error=` query param for server error display (PRG pattern).

**Contract**: Astro page wrapping a `CampaignCreateForm` React component with `client:load`. Passes `serverError` prop from URL params.

#### 3. Campaign create form component

**File**: `src/components/campaigns/CampaignCreateForm.tsx`

**Intent**: React form with title (required), goal (optional text input), description (optional textarea). Client-side validation for title presence. Uses existing form primitives pattern (FormField, SubmitButton, ServerError) adapted for campaign context.

**Contract**: `<form method="POST" action="/api/campaigns">`. Fields: `title` (text input, required), `goal` (text input, optional), `description` (textarea, optional). Uses `useFormStatus()` for pending state. Validates title is non-empty before submission.

#### 4. Campaign create API endpoint

**File**: `src/pages/api/campaigns/index.ts`

**Intent**: Handle POST requests to create a new campaign. Validates auth, parses form data, inserts into `campaigns` table, redirects to the new campaign's detail page.

**Contract**: `export const POST: APIRoute`. Creates Supabase client, checks for null. Verifies `context.locals.user` exists. Parses `title`, `goal`, `description` from form data. Validates title non-empty (server-side). Inserts row with `user_id`, `title`, `goal`, `description`, default status `'draft'`. On success: redirect to `/campaigns/[new-id]`. On error: redirect to `/campaigns/new?error=...`.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`
- Files exist: `src/pages/campaigns/index.astro`, `src/pages/campaigns/new.astro`, `src/components/campaigns/CampaignCreateForm.tsx`, `src/pages/api/campaigns/index.ts`

#### Manual Verification:

- `/campaigns` shows empty state with "Create your first campaign" CTA when no campaigns exist
- Clicking CTA navigates to `/campaigns/new`
- Creating a campaign with title + goal + description redirects to `/campaigns/[id]`
- Creating a campaign with only title (goal/description blank) works
- Submitting without title shows client-side validation error
- New campaign appears in the list at `/campaigns` with status "draft"
- Campaign cards show title, goal snippet, status badge

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Campaign Detail & Document CRUD

### Overview

Build the campaign detail page showing campaign info and documents (grouped by type), plus forms and API endpoints for adding source documents and user insights.

### Changes Required:

#### 1. Campaign detail page

**File**: `src/pages/campaigns/[id].astro`

**Intent**: Display campaign information (title, goal, description, status) and its documents grouped into "Source Documents" and "User Insights" sections. Each section has an "Add" button that reveals/links to the add form. Shows document cards with title, content preview, and creation date.

**Contract**: Astro page with dynamic route `[id]`. Frontmatter queries campaign by `id` where `user_id` matches current user (ownership check). If not found or not owned: redirect to `/campaigns`. Queries documents for this campaign, ordered by `created_at desc`. Renders campaign header, two document sections, and inline add-document forms (React components with `client:load`). Reads `?error=` and `?success=` query params for feedback messages.

#### 2. Add Source Document form component

**File**: `src/components/campaigns/AddSourceDocumentForm.tsx`

**Intent**: React form for adding a source document. Fields: title (required), content (required, fixed-height textarea with 20,000 char limit), source URL (optional).

**Contract**: `<form method="POST" action="/api/campaigns/[campaignId]/documents">`. Hidden field `type` = `"source_document"`. Props: `campaignId: string`, `serverError?: string`. Fields: `title` (text input, required), `content` (textarea, required, maxLength 20000, shows char count), `source_url` (text input, optional, basic URL format hint). Client-side validation: title non-empty, content non-empty and <= 20000 chars.

#### 3. Add User Insight form component

**File**: `src/components/campaigns/AddInsightForm.tsx`

**Intent**: React form for adding a user insight. Fields: title (required), content (required, fixed-height textarea with 20,000 char limit). No URL field.

**Contract**: `<form method="POST" action="/api/campaigns/[campaignId]/documents">`. Hidden field `type` = `"user_insight"`. Props: `campaignId: string`, `serverError?: string`. Fields: `title` (text input, required), `content` (textarea, required, maxLength 20000, shows char count). Client-side validation: title non-empty, content non-empty and <= 20000 chars.

#### 4. Document add API endpoint

**File**: `src/pages/api/campaigns/[id]/documents.ts`

**Intent**: Handle POST requests to add a document (either type) to a campaign. Validates auth, ownership, form data. Creates a `documents` row AND an initial `document_versions` row (version 1).

**Contract**: `export const POST: APIRoute`. Creates Supabase client, checks null. Verifies user auth. Parses `type`, `title`, `content`, `source_url` from form data. Validates: title non-empty, content non-empty, content <= 20000 chars, type is valid enum value (`source_document` or `user_insight`). Verifies campaign exists and is owned by user (query `campaigns` where `id` = param and `user_id` = current user). Inserts `documents` row with `campaign_id`, `user_id`, `type`, `title`, `content`, `source_url`, `current_version: 1`. Inserts `document_versions` row with `document_id`, `version_number: 1`, `content`. On success: redirect to `/campaigns/[id]?success=document_added`. On error: redirect to `/campaigns/[id]?error=...`.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`
- Files exist: `src/pages/campaigns/[id].astro`, `src/components/campaigns/AddSourceDocumentForm.tsx`, `src/components/campaigns/AddInsightForm.tsx`, `src/pages/api/campaigns/[id]/documents.ts`

#### Manual Verification:

- Campaign detail page shows campaign title, goal, description, status
- Page shows two sections: "Source Documents" and "User Insights"
- Empty sections show contextual empty state (e.g., "No source documents yet")
- Adding a source document (title + content + URL) shows it in the Source Documents section
- Adding a user insight (title + content) shows it in the User Insights section
- Character count displays correctly and prevents submission over 20,000 chars
- Submitting without required fields shows validation errors
- Attempting to access another user's campaign redirects to `/campaigns`
- Documents display title and a content preview (first ~200 chars truncated)
- Success feedback appears after adding a document
- Document counts update correctly on campaign list page

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

No test framework configured (per AGENTS.md). Skip.

### Integration Tests:

No test framework configured. Skip.

### Manual Testing Steps:

1. Sign in, verify Topbar shows "Campaigns" link
2. Navigate to `/campaigns`, verify empty state with CTA
3. Create a campaign with all fields filled -- verify redirect to detail page
4. Create a campaign with title only -- verify works
5. Navigate back to list -- verify both campaigns appear with correct metadata
6. On detail page, add a source document with all fields -- verify it appears in "Source Documents" section
7. Add a user insight -- verify it appears in "User Insights" section
8. Verify character counter works and blocks submission at 20,001 chars
9. Verify document counts update on campaign list page
10. Open a private/incognito window, attempt to access `/campaigns/[id]` -- verify redirect to sign in
11. Sign in as a different user, attempt to access the first user's campaign by ID -- verify redirect to `/campaigns`

## Performance Considerations

- Campaign list query should be efficient with the existing `idx_campaigns_user_status` index
- Document count query uses a group-by on `campaign_id` + `type` against `idx_documents_campaign_status`
- No pagination needed for MVP (users will have few campaigns/documents initially)
- Textarea with 20k char limit keeps page weight reasonable

## Migration Notes

No schema changes needed -- F-01 already provides all required tables and columns.

## References

- Schema migration: `supabase/migrations/20260606094848_create_application_schema.sql`
- TypeScript types: `src/db/database.types.ts`
- Auth API pattern: `src/pages/api/auth/signin.ts`
- Form component pattern: `src/components/auth/SignInForm.tsx`
- Middleware route protection: `src/middleware.ts:4`
- Roadmap slice: `context/foundation/roadmap.md` (S-01)
- PRD refs: FR-004, FR-005, FR-008, FR-009

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: UI Foundation

#### Automated Verification:

- [x] 1.1 shadcn components installed: files exist at src/components/ui/{card,input,textarea,badge,label}.tsx
- [x] 1.2 Lint passes: npm run lint
- [x] 1.3 Build passes: npm run build
- [x] 1.4 Middleware updated: "/campaigns" in PROTECTED_ROUTES

#### Manual Verification:

- [ ] 1.5 Unauthenticated users visiting /campaigns get redirected to /auth/signin
- [ ] 1.6 Topbar shows "Campaigns" link when signed in
- [ ] 1.7 Topbar does not show "Campaigns" link when signed out
- [ ] 1.8 Topbar appears on all pages (homepage, dashboard, auth pages, future campaign pages)

### Phase 2: Campaign List & Create

#### Automated Verification:

- [ ] 2.1 Lint passes: npm run lint
- [ ] 2.2 Build passes: npm run build
- [ ] 2.3 Files exist: src/pages/campaigns/index.astro, src/pages/campaigns/new.astro, src/components/campaigns/CampaignCreateForm.tsx, src/pages/api/campaigns/index.ts

#### Manual Verification:

- [ ] 2.4 /campaigns shows empty state with "Create your first campaign" CTA when no campaigns exist
- [ ] 2.5 Clicking CTA navigates to /campaigns/new
- [ ] 2.6 Creating a campaign with title + goal + description redirects to /campaigns/[id]
- [ ] 2.7 Creating a campaign with only title (goal/description blank) works
- [ ] 2.8 Submitting without title shows client-side validation error
- [ ] 2.9 New campaign appears in the list at /campaigns with status "draft"
- [ ] 2.10 Campaign cards show title, goal snippet, status badge

### Phase 3: Campaign Detail & Document CRUD

#### Automated Verification:

- [ ] 3.1 Lint passes: npm run lint
- [ ] 3.2 Build passes: npm run build
- [ ] 3.3 Files exist: src/pages/campaigns/[id].astro, src/components/campaigns/AddSourceDocumentForm.tsx, src/components/campaigns/AddInsightForm.tsx, src/pages/api/campaigns/[id]/documents.ts

#### Manual Verification:

- [ ] 3.4 Campaign detail page shows campaign title, goal, description, status
- [ ] 3.5 Page shows two sections: "Source Documents" and "User Insights"
- [ ] 3.6 Empty sections show contextual empty state
- [ ] 3.7 Adding a source document (title + content + URL) shows it in the Source Documents section
- [ ] 3.8 Adding a user insight (title + content) shows it in the User Insights section
- [ ] 3.9 Character count displays correctly and prevents submission over 20,000 chars
- [ ] 3.10 Submitting without required fields shows validation errors
- [ ] 3.11 Attempting to access another user's campaign redirects to /campaigns
- [ ] 3.12 Documents display title and a content preview (first ~200 chars truncated)
- [ ] 3.13 Success feedback appears after adding a document
- [ ] 3.14 Document counts update correctly on campaign list page
