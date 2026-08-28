---
type: Workstream
task: build-product-experience
workstream: load-preindexed-public-demo
title: Load a pre-indexed public demo
description: Validate and load one immutable generated review artifact for anonymous
  evidence-backed exploration without executing or contacting its source repository.
status: done
created: '2026-08-27T23:17:19Z'
timestamp: '2026-08-27T23:18:19Z'
owner: luna-demo
---

# Load a pre-indexed public demo

## Assigned outcome

Validate and load one immutable generated review artifact for anonymous evidence-backed exploration without executing or contacting its source repository.

## Owned and shared paths

- Owned:
- Shared:

## Acceptance and validation

- [x] Load only a bounded immutable generated review artifact from a configured local JSON path.
- [x] Strictly validate schema, state, coverage, sections, capabilities, evidence, citations, paths, dates, counts, and extra fields.
- [x] Answer anonymous demo questions only from the artifact's validated evidence index without provider/network/source execution.
- [x] Return stable body-free failures and an immutable browser-compatible review.
- [x] Verify through the public package interface without network access.

## Evidence

- Commit: working-tree slice (repository is not yet committed).
- Validation: `pnpm --filter @code-knowledge-assistant/demo-review test` passes 3/3; strict package typecheck passes.
- Integration: `apps/api` loads the artifact once and serves the demo contract; `deploy/start.mjs` and the Dockerfile bundle and identify the pinned Uptime Kuma artifact. Clean hosted-browser verification remains a parent-task evidence item.

## Handoff

- Record remaining risks, integration instructions, and knowledge-promotion needs.
