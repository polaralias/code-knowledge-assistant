---
type: Workstream
task: build-repository-review-pipeline
workstream: persist-review-jobs
title: Persist review jobs
description: Store versioned body-free review job state durably with atomic transitions,
  expiry metadata, and restart-safe reads.
status: done
created: '2026-08-27T16:04:32Z'
timestamp: '2026-08-27T16:30:53Z'
owner: James Whelan
---

# Persist review jobs

## Assigned outcome

Store versioned body-free review job state durably with atomic transitions, expiry metadata, and restart-safe reads.

## Owned and shared paths

- Owned: `packages/review-jobs/**`
- Shared: expose a stable package contract; do not edit API, orchestration, root configuration, documentation, or task records.

## Acceptance and validation

- [x] Define a versioned job record with queued, processing, ready, failed, expired, and deleted lifecycle states.
- [x] Store only body-free job, snapshot, review identity, timing, capability-summary, and stable error metadata.
- [x] Provide atomic create, read, compare-and-transition, list-expired, and delete operations through a provider-neutral interface.
- [x] Implement a restart-safe filesystem adapter using write-then-rename publication and path-safe identifiers.
- [x] Reject unknown fields, invalid transitions, stale versions, corrupt records, and path escapes through stable errors.
- [x] Test concurrency/version conflicts, restart reads, corruption, expiry discovery, deletion, and absence of source bodies.

## Evidence

- Commit: not created; the repository still has no initial Git commit.
- Validation: `pnpm test` passed 134 tests; `pnpm typecheck` passed; the focused job-store suite passed 6 tests.
- Integration: `FileSystemReviewJobStore` now supplies durable metadata to the asynchronous [review service](./integrate-asynchronous-review-service.md).

## Handoff

- Job records survive filesystem-store reconstruction and contain no source bodies. Completed review bodies remain outside this store by design.
- Durable lifecycle boundaries are promoted in the [architecture concept](../../../docs/knowledge/architecture-concept.md).
