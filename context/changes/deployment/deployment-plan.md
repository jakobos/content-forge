# ContentForge — Cloudflare Integration & Deployment Plan

> **For agentic workers:** Use this plan phase-by-phase. Each step uses checkbox (`- [ ]`) syntax for tracking. Phases are sequential — complete each before moving to the next.

**Goal:** Take ContentForge from "builds locally, deploys manually" to a production-ready Cloudflare Workers deployment with auto-deploy on push to `master` via Cloudflare Workers Builds.

**Architecture:** Cloudflare Workers Builds handles auto-deploy from Git (push to `master` = production deploy, branches = preview URLs). Existing GitHub Actions CI pipeline is kept for PR validation (lint + build gate). Secrets are managed via Wrangler CLI as Worker Secrets (runtime-only).

**Tech Stack:** Astro 6 + `@astrojs/cloudflare` v13.5 + Wrangler v4.90 + Cloudflare Workers Builds (Git integration)

**Source:** `context/foundation/infrastructure.md` (researched 2026-05-23)

---

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| CI/CD | Cloudflare Workers Builds (Git integration) | Native auto-deploy on push to master, branch previews |
| GitHub Actions CI | Keep as-is for PR validation | lint + build gate before merge; Workers Builds handles deploy |
| Hyperdrive | Deferred | Current Supabase client uses REST API; Hyperdrive only helps direct Postgres connections |
| Domain | `content-forge.workers.dev` for MVP | Custom domain added later |
| Log persistence | Deferred | `wrangler tail` for now; R2 Log Push added when needed |
| Preview deploys | Via Workers Builds branch deploys | Automatic preview URLs per branch |

---

## Phase 0: Prerequisites

**Goal:** Ensure all CLIs, accounts, and local config are in place before any deployment work begins.

### 0.1 Node.js

- [ ] **0.1.1** Install Node.js v22.14.0 (the version pinned in `.nvmrc`)

  ```bash
  # Using nvm:
  nvm install 22.14.0
  nvm use

  # Or using fnm:
  fnm install 22.14.0
  fnm use
  ```

  > The project pins Node 22.14.0 via `.nvmrc`. CI uses Node 22 (`ci.yml`). Workers Builds also reads `.nvmrc`. Using a different major version (e.g., v24) can cause subtle build differences — especially with native module resolution and `workerd` compatibility. Always run `node -v` in the project directory to confirm.

- [ ] **0.1.2** Verify Node version is active

  ```bash
  node -v
  # Expected: v22.14.0
  ```

### 0.2 npm & project dependencies

- [ ] **0.2.1** Install project dependencies

  ```bash
  npm ci
  ```

  > Uses `npm ci` (not `npm install`) to get a deterministic install from `package-lock.json`. This matches what CI and Workers Builds will do.

- [ ] **0.2.2** Verify key CLIs are available via npx (installed as devDependencies)

  ```bash
  npx wrangler --version
  # Expected: 4.90.x or later (from package.json: "wrangler": "^4.90.0")

  npx supabase --version
  # Expected: 2.23.x or later (from package.json: "supabase": "^2.23.4")

  npx astro --version
  # Expected: 6.3.x or later (from package.json: "astro": "^6.3.1")
  ```

  > Wrangler and Supabase CLI are project-local devDependencies — no global install needed. Always use `npx` to run them so you get the version pinned in `package.json`.

### 0.3 Cloudflare account & Wrangler authentication

