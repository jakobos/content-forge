---
starter_id: 10x-astro-starter
package_manager: npm
project_name: content-forge
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: custom
  quality_override: false
  self_check_answers:
    typed: true
    from_official_starter: true
    conventions: true
    docs_current: true
    can_judge_agent: true
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: true
---

## Why this stack

Solo builder shipping a content-strategy web app in 3 weeks with auth, AI-powered idea generation, and background jobs. The 10x Astro Starter (Astro 6 + React 19 + Supabase + Cloudflare) provides auth, database, and edge deployment out of the box — the three heaviest setup costs eliminated from day one. TypeScript + Zod at boundaries satisfies the agent-friendly bar across all four gates. RAG vector storage uses Supabase's pgvector extension, consolidating document embeddings into the same Postgres instance as application data — no separate vector DB service needed. Background AI generation runs as a separate agentic workflow service on Cloudflare Workers. Scaffolding confidence is first-class; CI on GitHub Actions with auto-deploy-on-merge.
