---
project: ContentForge
researched_at: 2026-05-23
recommended_platform: Cloudflare Workers
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 + React 19
  runtime: Cloudflare Workers (workerd)
---

## Recommendation

**Deploy on Cloudflare Workers.**

Cloudflare Workers is the only platform that requires zero migration from the current project setup -- `@astrojs/cloudflare` v13.5.0 is already configured and GA for Astro 6. The free tier handles 100,000 requests/day (far beyond MVP scale at low QPS), and all background processing primitives needed for async AI generation (Workflows, Queues, Durable Objects) are GA with generous free allowances. Cloudflare scored Pass on all five agent-friendly criteria, and the user's existing familiarity with the platform eliminates onboarding friction. Cost at MVP scale: $0/month on the free plan, $5/month on the paid plan.

## Platform Comparison

| Platform | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP/Integration | Total |
|---|---|---|---|---|---|---|
| **Cloudflare Workers** | Pass | Pass | Pass | Pass | Pass | 5/5 |
| **Vercel** | Pass | Pass | Pass | Pass | Pass | 5/5 |
| **Railway** | Pass | Pass | Pass | Pass | Pass | 5/5 |
| Netlify | Pass | Pass | Pass | Partial | Pass | 4.5/5 |
| Render | Partial | Pass | Pass | Partial | Pass | 4/5 |
| Fly.io | Pass | Partial | Partial | Pass | Fail | 3/5 |

**Scoring notes:**

- **Cloudflare Workers** -- Pass across the board. `wrangler` CLI covers deploy, rollback (100 versions), log tailing, secrets, and environment management. Fully serverless with zero infrastructure management. Publishes `llms.txt` for all products and markdown docs via `Accept: text/markdown`. 14+ official MCP servers covering docs, bindings, builds, and observability.

- **Vercel** -- Matches Cloudflare on raw criteria scores but penalized by soft weights: Hobby plan is non-commercial (ContentForge is a product), requiring Pro at $20/month. Requires swapping `@astrojs/cloudflare` for `@astrojs/vercel` adapter. Vercel Workflows (GA) handle background AI jobs but impose a different execution model than Cloudflare Workflows.

