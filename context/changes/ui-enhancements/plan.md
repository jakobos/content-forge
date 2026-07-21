# UI Enhancements: Ocean Breeze Theme Migration & Component Extraction

## Overview

Migrate ContentForge from the hardcoded "cosmic" dark palette (purple-600, blue-100/_, white/_) to the Ocean Breeze semantic token system, extract repeated UI patterns into reusable Tailwind utilities and shared modules, and update decorative elements to match the new coastal palette. The app remains dark-only (no light mode toggle).

## Current State Analysis

The app has **two disconnected color systems**:

1. **shadcn/ui CSS variables** -- 28 oklch tokens defined in `src/styles/global.css:6-73` with both `:root` (light) and `.dark` (dark) variants. These power `bg-primary`, `text-muted-foreground`, etc. via the `@theme inline` bridge at lines 75-111.
2. **Hardcoded "cosmic" palette** -- every feature component and page uses raw Tailwind classes: `purple-600` for buttons, `blue-100/70` for muted text, `white/10` for glass surfaces. No feature code references the semantic tokens.

The body background is a custom `@utility bg-cosmic` (`global.css:113-115`) with hardcoded hex values `#0a0e1a` -> `#0f1529` -> `#0a0e1a`, overriding the `bg-background` token set in the base layer.

The glassmorphism card pattern (`bg-white/5 border-white/10 backdrop-blur-xl`) is copy-pasted ~15 times across pages. The gradient heading pattern (`from-blue-200 via-purple-200 to-pink-200`) appears on 5+ pages. Campaign status badge classes are duplicated inline in `campaigns/index.astro:53-57` and `campaigns/[id].astro:113-118`.

### Key Discoveries:

- `src/styles/global.css:4` -- dark mode variant exists (`@custom-variant dark`) but Layout.astro never applies the `.dark` class
- `src/layouts/Layout.astro:22` -- body uses `bg-cosmic min-h-screen`, not `bg-background`
- `src/components/auth/FormField.tsx:5-6` -- auth input styling is centralized in `inputBase` constant
- `src/components/campaigns/CampaignCreateForm.tsx:31-36` -- campaign forms duplicate identical CSS constants instead of sharing
- `src/lib/ideas/lifecycle.ts:38-43` -- idea status classes are centralized; campaign status classes are not
- `src/components/Banner.astro:15-42` -- only component using scoped CSS with raw hex colors (light palette), inconsistent with the dark theme
- No file in `src/components/campaigns/` uses `cn()` -- all use raw className strings

## Desired End State

After this plan:

- All CSS variables in `global.css` use Ocean Breeze dark values as the default (no `.dark` class needed)
- The `bg-cosmic` gradient is replaced by a flat `bg-background` from the token system
- New `@utility` classes exist for `glass-card` and `text-gradient` patterns, used everywhere the patterns previously appeared inline
- All pages and components reference semantic tokens (`bg-primary`, `text-muted-foreground`, `border-border`, etc.) instead of hardcoded purple/blue/white classes
- Campaign status badge classes live in `src/lib/campaigns/lifecycle.ts`, mirroring the ideas pattern
- Welcome.astro decorative elements use Ocean Breeze-derived colors
- Banner.astro uses Tailwind classes consistent with the rest of the app

**Verification**: `npm run build` succeeds, `npm run lint` passes, all pages render correctly with the new palette (manual visual check).

## What We're NOT Doing

- **No shadcn/ui primitive adoption** -- campaign forms keep using raw HTML inputs with Tailwind classes (no migration to shadcn `Input`, `Label`, `Textarea`)
- **No campaign detail page decomposition** -- `campaigns/[id].astro` stays as a single 464-line file
- **No accessibility fixes** -- missing `aria-invalid`, `aria-describedby`, `role="alert"`, `<nav>` wrappers are out of scope
- **No light mode support** -- no `.dark` class toggle, no light/dark switching
- **No form component deduplication** -- campaign forms keep their own inline SubmitButton and input constants (just with updated colors)
- **No state management changes** -- `window.location.reload()` patterns stay as-is

## Implementation Approach

