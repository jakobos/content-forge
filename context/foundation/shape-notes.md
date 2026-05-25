---
project: "ContentForge"
context_type: greenfield
created: 2026-05-19
updated: 2026-05-20
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "pain category"
      decision: "workflow friction — manual bridge from raw material to structured post ideas"
    - topic: "competitive insight"
      decision: "brand context persistence + hierarchical strategy + structure over prose"
    - topic: "primary persona scope"
      decision: "solo experts / consultants building personal brands via social media"
    - topic: "auth strategy"
      decision: "email + password / OAuth; server-side data"
    - topic: "role model"
      decision: "flat — one role, all users equal"
    - topic: "MVP scope"
      decision: "dropped auto-tagging and comment-to-improve; added manual idea creation; kept RAG fragments and two doc types"
    - topic: "timeline"
      decision: "3 weeks after-hours"
    - topic: "document content mutability"
      decision: "content editable but versioned; old versions preserved for fragment references"
    - topic: "document deletion"
      decision: "active → archived → can be permanently deleted; deleted fragment refs show placeholder"
    - topic: "idea structure"
      decision: "core fields fixed (title, hook, key points, sources) + dynamic optional fields selected by AI per idea"
    - topic: "regeneration behavior"
      decision: "previous ideas stay alongside new ones; optional short hint (up to 200 chars) guides regeneration"
    - topic: "campaign edit impact"
      decision: "editing a campaign flags existing ideas for review"
  frs_drafted: 20
  quality_check_status: accepted
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: false
---

## Vision & Problem Statement

Solo experts and consultants who build personal brands through social media content face a draining workflow friction: the bridge from raw material (reports, notes, scattered thoughts) to structured, on-brand post ideas is manual, slow, and inconsistent. They either burn time staring at the blank page, produce posts that drift from their brand strategy, or skip publishing altogether — costing reach, consistency, and credibility. No single tool covers the full lifecycle from strategy through raw input to structured ideas to published posts.

Existing AI writing tools miss three things: (1) they don't persist brand context — tone, audience, goals must be re-explained every session; (2) they treat every generation as isolated, with no connection between campaign-level strategy and individual post ideas; (3) they produce finished prose when these users want structured skeletons (hook, bullet points, flow, key insights) that they finish and publish themselves.

## User & Persona

**Primary persona:** Solo expert / consultant (e.g., AI advisor, business coach, industry analyst) who publishes content on social media (LinkedIn, X) to build authority, attract clients, and promote products (e-books, courses, services). They have domain expertise and raw material but lack a structured system for turning it into consistent, on-brand content.

**Future vision (beyond MVP):**
- Store post lifecycle: drafts, revisions, published posts tracked inside the app
- AI-assisted campaign planning

## Access Control

Login via email + password or OAuth. Server-side data storage. Flat user model — one role, all users have the same capabilities. No admin/member separation in MVP.

## Success Criteria

### Primary
- User goes from raw documents to structured, on-brand post ideas in one session.
- Generated ideas clearly reflect the business profile (tone, audience, keywords) — not generic AI output.
- Ideas within a campaign are thematically coherent with each other.
- A user can produce a week's worth of post ideas in a single session vs. hours of manual work.

### Secondary
- Campaign/idea big-picture view — overview of what was done and the strategic direction the user is heading.
- Lifecycle statuses on campaigns and ideas: draft, ready, published, canceled.
- Visual suggestion for each idea (image/graphic recommendation).

### Guardrails
- Source material privacy — documents and business profile data must not leak to other users or be used for model training.
- No hallucinated sources — every fragment reference in a generated idea must point to real content the user uploaded.
- Data integrity — documents, campaigns, and ideas must not be lost or corrupted between sessions.

### MVP Flow (locked)

1. User opens app → business profile wizard
2. Wizard completes → Campaigns page
3. User creates a campaign (form)
4. User adds documents to campaign:
   a. Source document (name, title, link, references, created/updated)
   b. User insight (title, created/updated)
5. User generates post ideas (two paths):
   a. "Generate from documents" — AI analyzes docs via RAG, produces structured ideas with fragment references
   b. "Add idea manually" — user describes an idea, AI generates structured version based on description + documents
6. User reviews: accept or decline
7. Accepted ideas are easy to copy-paste

