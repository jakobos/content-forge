# UI Enhancements: Ocean Breeze Theme Migration — Plan Brief

> Full plan: `context/changes/ui-enhancements/plan.md`
> Research: `context/changes/ui-enhancements/research.md`

## What & Why

ContentForge's UI uses a hardcoded "cosmic" dark palette (purple-600, blue-100/_, white/_) spread across 20+ files with no connection to the installed shadcn/ui semantic token system. This makes visual changes expensive (every file must be edited) and blocks future theming work. We're migrating to the Ocean Breeze palette via CSS semantic tokens, and extracting repeated patterns into reusable Tailwind utilities.

## Starting Point

The app has two disconnected color systems: shadcn CSS variables (28 oklch tokens with light/dark variants, unused by feature code) and hardcoded Tailwind classes everywhere. A glassmorphism card pattern is copy-pasted ~15 times. Campaign status badge classes are duplicated in two files. The body uses a hardcoded hex gradient (`bg-cosmic`) that overrides the theme's `bg-background`.

## Desired End State

All pages and components reference Ocean Breeze semantic tokens (`bg-primary`, `text-muted-foreground`, `border-border`) instead of hardcoded colors. The app is dark-only with a flat deep-ocean background. Reusable `glass-card` and `text-gradient` Tailwind utilities replace duplicated inline patterns. Campaign status classes are centralized in a lifecycle module. The visual identity shifts from cosmic purple to calm coastal blues.

## Key Decisions Made

| Decision      | Choice                                         | Why (1 sentence)                                                                      | Source   |
| ------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------- | -------- |
| Scope         | Theme migration + component extraction         | Addresses the core maintainability issue without the risk of a full overhaul.         | Plan     |
| Dark mode     | Dark-only (no toggle)                          | App is already permanently dark; wiring a toggle adds complexity with no user demand. | Plan     |
| Background    | Flat `--background` token                      | Consistent with the token system; `bg-cosmic` was the only hardcoded hex gradient.    | Plan     |
| Glass pattern | Tailwind `@utility glass-card`                 | Zero runtime cost, works in Astro and React, follows existing `bg-cosmic` precedent.  | Plan     |
| Headings      | Keep gradient, update to Ocean Breeze colors   | Preserves visual character that makes pages polished.                                 | Plan     |
| Status badges | Centralize in `src/lib/campaigns/lifecycle.ts` | DRY, mirrors existing `ideas/lifecycle.ts` pattern.                                   | Research |
| Landing decor | Update orbs/stars to Ocean Breeze palette      | Consistent visual language across entire app.                                         | Plan     |

## Scope

**In scope:**

- Replace CSS variables with Ocean Breeze dark-only values
- Remove `bg-cosmic` gradient, use flat `bg-background`
- Define `glass-card` and `text-gradient` Tailwind utilities
- Migrate all 7 pages and 16 components to semantic tokens
- Centralize campaign status badge classes
- Update Welcome.astro decorative elements

**Out of scope:**

- shadcn/ui primitive adoption in campaign forms
- Campaign detail page decomposition
- Accessibility fixes (aria-\*, roles)
- Light mode support / theme toggle
- Form component deduplication
- State management changes

## Architecture / Approach

Bottom-up migration: Phase 1 changes the CSS foundation (variables, utilities), then Phases 2-3 migrate consumers (Astro pages, then React components). Phase 4 polishes decorative elements and does a full visual check. Each phase is independently verifiable -- the app works at every intermediate state because old hardcoded classes still resolve in Tailwind even as we replace them.

## Phases at a Glance

| Phase                                             | What it delivers                                                                    | Key risk                                                                           |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1. Theme Foundation                               | Ocean Breeze CSS variables, `glass-card`/`text-gradient` utilities, flat background | Utility definitions may need tuning for the glassmorphism opacity/color balance    |
| 2. Token Adoption (Astro)                         | All 7 pages + 3 Astro components use semantic tokens                                | Visual regressions in campaign detail page (largest file, most color references)   |
| 3. Token Adoption (React) + Status Centralization | All 13 React components + campaign lifecycle module                                 | Subtle color mismatches in interactive components (buttons, spinners, focus rings) |
| 4. Visual Polish                                  | Updated landing page decorative elements, full regression check                     | Decorative orb/star colors may need manual tuning to feel "right"                  |

**Prerequisites:** None -- this is a self-contained styling change with no external dependencies.
**Estimated effort:** ~2-3 sessions across 4 phases.

## Open Risks & Assumptions

- The Ocean Breeze CSS values are approximations (the official theme is paywalled) -- colors may need manual adjustment if they don't look good together
- `glass-card` utility uses `bg-card/50` which assumes Tailwind v4 supports opacity modifiers on CSS-variable-backed colors -- needs verification in Phase 1
- Some hardcoded colors (status badges, blockquote borders) don't have direct semantic token equivalents and will need approximation

## Success Criteria (Summary)

- All pages render with a cohesive Ocean Breeze palette -- no leftover purple/blue-100 hardcoded colors visible
- `npm run build` and `npm run lint` pass with zero errors
- The glassmorphism card pattern appears in exactly one place (`glass-card` utility) instead of ~15
