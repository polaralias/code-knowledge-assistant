---
type: Workstream
task: build-repository-review-pipeline
workstream: schedule-review-expiry
title: Schedule review expiry and cleanup
description: Run bounded periodic expiry sweeps that reconcile job metadata, source
  snapshots, review artifacts, and temporary state.
status: done
created: '2026-08-27T16:36:53Z'
timestamp: '2026-08-27T17:00:33Z'
owner: codex
---

# Schedule review expiry and cleanup

## Assigned outcome

Run bounded periodic expiry sweeps that reconcile job metadata, source snapshots, review artifacts, and temporary state.

## Owned and shared paths

- Owned: `packages/review-service/**`, `packages/review-jobs/**`, and root integration tests for the expiry lifecycle.
- Shared: consume the completed-review artifact store once available; root coordinator owns cross-package wiring and task records.

## Acceptance and validation

- [x] Align ready-job retention to 48 hours after review completion while retaining a bounded processing deadline.
- [x] Add an injectable periodic scheduler with explicit start, non-overlapping sweep, error reporting, and idempotent stop behaviour.
- [x] Sweep expired job metadata, source snapshots, persisted review artifacts, memory state, and owned temporary uploads through one service boundary.
- [x] Recover ready review metadata and artifacts after service reconstruction without reprocessing source.
- [x] Keep failures body-free and avoid deleting non-expired or currently processing reviews.
- [x] Test deadline semantics, overlapping ticks, restart recovery, partial cleanup failures, and clean shutdown through public interfaces.

## Evidence

- Commit: not created; repository has no initial Git commit and no commit was authorised.
- Validation: review-job, artifact, service, scheduler, and API runtime suites pass; full TypeScript check passes.
- Integration: `buildUploadReviewServer` starts the scheduler and stops it when the HTTP server closes; runtime tests prove restart recovery.

## Handoff

- Local cleanup is reconciled across filesystem stores. Multi-replica scheduling, hosted lifecycle rules, backup deletion, and deletion observability remain production work.
