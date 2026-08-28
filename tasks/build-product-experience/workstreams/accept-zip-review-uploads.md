---
type: Workstream
task: build-product-experience
workstream: accept-zip-review-uploads
title: Accept ZIP review uploads
description: Expose bounded ZIP upload, job-status, review, and deletion routes through
  the local HTTP adapter.
status: done
created: '2026-08-27T16:04:33Z'
timestamp: '2026-08-27T16:31:02Z'
owner: James Whelan
---

# Accept ZIP review uploads

## Assigned outcome

Expose bounded ZIP upload, job-status, review, and deletion routes through the local HTTP adapter.

## Owned and shared paths

- Owned: `apps/api/**`
- Shared: consume an injected review-job controller contract; root integration owns workspace configuration and package wiring.

## Acceptance and validation

- [x] Accept one bounded `application/zip` request body without buffering beyond the configured upload limit.
- [x] Write uploads to an isolated server-owned temporary path and transfer ownership only after the controller accepts the job.
- [x] Expose create, poll, completed-review, question, and early-delete routes with stable JSON contracts.
- [x] Validate review/job identifiers, methods, content types, body limits, and route shapes before controller work.
- [x] Map queued, processing, ready, failed, expired, deleted, rate-limited, and unknown states to deliberate HTTP responses without absolute paths or source bodies.
- [x] Clean partial uploads on disconnect, rejection, or controller failure and test the complete injected route boundary.

## Evidence

- Commit: not created; the repository still has no initial Git commit.
- Validation: `pnpm test` passed 134 tests; `pnpm typecheck` passed; 12 API tests and a real-ZIP runtime test cover the route boundary.
- Integration: `buildUploadReviewServer` injects `createReviewServiceController`, serves `/api` configuration to the browser, and removes incoming temporary directories after ownership transfer.

## Handoff

- The upload API is local and dependency-free. Authentication, rate-limit persistence, hosted storage, and deployment controls remain future work.
- The current boundary is documented in the [architecture concept](../../../docs/knowledge/architecture-concept.md).
