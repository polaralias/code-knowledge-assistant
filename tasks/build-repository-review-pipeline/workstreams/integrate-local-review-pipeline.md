---
type: Workstream
task: build-repository-review-pipeline
workstream: integrate-local-review-pipeline
title: Integrate local review pipeline
description: Connect inventory-backed analysis, deterministic review concepts, and
  provenance-preserving lexical retrieval through one public local review interface.
status: done
created: '2026-08-26T20:59:49Z'
timestamp: '2026-08-27T06:47:02Z'
owner: codex
---

# Integrate local review pipeline

## Assigned outcome

Connect inventory-backed analysis, deterministic review concepts, and provenance-preserving lexical retrieval through one public local review interface.

## Owned and shared paths

- Owned: `packages/review-pipeline/**`.
- Shared: root workspace, test command, and lockfile are coordinator-owned integration surfaces.

## Acceptance and validation

- [x] Expose one public local-review interface that accepts a materialized repository root, its inventory, immutable revision, review identity, and injected generation time.
- [x] Route eligible source through capability analysis, normalized review evidence, all required review concept families, and a queryable lexical evidence index.
- [x] Map primary chunks and derived claims to resolvable repository paths and 1-based line ranges.
- [x] Preserve capability disclosures, exclusions, failures, coverage, generation metadata, and uncertainty through the integrated result.
- [x] Refuse an analysis with no valid evidence rather than generating an ungrounded review.
- [x] Exercise the complete public path against a real temporary repository and prove a question retrieves citation-ready source evidence.

## Evidence

- Commit:
- Validation: Two vertical pipeline tests and the 87-test final repository suite pass; strict TypeScript checking passes.
- Integration: A real temporary repository now flows through `inventoryRepository -> analyzeRepository -> buildDeterministicReviewBundle -> buildLexicalEvidenceIndex`, and a question retrieves a citation-ready source span.

## Handoff

- This is the local provider-free vertical path. LLM prose, ZIP controller wiring, retained-snapshot rehydration, API transport, and the live UI adapter remain later integration layers.