Bottom-up: change the theme foundation first (CSS variables, utilities), then migrate pages and components to use the new tokens. This way each subsequent phase benefits from the utilities defined in the first phase.

The color mapping strategy:

| Cosmic palette              | Ocean Breeze token                                               | Usage                   |
| --------------------------- | ---------------------------------------------------------------- | ----------------------- |
| `purple-600` / `purple-500` | `--primary` (oklch 0.72 0.10 230 -- sea blue)                    | Primary buttons, CTA    |
| `purple-300` / `purple-100` | `--primary` with opacity or `--accent`                           | Links, icons, badges    |
| `blue-100/{30-80}`          | `--muted-foreground` (oklch 0.65 0.04 230)                       | Muted/secondary text    |
| `white`                     | `--foreground` (oklch 0.93 0.02 230 -- sea foam)                 | Primary text, headings  |
| `white/5`, `white/10`       | `--border` (oklch 1 0 0 / 10%) and `--input` (oklch 1 0 0 / 15%) | Glass surfaces, borders |
| `red-300/400/500`           | `--destructive` (oklch 0.704 0.191 22.216)                       | Errors                  |
| `bg-cosmic` hex gradient    | `--background` (oklch 0.18 0.03 230 -- deep ocean)               | Page background         |

---

## Phase 1: Theme Foundation

### Overview

Replace CSS variables with Ocean Breeze dark-only values, remove the unused light mode definitions, replace `bg-cosmic` with flat `bg-background`, and define reusable `@utility` classes for the glassmorphism card and gradient heading patterns.

### Changes Required:

#### 1. Ocean Breeze CSS Variables

**File**: `src/styles/global.css`

**Intent**: Replace the current `:root` (light) and `.dark` (dark) variable blocks with a single `:root` block containing Ocean Breeze dark values. Remove the `.dark` selector and the `@custom-variant dark` declaration since the app is dark-only.

**Contract**: The `:root` block uses the dark-mode values from `context/foundation/shadcn-ocean-breeze-theme.md` (lines 56-74). The `@theme inline` bridge (lines 75-111) stays unchanged -- it already maps all CSS variables to Tailwind tokens. The `--border` and `--input` tokens use oklch with alpha transparency (`oklch(1 0 0 / 10%)`, `oklch(1 0 0 / 15%)`), matching the existing glassmorphism convention.

#### 2. Remove bg-cosmic, Define glass-card and text-gradient Utilities

**File**: `src/styles/global.css`

**Intent**: Remove the `@utility bg-cosmic` definition. Add two new `@utility` definitions:

- `glass-card` -- encapsulates the glassmorphism card pattern currently duplicated across pages
- `text-gradient` -- encapsulates the gradient heading pattern with Ocean Breeze-derived colors

**Contract**:

```css
@utility glass-card {
  @apply border-border bg-card/50 rounded-xl border backdrop-blur-xl;
}

@utility text-gradient {
  @apply from-primary via-accent to-primary/70 bg-gradient-to-r bg-clip-text text-transparent;
}
```

The `glass-card` maps `border-white/10` -> `border-border`, `bg-white/5` -> `bg-card/50` (card token at 50% opacity for the translucent effect). The `text-gradient` replaces `from-blue-200 via-purple-200 to-pink-200` with Ocean Breeze sea-blue/mist tones derived from `--primary` and `--accent` tokens.

#### 3. Update Layout Body Class

**File**: `src/layouts/Layout.astro`

**Intent**: Replace `bg-cosmic` with `bg-background` on the body element so the page background uses the Ocean Breeze deep ocean token.

**Contract**: Change `<body class="bg-cosmic min-h-screen">` to `<body class="bg-background min-h-screen">`.

### Success Criteria:

#### Automated Verification:

- Astro types generate cleanly: `npx astro sync`
- Lint passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Open `npm run dev` and verify: background is a flat deep ocean blue (not the old gradient), no visible color regressions on existing pages (they still use hardcoded classes at this point, which is expected)
- Verify `glass-card` and `text-gradient` classes are available in Tailwind (test by temporarily adding to an element)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Token Adoption in Astro Pages & Components

### Overview

