---
type: Workstream
task: build-repository-review-pipeline
workstream: generalise-materialized-review-orchestration
title: Generalise materialized repository review orchestration
description: Review a safely materialized repository through the same snapshot, disposable
  rehydration, evidence, and cleanup lifecycle used by ZIP intake.
status: done
created: '2026-08-27T17:16:00Z'
timestamp: '2026-08-27T21:33:33Z'
owner: terra-orchestration
---

# Generalise materialized repository review orchestration

## Assigned outcome

Review a safely materialized repository through the same snapshot, disposable rehydration, evidence, and cleanup lifecycle used by ZIP intake.

## Owned and shared paths

- Owned: `packages/review-orchestration/**`.
- Shared: preserve `orchestrateZipRepositoryReview`; expose one provider-neutral materialized-directory path for Git intake consumers.

## Acceptance and validation

- [x] Snapshot only inventory-eligible source and preserve exclusion reasons without excluded bodies.
- [x] Delete the acquired intake workspace before reviewing a fresh disposable rehydration.
- [x] Preserve immutable source revision, review identifier, snapshot expiry, body-free failures, rollback, and idempotent cleanup.
- [x] Route ZIP orchestration through the same materialized lifecycle without changing its public behaviour.
- [x] Test success, evidence failure, cleanup failure, snapshot rollback, and source drift through public interfaces.

## Evidence

- Commit: not yet committed; the current working tree is the reviewable evidence boundary.
- Validation: `pnpm test` passes 168 tests; `pnpm typecheck` passes; orchestration tests cover six success, rollback, cleanup, expiry, drift, and evidence paths.
- Integration: ZIP and public Git service paths both call `orchestrateMaterializedRepositoryReview`; the live public Git smoke reached `ready`.

## Handoff

- Remaining risk: hosted object/database adapters and multi-instance coordination remain outside this filesystem-backed singleton slice.
