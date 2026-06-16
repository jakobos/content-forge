---
change_id: deterministic-generation-workflow
title: Deterministic generation workflow
status: archived
created: 2026-06-13
updated: 2026-06-16
archived_at: 2026-06-16T14:34:00Z
---

## Notes

Replaces the non-deterministic agent-loop generation path (F-02 runner + tools)
with a fixed, server-orchestrated pipeline: rule-based multi-query retrieval ->
single structured-output LLM call -> server-side validation + persistence.
"Deterministic" refers to the workflow control flow, NOT the output — ideas stay
creative (higher temperature, no reproducibility guarantee).

Supersedes the unbuilt phases (3-4) of S-02 `first-gated-generation`; keeps its
landed Phase 1 (auto-embed) and the ideas schema/persist table work.
