---
type: Workstream
task: build-product-experience
workstream: connect-live-review-data
title: Connect live review data
description: Replace the workspace hard fixture dependency with a validated asynchronous
  client seam while retaining the pre-indexed demo fallback.
status: done
created: '2026-08-27T06:49:39Z'
timestamp: '2026-08-28T02:26:59Z'
owner: James Whelan
---

# Connect live review data

## Assigned outcome

Replace the workspace hard fixture dependency with a validated asynchronous client seam while retaining the pre-indexed demo fallback.

## Owned and shared paths

- Owned: `apps/web/**`
- Shared: preserve the documented fixture schema and consume the agreed local API response without editing backend packages.

## Acceptance and validation

- [x] Add an asynchronous data client that validates live review responses before rendering.
- [x] Prefer a configured live endpoint while preserving an explicit pre-indexed demo fallback.
- [x] Map request, invalid-response, network-failure, and empty results into deliberate workspace states.
- [x] Submit questions through the same client and render only validated cited answers.
- [x] Avoid placing repository content or credentials in URLs, logs, or persistent browser storage.
- [x] Extend dependency-free tests for client validation and live/fallback state routing.

## Evidence

- Commit: uncommitted initial repository; `apps/web/**` contains the live-data slice.
- Validation: Eleven dependency-free browser-contract tests pass within the 109-test repository suite.
- Integration: Browser execution verified live review loading, question submission with the loaded review identity, cited answer rendering, and source-span inspection; integration-only defects found during this pass were repaired and regression-tested.

## Handoff

- Remaining: clean hosted-browser upload/Git/deletion verification and stable public screenshots. Bundled local demo routing and cited-question flow are now runtime-verified; access-code gating and persistent hosted limits are implemented in the API.