Migrate all Astro pages (7) and Astro components (Topbar, Banner, Welcome) from hardcoded cosmic palette classes to Ocean Breeze semantic tokens and the new `glass-card` / `text-gradient` utilities.

### Changes Required:

#### 1. Auth Pages

**Files**: `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`, `src/pages/auth/confirm-email.astro`

**Intent**: Replace hardcoded color classes with semantic tokens. Use `glass-card` utility for the card container. Use `text-gradient` for the gradient heading. Replace `text-purple-300` links with `text-primary`, `text-blue-100/60` with `text-muted-foreground`.

**Contract**: Each auth page has the same pattern -- a centered glass card with a gradient heading. Map: `bg-white/10 border-white/10 backdrop-blur-xl` -> `glass-card`, `from-blue-200 to-purple-200` -> `text-gradient`, `text-blue-100/60` -> `text-muted-foreground`, `text-purple-300` -> `text-primary`. Remove `bg-cosmic` from `signin.astro:9` and `signup.astro:9` (no longer needed since Layout.astro handles background).

#### 2. Campaign Pages

**Files**: `src/pages/campaigns/index.astro`, `src/pages/campaigns/new.astro`, `src/pages/campaigns/[id].astro`

**Intent**: Replace all hardcoded color classes across the three campaign pages with semantic tokens. Use `glass-card` for card containers. Use `text-gradient` for gradient headings. Replace muted text, links, borders, and accent colors with their token equivalents.

**Contract**: The color mapping table from the Implementation Approach section applies. Key replacements:

- `text-white` -> `text-foreground`
- `text-blue-100/*` (all opacity variants) -> `text-muted-foreground`
- `text-purple-300` / `hover:text-purple-100` -> `text-primary` / `hover:text-primary/80`
- `bg-purple-600` / `hover:bg-purple-500` -> `bg-primary` / `hover:bg-primary/90`
- `border-white/10 bg-white/5 backdrop-blur-xl` -> `glass-card`
- `hover:border-white/20 hover:bg-white/10` -> `hover:border-border/50 hover:bg-card/70`
- `from-blue-200 via-purple-200` -> `text-gradient`
- Status badge classes in `index.astro:53-57` and `[id].astro:113-118` -> import from the centralized module (created in Phase 3)
- Blockquote left borders (`blue-400/40`, `amber-400/40`, `purple-500/40`) -> `border-primary/40`, `border-accent/40`, `border-ring/40`
- Success/error banners in `[id].astro:153-160` -> use destructive token for errors, primary token for success

#### 3. Topbar Component

**File**: `src/components/Topbar.astro`

**Intent**: Replace hardcoded colors with semantic tokens. The topbar container uses the glass pattern.

**Contract**: `bg-white/5 border-white/10` -> `glass-card` (or inline `border-border bg-card/50 backdrop-blur-xl` if rounded corners from `glass-card` are unwanted on the topbar), `text-white/80` -> `text-foreground/80`, `text-blue-100/70` -> `text-muted-foreground`, `text-purple-300 hover:text-purple-100` -> `text-primary hover:text-primary/80`, `text-white` -> `text-foreground`.

#### 4. Banner Component

**File**: `src/components/Banner.astro`

**Intent**: Replace scoped CSS with raw hex colors with Tailwind utility classes using semantic tokens, making Banner consistent with the rest of the app.

**Contract**: Convert the scoped `<style>` block (lines 15-42) to Tailwind classes on the element. The banner should use the dark theme's surfaces -- e.g., info: `bg-primary/10 text-primary border-primary/30`, warning: `bg-accent/20 text-accent border-accent/40`, error: `bg-destructive/10 text-destructive border-destructive/30`. Remove the scoped `<style>` block entirely.

### Success Criteria:

#### Automated Verification:

- Astro types generate cleanly: `npx astro sync`
- Lint passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- All auth pages (signin, signup, confirm-email) render with Ocean Breeze palette -- sea-blue headings, muted-foreground body text, primary-colored links
- Campaign list page renders with sea-blue buttons and glass cards
- Campaign detail page renders with properly colored sections, badges, blockquotes
- Topbar renders with correct glass background and sea-blue links
- Banner component renders correctly for info, warning, and error variants
- No visible color regressions on any page

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Token Adoption in React Components & Status Centralization

