---
change_id: data-authorization
title: RLS policies and API authorization on all application tables
status: archived
created: 2026-07-13
updated: 2026-07-14
archived_at: 2026-07-14T13:54:39Z
---

## Notes

RLS policies and API authorization enforced on all application tables. Ensures users access only their own data; API endpoint authorization patterns established so every server route verifies ownership before returning or mutating rows. Must precede multi-user deployment.
