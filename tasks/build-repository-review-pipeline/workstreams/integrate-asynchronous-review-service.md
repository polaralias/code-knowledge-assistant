---
type: Workstream
task: build-repository-review-pipeline
workstream: integrate-asynchronous-review-service
title: Integrate asynchronous review service
description: Coordinate uploaded ZIP ownership, durable job transitions, review orchestration,
  retained review access, failure cleanup, and deletion.
status: done
created: '2026-08-27T16:04:36Z'
timestamp: '2026-08-27T16:30:58Z'
owner: James Whelan
---

# Integrate asynchronous review service

## Assigned outcome

Coordinate uploaded ZIP ownership, durable job transitions, review orchestration, retained review access, failure cleanup, and deletion.

## Owned and shared paths

- Owned: `packages/review-service/**`
- Shared: consume review-jobs, review-orchestration, answering, and snapshot contracts; root coordinator owns final package wiring.

## Acceptance and validation

- [x] Expose an application service implementing the injected API controller boundary for create, poll, retrieve, question, and delete.
- [x] Transfer accepted upload ownership into a queued job and run review orchestration through explicit processing and terminal transitions.
- [x] Retain completed review/evidence indexes only behind opaque identifiers for follow-up questions during the active lifetime.
- [x] Convert body-free orchestration failures into durable failed jobs while cleaning raw uploads, temporary workspaces, snapshots, and review memory as appropriate.
- [x] Make early deletion idempotent across job metadata, retained snapshot, in-memory review state, and any owned upload.
- [x] Test success, restart-visible job state, failure, deletion, expiry, stale transitions, and cited follow-up questions without executing repository content.

## Evidence

- Commit: not created; the repository still has no initial Git commit.
- Validation: `pnpm test` passed 134 tests; `pnpm typecheck` passed; service success/failure/deletion/expiry tests and the real-ZIP HTTP integration test passed.
- Integration: `createReviewService` connects accepted uploads to `orchestrateZipRepositoryReview`, `FileSystemReviewJobStore`, `FileSystemObjectStore`, deterministic answering, and the API controller adapter.

## Handoff

- Body-free job metadata and source snapshots are filesystem-durable. Completed review objects and evidence indexes are currently process-memory residents and are not rehydrated after an application restart.
- Hosted object storage, multi-instance coordination, and durable hosted review/evidence adapters remain open and are documented in the [deployment readiness](../../../docs/knowledge/deployment-readiness.md) and [architecture concept](../../../docs/knowledge/architecture-concept.md).