### Overview

Migrate all 13 React components from hardcoded cosmic palette classes to Ocean Breeze semantic tokens. Create `src/lib/campaigns/lifecycle.ts` to centralize campaign status badge classes (mirroring the existing `src/lib/ideas/lifecycle.ts` pattern).

### Changes Required:

#### 1. Auth React Components

**Files**: `src/components/auth/FormField.tsx`, `src/components/auth/SubmitButton.tsx`, `src/components/auth/ServerError.tsx`, `src/components/auth/SignInForm.tsx`, `src/components/auth/SignUpForm.tsx`

**Intent**: Replace hardcoded color classes with semantic tokens across all auth components.

**Contract**: Key replacements in FormField (`inputBase` constant at line 5-6 is the central choke point):

- `bg-white/10` -> `bg-input`
- `text-white` -> `text-foreground`
- `placeholder-white/40` -> `placeholder:text-muted-foreground/60`
- `border-white/20` -> `border-input`
- `focus:ring-purple-400` -> `focus:ring-ring`
- `border-red-400/60` -> `border-destructive/60`
- `focus:ring-red-400` -> `focus:ring-destructive`
- `text-blue-100/80` (label) -> `text-muted-foreground`
- `text-white/40` (icon) -> `text-muted-foreground/60`
- `text-red-300` (error) -> `text-destructive`

In SubmitButton: `bg-purple-600 hover:bg-purple-500 text-white` -> `bg-primary hover:bg-primary/90 text-primary-foreground`. Spinner: `border-white/30 border-t-white` -> `border-primary-foreground/30 border-t-primary-foreground`.

In ServerError: `border-red-500/30 bg-red-900/30 text-red-300` -> `border-destructive/30 bg-destructive/10 text-destructive`.

In SignUpForm: `text-blue-100/50` (password hint) -> `text-muted-foreground/70`.

#### 2. Campaign Form Components

**Files**: `src/components/campaigns/CampaignCreateForm.tsx`, `src/components/campaigns/AddInsightForm.tsx`, `src/components/campaigns/AddSourceDocumentForm.tsx`

**Intent**: Replace the duplicated CSS constants (`inputClass`, `inputErrorClass`, `labelClass`) and inline SubmitButton styling in all three forms with semantic token equivalents.

**Contract**: The same token mappings as auth components apply. Each file has its own `inputClass`/`inputErrorClass`/`labelClass` constants -- update all three sets identically. Inline SubmitButton styling in each file follows the same pattern as `auth/SubmitButton.tsx` replacements.

#### 3. Campaign Interactive Components

**Files**: `src/components/campaigns/GenerateIdeasPanel.tsx`, `src/components/campaigns/RegenerateForm.tsx`, `src/components/campaigns/IdeaActions.tsx`, `src/components/campaigns/IdeaPublication.tsx`

**Intent**: Replace all hardcoded color classes with semantic tokens.

**Contract**: Key replacements across these files:

- `text-blue-100/*` (all opacity variants) -> `text-muted-foreground` (with appropriate opacity when needed)
- `bg-purple-600/20 text-purple-300 hover:bg-purple-600/30` (secondary buttons) -> `bg-primary/20 text-primary hover:bg-primary/30`
- `bg-purple-600/30 text-purple-200 hover:bg-purple-600/50` (CTA buttons) -> `bg-primary/30 text-primary-foreground hover:bg-primary/50`
- `border-white/10 bg-white/5 text-white` (inputs) -> `border-input bg-input text-foreground`
- `focus:ring-purple-500` / `focus:border-purple-500/50` -> `focus:ring-ring` / `focus:border-ring/50`
- `border-purple-400 border-t-transparent` (spinner) -> `border-primary border-t-transparent`
- `text-red-300` / `text-red-400` -> `text-destructive`
- `border-purple-500/30 bg-purple-500/10 text-purple-300` (action buttons) -> `border-primary/30 bg-primary/10 text-primary`
- `border-red-500/20 bg-red-500/5 text-red-400` (destructive buttons) -> `border-destructive/20 bg-destructive/5 text-destructive`
- `text-purple-300 hover:text-purple-100` -> `text-primary hover:text-primary/80`
- `placeholder-blue-100/30` / `placeholder:text-blue-100/30` -> `placeholder:text-muted-foreground/50`
- `border-white/10 bg-white/5` (glass surfaces) -> `border-border bg-card/50` or apply `glass-card` where appropriate
- `hover:bg-white/10` / `hover:bg-white/5` -> `hover:bg-card/70` / `hover:bg-card/50`

