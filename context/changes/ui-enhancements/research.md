---
date: 2026-07-21T16:45:24+02:00
researcher: Claude (claude-opus-4-6)
git_commit: 674bf5ab3da35f8028203ef44e83bf944f033b53
branch: master
repository: jakobos/content-forge
topic: "Audit of existing pages and components for UI layout enhancements"
tags: [research, codebase, ui, components, pages, styling, shadcn]
status: complete
last_updated: 2026-07-21
last_updated_by: Claude (claude-opus-4-6)
---

# Research: Audit of Existing Pages and Components

**Date**: 2026-07-21T16:45:24+02:00
**Researcher**: Claude (claude-opus-4-6)
**Git Commit**: [674bf5a](https://github.com/jakobos/content-forge/blob/674bf5ab3da35f8028203ef44e83bf944f033b53)
**Branch**: master
**Repository**: jakobos/content-forge

## Research Question

Full inventory of existing pages and components with focus on component patterns -- shadcn/ui usage, component composition, prop patterns, and reusability -- to inform UI layout adjustments.

## Summary

ContentForge has **7 UI pages**, **12 API endpoints**, **1 layout**, **7 shadcn/ui primitives** (6 standard + 1 custom Astro badge), and **16 feature components** (6 auth, 7 campaign, 3 layout/shared). The key findings:

1. **shadcn/ui adoption is minimal** -- only 1 of 16 feature components uses a shadcn primitive (`SubmitButton` uses `Button`). The shadcn `Input`, `Label`, `Textarea`, `Card`, and `Badge` components are installed but unused by any feature code.
2. **Duplicated form patterns** -- three campaign forms (`CampaignCreateForm`, `AddInsightForm`, `AddSourceDocumentForm`) duplicate identical CSS constants, inline `SubmitButton` sub-components, and validation patterns rather than sharing with the existing `auth/FormField` and `auth/SubmitButton`.
3. **Two parallel color systems** -- shadcn semantic tokens (CSS variables in oklch) vs. hardcoded "cosmic" Tailwind classes (`purple-600`, `blue-100/70`, `white/10`). The app uses the cosmic palette; shadcn tokens go unused.
4. **The campaign detail page (`[id].astro`) is 464 lines** with 6 React islands, multiple inline status maps, and all sections in one file.

## Detailed Findings

### Pages Inventory

| Route                 | File                                 | Auth                   | Components Used                             |
| --------------------- | ------------------------------------ | ---------------------- | ------------------------------------------- |
| `/`                   | `src/pages/index.astro`              | Redirects if logged in | `Welcome`                                   |
| `/auth/signin`        | `src/pages/auth/signin.astro`        | Public                 | `SignInForm` (React, `client:load`)         |
| `/auth/signup`        | `src/pages/auth/signup.astro`        | Public                 | `SignUpForm` (React, `client:load`)         |
| `/auth/confirm-email` | `src/pages/auth/confirm-email.astro` | Public                 | None (pure Astro)                           |
| `/campaigns`          | `src/pages/campaigns/index.astro`    | Middleware             | None (server-rendered)                      |
| `/campaigns/new`      | `src/pages/campaigns/new.astro`      | Middleware             | `CampaignCreateForm` (React, `client:load`) |
| `/campaigns/:id`      | `src/pages/campaigns/[id].astro`     | Middleware + explicit  | 6 React components                          |

**Layout:** Single `Layout.astro` wraps all pages. Contains `Banner.astro` (config warnings) and `Topbar.astro` (nav bar with auth-aware content). Body uses `bg-cosmic min-h-screen`.

**Middleware:** Only `/campaigns` prefix is protected (`src/middleware.ts:4`). Redirects unauthenticated users to `/auth/signin`.

### shadcn/ui Primitives (7 files in `src/components/ui/`)

| Component  | File             | Variants                                                              | Customizations                          |
| ---------- | ---------------- | --------------------------------------------------------------------- | --------------------------------------- |
| `Badge`    | `badge.tsx`      | 6 (`default`, `secondary`, `destructive`, `outline`, `ghost`, `link`) | `ghost` and `link` added (non-standard) |
| `Button`   | `button.tsx`     | 6 variants x 4 sizes                                                  | None (standard shadcn)                  |
| `Card`     | `card.tsx`       | 7 sub-components                                                      | None (standard shadcn)                  |
| `Input`    | `input.tsx`      | --                                                                    | None (standard shadcn)                  |
| `Label`    | `label.tsx`      | --                                                                    | None (standard shadcn)                  |
| `Textarea` | `textarea.tsx`   | --                                                                    | None (standard shadcn)                  |
| `LibBadge` | `LibBadge.astro` | --                                                                    | Custom Astro component, not shadcn      |

**Usage across feature components:**

- `Button` -- used by `auth/SubmitButton.tsx` only
- `Badge`, `Card`, `Input`, `Label`, `Textarea` -- **not imported by any feature component**

### Feature Components

#### Auth Components (`src/components/auth/`)

| Component        | Props                                                             | Composition                                                              | Notes                                   |
| ---------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------- |
| `FormField`      | `id, label, type, value, onChange, icon, endContent, error, hint` | Composable wrapper; receives `icon` and `endContent` as ReactNode        | Used by `SignInForm`, `SignUpForm` only |
| `PasswordToggle` | `visible, onToggle`                                               | Plugs into `FormField.endContent`                                        | Proper `aria-label`                     |
| `ServerError`    | `message?`                                                        | Conditional render; shared across 5 forms                                | No ARIA role                            |
| `SubmitButton`   | `pendingText, icon, children`                                     | Wraps shadcn `Button`; uses `useFormStatus()`                            | Only feature component using shadcn     |
| `SignInForm`     | `serverError?`                                                    | Composes `FormField` + `PasswordToggle` + `SubmitButton` + `ServerError` | Native form POST to `/api/auth/signin`  |
| `SignUpForm`     | `serverError?`                                                    | Same as SignInForm + confirm-password field                              | Dynamic password hint                   |

#### Campaign Components (`src/components/campaigns/`)

| Component               | Props                                           | Pattern                                                                              | Notes                                                |
| ----------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `CampaignCreateForm`    | `serverError?`                                  | Native form POST; inline SubmitButton sub-component                                  | Does NOT use `auth/FormField` or `auth/SubmitButton` |
| `AddInsightForm`        | `campaignId, serverError?`                      | Native form POST; inline SubmitButton; char counter                                  | Duplicates CampaignCreateForm patterns               |
| `AddSourceDocumentForm` | `campaignId, serverError?`                      | Native form POST; inline SubmitButton; char counter                                  | Duplicates AddInsightForm patterns                   |
| `GenerateIdeasPanel`    | `campaignId, hasDocuments`                      | State machine (idle/composing/generating/error); SSE via `consumeSSE`; `fetch()` API | `window.location.reload()` on success                |
| `IdeaActions`           | `ideaId, initialStatus, idea, refs`             | Optimistic PATCH for status; clipboard copy                                          | `e.stopPropagation()` on all handlers                |
| `IdeaPublication`       | `ideaId, status, publication`                   | Three render states (display/empty/edit); PUT/DELETE via `fetch()`                   | 7 useState hooks; `window.location.reload()` on save |
| `RegenerateForm`        | `campaignId, generationNumber, ideaId?, label?` | State machine (idle/editing/generating/error); SSE                                   | Similar pattern to GenerateIdeasPanel                |

#### Shared/Layout Components

| Component       | Type  | Purpose                                                                        |
| --------------- | ----- | ------------------------------------------------------------------------------ |
| `Welcome.astro` | Astro | Landing page hero with cosmic effects, 3 feature cards                         |
| `Topbar.astro`  | Astro | Nav bar; auth-aware (email + sign out vs. sign in/up links)                    |
| `Banner.astro`  | Astro | Notification banner (`info`/`warning`/`error`); uses scoped CSS (not Tailwind) |

### Component Pattern Issues

#### 1. Duplicated Form Infrastructure

Three campaign forms define identical constants rather than using the shared auth components:

```
// Duplicated in CampaignCreateForm.tsx:30-36, AddInsightForm.tsx:33-37, AddSourceDocumentForm.tsx:33-37
const inputClass = "w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 ...";
const inputErrorClass = "w-full rounded-lg border border-red-400/60 bg-white/10 ...";
const labelClass = "mb-1 block text-sm text-blue-100/80";
```

Each also defines its own inline `SubmitButton` with `useFormStatus()` rather than importing `auth/SubmitButton.tsx`.

#### 2. shadcn Primitives vs. Custom Styling

The project has two styling worlds:

- **shadcn/ui components** use CSS-variable-based theming (`--primary`, `--background`, etc. in oklch)
- **Feature components** use hardcoded Tailwind classes in the "cosmic" palette (`bg-white/10`, `text-purple-300`, `border-white/20`)

This means the shadcn `Input`, `Label`, and `Textarea` render with the standard theme (light backgrounds, dark text) while feature components render with the cosmic theme (glass backgrounds, light text). They are visually incompatible without customization.

#### 3. Two Form Paradigms

- **Pattern A (native HTML form):** `SignInForm`, `SignUpForm`, `CampaignCreateForm`, `AddInsightForm`, `AddSourceDocumentForm` -- `<form method="POST" action="...">` with `useFormStatus()` for pending state
- **Pattern B (fetch + state machine):** `GenerateIdeasPanel`, `RegenerateForm`, `IdeaActions`, `IdeaPublication` -- `fetch()` calls, manual loading state, `window.location.reload()` on success

Both paradigms are valid for their use cases (simple form submission vs. streaming SSE responses), but the reload-on-success pattern in Pattern B means the React component tree is fully remounted, losing scroll position.

#### 4. No Shared State Layer

No React Context, no state management library. All state is component-local `useState`. Cross-component communication happens via page reload (stale) or query parameters (`?error=`, `?success=`).

#### 5. Error Display Inconsistencies

Three different error patterns exist:

1. `ServerError` component -- red alert box with `CircleAlert` icon (auth + campaign forms)
2. Inline field errors -- small `text-xs text-red-300` below inputs (auth forms via `FormField`, campaign forms inline)
3. Inline error spans -- `text-xs text-red-400` in action areas (IdeaActions, IdeaPublication)

The `ServerError` component lacks `role="alert"` for accessibility.

### Styling Architecture

- **Tailwind CSS v4** via `@tailwindcss/vite` plugin (no JS config file; CSS-first via `@theme inline` in `global.css`)
- **Design tokens:** 28 CSS variables in oklch color space with light/dark variants (dark mode class-based but no toggle exists in UI)
- **Custom utility:** `@utility bg-cosmic` defines the app background gradient (`#0a0e1a` -> `#0f1529` -> `#0a0e1a`)
- **`cn()`** from `src/lib/utils.ts` (clsx + tailwind-merge) used in all shadcn components + `FormField`
- **Responsive breakpoints:** Mostly `sm:` (640px), limited `md:` and `lg:` usage; concentrated in `Welcome.astro` and page wrappers
- **Scoped CSS exception:** `Banner.astro` uses scoped `<style>` with hardcoded hex colors instead of Tailwind

### Campaign Detail Page Complexity

`src/pages/campaigns/[id].astro` is the largest file at 464 lines. It contains:

- 5 database queries (campaigns, documents, ideas, fragment references, publications)
- 6 React component islands with varying hydration strategies
- Inline status label/class maps duplicated from `src/lib/ideas/lifecycle.ts`
- Three major sections (Ideas, Source Documents, User Insights) all in one template

## Code References

- `src/layouts/Layout.astro:22` - Body with `bg-cosmic min-h-screen`
- `src/layouts/Layout.astro:40` - Topbar inclusion
- `src/middleware.ts:4` - `PROTECTED_ROUTES = ["/campaigns"]`
- `src/components/auth/FormField.tsx:5-6` - Shared input base class
- `src/components/auth/SubmitButton.tsx:15` - Only shadcn `Button` usage
- `src/components/campaigns/CampaignCreateForm.tsx:10-28` - Duplicated inline SubmitButton
- `src/components/campaigns/AddInsightForm.tsx:33-37` - Duplicated CSS constants
- `src/components/campaigns/GenerateIdeasPanel.tsx:56` - `window.location.reload()` pattern
- `src/components/campaigns/IdeaActions.tsx:26` - `e.stopPropagation()` pattern
- `src/pages/campaigns/[id].astro:113-118` - Inline status class map
- `src/styles/global.css:113-115` - `@utility bg-cosmic` definition
- `src/styles/global.css:75-111` - `@theme inline` Tailwind-CSS variable bridge
- `src/components/Banner.astro:15-42` - Scoped CSS exception
- `src/lib/ideas/lifecycle.ts:38-43` - Idea status badge classes

## Architecture Insights

1. **Astro islands pattern:** The project correctly uses Astro's island architecture -- pages are server-rendered `.astro` files, interactive parts are React components hydrated with `client:load` (immediate) or `client:visible` (lazy). This is sound for the app's complexity level.

2. **Progressive enhancement in forms:** Auth and campaign creation forms use native HTML form submission enhanced with React validation -- forms work even if JS fails. However, the AI interaction components (GenerateIdeasPanel, RegenerateForm) require JS entirely.

3. **No component library adoption:** Despite installing 6 shadcn/ui primitives, the feature code uses raw HTML elements with inline Tailwind. This creates maintenance overhead -- styling changes require touching every component rather than updating a primitive.

4. **Status badge duplication:** Campaign status classes are defined inline in `campaigns/[id].astro:113-118` and `campaigns/index.astro:47-55`, while idea status classes come from `src/lib/ideas/lifecycle.ts:38-43`. The campaign status classes are not centralized.

5. **Glassmorphism convention:** All card surfaces use `bg-white/5` or `bg-white/10` with `backdrop-blur-xl` and `border-white/10`. This is consistent but hardcoded in every usage site rather than extracted into a shared class or component.

## Historical Context (from prior changes)

Three archived changes involved UI work:

- `context/archive/2026-06-14-idea-review-and-copy/plan.md` - Added `IdeaActions` component with status badges and clipboard copy
- `context/archive/2026-07-11-idea-regeneration/plan.md` - Added `RegenerateForm` with SSE progress streaming
- `context/archive/2026-07-11-manual-idea-creation/plan.md` - Extended `GenerateIdeasPanel` with manual idea mode

Each change added new React islands to `campaigns/[id].astro` incrementally, contributing to its current 464-line size.

## Open Questions

1. **Should shadcn/ui primitives be adopted across feature components?** The installed `Input`, `Label`, `Textarea` etc. use the light/dark CSS variable system, but the app uses the "cosmic" dark palette. Adopting shadcn would require theming the primitives to match.
2. **Should `campaigns/[id].astro` be decomposed?** Its three sections (Ideas, Documents, Insights) could become separate Astro components to improve readability.
3. **Should the glassmorphism card pattern be extracted?** A shared `GlassCard` component (or Tailwind `@apply` utility) could reduce duplication across all card surfaces.
4. **Should campaign status classes be centralized?** Like idea status classes in `lifecycle.ts`, campaign status could have a shared module.
5. **Should `window.location.reload()` be replaced?** The current pattern causes full page reload after mutations. An alternative would be Astro's view transitions or partial hydration updates.