- [ ] **0.3.1** Create a Cloudflare account (if you don't have one)

  1. Go to [https://dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up)
  2. Verify your email
  3. The free plan is sufficient for MVP (100k requests/day)

- [ ] **0.3.2** Authenticate Wrangler with your Cloudflare account

  ```bash
  npx wrangler login
  ```

  > Opens a browser window for OAuth. After authorizing, Wrangler stores credentials locally at `~/.wrangler/config/default.toml`. This is a one-time setup per machine.

- [ ] **0.3.3** Verify authentication works

  ```bash
  npx wrangler whoami
  ```

  > Should display your account name and account ID. Note the **Account ID** — you may need it later for API tokens.

**Edge case support step:**
- [ ] **0.3.4** If `wrangler login` fails (e.g., headless environment, WSL without browser):

  1. Create an API token manually at [https://dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
  2. Use the **Edit Cloudflare Workers** template
  3. Set the token as an environment variable:
     ```bash
     export CLOUDFLARE_API_TOKEN="your-token-here"
     ```
  4. Verify with `npx wrangler whoami`

### 0.4 Supabase project setup

- [ ] **0.4.1** Create a Supabase project (if you don't have one)

  1. Go to [https://supabase.com/dashboard](https://supabase.com/dashboard)
  2. Click **New project**
  3. Choose organization, set project name (e.g., `content-forge`), database password, and region
  4. Wait for the project to provision (takes ~2 minutes)

- [ ] **0.4.2** Retrieve your Supabase credentials

  1. In Supabase Dashboard, go to **Settings** > **API**
  2. Copy **Project URL** — this is your `SUPABASE_URL`
  3. Copy **anon public** key under **Project API keys** — this is your `SUPABASE_KEY`

  > The `anon` key is safe for server-side use with Row Level Security (RLS) enabled. Do NOT use the `service_role` key unless you explicitly need to bypass RLS.

- [ ] **0.4.3** (Optional) Link the Supabase CLI to your remote project

  ```bash
  npx supabase login
  # Paste your Supabase access token when prompted (generate at https://supabase.com/dashboard/account/tokens)

  npx supabase link --project-ref <your-project-ref>
  # The project ref is the subdomain part of your SUPABASE_URL:
  # https://<project-ref>.supabase.co
  ```

  > Linking enables `supabase db push`, `supabase db pull`, and migration management against your remote project. Not strictly required for deployment, but needed for any future database schema work.

**Edge case support step:**
- [ ] **0.4.4** If you want to run Supabase locally (requires Docker):

  ```bash
  # Verify Docker is running
  docker info

  # Start local Supabase stack
  npx supabase start
  ```

  > Local Supabase runs on ports 54321 (API), 54322 (Postgres), 54323 (Studio), 54324 (Inbucket for email testing). The local `config.toml` is at `supabase/config.toml`. Local credentials are printed by `supabase start` — use those for `.env` and `.dev.vars` during local development.

### 0.5 Local environment files

- [ ] **0.5.1** Create `.env` from the example template

  ```bash
  cp .env.example .env
  ```

  Then edit `.env` and replace `###` with your actual Supabase credentials:

  ```
  SUPABASE_URL=https://<project-ref>.supabase.co
  SUPABASE_KEY=eyJ...your-anon-key
  ```

  > `.env` is read by Astro's dev server. It's gitignored — never commit it.

- [ ] **0.5.2** Create `.dev.vars` with the same credentials

  ```bash
  cp .env .dev.vars
  ```

  > `.dev.vars` is read by Wrangler when running `astro dev` with the Cloudflare adapter (workerd runtime). It uses the same format as `.env`. Also gitignored.

- [ ] **0.5.3** Verify both files are gitignored

  ```bash
  git check-ignore .env .dev.vars
  # Expected output:
  # .env
  # .dev.vars
  ```

### 0.6 Verify local dev works

- [ ] **0.6.1** Generate Astro types

  ```bash
  npx astro sync
  ```

  > Must run before lint or build. Generates type definitions in `.astro/` based on env schema and content collections.

- [ ] **0.6.2** Run lint to catch any issues

  ```bash
  npm run lint
  ```

- [ ] **0.6.3** Start the dev server and verify it runs

  ```bash
  npm run dev
  ```

  Visit `http://localhost:4321` — the homepage should load. Visit `/auth/signin` — the sign-in form should render. Visit `/dashboard` — should redirect to `/auth/signin`.

  > The dev server runs on Cloudflare's `workerd` runtime via the adapter, so local dev behavior closely matches production. If the dev server crashes with Node.js API errors, check that `nodejs_compat` is in `wrangler.jsonc` compatibility flags.

- [ ] **0.6.4** Run a production build to confirm it succeeds

  ```bash
  npm run build
  ```

  > The build output goes to `dist/`. This is what Wrangler uploads to Cloudflare. If the build fails, fix issues before proceeding to Phase 1.

**Edge case support step:**
- [ ] **0.6.5** If `npm run dev` fails with `workerd` errors:
  - Verify Node version matches `.nvmrc` (`22.14.0`)
  - Try deleting `node_modules` and reinstalling: `rm -rf node_modules && npm ci`
  - Check that `.dev.vars` exists and has valid format (no quotes around values, no spaces around `=`)

---

## Phase 1: Project Configuration (local prep)

**Goal:** Align wrangler.jsonc and astro.config.mjs with production identity before first deploy.

- [ ] **1.1** Rename worker in `wrangler.jsonc`: change `"name"` from `"10x-astro-starter"` to `"content-forge"`

  ```jsonc
  // wrangler.jsonc — change this line:
  "name": "content-forge",
  ```

  > **Why:** The Worker name becomes the workers.dev subdomain (`content-forge.<account>.workers.dev`) and must match the Cloudflare dashboard Worker name for Workers Builds to work. From the [Workers Builds docs](https://developers.cloudflare.com/workers/ci-cd/builds/): _"the Worker name in the Cloudflare dashboard must match the `name` in the Wrangler configuration file, or the build will fail."_

- [ ] **1.2** Add `site` property to `astro.config.mjs` for correct sitemap generation

  ```js
  // astro.config.mjs — add this property inside defineConfig:
  site: "https://content-forge.<your-account>.workers.dev",
  ```

  > The `@astrojs/sitemap` integration needs `site` to generate absolute URLs. Without it, the sitemap outputs relative paths or omits URLs. Update this value when a custom domain is added later.

- [ ] **1.3** (Recommended) Add `global_fetch_strictly_public` compatibility flag to `wrangler.jsonc`

  ```jsonc
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
  ```

  > The Astro Cloudflare deployment docs include this flag in their recommended on-demand config. It ensures the global `fetch()` only accesses public resources, not internal service bindings, which is a security best practice. This flag may already be the default with `compatibility_date: "2026-05-08"` — adding it explicitly ensures the behavior regardless of compat date changes.

- [ ] **1.4** Verify the local build still works

  ```bash
  npx astro sync && npm run lint && npm run build
  ```

  > Confirms the config changes don't break anything before deploying.

**Edge case support step:**
- [ ] **1.5** If the build fails after adding `global_fetch_strictly_public`, remove it and check the [compatibility flags docs](https://developers.cloudflare.com/workers/configuration/compatibility-flags/) for whether it conflicts with the current `compatibility_date`. The compat date `2026-05-08` likely enables it by default.

---

## Phase 2: Cloudflare Account Prep & First Manual Deploy

**Goal:** Bootstrap the Worker on Cloudflare so Workers Builds has something to connect to.

- [ ] **2.1** Log in to Cloudflare via Wrangler CLI

  ```bash
  npx wrangler login
  ```

  > Opens browser for OAuth authentication. Required before setting secrets or deploying.

- [ ] **2.2** Create a Cloudflare API token for CI/automation

  1. Go to [Cloudflare Dashboard > Account API Tokens](https://dash.cloudflare.com/?to=/:account/api-tokens)
  2. Select **Create Token**
  3. Use the **Edit Cloudflare Workers** template (covers deploy, secrets, Worker management)
  4. Scope to the specific account only
  5. Save the token securely — you'll need it for Workers Builds

  > This token is used by Workers Builds internally. If Workers Builds uses the Git integration's OAuth, this step may not be needed — but having an API token is good practice for `wrangler` CLI usage and emergency manual deploys.

- [ ] **2.3** Set production secrets via Wrangler

  ```bash
  npx wrangler secret put SUPABASE_URL
  # Paste your Supabase project URL when prompted

  npx wrangler secret put SUPABASE_KEY
  # Paste your Supabase anon key when prompted
  ```

  > Secrets are encrypted at rest and only readable by the Worker runtime. They're not visible in the dashboard after creation. These are runtime secrets — the build does NOT need them because both env vars are `optional: true` in the Astro env schema.

- [ ] **2.4** Build and deploy manually (first deploy)

  ```bash
  npm run build && npx wrangler deploy
  ```

  > This creates the Worker on Cloudflare's infrastructure. Wrangler will output the URL: `https://content-forge.<account>.workers.dev`. This first deploy is required before connecting Workers Builds.

- [ ] **2.5** Verify the deployment

  1. Visit `https://content-forge.<account>.workers.dev` — should see the homepage
  2. Visit `https://content-forge.<account>.workers.dev/auth/signin` — should see the sign-in page
  3. Visit `https://content-forge.<account>.workers.dev/dashboard` — should redirect to `/auth/signin` (protected route)

  ```bash
  # Also verify logs stream correctly:
  npx wrangler tail --format json
  # Visit the site in a browser while tail is running — you should see request logs
  ```

**Edge case support steps:**

- [ ] **2.6** If `wrangler deploy` fails with a CommonJS error (e.g., `require is not defined`):
  - Check the error output for which package uses `require()`
  - Add the package to Vite's `optimizeDeps.include` in `astro.config.mjs`:
    ```js
    vite: {
      plugins: [tailwindcss()],
      optimizeDeps: {
        include: ["problematic-package"],
      },
    },
    ```
  - Rebuild and redeploy

- [ ] **2.7** If the deployed site shows hydration mismatches in the console:
  - Go to Cloudflare Dashboard > your domain > Speed > Optimization > Content Optimization
  - Disable **Auto Minify** for JavaScript
  - Ref: [Astro Cloudflare troubleshooting — client-side hydration](https://docs.astro.build/en/guides/deploy/cloudflare/#client-side-hydration)

- [ ] **2.8** If the deployed site returns 500 errors related to Node.js APIs:
  - Verify `nodejs_compat` is in `compatibility_flags` in `wrangler.jsonc`
  - Verify `compatibility_date` is `2024-09-23` or later (currently `2026-05-08`, so this is fine — `nodejs_compat_v2` is automatically enabled)
  - Check which specific Node.js API is failing and consult [Cloudflare Node.js compatibility docs](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)

---

## Phase 3: Workers Builds — Auto-deploy from Git

**Goal:** Connect the GitHub repository to Cloudflare Workers Builds so pushes to `master` auto-deploy and branches get preview URLs.

- [ ] **3.1** Connect the repository in the Cloudflare Dashboard

  1. Go to [Cloudflare Dashboard > Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages)
  2. Select the **content-forge** Worker (created in Phase 2)
  3. Go to **Settings** > **Builds**
  4. Select **Connect** and follow prompts to connect your GitHub account
  5. Select the repository containing ContentForge

  > Workers Builds requires the Worker name in the dashboard to match `"name"` in `wrangler.jsonc`. This is why we renamed it to `content-forge` in Phase 1.

- [ ] **3.2** Configure build settings in Workers Builds

  | Setting | Value |
  |---------|-------|
  | **Root directory** | `/` (project root) |
  | **Build command** | `npx astro build` |
  | **Deploy command** | `npx wrangler deploy` |
  | **Build watch paths** | (leave default — all files) |
  | **Production branch** | `master` |

  > **Important:** The production branch is `master`, not `main`. Verify this is set correctly.

- [ ] **3.3** Configure environment variables for the build (if needed)

  > In most cases, no build-time env vars are needed because `SUPABASE_URL` and `SUPABASE_KEY` are `optional: true` in the Astro env schema and are provided at runtime via Worker Secrets (set in Phase 2). However, if the build fails with env validation errors, add them as build environment variables in Workers Builds settings.

- [ ] **3.4** Trigger the first Workers Builds deploy

  Push a small commit to `master` (e.g., a comment change) and verify:
  1. Workers Builds picks up the push
  2. The build succeeds (check **Deployments** tab > **View build history**)
  3. The deployed site is updated
  4. The version appears in **Version History**

- [ ] **3.5** Verify branch preview deploys

  1. Create a test branch and push it
  2. Check Workers Builds — it should create a preview version
  3. Find the preview URL in **Version History** > select the version > **Version ID** section
  4. Verify the preview URL loads the site correctly
  5. Delete the test branch when done

**Edge case support steps:**

- [ ] **3.6** If Workers Builds fails with "Worker name mismatch":
  - Verify `"name"` in `wrangler.jsonc` exactly matches the Worker name in the Cloudflare dashboard
  - Both must be `content-forge`

- [ ] **3.7** If Workers Builds fails during `npx astro build` with missing env vars:
  - Go to Workers Builds settings > Environment Variables
  - Add `SUPABASE_URL` and `SUPABASE_KEY` as build-time environment variables (these are separate from Worker Secrets which are runtime-only)
  - Alternatively, confirm the Astro env schema has `optional: true` for both vars — if so, the build should succeed without them

- [ ] **3.8** If Workers Builds triggers on branches you don't want:
  - Go to Workers Builds settings > configure branch filtering
  - Set up include/exclude patterns to control which branches trigger builds
  - At minimum: `master` for production deploy, all others for preview

---

## Phase 4: CI Pipeline Alignment

**Goal:** Ensure GitHub Actions CI and Workers Builds coexist without conflict.

- [ ] **4.1** Verify current CI still passes on PRs

  The existing `.github/workflows/ci.yml` runs:
  ```
  astro sync > lint > build
  ```

  This runs on pushes to `master` AND PRs to `master`. This is **intentionally kept** — it serves as a quality gate on PRs (catching lint errors and build failures before merge). Workers Builds then handles the actual deploy after merge.

- [ ] **4.2** Ensure CI secrets are still configured in GitHub

  Verify in GitHub > Repository Settings > Secrets and Variables > Actions:
  - `SUPABASE_URL` is set (used by CI build step)
  - `SUPABASE_KEY` is set (used by CI build step)

  > These are GitHub Actions secrets, separate from Cloudflare Worker Secrets. CI needs them for the build validation step.

- [ ] **4.3** (Optional) Add a `npm run deploy` convenience script to `package.json`

  ```json
  "deploy": "astro build && wrangler deploy"
  ```

  > Useful for emergency manual deploys if Workers Builds is down or misconfigured. Not part of CI — purely for developer use.

**Edge case support step:**

- [ ] **4.4** If CI and Workers Builds produce different build results:
  - Verify Node.js versions match: CI uses Node 22 (from `ci.yml`), Workers Builds uses its own Node version
  - If Workers Builds uses a different Node version, check their build config or add an `.nvmrc` to control it (the project already has `.nvmrc` with `22.14.0`)
  - Workers Builds should respect `.nvmrc` if present — verify this in the build logs

---

## Phase 5: Post-deploy Hardening & Verification

**Goal:** Validate the full deployment pipeline end-to-end and address security considerations.

- [ ] **5.1** End-to-end workflow test

  1. Create a feature branch
  2. Make a visible change (e.g., add text to `src/pages/index.astro`)
  3. Push the branch > verify Workers Builds creates a preview
  4. Open a PR to `master` > verify CI passes (lint + build)
  5. Merge the PR > verify Workers Builds auto-deploys to production
  6. Visit the production URL and confirm the change is live

- [ ] **5.2** Test rollback procedure

  ```bash
  # List recent deployments/versions
  npx wrangler deployments list

  # Rollback to a previous version
  npx wrangler rollback [version-id]
  ```

  > Rollback reverts Worker code only — Supabase database changes are NOT rolled back. Verify the site still works after rollback.

- [ ] **5.3** Verify auth flow works in production

  1. Sign up with a test email
  2. Check email confirmation flow
  3. Sign in > verify redirect to dashboard
  4. Sign out > verify redirect

  > This validates that Supabase secrets are correctly set and the cookie-based auth flow works through Cloudflare Workers.

- [ ] **5.4** (Recommended) Consider Cloudflare Access for preview deploys

  > Preview deploy URLs are public by default. If the app handles any sensitive data during development, consider enabling [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) on preview Worker URLs. This is flagged in the infrastructure.md risk register as a low-likelihood but high-impact risk.

- [ ] **5.5** Document the deployment setup

  Update `AGENTS.md` deployment section with:
  - Production URL: `https://content-forge.<account>.workers.dev`
  - Deploy method: auto-deploy via Cloudflare Workers Builds on push to `master`
  - Manual deploy: `npm run build && npx wrangler deploy`
  - Rollback: `npx wrangler rollback [version-id]`
  - Secrets management: `npx wrangler secret put <KEY>`

---

## Phase 6: Future Work (not in scope, documented for reference)

These items are explicitly deferred but should be tracked:

| Item | Trigger | Reference |
|------|---------|-----------|
| **Hyperdrive setup** | When direct Postgres connections are added (pgvector/RAG) | infrastructure.md, Getting Started step 4 |
| **R2 Log Push** | When log retention > 3 days is needed | infrastructure.md, Operational Story |
| **Custom domain** | When branding/SEO matters | infrastructure.md, Operational Story |
| **Cloudflare Workflows** | When AI generation background jobs are built | PRD: FR-012, FR-013, FR-021 |
| **Environment-specific builds** | When staging environment is needed | infrastructure.md, Devil's Advocate point 4 |
| **Vendor abstraction layer** | When lock-in risk becomes a concern | infrastructure.md, Risk Register |

---

## Risk Checklist (from infrastructure.md)

These risks should be monitored during and after deployment:

- [ ] **Node.js compatibility** — Test all `@supabase/*` and AI SDK dependencies against `workerd` runtime. If any fail, check [Cloudflare Node.js compat docs](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)
- [ ] **CommonJS issues** — Watch for `require()` errors during `npm run build` or `wrangler deploy`. Fix with `vite.optimizeDeps.include`
- [ ] **Build consistency** — Confirm that local builds, CI builds, and Workers Builds produce the same output. Differences usually stem from Node.js version mismatches
- [ ] **Supabase connection limits** — Current REST API usage won't hit connection limits. When switching to direct Postgres (for pgvector), add Hyperdrive immediately
- [ ] **Workers Builds name sync** — The `"name"` field in `wrangler.jsonc` must always match the Worker name in the Cloudflare dashboard

---

## Execution Order

```
Phase 0 (prerequisites) -> Phase 1 (config changes) -> Phase 2 (first deploy) -> Phase 3 (Workers Builds) -> Phase 4 (CI alignment) -> Phase 5 (verification)
```

Each phase depends on the previous one. Phases 4 and 5 can partially overlap.