#### 4. Centralize Campaign Status Classes

**File**: `src/lib/campaigns/lifecycle.ts` (new file)

**Intent**: Create a campaign lifecycle module mirroring `src/lib/ideas/lifecycle.ts`, centralizing the status badge classes and labels that are currently duplicated inline in two Astro pages.

**Contract**: Export a `CAMPAIGN_STATUS_CLASS` record and a `CAMPAIGN_STATUS_LABEL` record, typed against the campaign status enum. The badge classes should use Ocean Breeze tokens instead of the current hardcoded slate/green/purple/gray values. The two Astro pages that currently define inline status maps (`campaigns/index.astro` and `campaigns/[id].astro`) import from this module instead.

#### 5. Update Idea Status Badge Classes

**File**: `src/lib/ideas/lifecycle.ts`

**Intent**: Update the `IDEA_STATUS_CLASS` record to use Ocean Breeze-aligned colors instead of hardcoded palette colors.

**Contract**: The badge class strings at lines 38-43 should align with the new palette. The semantic structure stays the same (`bg-{color} text-{color} border-{color}`), but the specific Tailwind color classes should use tokens or Ocean Breeze-compatible values.

### Success Criteria:

#### Automated Verification:

- Astro types generate cleanly: `npx astro sync`
- Lint passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Auth forms (signin, signup) render with Ocean Breeze colors -- sea-blue focus rings, properly colored labels and errors
- Campaign creation form renders with correct token-based styling
- Campaign detail page: all interactive components (GenerateIdeasPanel, IdeaActions, IdeaPublication, RegenerateForm) render correctly
- Add Insight and Add Source Document forms render properly
- Status badges on campaign list and detail pages show consistent colors from the centralized module
- Idea status badges render with updated colors

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Visual Polish & Verification

### Overview

Update the Welcome.astro landing page decorative elements to match the Ocean Breeze palette, and do a final full-app visual regression check.

### Changes Required:

#### 1. Update Welcome.astro Decorative Elements

**File**: `src/components/Welcome.astro`

**Intent**: Update the three cosmic orb blurs and the star field background to use Ocean Breeze-aligned colors. Update feature card colors to use semantic tokens.

**Contract**: Orb color mapping:

- `bg-purple-500/20` -> `bg-primary/20` (sea blue orb)
- `bg-blue-500/15` -> `bg-accent/15` (morning mist orb)
- `bg-indigo-400/10` -> `bg-secondary/10` (sandy warm orb)

Star field: update the `rgba(255,255,255,...)` values in the inline style to use lower opacity to match the Ocean Breeze muted aesthetic (e.g., 0.10/0.07/0.04 instead of 0.15/0.1/0.07).

Feature card styling: `text-purple-300` (icons) -> `text-primary`, `text-white` (titles) -> `text-foreground`, `text-blue-100/60` (body) -> `text-muted-foreground`, `border-white/10 bg-white/5 backdrop-blur-xl` -> `glass-card`.

CTA buttons: Sign In `bg-purple-600 hover:bg-purple-500 text-white` -> `bg-primary hover:bg-primary/90 text-primary-foreground`. Sign Up `border-white/20 text-white hover:bg-white/10` -> `border-border text-foreground hover:bg-card/50`.

Heading gradient: `from-blue-200 via-purple-200 to-pink-200` -> `text-gradient`.

#### 2. Full Visual Regression Check

**Intent**: Verify every page in the app renders correctly with the complete Ocean Breeze palette.

**Contract**: No code changes -- this is a manual verification step.

### Success Criteria:

#### Automated Verification:

