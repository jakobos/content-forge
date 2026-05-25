---
bootstrapped_at: 2026-05-21T12:04:00Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: content-forge
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
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
```

### Why this stack

Solo builder shipping a content-strategy web app in 3 weeks with auth, AI-powered idea generation, and background jobs. The 10x Astro Starter (Astro 6 + React 19 + Supabase + Cloudflare) provides auth, database, and edge deployment out of the box — the three heaviest setup costs eliminated from day one. TypeScript + Zod at boundaries satisfies the agent-friendly bar across all four gates. RAG vector storage uses Supabase's pgvector extension, consolidating document embeddings into the same Postgres instance as application data — no separate vector DB service needed. Background AI generation runs as a separate agentic workflow service on Cloudflare Workers. Scaffolding confidence is first-class; CI on GitHub Actions with auto-deploy-on-merge.

## Pre-scaffold verification

| Signal        | Value                                          | Severity | Notes                                      |
| ------------- | ---------------------------------------------- | -------- | ------------------------------------------ |
| npm package   | not run                                        | —        | cmd_template uses git clone, not npm create |
| GitHub repo   | przeprogramowani/10x-astro-starter last pushed 2026-05-17 | fresh    | from card.docs_url                         |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone
**Exit code**: 0
**Files moved**: 19
**Conflicts (.scaffold siblings)**: none
**.gitignore handling**: moved silently (no pre-existing .gitignore in cwd)
**.bootstrap-scaffold/.git/ deleted**: yes (upstream history stripped before move-up)
**.bootstrap-scaffold cleanup**: deleted

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 1 HIGH, 10 MODERATE, 0 LOW
**Direct vs transitive**: 0/0/3/0 direct of total 0/1/10/0

#### CRITICAL findings

None.

#### HIGH findings

- **devalue** 5.6.3–5.8.0 — DoS via sparse array deserialization (GHSA-77vg-94rm-hx3p, CVSS 7.5). Transitive. Fix available via `npm audit fix`.

#### MODERATE findings

- **@astrojs/check** >=0.9.3 — via @astrojs/language-server (transitive yaml vulnerability). Direct dependency. Fix: downgrade to 0.9.2 (semver-major).
- **@astrojs/cloudflare** >=12.2.4 — via @cloudflare/vite-plugin and wrangler (ws vulnerability). Direct dependency. Fix: downgrade to 12.6.13 (semver-major).
- **@astrojs/language-server** >=2.14.0 — via volar-service-yaml. Transitive.
- **@cloudflare/vite-plugin** >=0.0.7 — via miniflare, wrangler, ws. Transitive.
- **miniflare** >=3.20250204.0 — via ws. Transitive.
- **volar-service-yaml** <=0.0.70 — via yaml-language-server. Transitive.
- **wrangler** >=3.108.0 — via miniflare (ws vulnerability). Direct dependency. Fix: downgrade to 3.107.3 (semver-major).
- **ws** 8.0.0–8.20.0 — Uninitialized memory disclosure (GHSA-58qx-3vcg-4xpx, CVSS 4.4). Transitive.
- **yaml** 2.0.0–2.8.2 — Stack Overflow via deeply nested YAML collections (GHSA-48c2-rrv3-qjmp, CVSS 4.3). Transitive.
- **yaml-language-server** — via yaml. Transitive.

#### LOW / INFO findings

None.

## Hints recorded but not acted on

| Hint                       | Value                                                                 |
| -------------------------- | --------------------------------------------------------------------- |
| bootstrapper_confidence    | first-class                                                           |
| quality_override           | false                                                                 |
| path_taken                 | custom                                                                |
| self_check_answers         | typed: true, from_official_starter: true, conventions: true, docs_current: true, can_judge_agent: true |
| team_size                  | solo                                                                  |
| deployment_target          | cloudflare-pages                                                      |
| ci_provider                | github-actions                                                        |
| ci_default_flow            | auto-deploy-on-merge                                                  |
| has_auth                   | true                                                                  |
| has_payments               | false                                                                 |
| has_realtime               | false                                                                 |
| has_ai                     | true                                                                  |
| has_background_jobs        | true                                                                  |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review any `.scaffold` siblings the conflict policy created and decide which version of each file to keep.
- Address audit findings per your project's risk tolerance — the full breakdown is in this log.
