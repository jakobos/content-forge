---
project: ContentForge
version: 1
status: draft
created: 2026-05-31
updated: 2026-05-31
source: context/foundation/roadmap.md
target: Linear (Content Forge team)
---

# Linear Roadmap Sync Plan

> Mapping from `context/foundation/roadmap.md` (v1) to Linear issues.
> This document captures the agreed structure, format, and decisions for the roadmap-to-Linear conversion.

## Linear Workspace Inventory

| Resource | Value |
|---|---|
| **Team** | Content Forge (`5b8edb10-80a7-4c95-80a2-974e79d04fa2`) |
| **Projects** | None (to be created) |
| **Existing labels** | `Feature`, `Improvement`, `Bug` (defaults) |
| **Statuses** | Backlog → Todo → In Progress → Done (+ Duplicate, Canceled) |

## Agreed Structure

**Approach:** Project + Milestones (Option A)

- One Linear **project** (`ContentForge MVP`) groups all roadmap items.
- Three **milestones** map to the roadmap's dependency streams.
- Two new **labels** (`Foundation`, `Slice`) distinguish roadmap item types.
- **Blocking relations** encode the prerequisite graph from the roadmap.
- **Priority** is assigned by north-star criticality, not stream order.

## Labels to Create

| Name | Color | Purpose |
|---|---|---|
| `Foundation` | `#F2994A` (orange) | Infrastructure/schema items (F-xx) that unlock feature slices |
| `Slice` | `#6FCF97` (green) | User-facing vertical slices (S-xx) |

## Project

| Field | Value |
|---|---|
| Name | `ContentForge MVP` |
| Team | Content Forge |
| State | started |

## Milestones

| Milestone | Stream | Chain | Description |
|---|---|---|---|
| Stream A: Core Generation | A | F-01 → S-01 → S-02 → S-03 → S-08 | North star path -- fastest route to proving the transformation works |
| Stream B: AI Extensions | B | F-02 → S-05 / S-06 / S-09 | AI pipeline and downstream features; joins Stream A at S-02 via F-02 prerequisite |
| Stream C: Profile & Lifecycle | C | S-04 / S-07 / S-10 | Independent from generation; S-07 joins Stream A at S-01 |

## Issues

### Priority Mapping

| Priority level | Linear value | Assigned to |
|---|---|---|
| Urgent | 1 | F-01 (everything depends on it) |
| High | 2 | F-02, S-01, S-02 (north star path + critical foundation) |
| Medium | 3 | S-03, S-04, S-05, S-06, S-07 (supporting features) |
| Low | 4 | S-08, S-09, S-10 (polish/secondary) |

### Issue List

| # | Roadmap ID | Title | Labels | Priority | Status | Milestone |
|---|---|---|---|---|---|---|
| 1 | F-01 | Design and deploy Supabase application data schema | Foundation | Urgent (1) | Todo | Stream A: Core Generation |
| 2 | F-02 | Build AI generation pipeline with async processing | Foundation | High (2) | Backlog | Stream B: AI Extensions |
| 3 | S-01 | Campaign & document CRUD pages | Slice | High (2) | Backlog | Stream A: Core Generation |
| 4 | S-02 | First gated generation (north star) | Slice | High (2) | Backlog | Stream A: Core Generation |
| 5 | S-03 | Idea review lifecycle & markdown copy | Slice | Medium (3) | Backlog | Stream A: Core Generation |
| 6 | S-04 | Business profile wizard & edit form | Slice | Medium (3) | Backlog | Stream C: Profile & Lifecycle |
| 7 | S-05 | Manual idea creation with AI structuring | Slice | Medium (3) | Backlog | Stream B: AI Extensions |
| 8 | S-06 | Single and batch idea regeneration with hints | Slice | Medium (3) | Backlog | Stream B: AI Extensions |
| 9 | S-07 | Campaign & document lifecycle management | Slice | Medium (3) | Backlog | Stream C: Profile & Lifecycle |
| 10 | S-08 | Publication metadata on published ideas | Slice | Low (4) | Backlog | Stream A: Core Generation |
| 11 | S-09 | Background operations status dashboard | Slice | Low (4) | Backlog | Stream B: AI Extensions |
| 12 | S-10 | Account and data deletion | Slice | Low (4) | Backlog | Stream C: Profile & Lifecycle |