- Astro types generate cleanly: `npx astro sync`
- Lint passes: `npm run lint`
- Build succeeds: `npm run build`
- Format check passes: `npm run format`

#### Manual Verification:

- Welcome/landing page renders with Ocean Breeze orbs, star field, and feature cards
- Sign in, sign up, confirm email pages look cohesive
- Campaign list, new campaign, campaign detail pages look cohesive
- All buttons, links, badges, forms, and interactive elements use the Ocean Breeze palette consistently
- No leftover purple/blue-100 hardcoded colors visible anywhere
- The app feels like a unified "ocean breeze" theme -- sea blues, sandy neutrals, morning mist accents

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before marking the change as complete.

---

## Testing Strategy

### Unit Tests:

No test framework is configured. No unit tests.

### Integration Tests:

No test framework is configured. No integration tests.

### Manual Testing Steps:

1. Run `npm run dev` and visit every page: `/`, `/auth/signin`, `/auth/signup`, `/auth/confirm-email`, `/campaigns`, `/campaigns/new`, `/campaigns/:id`
2. Verify background is flat deep ocean blue (not gradient)
3. Verify all headings use the sea-blue gradient
4. Verify all cards use the glass-card pattern with consistent borders
5. Verify all buttons use sea-blue primary color
6. Verify all muted text uses the muted-foreground token
7. Verify status badges render correctly on campaign list and detail pages
8. Verify form inputs, error states, and validation messages use correct colors
9. Verify interactive components (generate ideas, regenerate, idea actions, publication) work and look correct
10. Verify Welcome page orbs and star field match the Ocean Breeze aesthetic
11. Run `npm run build` to confirm production build succeeds

## Performance Considerations

No performance impact expected. The change is purely cosmetic -- CSS variable values change, inline classes change, but no new JS, no new components, no new network requests. The `glass-card` and `text-gradient` utilities compile to the same CSS as the inline classes they replace.

## References

- Ocean Breeze theme reference: `context/foundation/shadcn-ocean-breeze-theme.md`
- Codebase audit: `context/changes/ui-enhancements/research.md`
- Ideas lifecycle pattern to mirror: `src/lib/ideas/lifecycle.ts`
- shadcn theming docs: `context/foundation/shadcn-ocean-breeze-theme.md:79-114`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Theme Foundation

#### Automated

- [x] 1.1 Astro types generate cleanly after CSS variable changes — 78ec8ef
- [x] 1.2 Lint passes after CSS variable changes — 78ec8ef
- [x] 1.3 Build succeeds after CSS variable changes — 78ec8ef

#### Manual

- [ ] 1.4 Background is flat deep ocean blue, no gradient
- [ ] 1.5 glass-card and text-gradient utilities available and working

### Phase 2: Token Adoption in Astro Pages & Components

#### Automated

- [x] 2.1 Astro types generate cleanly after page migrations
- [x] 2.2 Lint passes after page migrations
- [x] 2.3 Build succeeds after page migrations

#### Manual

- [ ] 2.4 Auth pages render with Ocean Breeze palette
- [ ] 2.5 Campaign pages render with Ocean Breeze palette
- [ ] 2.6 Topbar renders with correct glass background and sea-blue links
- [ ] 2.7 Banner component renders correctly for all variants

### Phase 3: Token Adoption in React Components & Status Centralization

#### Automated

- [ ] 3.1 Astro types generate cleanly after component migrations
- [ ] 3.2 Lint passes after component migrations
- [ ] 3.3 Build succeeds after component migrations

#### Manual

- [ ] 3.4 Auth forms render with Ocean Breeze colors
- [ ] 3.5 Campaign forms render with token-based styling
- [ ] 3.6 Interactive components render correctly
- [ ] 3.7 Status badges show consistent colors from centralized module

### Phase 4: Visual Polish & Verification

#### Automated

- [ ] 4.1 Astro types generate cleanly
- [ ] 4.2 Lint passes
- [ ] 4.3 Build succeeds
- [ ] 4.4 Format check passes

#### Manual

- [ ] 4.5 Welcome page renders with Ocean Breeze decorative elements
- [ ] 4.6 Full app visual regression check passes -- unified Ocean Breeze theme
