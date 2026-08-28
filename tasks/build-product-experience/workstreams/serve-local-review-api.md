---
type: Workstream
task: build-product-experience
workstream: serve-local-review-api
title: Serve the local review API
description: Expose the implemented review and answer paths through a bounded local
  HTTP adapter and verify the browser can consume them.
status: done
created: '2026-08-27T06:49:42Z'
timestamp: '2026-08-27T07:13:25Z'
owner: James Whelan
---

# Serve the local review API

## Assigned outcome

Expose the implemented review and answer paths through a bounded local HTTP adapter and verify the browser can consume them.

## Owned and shared paths

- Owned: `apps/api/**`
- Shared: consume review-pipeline and answering public interfaces; root workspace metadata may be updated only by the coordinator.

## Acceptance and validation

- [x] Serve bounded JSON endpoints for a pre-indexed local review and cited questions.
- [x] Validate methods, routes, content types, request bodies, and size limits before application work.
- [x] Return a stable browser-facing view model without exposing local absolute paths or source bodies outside cited spans.
- [x] Keep the server dependency-free, localhost-safe by default, and injectable for tests.
- [x] Map known application failures to deliberate status codes and body-safe errors.
- [x] Prove review retrieval, cited questions, rejection paths, and graceful server lifecycle through integration tests.

## Evidence

- Commit: uncommitted initial repository; `apps/api/**` is the bounded implementation slice.
- Validation: Seven API/adapter/runtime tests pass within the 109-test repository suite; strict typechecking passes.
- Integration: `buildLocalReviewServer` inventories and reviews a real materialized repository, serves the workspace and API from one localhost origin, and maps deterministic cited answers into the validated browser contract.

## Handoff

- Remaining: provider-backed generation/evaluation and hosted deployment configuration. Authentication/access-code gating and persistent limits are now integrated at hosted entrypoints.