**Dropped for v2:** auto-tagging, comment-to-improve loop
**Future vision (captured in Step 1):** post lifecycle storage (drafts → published), AI-assisted campaign planning

## Functional Requirements

### Onboarding
- FR-001: User can create an account (email+password or OAuth). Priority: must-have
  > Socrates: "Local-first MVP ships faster without auth." Resolution: kept — multi-device access and data persistence matter from day one.
- FR-002: User can complete a business profile wizard (brand goal, audience, tone of voice, archetype, keywords, preferred formats, resources, pain points, transformation, delivered value). Priority: must-have
  > Socrates: "10-field wizard is a high-friction onboarding wall." Resolution: kept — all fields needed for quality generation; the wizard IS the value proposition.
- FR-003: User can edit their business profile after initial setup. Priority: must-have
  > Socrates: "Could just re-run the wizard." Resolution: kept as simple edit form, not wizard re-run.

### Campaigns
- FR-004: User can create a campaign (with goal/theme and additional attributes). Priority: must-have
  > Socrates: "Campaigns are a thin wrapper — skip for v1?" Resolution: kept — campaigns are the essential strategic layer; user wants additional attributes beyond goal/theme.
- FR-005: User can view a list of their campaigns. Priority: must-have
- FR-006: User can edit campaign details; editing flags existing ideas for review. Priority: must-have
  > Socrates: "Should edits propagate to existing ideas?" Resolution: editing a campaign flags existing ideas for review (not auto-delete, not ignore).
- FR-007: User can manage campaign lifecycle: draft → active → completed → archived. Priority: must-have
  > Socrates: "Four states is ceremony for MVP." Resolution: kept — draft = planning, active = creating content, completed = goal met, archived = historical.

### Documents
- FR-008: User can add a source document to a campaign (title + raw text content; optional link; created/updated dates auto-set). Priority: must-have
  > Socrates: "Six metadata fields is heavy." Resolution: slimmed to title + raw text + optional link; dates auto-set; references field dropped.
- FR-009: User can add a user insight to a campaign (title + text content; created/updated dates auto-set). Priority: must-have
  > Socrates: "Unify into one doc type with optional fields?" Resolution: kept as two types — source docs are external material, insights are the user's own thinking. They serve different roles in generation.
- FR-010: User can edit document metadata (title, link) and content. Content edits create a new version; old versions are preserved so existing fragment references remain valid. Priority: must-have
  > Socrates: "Immutability means re-create on typo." Resolution: revised — content is editable but versioned; old versions preserved for fragment reference integrity.
- FR-011: User can manage document lifecycle: active → archived. Archived documents can be permanently deleted; references to deleted fragments show a placeholder. Priority: must-have
  > Socrates: "No-deletion blocks removal of sensitive content." Resolution: revised — archived docs can be permanently deleted; deleted fragment refs show placeholder.

### Idea Generation
- FR-012: User can generate post ideas from campaign documents — AI analyzes docs via RAG and produces structured ideas with fragment references from one or more documents. Priority: must-have
  > Socrates: "RAG is the heaviest component — context-window stuffing ships faster." Resolution: kept — fragment references are core value and product differentiator.
- FR-013: User can manually describe an idea — AI generates a structured version based on that description + campaign documents. Priority: must-have
  > Socrates: "Two generation paths double prompt engineering." Resolution: kept — it's a different workflow need (structuring vs. discovering).
- FR-014: Each generated idea includes core fixed fields (working title, hook, key points, source references) plus dynamic optional fields (e.g., proposed flow, key quotes, insights/conclusions) selected by AI based on the idea's content. Priority: must-have
  > Socrates: "Seven rigid fields may not fit all content styles." Resolution: revised — core fields fixed, AI dynamically selects additional fields per idea.

### Idea Review
- FR-015: User can manage idea lifecycle: draft → accepted → published → archived | declined. Priority: must-have
  > Socrates: "Five states is complex — three is enough." Resolution: kept — all states map to real content workflow stages.
- FR-016: User can copy-paste an accepted idea's full structured content in markdown syntax. Priority: must-have
  > Socrates: "What format gets copied?" Resolution: full structured idea in markdown.
