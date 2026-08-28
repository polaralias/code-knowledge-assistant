---
type: Workstream
task: build-repository-review-pipeline
workstream: persist-completed-review-artifacts
title: Persist completed review artifacts
description: Persist generated review data and reconstruct cited evidence indexes
  after an application restart.
status: done
created: '2026-08-27T16:36:50Z'
timestamp: '2026-08-27T17:00:21Z'
owner: terra-artifacts
---

# Persist completed review artifacts

## Assigned outcome

Persist generated review data and reconstruct cited evidence indexes after an application restart.

## Owned and shared paths

- Owned: `packages/review-artifacts/**`
- Shared: expose a provider-neutral artifact-store contract; do not edit review-service, API, root configuration, documentation, or task records.

## Acceptance and validation

- [x] Persist a versioned completed-review artifact without absolute paths, credentials, or uncontrolled fields.
- [x] Reconstruct the full `LocalRepositoryReview` and lexical evidence index through the public store interface.
- [x] Publish atomically and reject corrupt, mismatched, duplicate, unsafe, or integrity-drifted records through stable body-free errors.
- [x] Support get, delete, and expiry discovery with idempotent deletion and opaque path-safe identifiers.
- [x] Prove restart reads by reconstructing the filesystem adapter and answering a cited question from the loaded artifact.
- [x] Keep storage provider-neutral and test only public behaviour.

## Evidence

- Commit: not created; repository has no initial Git commit and no commit was authorised.
- Validation: `packages/review-artifacts` tests pass; full TypeScript check passes; runtime reconstruction serves the same review and cited answer after restart.
- Integration: `buildUploadReviewServer` supplies `FileSystemReviewArtifactStore`; `createReviewService` persists before ready publication and reloads on demand.

## Handoff

- The filesystem adapter is suitable for the singleton local/reference deployment. Distributed locking and hosted object/database adapters remain future production work.
