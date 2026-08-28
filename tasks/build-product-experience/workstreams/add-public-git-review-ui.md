---
type: Workstream
task: build-product-experience
workstream: add-public-git-review-ui
title: Add public Git review input
description: Let a user start and follow a public GitHub review from the existing
  repository intake workspace alongside ZIP upload.
status: done
created: '2026-08-27T17:16:03Z'
timestamp: '2026-08-27T21:33:40Z'
owner: luna-web
---

# Add public Git review input

## Assigned outcome

Let a user start and follow a public GitHub review from the existing repository intake workspace alongside ZIP upload.

## Owned and shared paths

- Owned: `apps/web/**`.
- Shared: consume the documented API contract without changing server or package code.

## Acceptance and validation

- [x] Present Public GitHub URL and ZIP as two clear intake modes in the existing review dialog.
- [x] Validate a credential-free GitHub HTTPS repository URL and optional ref before sending while keeping server validation authoritative.
- [x] Submit bounded JSON, reuse opaque polling/review loading, and show deliberate queued, processing, failed, expired, deleted, rate-limited, and network states.
- [x] Keep repository contents and credentials out of browser persistence and diagnostics.
- [x] Preserve ZIP upload, review navigation, cited questions, deletion, responsive behaviour, and accessible form semantics.
- [x] Test request shape, validation, state transitions, mode switching, and regression coverage through public client/UI behaviour.

## Evidence

- Commit: not yet committed; the current working tree is the reviewable evidence boundary.
- Validation: the Git client/UI tests pass as part of `pnpm test` (168 tests); strict typecheck passes; request-shape, validation, polling, error, and ZIP-regression coverage is present.
- Integration: the existing review dialog switches between ZIP and Public GitHub, sends only bounded JSON, and reuses opaque job polling and review loading. A clean browser Git-flow observation remains a release gate.

## Handoff

- Remaining risk: the Git UI has contract coverage but still needs a clean hosted-browser smoke and stable screenshots for the public release evidence.
