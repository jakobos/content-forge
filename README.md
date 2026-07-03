# ContentForge

A web application for solo experts and consultants to transform raw material (reports, notes, thoughts) into structured, on-brand social media post ideas using AI.

## Features

- **Authentication** -- email/password sign-in and sign-up with Supabase Auth
- **Campaigns** -- organize content generation around goals and themes with lifecycle management (draft/active/completed/archived)
- **Documents** -- attach source documents and personal insights to campaigns for AI context
- **AI idea generation** -- batch-generate structured post ideas (title, hook, key points, source references) from campaign documents using RAG with Supabase pgvector
- **Manual idea creation** -- describe an idea and let AI structure it with relevant campaign document fragments
- **Idea review** -- review, accept, decline, or regenerate ideas; copy as markdown
- **Publication tracking** -- attach URL, platform, and date to published ideas

## Tech Stack

- [Astro](https://astro.build/) v6 -- server-first rendering with file-based routing
- [React](https://react.dev/) v19 -- interactive UI components
- [TypeScript](https://www.typescriptlang.org/) v5 -- strict mode, Zod at boundaries
- [Tailwind CSS](https://tailwindcss.com/) v4 -- utility-first styling with [shadcn/ui](https://ui.shadcn.com/) components
- [Supabase](https://supabase.com/) -- authentication, PostgreSQL database, pgvector for RAG
- [Cloudflare Workers](https://workers.cloudflare.com/) -- edge deployment runtime

## Prerequisites

- Node.js v22.14.0 (as specified in `.nvmrc`)
- npm (comes with Node.js)

## Getting Started

1. Clone the repository:

```bash
git clone <repository-url>
cd 10x3
```

2. Install dependencies:

```bash
npm install
```

3. Set up Supabase and configure environment variables -- see [Supabase Configuration](#supabase-configuration) below.

4. Create a `.dev.vars` file for local Cloudflare dev secrets:

```bash
cp .env.example .dev.vars
```

5. Run the development server:

```bash
npm run dev
```

## Available Scripts

- `npm run dev` -- start development server (Cloudflare workerd runtime)
- `npm run build` -- build for production (requires `SUPABASE_URL` and `SUPABASE_KEY`)
- `npm run lint` -- ESLint with strict TypeScript type-checking
- `npm run lint:fix` -- auto-fix lint issues
- `npm run format` -- Prettier (double quotes, semicolons, 120-char width)
- `npx astro sync` -- regenerate Astro types (run before lint or build)
- `npm run deploy` -- build + deploy to Cloudflare Workers

## Project Structure

```
src/
├── components/
│   ├── auth/           # React form components for auth flows
│   ├── campaigns/      # Campaign and document management UI
│   └── ui/             # shadcn/ui primitives
├── db/                 # Supabase database types
├── layouts/            # Astro layouts
├── lib/
│   ├── ai/             # AI generation and RAG utilities
│   ├── ideas/          # Idea management logic
│   ├── supabase.ts     # Per-request Supabase server client factory
│   └── utils.ts        # cn() class-merge utility
├── pages/
│   ├── api/
│   │   ├── ai/         # AI generation and embedding endpoints
│   │   ├── auth/       # Sign-in, sign-up, sign-out
│   │   ├── campaigns/  # Campaign and document CRUD
│   │   └── ideas/      # Idea status and publication endpoints
│   ├── auth/           # Auth pages (signin, signup, confirm-email)
│   └── campaigns/      # Campaign detail pages
├── middleware.ts        # Supabase client init, route protection
└── styles/             # Tailwind CSS entry point
```

## Supabase Configuration

This project uses [Supabase](https://supabase.com/) for authentication. Environment variables are declared via Astro's `astro:env` schema and are treated as **server-only secrets** — they are never exposed to the client.

### First-time setup (local, no cloud project needed)

Requires [Docker](https://www.docker.com/) and ~7 GB RAM.

1. Create your `.env` file:

```bash
cp .env.example .env
```

2. Initialize the local Supabase project (creates a `supabase/` config folder):

```bash
npx supabase init
```

3. Start the local stack (downloads Docker images on first run):

```bash
npx supabase start
```

4. Copy the credentials printed by the CLI into your `.env` and `.dev.vars`:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon key from CLI output>
```

5. To stop the stack when done:

```bash
npx supabase stop
```

The local Studio UI is available at `http://localhost:54323`.

No database tables or migrations are required — this project uses Supabase Auth's built-in `auth.users` table only.

### Using a cloud Supabase project instead

If you prefer to use a hosted Supabase project, add these variables to your `.env` and `.dev.vars` files:

| Variable       | Description                                                |
| -------------- | ---------------------------------------------------------- |
| `SUPABASE_URL` | Project URL from Supabase dashboard → Settings → API       |
| `SUPABASE_KEY` | `anon` public key from Supabase dashboard → Settings → API |

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_KEY=<anon-key>
```

### Email confirmation in local development

By default Supabase requires email confirmation before a user can sign in. To skip this during local development:

1. Open the Supabase dashboard for your project
2. Go to **Authentication → Email → Confirm email**
3. Toggle it **off**

Users can then sign in immediately after sign-up without clicking a confirmation link.

### Auth routes

| Route                 | Description                                                             |
| --------------------- | ----------------------------------------------------------------------- |
| `/auth/signin`        | Email/password sign-in form                                             |
| `/auth/signup`        | Email/password sign-up form                                             |
| `/auth/confirm-email` | Post-signup "check your inbox" page                                     |
| `/dashboard`          | Example protected page (redirects to `/auth/signin` if unauthenticated) |

Route protection is handled in `src/middleware.ts`. Add paths to the `PROTECTED_ROUTES` array there to require authentication.

## Deployment

This project deploys to [Cloudflare Workers](https://workers.cloudflare.com/).

- **Production URL:** `https://content-forge.jakub-skwara-js.workers.dev`
- **Auto-deploy:** Push to `master` triggers Cloudflare Workers Builds (build + deploy)
- **Preview deploys:** Branch pushes create preview versions at `https://<version-id>-content-forge.jakub-skwara-js.workers.dev`
- **Manual deploy:** `npm run deploy` (builds then deploys via Wrangler)
- **Rollback:** `npx wrangler rollback [version-id]`

### Secrets

Set runtime secrets via Wrangler:

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_KEY
```

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on every push and PR to `master`:

1. `npx astro sync` -- generate type definitions
2. `npm run lint` -- ESLint with type-checking
3. `npm run build` -- production build

Configure `SUPABASE_URL` and `SUPABASE_KEY` as repository secrets in GitHub.

Pre-commit hook runs `lint-staged` via Husky.

## License

MIT