- FR-017: User can regenerate a single idea with an optional short improvement hint (up to 200 chars). Previous ideas stay alongside new ones. Priority: must-have
  > Socrates: "Regeneration without feedback is a slot machine." Resolution: revised — optional hint guides regeneration; old ideas preserved alongside new ones.
- FR-018: User can regenerate an entire batch with an optional short improvement hint (up to 200 chars). Previous ideas stay alongside new ones. Priority: must-have
  > Socrates: Same as FR-017.
- FR-019: User can attach publication metadata to a published idea (URL, platform name, publish date, optional note). Priority: must-have
  > Socrates: "Publication tracking is a secondary concern." Resolution: kept — closing the loop matters for campaign overview completeness.

### Account
- FR-020: User can permanently delete their account and all associated data (profile, campaigns, documents, ideas). Priority: must-have
  > Socrates: "Cascading deletes are expensive — manual process for v1?" Resolution: kept — self-service deletion; privacy is a guardrail.

## User Stories

### US-01: User generates post ideas from campaign documents

- **Given** a user with a completed business profile and a campaign with at least one document added
- **When** they click "Generate post ideas"
- **Then** the system produces a set of structured post ideas (title, hook, bullet points, flow, quotes, insights, source references) that reflect the business profile tone/audience and align with the campaign's goal

#### Acceptance Criteria
- Each idea references specific fragments from one or more campaign documents
- Ideas reflect business profile (tone, keywords, audience)
- Ideas are thematically coherent with the campaign goal
- User can immediately accept, decline, or regenerate each idea

### US-02: User creates an idea from a manual description

- **Given** a user with a completed business profile and a campaign with at least one document
- **When** they describe an idea in their own words and submit it
- **Then** the system generates a structured post idea based on that description, enriched with relevant fragments from one or more campaign documents

#### Acceptance Criteria
- The generated structure follows the same format as auto-generated ideas
- The user's original description is preserved/visible alongside the structured output
- Relevant document fragments are matched and referenced from across campaign documents

## Business Logic

The app helps to manage strategically the social media content ideas by transforming raw source documents into structured on-brand post ideas for a given campaign's context.

The transformation rule consumes three inputs: (1) the user's business profile — tone of voice, audience, keywords, archetype, brand goal, and other persistent brand attributes; (2) the campaign context — the strategic goal, theme, and additional attributes that frame this specific content effort; (3) document content — raw text from source documents (external material like reports and articles) and user insights (the user's own thinking and notes).

The output is a set of structured post ideas, each with core fixed fields (working title, hook, key points, source references) plus dynamic optional fields selected based on the idea's content. Each idea traces back to the specific document fragments that informed it, so the user can verify provenance.

The user encounters this rule at two points: when they click "Generate post ideas" (system analyzes campaign documents and produces a batch of structured ideas), and when they manually describe an idea (system structures and enriches the description using campaign documents).

## Non-Functional Requirements

- The user sees continuous visible feedback during idea generation, and receives results within a reasonable time window — generation must not feel stalled or abandoned.
- User data (documents, business profile, campaigns, ideas) persists until the user explicitly deletes or archives it. No silent expiration or automatic cleanup.
- The app is usable on phone and tablet screens, not only desktop — responsive layout that supports the core workflow on mobile devices.

## Non-Goals

- No auto-publishing to social platforms — no LinkedIn/X API integration in MVP. User copies and publishes manually.
- No image/graphic generation — visual suggestions are text-only (secondary criterion); no AI-generated visuals.
- No PDF/DOCX parsing — plain text input only. No file upload processing for complex document formats.
- No team/collaboration features — single-user experience. No shared campaigns, co-editing, or role-based access.
- No content calendar / scheduling — no timeline view, date-based planning, or publication scheduling.

## Quality cross-check

All 6 greenfield elements present. No gaps. Status: accepted.

## Open Questions

1. **What are the campaign's "additional attributes" beyond goal/theme?** — Owner: user. Examples: target platform, audience segment, content pillars, duration. Block: no (campaigns work with just goal/theme; attributes enrich generation).
2. **How many ideas does a batch generation produce?** — Owner: user. Fixed number, user-configurable, or AI-decided? Block: no (can default to a reasonable number).
3. **What exactly is a "visual suggestion" (secondary criterion)?** — Owner: user. Text description, stock photography keyword, image generation prompt? Block: no (secondary criterion, not MVP-blocking).
