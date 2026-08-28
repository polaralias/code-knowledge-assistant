---
type: Workstream
task: build-repository-review-pipeline
workstream: orchestrate-zip-review-lifecycle
title: Orchestrate ZIP review lifecycle
description: Connect safe ZIP intake, retained source snapshots, rehydration, local
  review generation, and cleanup through one application boundary.
status: done
created: '2026-08-27T06:49:31Z'
timestamp: '2026-08-27T07:13:10Z'
owner: James Whelan
---

# Orchestrate ZIP review lifecycle

## Assigned outcome

Connect safe ZIP intake, retained source snapshots, rehydration, local review generation, and cleanup through one application boundary.

## Owned and shared paths

- Owned: `packages/review-orchestration/**`
- Shared: consume public interfaces from intake, source snapshots, and review pipeline without editing them.

## Acceptance and validation

- [x] Expose one coordinator that consumes a ZIP and creates an immutable policy-filtered source snapshot before review.
- [x] Run review from a disposable rehydrated workspace rather than relying on the extraction directory.
- [x] Consume raw uploads and clean every temporary workspace on success and failure.
- [x] Return review output plus snapshot identity and expiry needed for follow-up questions.
- [x] Reject expired, drifting, or empty-evidence inputs through stable errors without source bodies.
- [x] Test the public success path and material cleanup/rollback failures without executing repository content.

## Evidence

- Commit: uncommitted initial repository; `packages/review-orchestration/**` is the bounded implementation slice.
- Validation: Four focused orchestration tests pass within the 109-test repository suite; strict typechecking passes.
- Integration: `orchestrateZipRepositoryReview` coordinates safe intake, immutable snapshot creation, intake cleanup, snapshot rehydration, `buildLocalRepositoryReview`, rehydration cleanup, and rollback.

## Handoff

- Remaining: hosted object storage, cross-process cleanup coordination, and operator-visible cleanup observability above this filesystem boundary.