- **Railway** -- Strong PaaS with true persistent processes, WebSocket support, and excellent MCP integration. Tied on criteria but loses on cost ($5/month minimum vs. Cloudflare's free tier) and requires adapter swap to `@astrojs/node`. App sleeping on Hobby plan may cause 502 errors on first requests.

- **Netlify** -- Partial on stable deploy API (rollback via UI/API, no dedicated CLI command). Credit-based pricing since September 2025 adds billing complexity. Background Functions (15 min) and Async Workloads handle AI generation but with a different model. Astro 6 adapter compatibility unverified in Netlify's docs.

- **Render** -- Partial on CLI-first (rollback is dashboard-only) and stable deploy API (no CLI rollback). $7/month Starter plan. Workflows feature is in public beta. No official Astro deploy guide (404). Requires adapter swap.

- **Fly.io** -- Partial on managed/serverless (requires Dockerfile management and VM sizing decisions). Partial on agent-readable docs (markdown on GitHub but no `llms.txt`). Fail on MCP integration (no official MCP server). No free tier post-trial. Requires adapter swap and Dockerfile.

**Soft-weight adjustments applied:**
- Cost minimization (Q2) heavily favored Cloudflare (free tier vs. $5-20/month competitors).
- Platform familiarity (Q3) broke the tie between Cloudflare and Vercel in Cloudflare's favor (both familiar, but Cloudflare avoids adapter migration).
- Single region (Q4) slightly reduced Cloudflare's edge distribution advantage but did not penalize it.
- External providers (Q5) was neutral across all platforms since Supabase is already chosen.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Cloudflare Workers wins because it is the path of least resistance with the highest ceiling. The project already uses `@astrojs/cloudflare` v13.5.0 with `wrangler.jsonc` configured -- deployment works today with `npx wrangler deploy`. The free tier (100k requests/day, 10ms CPU/invocation) covers MVP traffic with headroom. Background AI generation maps to Cloudflare Workflows (GA) or Queues (GA), both with free-tier allowances. Supabase connectivity is supported via Hyperdrive (free 100k queries/day) for connection pooling. The 14+ MCP servers and comprehensive `llms.txt` coverage make it the most agent-friendly platform in the comparison.

#### 2. Vercel

Vercel is the strongest alternative, offering familiar DX and a mature Workflows system for background AI jobs. It scored 5/5 on agent-friendly criteria. The gap vs. Cloudflare: (a) Hobby plan restricts commercial use, pushing cost to $20/month on Pro; (b) migrating from `@astrojs/cloudflare` to `@astrojs/vercel` is non-trivial work that delays MVP; (c) no WebSocket support if the product ever needs real-time features. Vercel would be the right choice if the project were greenfield without an existing Cloudflare adapter setup.

#### 3. Railway

Railway offers what the other two don't: true persistent processes with WebSocket support. If ContentForge evolves to need always-on background workers (not step-based workflows), Railway's model is more natural. The $5/month Hobby plan is cheap, and the MCP server integration is excellent (supports Claude Code, OpenCode, Cursor, Codex). The gap: requires adapter swap to `@astrojs/node`, loses edge-native Astro 6 features, and app sleeping on Hobby may cause first-request 502 errors.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate -- Weaknesses

1. **Node.js compatibility gaps are unpredictable.** The `nodejs_compat` flag provides partial Node.js API support, but specific npm packages (especially those with native bindings or deep `fs`/`net` usage) will fail silently or throw at runtime. AI SDK dependencies, embedding libraries, or Supabase client internals may hit these walls without warning during development.

2. **No traditional long-running process model.** Cloudflare Workflows and Queues impose a step-based execution model -- not a traditional background worker. AI generation tasks that orchestrate multiple LLM calls, vector searches, and database writes must be decomposed into discrete steps. If a single step exceeds CPU time limits (30s on free, configurable on paid), the task fails.

3. **CommonJS dependency hell.** `workerd` doesn't support CommonJS. Any transitive dependency using `require()` must be pre-compiled through Vite's `optimizeDeps.include`. This surfaces at deploy time, not during local dev, making it hard to catch early.

4. **Environment-specific builds.** You cannot build once and deploy to staging + production. Each environment requires a separate `CLOUDFLARE_ENV=<env> astro build`. This complicates CI/CD and makes preview deploys more fragile than on Vercel/Netlify.

5. **Vendor lock-in on primitives.** Once you build on Durable Objects, Queues, KV, D1, and Workflows, migration to another platform requires rewriting significant application logic. These are Cloudflare-proprietary APIs with no portable abstractions.

### Pre-Mortem -- How This Could Fail

The team deployed ContentForge on Cloudflare Workers, betting on the generous free tier and edge-native Astro 6 support. Within three months, the AI generation pipeline became the critical bottleneck. The Workflows step model worked for simple single-LLM-call ideas, but as the product evolved to require multi-step orchestration (RAG retrieval from Supabase pgvector, LLM generation, post-processing, batch writes), each workflow became a complex state machine. Debugging failed workflows was painful -- error messages from `workerd` were cryptic, and there was no way to replay individual steps locally.

The CommonJS problem struck when upgrading an AI SDK that pulled in a dependency using `require()`. The build broke in CI but worked locally, costing two days of debugging. Meanwhile, a Supabase client version bump exposed a Node.js API edge case that worked in Node but behaved differently in `workerd`. By month six, the team spent more time working around platform constraints than building features, and began evaluating a migration to Railway for the AI worker service while keeping the frontend on Cloudflare.

### Unknown Unknowns

- **Supabase connection pooling from Workers requires Hyperdrive.** Direct connections from Workers to Supabase Postgres hit connection limits because each invocation opens a new connection. Hyperdrive (GA, free 100k queries/day) solves this but is an additional configuration step that's easy to miss until "too many connections" errors appear in production.

- **`@astrojs/cloudflare` v13 dropped Pages support.** Older tutorials and community guides reference Cloudflare Pages deployment. The adapter now targets Workers only. The migration path is documented but not prominently flagged outside the upgrade guide.

- **Workers Logs retention is 3 days (free) / 7 days (paid).** Bug reports arriving after the retention window find no logs. There's no built-in log persistence -- you need to configure a log push destination (R2 or third-party) manually.

- **Cloudflare Workflows storage billing starts September 2025.** If workflow state grows (each AI generation job stores intermediate results), unexpected storage charges may appear that weren't part of the free-tier cost estimate.

- **No native branch preview environment.** Unlike Vercel/Netlify's automatic PR previews, Cloudflare requires Workers Builds with Git integration or manual setup of separate Worker environments. This is functional but less polished than competitors.

## Operational Story

- **Preview deploys**: Configure Workers Builds with GitHub integration. Each push to a non-production branch creates a preview Worker at `<branch>.<project>.workers.dev`. Preview URLs are public by default -- add Cloudflare Access if the app contains sensitive data. Alternatively, use `npx wrangler deploy --env preview` for manual preview deploys.
- **Secrets**: Server secrets (`SUPABASE_URL`, `SUPABASE_KEY`) live in Cloudflare Workers Secrets, set via `npx wrangler secret put <KEY>`. For local dev, secrets go in `.dev.vars` (gitignored). Secrets are encrypted at rest, readable only by the Worker runtime -- not visible in the dashboard after creation. Rotation: `wrangler secret put <KEY>` overwrites the existing value; no versioning.
- **Rollback**: `npx wrangler rollback [version-id]` instantly reverts to any of the last 100 deployed versions. Time-to-revert: seconds. Caveat: rollback does not revert database migrations -- if a deploy included Supabase schema changes, those persist regardless of Worker rollback.
- **Approval**: Deploying to production (`wrangler deploy`) can be performed by an agent unattended. Rotating secrets (`wrangler secret put`), deleting Workers, and modifying account-level settings (billing, Access policies) should require human approval. Wrangler does not enforce approval gates -- operational discipline is the guardrail.
- **Logs**: `npx wrangler tail` streams real-time logs from production. `npx wrangler tail --format json` for structured output parseable by agents. Dashboard provides a searchable log viewer (3-day retention free, 7-day paid). For persistent logs, configure Log Push to R2 or a third-party sink.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Node.js npm package incompatible with `workerd` | Devil's advocate | Medium | High | Test all AI SDK dependencies early in dev; maintain a `vite.optimizeDeps.include` allowlist; pin dependency versions |
| AI generation workflow exceeds CPU step limits | Devil's advocate | Medium | High | Design workflows with short, discrete steps; move heavy computation to external AI APIs (LLM calls are I/O, not CPU); monitor step durations |
| CommonJS dependency breaks deploy but not local dev | Devil's advocate | Medium | Medium | Add `astro build` to pre-commit or CI before merge; keep `wrangler dev` and CI build environments aligned |
| Supabase connection exhaustion without Hyperdrive | Unknown unknowns | High | High | Configure Hyperdrive for Supabase Postgres from day one; add connection pooling to initial infrastructure setup |
| Workflow storage costs exceed expectations | Unknown unknowns | Low | Medium | Monitor Workflows storage usage monthly; keep intermediate state minimal; clean up completed workflow state |
| Log loss due to short retention window | Unknown unknowns | Medium | Low | Set up Log Push to R2 early; budget is $0 (R2 egress is free, storage is cheap) |
| Environment-specific builds break CI/CD | Devil's advocate | Low | Medium | Use GitHub Actions matrix strategy for env-specific builds; document the `CLOUDFLARE_ENV` pattern in CI config |
| Vendor lock-in prevents future platform migration | Devil's advocate | Low | High | Isolate Cloudflare-specific APIs behind thin adapter interfaces (e.g., queue producer/consumer abstraction); accept lock-in for MVP speed |
| Preview deploys expose sensitive data | Pre-mortem | Low | High | Enable Cloudflare Access on preview Workers; restrict preview deploy URLs in Workers Builds config |

## Getting Started

These steps assume the current project setup (`@astrojs/cloudflare` v13.5.0, `wrangler.jsonc` already configured, `astro` v6.3.1).

1. **Set up secrets for local dev.** Copy `.env.example` to `.dev.vars` with your Supabase credentials. Wrangler reads `.dev.vars` automatically when running `astro dev` (the Astro dev server uses `workerd` via the Cloudflare adapter -- no separate `wrangler dev` needed).

2. **Set up production secrets.** Run `npx wrangler secret put SUPABASE_URL` and `npx wrangler secret put SUPABASE_KEY` to store secrets in your Cloudflare account.

3. **Deploy.** Run `npm run build && npx wrangler deploy`. The build output in `dist/` is uploaded to your Worker. Verify at `https://<worker-name>.workers.dev`.

4. **Configure Hyperdrive for Supabase connection pooling.** Create a Hyperdrive config pointing to your Supabase Postgres connection string: `npx wrangler hyperdrive create content-forge-db --connection-string="<supabase-postgres-url>"`. Add the Hyperdrive binding to `wrangler.jsonc`.

5. **Set up CI/CD.** The project already has `.github/workflows/ci.yml` running `astro sync` -> `lint` -> `build`. Add a deploy step using `npx wrangler deploy` with a `CLOUDFLARE_API_TOKEN` secret in GitHub Actions. For preview deploys, configure Workers Builds in the Cloudflare dashboard with GitHub integration.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (beyond noting the existing GitHub Actions workflow)
- Production-scale architecture (multi-region, HA, DR)
- Cloudflare Workflows implementation details for AI generation
- Supabase pgvector configuration for RAG
