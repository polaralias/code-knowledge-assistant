---
type: Workstream
task: build-product-experience
workstream: build-upload-progress-experience
title: Build upload and progress experience
description: Let a user submit a ZIP, observe deliberate review stages, recover from
  failure, and enter the completed review workspace.
status: done
created: '2026-08-27T16:04:35Z'
timestamp: '2026-08-27T16:31:06Z'
owner: James Whelan
---

# Build upload and progress experience

## Assigned outcome

Let a user submit a ZIP, observe deliberate review stages, recover from failure, and enter the completed review workspace.

## Owned and shared paths

- Owned: `apps/web/**`
- Shared: consume the documented ZIP-job HTTP contract; do not edit API, backend packages, root configuration, or task records.

## Acceptance and validation

- [x] Add an accessible ZIP chooser and submit action without reading or persisting repository contents in browser storage.
- [x] Validate extension, non-empty size, and disclosed client-side limit before upload while keeping server validation authoritative.
- [x] Render queued, uploading, processing, ready, failed, expired, deleted, and rate-limited progress states with recovery actions.
- [x] Poll only the opaque job endpoint at a bounded interval and stop polling on every terminal state or teardown.
- [x] Load the completed live review and preserve the existing cited question/evidence experience.
- [x] Keep the pre-indexed fixture journey when no live upload endpoint is configured and add dependency-free tests for state and client routing.

## Evidence

- Commit: not created; the repository still has no initial Git commit.
- Validation: `pnpm test` passed 134 tests; browser execution uploaded a real ZIP, opened its generated review, and returned cited `src/endpoint.ts` evidence without console warnings.
- Integration: the browser consumes the exact `{ state, jobId, reviewId }`, wrapped review, and wrapped answer contracts served by `apps/api`.

## Handoff

- The fixture remains the no-endpoint fallback; `/api` activates live uploads. A browser-discovered native form-validation defect was fixed by keeping file presence validation in retained application state after re-render.
- The user-visible flow is documented in the [review output contract](../../../docs/knowledge/review-output-contract.md).
