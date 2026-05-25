# Repository Guidelines

ContentForge is an Astro 6 / React 19 web app with Supabase auth, deployed on Cloudflare Workers. TypeScript strict mode, Tailwind CSS v4, shadcn/ui (new-york style).

## Hard Rules

- Run `npx astro sync` before lint or build -- it generates required type definitions in `.astro/`.
- Never commit `.env`, `.dev.vars`, or Supabase secrets.
- No test framework is configured. Do not generate test files or assume any test runner exists.
- The Supabase client can be `null` when env vars are missing. Always handle the null case -- see `@src/lib/supabase.ts`.
- Default branch is `master`, not `main`.
- API endpoint convention: see `@src/pages/api/auth/signin.ts`.

## Commands

- `npm run dev` -- Cloudflare workerd-based dev server
- `npm run build` -- production build (requires `SUPABASE_URL` and `SUPABASE_KEY`)
- `npm run lint` -- ESLint with strict TypeScript type-checking
- `npm run lint:fix` -- auto-fix lint issues
- `npm run format` -- Prettier (double quotes, semicolons, 120-char width)
- `npx astro sync` -- regenerate Astro types after env schema or content changes
- `npx wrangler deploy` -- deploy to Cloudflare Workers

CI gate (`@.github/workflows/ci.yml`): `astro sync` -> `lint` -> `build`. No test step. Pre-commit hook runs `lint-staged` via Husky.

## Project Structure

- `src/pages/` -- file-based routing; Astro pages for UI, `api/` subdirectory for server endpoints
- `src/components/auth/` -- React form components for auth flows
- `src/components/ui/` -- shadcn/ui primitives; add new ones with `npx shadcn@latest add <component>`
- `src/lib/supabase.ts` -- per-request Supabase server client factory
- `src/lib/utils.ts` -- `cn()` class-merge utility
- `src/middleware.ts` -- Supabase client init, sets `context.locals.user`, route protection via `PROTECTED_ROUTES` array
- `src/styles/global.css` -- Tailwind CSS entry point
- `context/foundation/` -- product spec (`@context/foundation/prd.md`) and stack decisions (`@context/foundation/tech-stack.md`)

## Coding Conventions

- Path alias `@/` maps to `src/` -- use for all imports
- `no-console` is a warning; remove console statements before committing
- Prettier config: `@.prettierrc.json`. ESLint config: `@eslint.config.js`
- ESLint includes `react-compiler` (error) and `jsx-a11y` accessibility rules

## Environment & Secrets

- Copy `.env.example` to `.env` (Astro) and `.dev.vars` (Wrangler) for local dev
- `SUPABASE_URL` and `SUPABASE_KEY` are server-only secrets via `astro:env` schema in `@astro.config.mjs`; optional -- app degrades gracefully without them

## Auth Architecture

- Protected routes: add paths to `PROTECTED_ROUTES` in `@src/middleware.ts`
- Pages in `src/pages/auth/`, React forms in `src/components/auth/`, API handlers in `src/pages/api/auth/`
- Auth errors passed as `?error=` query parameters