### Issue Description Template

Every issue uses this consistent format:

```markdown
## Outcome
{outcome from roadmap}

## Details
- **Roadmap ID:** {F-01 / S-01 / etc.}
- **Change ID:** `{change-id}`
- **PRD refs:** {FR-xxx, FR-yyy}
- **Unlocks:** {downstream IDs}
- **Parallel with:** {concurrent IDs}

## Risk
{risk text from roadmap}

## Unknowns
{unknowns list, or "None"}
```

## Blocking Relations

These encode the `Prerequisites` column from the roadmap. Each row means "blocker must be done before blocked can start."

| # | Blocker | Blocked | Roadmap basis |
|---|---|---|---|
| 1 | F-01 | F-02 | F-02 prerequisite: F-01 |
| 2 | F-01 | S-01 | S-01 prerequisite: F-01 |
| 3 | F-01 | S-04 | S-04 prerequisite: F-01 |
| 4 | F-01 | S-10 | S-10 prerequisite: F-01 |
| 5 | F-02 | S-02 | S-02 prerequisite: F-02 |
| 6 | S-01 | S-02 | S-02 prerequisite: S-01 |
| 7 | S-02 | S-03 | S-03 prerequisite: S-02 |
| 8 | S-03 | S-08 | S-08 prerequisite: S-03 |
| 9 | S-01 | S-07 | S-07 prerequisite: S-01 |
| 10 | F-02 | S-05 | S-05 prerequisite: F-02 |
| 11 | S-01 | S-05 | S-05 prerequisite: S-01 |
| 12 | F-02 | S-06 | S-06 prerequisite: F-02 |
| 13 | S-02 | S-06 | S-06 prerequisite: S-02 |
| 14 | F-02 | S-09 | S-09 prerequisite: F-02 |

**Total: 14 blocking relations**

## Execution Order

```
Phase 1: Create labels (2 calls, parallel)
    |
Phase 2: Create project (1 call) -> Create milestones (3 calls, parallel)
    |
Phase 3: Create issues (12 calls, parallel)
    |
Phase 4: Set blocking relations (14 calls, requires issue IDs from Phase 3)
```

**Total API calls: ~31**

## Linear ID Mapping

| Roadmap ID | Linear ID | URL |
|---|---|---|
| F-01 | CON-5 | https://linear.app/content-forge/issue/CON-5 |
| F-02 | CON-6 | https://linear.app/content-forge/issue/CON-6 |
| S-01 | CON-7 | https://linear.app/content-forge/issue/CON-7 |
| S-02 | CON-8 | https://linear.app/content-forge/issue/CON-8 |
| S-03 | CON-9 | https://linear.app/content-forge/issue/CON-9 |
| S-04 | CON-10 | https://linear.app/content-forge/issue/CON-10 |
| S-05 | CON-11 | https://linear.app/content-forge/issue/CON-11 |
| S-06 | CON-12 | https://linear.app/content-forge/issue/CON-12 |
| S-07 | CON-13 | https://linear.app/content-forge/issue/CON-13 |
| S-08 | CON-14 | https://linear.app/content-forge/issue/CON-14 |
| S-09 | CON-15 | https://linear.app/content-forge/issue/CON-15 |
| S-10 | CON-16 | https://linear.app/content-forge/issue/CON-16 |

## Sync Status

- [x] Phase 1: Labels created (Foundation, Slice)
- [x] Phase 2: Project and milestones created (ContentForge MVP + 3 stream milestones)
- [x] Phase 3: Issues created (CON-5 through CON-16)
- [x] Phase 4: Blocking relations set (14 relations)

Synced on: 2026-05-31
