# Cloudflare Deployment -- Concepts Explained

Everything you just set up, explained from scratch. This document covers every
tool, concept, and moving part from the deployment plan.

---

## Table of Contents

1. [The Big Picture](#1-the-big-picture)
2. [Cloudflare Workers](#2-cloudflare-workers)
3. [workerd -- The Runtime](#3-workerd----the-runtime)
4. [Wrangler -- The CLI](#4-wrangler----the-cli)
5. [wrangler.jsonc -- The Config File](#5-wranglerJsonc----the-config-file)
6. [Compatibility Date and Flags](#6-compatibility-date-and-flags)
7. [Bindings -- How Workers Access Services](#7-bindings----how-workers-access-services)
8. [Worker Secrets vs Environment Variables](#8-worker-secrets-vs-environment-variables)
9. [The Astro + Cloudflare Adapter](#9-the-astro--cloudflare-adapter)
10. [The Build Pipeline -- What Happens When You Deploy](#10-the-build-pipeline)
11. [Workers Builds -- Auto-Deploy from Git](#11-workers-builds----auto-deploy-from-git)
12. [Versions, Deployments, and Rollbacks](#12-versions-deployments-and-rollbacks)
13. [Preview Deploys](#13-preview-deploys)
14. [GitHub Actions vs Workers Builds -- Two CI Systems](#14-github-actions-vs-workers-builds)
15. [The workers.dev Domain](#15-the-workersdev-domain)
16. [KV (Key-Value) Storage](#16-kv-key-value-storage)
17. [R2, D1, Hyperdrive -- Storage You Might Use Later](#17-r2-d1-hyperdrive)
18. [Cloudflare Access](#18-cloudflare-access)
19. [wrangler tail -- Live Logs](#19-wrangler-tail----live-logs)
20. [Local Development Flow](#20-local-development-flow)
21. [Environment Files -- .env vs .dev.vars](#21-environment-files)
22. [npx, nvm, npm ci -- Node Tooling](#22-npx-nvm-npm-ci)
23. [Supabase in This Architecture](#23-supabase-in-this-architecture)
24. [The Complete Request Flow](#24-the-complete-request-flow)
25. [Where Secrets Live -- A Map](#25-where-secrets-live)

---

## 1. The Big Picture

Here is how your entire deployment works, end to end:

```
  YOUR MACHINE                    GITHUB                     CLOUDFLARE
  ============                    ======                     ==========

  Write code
      |
      v
  git push -----> GitHub repo
                      |
                      +--> GitHub Actions (CI)
                      |      - astro sync
                      |      - lint
                      |      - build
                      |      Result: pass/fail badge on PR
                      |
                      +--> Workers Builds (CD)
                             - npm ci
                             - npx astro build
                             - npx wrangler deploy
                             |
                             v
                      Cloudflare Edge Network
                      (300+ data centers worldwide)
                             |
                             v
                      content-forge Worker
                      runs your Astro app
                             |
                             v
                      User visits your site
```

Two separate systems watch your GitHub repo:

- **GitHub Actions** checks code quality (lint, build) on PRs
- **Workers Builds** actually deploys to production on merge

They don't talk to each other. They just both watch the same repo.

---

## 2. Cloudflare Workers

A Worker is a small program that runs on Cloudflare's edge network. "Edge"
means the code runs in data centers close to the user, not in one central
server.

```
  Traditional Server                  Cloudflare Workers
  ==================                  ==================

  User (Tokyo)                        User (Tokyo)
      |                                   |
      |  500ms round trip                 |  20ms round trip
      v                                   v
  Server (US-East)                    Edge (Tokyo data center)
                                          |
                                      User (Berlin)
                                          |  20ms round trip
                                          v
                                      Edge (Berlin data center)
```

Your entire Astro app runs as a Worker. Every page request, every API call,
every auth redirect -- it all executes inside a Worker.

Key properties:

- **No server to manage.** You don't rent a VM, install Node, configure nginx.
  You upload code, Cloudflare runs it.
- **Stateless per request.** Each HTTP request gets a fresh execution. There's no
  persistent memory between requests (you use KV, D1, or R2 for state).
- **Cold start ~0ms.** Workers use V8 isolates (not containers), so startup is
  nearly instant.
- **Free tier: 100,000 requests/day.** More than enough for an MVP.

---

## 3. workerd -- The Runtime

When you write JavaScript that runs in Node.js, you have access to `fs`,
`path`, `http`, `Buffer`, etc. Workers don't use Node.js. They use a custom
runtime called **workerd** (pronounced "worker-dee").

```
  Node.js runtime                     workerd runtime
  ==============                      ===============

  V8 engine                           V8 engine (same!)
  + Node.js APIs (fs, path, etc.)     + Web APIs (fetch, Request, Response)
  + npm packages                      + limited Node.js compat layer
  + full OS access                    + NO filesystem, NO OS access
```

workerd implements the same APIs you find in a browser: `fetch()`, `Request`,
`Response`, `URL`, `crypto`, `TextEncoder`, `setTimeout`, etc.

It does NOT have:
- `fs` (no filesystem)
- `child_process` (no spawning processes)
- `net` / `http` (no raw TCP sockets)
- Most Node.js built-in modules

The `nodejs_compat` flag (in your wrangler.jsonc) enables a compatibility layer
that polyfills some Node.js APIs so npm packages that use `Buffer`, `stream`,
`util`, `events`, etc. can still work.

**Why this matters:** When your Astro app does `import { createClient } from
'@supabase/supabase-js'`, that library needs to make HTTP requests. In Node.js
it would use `http` module. In workerd, it uses `fetch()`. The Supabase client
is designed to work in both environments, which is why it works here.

---

## 4. Wrangler -- The CLI

Wrangler is Cloudflare's command-line tool. Think of it as the bridge between
your local machine and Cloudflare's infrastructure.

```
  +-------------------+
  |   Your Terminal   |
  +-------------------+
          |
          v
  +-------------------+         +-------------------+
  |     Wrangler      | ------> |  Cloudflare API   |
  |                   |         |                   |
  |  wrangler deploy  |         |  Creates/updates  |
  |  wrangler secret  |         |  your Worker      |
  |  wrangler tail    |         |                   |
  |  wrangler login   |         |                   |
  +-------------------+         +-------------------+
```

Key commands you used:

| Command                    | What it does                                       |
|----------------------------|----------------------------------------------------|
| `wrangler login`           | Opens browser, you authorize, stores OAuth token   |
| `wrangler whoami`          | Shows which account you're authenticated as        |
| `wrangler deploy`          | Uploads your built code to Cloudflare              |
| `wrangler secret put KEY`  | Sets an encrypted runtime secret on the Worker     |
| `wrangler deployments list`| Shows version history of your Worker               |
| `wrangler rollback <id>`   | Reverts production to a previous version           |
| `wrangler tail`            | Streams live logs from your running Worker         |

Wrangler is installed as a **devDependency** in your project (`package.json`),
not globally. You run it via `npx wrangler` so you always use the version
pinned in your project. This prevents version mismatches between your machine,
CI, and Workers Builds.

**Authentication:** When you ran `wrangler login`, it stored an OAuth token at
`~/.wrangler/config/default.toml`. Every subsequent wrangler command reads this
file to authenticate with Cloudflare's API.

---

## 5. wrangler.jsonc -- The Config File

This file tells Wrangler everything about your Worker:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",  // IDE autocomplete
  "name": "content-forge",                                 // Worker name = URL
  "main": "@astrojs/cloudflare/entrypoints/server",        // Entry point
  "compatibility_date": "2026-05-08",                      // Runtime behavior
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
  "assets": {
    "binding": "ASSETS",         // Static files (CSS, JS, images)
    "directory": "./dist",       // Where build output goes
    "not_found_handling": "404-page"
  },
  "observability": {
    "enabled": true              // Enables logging/metrics in dashboard
  }
}
```

The `"name"` field is critical. It determines:
1. Your workers.dev URL: `https://<name>.<account-subdomain>.workers.dev`
2. The identity Cloudflare uses to match Workers Builds to your Worker
3. What shows up in the Cloudflare dashboard

The `"main"` field points to your app's entry point. For Astro with the
Cloudflare adapter, this is a special entrypoint provided by the adapter
package that knows how to handle Astro's server-side rendering inside a Worker.

---

## 6. Compatibility Date and Flags

Cloudflare evolves the Workers runtime over time. New features are added, bugs
are fixed, and sometimes behavior changes. To prevent your Worker from breaking
when Cloudflare updates their runtime, they use a **compatibility date** system.

```
  Timeline of workerd changes:
  ============================

  2024-01-01    2024-09-23      2026-05-08        future
      |              |               |               |
      v              v               v               v
  ----+----+---------+---------+-----+---------------+---->
      |    |         |         |     |
      |    |    nodejs_compat  |  Your compat_date
      |    |    v2 becomes     |  (you get all changes
      |    |    default        |   up to this date)
      |    |                   |
      |  Some behavior         |
      |  changed here      Some other
      |                    change here
```

Your `compatibility_date: "2026-05-08"` means: "give me the runtime behavior
as it existed on May 8, 2026." If Cloudflare changes something on May 9, your
Worker keeps the old behavior until you update the date.

**Compatibility flags** opt into specific features regardless of date:

- `nodejs_compat` -- Enables the Node.js polyfill layer. Without this, any npm
  package that uses `Buffer`, `stream`, `events`, etc. would crash.

- `global_fetch_strictly_public` -- When your code calls `fetch()`, it can only
  reach public URLs. Without this flag, `fetch()` inside a Worker could
  theoretically access internal Cloudflare service bindings, which is a security
  risk. This flag locks it down.

---

## 7. Bindings -- How Workers Access Services

Workers are isolated by default. They can't access databases, storage, or other
services unless you explicitly create a **binding**. A binding is a named
connection from your Worker to a Cloudflare service.

```
  Your Worker Code
  ================
       |
       +-- env.ASSETS --------> Static files (CSS, JS, images in dist/)
       |
       +-- env.SESSION -------> KV Namespace (session storage)
       |
       +-- env.IMAGES --------> Cloudflare Images (image optimization)
       |
       +-- env.SUPABASE_URL --> Worker Secret (encrypted string)
       |
       +-- env.SUPABASE_KEY --> Worker Secret (encrypted string)
```

In your deployment, three bindings were set up:

1. **ASSETS** -- Created by the Astro Cloudflare adapter. Serves your static
   files (compiled CSS, client-side JS, images). When a browser requests
   `/_astro/Layout.C9cPX9o8.css`, the ASSETS binding serves it.

2. **SESSION** -- A KV Namespace auto-provisioned during deploy. Astro's session
   system uses this to store session data. The KV namespace was named
   `content-forge-session` in Cloudflare.

3. **IMAGES** -- Cloudflare's image transformation service. The Astro adapter
   set this up for production image optimization.

Bindings are defined in `wrangler.jsonc` (some are added automatically by the
Astro adapter during build). They're NOT environment variables in the
traditional sense -- they're typed connections to Cloudflare services that are
injected into your Worker's execution context.

---

## 8. Worker Secrets vs Environment Variables

This is one of the most confusing parts. There are FOUR different places
where "environment variables" or "secrets" can live:

```
  +---------------------------------------------------------------+
  |                    WHERE VALUES LIVE                           |
  +---------------------------------------------------------------+
  |                                                               |
  |  LOCAL DEV                                                    |
  |  =========                                                    |
  |  .env ----------> Read by Astro dev server                    |
  |  .dev.vars -----> Read by Wrangler (workerd runtime)          |
  |                   Both files have the same values.            |
  |                   Both are gitignored. Never committed.       |
  |                                                               |
  |  CI (GITHUB ACTIONS)                                          |
  |  ===================                                          |
  |  GitHub Secrets --> Injected as env vars during CI build       |
  |                     Set via: GitHub repo Settings > Secrets    |
  |                     Used only for: build validation            |
  |                                                               |
  |  PRODUCTION (CLOUDFLARE)                                      |
  |  =======================                                      |
  |  Worker Secrets --> Encrypted at rest, injected at runtime     |
  |                     Set via: npx wrangler secret put KEY       |
  |                     NOT visible after creation                 |
  |                     NOT available at build time                |
  |                     Only your running Worker can read them     |
  |                                                               |
  |  WORKERS BUILDS (BUILD TIME)                                  |
  |  ===========================                                  |
  |  Build env vars -> Available during npx astro build           |
  |                    Set via: CF Dashboard > Builds > Settings   |
  |                    We didn't need these because our env vars   |
  |                    are optional: true in Astro's schema.       |
  |                                                               |
  +---------------------------------------------------------------+
```

**Why Worker Secrets are separate from build env vars:**

When Workers Builds runs `npx astro build`, that's a build step running in a
temporary container. It doesn't have access to Worker Secrets. Worker Secrets
are only available when your Worker handles an actual HTTP request in
production.

Since our Astro env schema marks both `SUPABASE_URL` and `SUPABASE_KEY` as
`optional: true`, the build succeeds without them. The running Worker then
picks them up from secrets at runtime.

---

## 9. The Astro + Cloudflare Adapter

Astro is a web framework. By itself, it doesn't know how to run on Cloudflare
Workers. The **adapter** (`@astrojs/cloudflare`) is the translation layer.

```
  What Astro produces            What the adapter transforms it into
  ====================           ===================================

  .astro pages        ------>    Server-side rendering functions
  API routes          ------>    that run inside a Worker's
  middleware           ------>    fetch() handler
  static assets       ------>    Separate static files served via ASSETS binding

  astro.config.mjs               wrangler.jsonc (extended at build time)
  (your config)                   (adapter adds bindings, routes, etc.)
```

When you run `npm run build`, the adapter:

1. Takes your Astro pages and compiles them into JavaScript modules
2. Creates a Worker entry point that handles incoming HTTP requests
3. Routes each request to the right page/API handler
4. Outputs everything to `dist/`:
   - `dist/server/` -- the Worker code (server-side rendering)
   - `dist/client/` -- static assets (CSS, JS, images)
5. Generates a `dist/server/wrangler.json` with additional config (bindings)

During `wrangler deploy`, Wrangler reads this output:
- Uploads server code as the Worker
- Uploads client assets to the ASSETS binding
- Merges the generated wrangler.json with your wrangler.jsonc

---

## 10. The Build Pipeline

Here is exactly what happens when you run `npm run build && npx wrangler deploy`:

```
  npm run build
  =============

  Step 1: astro build
          |
          v
  +------------------+
  | Vite bundler     |  Astro uses Vite under the hood.
  | - Resolves       |  Vite bundles your TypeScript, React components,
  |   imports        |  CSS (via Tailwind plugin), and produces
  | - Bundles JS     |  optimized output.
  | - Processes CSS  |
  | - Tree-shakes    |
  +------------------+
          |
          v
  +------------------+
  | Astro SSR        |  Astro compiles .astro files into server-side
  | compilation      |  rendering functions. Each page becomes a
  |                  |  module that can render HTML on demand.
  +------------------+
          |
          v
  +------------------+
  | CF Adapter       |  The Cloudflare adapter wraps everything in
  | wrapping         |  a Worker-compatible entry point and writes
  |                  |  the output to dist/.
  +------------------+
          |
          v
  dist/
  +-- client/           Static assets (served by ASSETS binding)
  |   +-- _astro/       Hashed CSS, JS bundles
  |   +-- favicon.png
  |   +-- template.png
  +-- server/           Worker code
      +-- index.js      Main Worker entry point
      +-- chunks/       Code-split modules
      +-- wrangler.json Generated config additions


  npx wrangler deploy
  ====================

  Step 2: Upload to Cloudflare
          |
          v
  +------------------+
  | Read config      |  Merges your wrangler.jsonc with the
  | (wrangler.jsonc  |  adapter-generated wrangler.json from dist/.
  |  + dist config)  |
  +------------------+
          |
          v
  +------------------+
  | Upload Worker    |  Sends the server code to Cloudflare's API.
  | code             |  The code is distributed to 300+ edge locations.
  +------------------+
          |
          v
  +------------------+
  | Upload assets    |  Sends static files separately.
  | (CSS, JS, imgs)  |  These are cached aggressively at the edge.
  +------------------+
          |
          v
  +------------------+
  | Provision        |  If bindings reference services that don't
  | bindings         |  exist yet (like the SESSION KV namespace),
  |                  |  Wrangler creates them automatically.
  +------------------+
          |
          v
  +------------------+
  | Create version   |  A new version is created. It gets a unique
  |                  |  version ID (like d789de48-...). This version
  |                  |  is deployed to 100% of traffic.
  +------------------+
          |
          v
  LIVE at https://content-forge.jakub-skwara-js.workers.dev
```

---

## 11. Workers Builds -- Auto-Deploy from Git

Workers Builds is Cloudflare's built-in CI/CD system. You connected it to your
GitHub repo so it watches for pushes and deploys automatically.

```
  WHAT HAPPENS ON git push TO master
  ====================================

  1. You push code to GitHub

  2. GitHub notifies Cloudflare (via webhook)

  3. Workers Builds spins up a build container:
     +------------------------------------------+
     | Build Environment                        |
     |                                          |
     |  - Reads .nvmrc -> installs Node 22.14.0 |
     |  - npm ci (installs dependencies)        |
     |  - npx astro build (your build command)  |
     |  - npx wrangler deploy (deploy command)  |
     |                                          |
     |  Has access to:                          |
     |  - Build env vars (if configured)        |
     |  - Cloudflare API credentials            |
     |                                          |
     |  Does NOT have access to:                |
     |  - Worker Secrets                        |
     |  - Your local .env / .dev.vars           |
     +------------------------------------------+

  4. If build succeeds: new version deployed to production
     If build fails: nothing changes, old version stays live
```

Workers Builds configuration (what you set in the dashboard):

```
  +----------------------------------+
  | Workers Builds Settings          |
  +----------------------------------+
  | Root directory:    /             |  Where to run commands from
  | Build command:     npx astro build|  What builds your app
  | Deploy command:    npx wrangler deploy| What deploys it
  | Production branch: master        |  Push here = production deploy
  +----------------------------------+
```

Any branch push creates a **preview version** (not routed to production).
Only `master` pushes update production.

---

## 12. Versions, Deployments, and Rollbacks

Every deploy creates a **version**. Versions are immutable snapshots of your
Worker code + config.

```
  Version History (what you see in the dashboard)
  ================================================

  Version ID    Source             Branch           When
  ----------    ------             ------           ----
  68314592      Workers Builds     master           latest  <-- ACTIVE (100%)
  9fa9fbf0      Workers Builds     master           1h ago
  d789de48      Manual (wrangler)  -                2h ago  (first deploy)
  01beed90      Secret Change      -                2h ago
  ...

  Only ONE version serves production traffic at a time.
```

**Deployments** are the act of routing traffic to a specific version.

**Rollback** switches production back to a previous version:

```
  Before rollback:
  ================
  All traffic --> Version 68314592 (has "ContentForge" title)

  npx wrangler rollback 9fa9fbf0
  ================================
  All traffic --> Version 9fa9fbf0 (has "10x Astro Starter" title)

  Roll forward again:
  ===================
  npx wrangler rollback 68314592
  All traffic --> Version 68314592 (back to "ContentForge")
```

Rollback is instant (seconds, not minutes). It doesn't rebuild anything --
it just re-routes traffic to an existing version.

Important limitation: Rollback only affects Worker code. If you also changed a
database schema or KV data, that is NOT rolled back. You need to handle data
rollbacks separately.

---

## 13. Preview Deploys

When you push a non-production branch, Workers Builds creates a preview version.
This version is NOT routed to your main URL. Instead, it gets its own URL:

```
  Production URL (master only):
  https://content-forge.jakub-skwara-js.workers.dev

  Preview URL (any branch):
  https://<version-id>-content-forge.jakub-skwara-js.workers.dev

  Example:
  https://64541297-content-forge.jakub-skwara-js.workers.dev
```

```
  Branch: master                   Branch: feature/new-design
  ==============                   =========================

  Push to GitHub                   Push to GitHub
       |                                |
       v                                v
  Workers Builds                   Workers Builds
       |                                |
       v                                v
  Deploy to                        Create preview
  production URL                   version only
       |                                |
       v                                v
  content-forge.                   64541297-content-forge.
  jakub-skwara-js.                 jakub-skwara-js.
  workers.dev                      workers.dev
  (everyone sees this)             (only you use this for testing)
```

Preview URLs are public by default. Anyone with the URL can access them. This
is why the plan mentions Cloudflare Access as an option for restricting preview
access.

---

## 14. GitHub Actions vs Workers Builds

You have two completely independent CI systems watching the same repo. They
serve different purposes:

```
  +---------------------+          +---------------------+
  | GitHub Actions (CI) |          | Workers Builds (CD) |
  +---------------------+          +---------------------+
  | Purpose: Quality    |          | Purpose: Deploy     |
  |          gate       |          |          to prod    |
  |                     |          |                     |
  | Triggers:           |          | Triggers:           |
  |  - Push to master   |          |  - Push to master   |
  |  - PR to master     |          |  - Push to any      |
  |                     |          |    branch            |
  | Steps:              |          |                     |
  |  1. npm ci          |          | Steps:              |
  |  2. astro sync      |          |  1. npm ci          |
  |  3. lint            |          |  2. astro build     |
  |  4. build           |          |  3. wrangler deploy |
  |                     |          |                     |
  | Output:             |          | Output:             |
  |  Pass/fail status   |          |  New Worker version |
  |  on the PR          |          |  deployed           |
  +---------------------+          +---------------------+

  "Can this code merge?"           "Ship this code to production."
```

Why keep both?

- **GitHub Actions** runs on PRs before merge. It catches lint errors, type
  errors, and build failures BEFORE code reaches production. It's your safety
  net.

- **Workers Builds** only runs after code is pushed/merged. It doesn't lint.
  It just builds and deploys. If you only had Workers Builds, broken code could
  reach production via a direct push to master.

The recommended workflow:

```
  1. Create feature branch
  2. Push branch
       --> Workers Builds: creates preview version
  3. Open PR to master
       --> GitHub Actions: runs lint + build
       --> Shows pass/fail on the PR
  4. Merge PR (only if CI passes)
       --> Workers Builds: deploys to production
       --> GitHub Actions: runs again on master (redundant but harmless)
```

---

## 15. The workers.dev Domain

Every Cloudflare account gets a `*.workers.dev` subdomain. The format is:

```
  https://<worker-name>.<account-subdomain>.workers.dev
  |       |              |                  |
  |       |              |                  +-- All Workers share this TLD
  |       |              |
  |       |              +-- Your account's unique subdomain
  |       |                  (jakub-skwara-js in your case)
  |       |
  |       +-- The "name" field from wrangler.jsonc
  |           (content-forge in your case)
  |
  +-- Always HTTPS (TLS is automatic)
```

This is a free, auto-provisioned domain. You don't need to buy a domain name
or configure DNS for it. Cloudflare handles TLS certificates automatically.

Later, you can add a custom domain (e.g., `contentforge.com`) and point it to
the same Worker.

---

## 16. KV (Key-Value) Storage

KV is Cloudflare's distributed key-value store. It was auto-provisioned during
your deploy for session storage.

```
  What KV is:
  ===========

  A global key-value database optimized for reads.

  +--------------------+     +--------------------+
  | Key                |     | Value              |
  +--------------------+     +--------------------+
  | session:abc123     | --> | {user: "...", ...}  |
  | session:def456     | --> | {user: "...", ...}  |
  +--------------------+     +--------------------+

  Properties:
  - Eventually consistent (writes take up to 60s to propagate globally)
  - Extremely fast reads (cached at every edge location)
  - Good for: sessions, config, cached data
  - Bad for: frequent writes, strong consistency needs
```

In your app, the Astro session system uses the KV namespace
`content-forge-session` (provisioned as the `SESSION` binding). When a user
logs in, their session data is stored here.

Your Worker accesses it through the binding:

```
  // Conceptually (Astro handles this internally):
  await env.SESSION.put("session:abc123", JSON.stringify(sessionData));
  const session = await env.SESSION.get("session:abc123");
```

---

## 17. R2, D1, Hyperdrive

These are other Cloudflare storage services mentioned in the plan as future
work. Brief overview:

```
  +----------+---------------------------+-------------------------------+
  | Service  | What it is                | When you'd use it             |
  +----------+---------------------------+-------------------------------+
  | KV       | Key-value store           | Sessions, config, cache       |
  |          | (you're using this now)   |                               |
  +----------+---------------------------+-------------------------------+
  | R2       | Object storage (like S3)  | File uploads, log storage,    |
  |          |                           | images, backups               |
  +----------+---------------------------+-------------------------------+
  | D1       | SQLite database at the    | Structured data that needs    |
  |          | edge                      | SQL queries (alternative to   |
  |          |                           | Supabase for some use cases)  |
  +----------+---------------------------+-------------------------------+
  | Hyperdrive| Connection pooler for    | When you connect directly to  |
  |          | external Postgres DBs     | Supabase's Postgres DB        |
  |          |                           | instead of using REST API     |
  +----------+---------------------------+-------------------------------+
```

Currently, your app uses Supabase via its REST API (`@supabase/supabase-js`
makes HTTP requests). This is fine and doesn't need Hyperdrive.

If you later add pgvector for AI/RAG features and need direct Postgres
connections, Hyperdrive would sit between your Worker and Supabase's database
to pool connections efficiently.

---

## 18. Cloudflare Access

Cloudflare Access is an authentication layer you can put in front of any
Cloudflare-served URL. It was mentioned in the plan as a security consideration
for preview deploys.

```
  Without Cloudflare Access:
  ==========================
  Anyone with the URL --> Preview site loads

  With Cloudflare Access:
  =======================
  Anyone with the URL --> Cloudflare login screen --> Only authorized
                          (email, SSO, etc.)          users see the site
```

This is NOT the same as your app's auth (Supabase). Cloudflare Access sits
at the network level, BEFORE your Worker code even runs. It's useful for
restricting who can access preview deployments.

---

## 19. wrangler tail -- Live Logs

Workers don't write to a local terminal. They run on Cloudflare's edge. To see
logs from your running Worker:

```
  Your terminal                        Cloudflare Edge
  =============                        ===============

  npx wrangler tail
       |                               Worker handles request
       |  <-- WebSocket connection -->  console.log("...")
       |                               |
       v                               v
  Logs appear here                  Log is forwarded
  in real-time                      to your terminal
```

`wrangler tail` opens a WebSocket to Cloudflare and streams log output from
your production Worker in real time. Useful for debugging production issues.

Logs are ephemeral -- they're only available while `tail` is running. For
persistent logs, you'd set up R2 Log Push (deferred in the plan).

---

## 20. Local Development Flow

When you run `npm run dev`, here's what happens:

```
  npm run dev
  ===========
       |
       v
  Astro dev server starts
       |
       +-- Uses Cloudflare adapter
       |   which starts a LOCAL workerd runtime
       |
       +-- Reads .dev.vars for secrets
       |
       +-- Serves on http://localhost:4321
       |
       v
  +------------------------------------------+
  | Local workerd process                    |
  |                                          |
  |  Your Astro app running in the SAME      |
  |  runtime as production. Same APIs,       |
  |  same restrictions, same behavior.       |
  |                                          |
  |  Key difference from production:         |
  |  - Reads secrets from .dev.vars          |
  |    (not Worker Secrets)                  |
  |  - No KV/R2/D1 (uses local simulation)  |
  |  - Single machine (not distributed)      |
  +------------------------------------------+
```

This is different from most frameworks where `npm run dev` uses Node.js. Here,
you're running the actual workerd runtime locally. This means bugs that would
only appear in production (due to missing Node.js APIs) also appear in local
dev.

---

## 21. Environment Files

```
  .env.example          .env                  .dev.vars
  ============          ====                  =========
  SUPABASE_URL=###      SUPABASE_URL=https:// SUPABASE_URL=https://
  SUPABASE_KEY=###      SUPABASE_KEY=eyJ...   SUPABASE_KEY=eyJ...

  Committed to git      gitignored            gitignored
  Template only         Read by Astro         Read by Wrangler
                        (if not using         (workerd runtime
                         workerd adapter)      during npm run dev)
```

Why two files with the same content?

- `.env` is the standard for Astro and most Node.js tools
- `.dev.vars` is Wrangler's format for injecting secrets into the local workerd
  runtime

In practice, with the Cloudflare adapter, `.dev.vars` is the one that matters
during `npm run dev`. But having `.env` as well ensures compatibility with any
tooling that expects it.

---

## 22. npx, nvm, npm ci

### npx

`npx` runs a command from your project's `node_modules/.bin/`. Instead of
installing wrangler globally, you run `npx wrangler`, which uses the exact
version from your `package.json`.

```
  npx wrangler deploy
       |
       v
  Looks in ./node_modules/.bin/wrangler
  Runs that specific version (4.94.0)

  vs.

  wrangler deploy (global install)
       |
       v
  Runs whatever version is installed globally
  (could be different from what your project expects)
```

### nvm (Node Version Manager)

Manages multiple Node.js versions on one machine:

```
  nvm install 22.14.0    # Download and install this version
  nvm use 22.14.0        # Switch to it in current shell

  .nvmrc file contains: 22.14.0
  nvm use                # Reads .nvmrc, switches automatically
```

Why pin Node 22.14.0? Because your local build, GitHub Actions (Node 22), and
Workers Builds (reads .nvmrc) should all use the same major version. Different
versions can produce subtly different build output.

### npm ci vs npm install

```
  npm install                       npm ci
  ===========                       ======
  Reads package.json                Reads package-lock.json
  Resolves "^4.90.0" to latest      Installs EXACT versions from lock file
  May update package-lock.json      Never modifies package-lock.json
  Good for: adding new packages     Good for: CI, builds, reproducibility
```

`npm ci` is used everywhere in your pipeline (local, CI, Workers Builds)
because it guarantees everyone gets the exact same dependency versions.

---

## 23. Supabase in This Architecture

Supabase provides authentication and (eventually) database for your app. Here's
how it fits:

```
  User's Browser
       |
       | 1. POST /api/auth/signin (email + password)
       v
  Cloudflare Worker (your Astro app)
       |
       | 2. createClient(SUPABASE_URL, SUPABASE_KEY)
       |    (reads from Worker Secrets at runtime)
       |
       | 3. supabase.auth.signInWithPassword(...)
       |    (HTTP request to Supabase REST API)
       v
  Supabase (hosted service)
       |
       | 4. Validates credentials, returns JWT + session
       v
  Cloudflare Worker
       |
       | 5. Sets session cookie, redirects to /dashboard
       v
  User's Browser
       |
       | 6. Subsequent requests include cookie
       | 7. Middleware reads cookie, sets context.locals.user
       | 8. Protected routes check context.locals.user
```

The `SUPABASE_URL` is the REST API endpoint for your Supabase project. The
`SUPABASE_KEY` is the "anon" key -- a public-safe key that works with Row
Level Security (RLS). The supabase-js client uses standard `fetch()` calls
to communicate, which works perfectly in the workerd runtime.

---

## 24. The Complete Request Flow

From a user typing your URL to seeing the page:

```
  1. User types: https://content-forge.jakub-skwara-js.workers.dev/dashboard

  2. DNS resolves to nearest Cloudflare data center (e.g., Warsaw)

  3. Cloudflare edge receives the request

  4. Is it a static asset? (/_astro/*.css, /_astro/*.js, /favicon.png)
     +-- YES --> Serve from ASSETS binding (cached, fast)
     +-- NO  --> Route to Worker

  5. Worker starts executing (cold start ~0ms, V8 isolate)

  6. Astro middleware runs:
     a. Creates Supabase client (using Worker Secrets)
     b. Reads session cookie from request
     c. If valid session --> sets context.locals.user
     d. Checks if route is in PROTECTED_ROUTES
        - /dashboard IS protected
        - No user? --> 302 redirect to /auth/signin

  7. If user IS authenticated:
     a. Astro renders the dashboard page (server-side)
     b. Injects any React islands that need hydration
     c. Returns HTML response

  8. Browser receives HTML
     a. Renders the page
     b. Downloads client JS from ASSETS (/_astro/*.js)
     c. Hydrates React components (interactive)

  9. Total time: ~50-150ms (depending on distance to edge + Supabase latency)
```

---

## 25. Where Secrets Live -- A Map

This is often the most confusing part. Here's a complete map of where every
secret and credential lives:

```
  +================================================================+
  |                SECRET / CREDENTIAL MAP                         |
  +================================================================+
  |                                                                |
  |  SUPABASE_URL and SUPABASE_KEY                                 |
  |  --------------------------------                              |
  |                                                                |
  |  Location              Purpose            How it gets there    |
  |  --------              -------            -----------------    |
  |  .env                  Local dev (Astro)  You copied from      |
  |                                           .env.example and     |
  |                                           filled in values     |
  |                                                                |
  |  .dev.vars             Local dev          You copied from      |
  |                        (workerd runtime)  .env                 |
  |                                                                |
  |  GitHub Secrets        CI build step      You set via GitHub   |
  |                                           Settings or gh CLI   |
  |                                                                |
  |  Worker Secrets        Production         You set via          |
  |                        runtime            wrangler secret put  |
  |                                                                |
  |                                                                |
  |  CLOUDFLARE CREDENTIALS                                        |
  |  ----------------------                                        |
  |                                                                |
  |  ~/.wrangler/config/   Wrangler CLI       Created by           |
  |  default.toml          authentication     wrangler login       |
  |                                                                |
  |  Cloudflare OAuth      Workers Builds     Created when you     |
  |  (internal)            deploys            connected GitHub     |
  |                                           in the dashboard     |
  |                                                                |
  |                                                                |
  |  GITHUB CREDENTIALS                                            |
  |  -------------------                                           |
  |                                                                |
  |  ~/.gitconfig          Git operations     ssh-keygen / gh auth |
  |  SSH keys                                                      |
  |                                                                |
  +================================================================+
```

---

## Quick Reference: What Each Tool Does

```
  Tool/Concept              One-line explanation
  ============              ====================
  Cloudflare Workers        Serverless functions at the edge (your app runs here)
  workerd                   The JavaScript runtime Workers use (not Node.js)
  Wrangler                  CLI to manage Workers (deploy, secrets, logs, config)
  wrangler.jsonc            Config file defining your Worker's name, flags, bindings
  Workers Builds            Cloudflare's CI/CD that auto-deploys from GitHub
  Worker Secrets            Encrypted runtime-only variables (wrangler secret put)
  Bindings                  Named connections from Worker to CF services (KV, R2, etc)
  Compatibility date        Pins your Worker's runtime behavior to a specific date
  Compatibility flags       Opt into specific runtime features (nodejs_compat, etc)
  KV                        Key-value store (used for sessions in your app)
  R2                        Object storage like S3 (not used yet)
  D1                        SQLite database at the edge (not used yet)
  Hyperdrive                Connection pooler for external Postgres (not used yet)
  Cloudflare Access         Auth layer in front of any CF-served URL
  wrangler tail             Stream live logs from production Worker
  .dev.vars                 Local secrets file for workerd dev runtime
  @astrojs/cloudflare       Adapter that makes Astro run as a Worker
  npx                       Runs CLI tools from project's node_modules
  nvm                       Manages multiple Node.js versions per machine
  npm ci                    Deterministic install from package-lock.json
  GitHub Actions            CI system for PR quality gates (lint + build)
  workers.dev               Free auto-provisioned domain for Workers
  Version                   Immutable snapshot of Worker code
  Deployment                Routing traffic to a specific version
  Rollback                  Switching production to a previous version
  Preview deploy            Non-production version accessible via unique URL
```
