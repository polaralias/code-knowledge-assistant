---
type: Workstream
task: build-grounded-conversation
workstream: implement-lexical-retrieval
title: Implement lexical evidence retrieval
description: Index derived and primary evidence into a deterministic lexical retrieval
  boundary with provenance-preserving ranked results.
status: done
created: '2026-08-26T20:49:52Z'
timestamp: '2026-08-27T06:47:07Z'
owner: terra-retrieval
---

# Implement lexical evidence retrieval

## Assigned outcome

Index derived and primary evidence into a deterministic lexical retrieval boundary with provenance-preserving ranked results.

## Owned and shared paths

- Owned: `packages/retrieval/**`.
- Shared: none during parallel implementation. The lifecycle coordinator alone changes root workspace configuration, parent tasks, and canonical docs.

## Acceptance and validation

- [x] Expose provider-independent public interfaces to build and query an immutable lexical evidence index.
- [x] Accept primary-source and derived-knowledge records through a small explicit document contract carrying stable identity and provenance.
- [x] Return deterministic ranked results with repository path, line range, layer, score, and bounded content needed for later citation assembly.
- [x] Search across both evidence layers, use stable tie-breaking, and prevent duplicate records from silently overwriting one another.
- [x] Return an explicit insufficient-evidence result for empty, stop-word-only, or non-matching questions.
- [x] Apply configurable result and context-byte limits outside any model boundary.
- [x] Test ranking, provenance preservation, mixed-layer retrieval, ties, malformed records, and insufficient evidence without provider calls.

## Evidence

- Commit:
- Validation: Six retrieval tests and the 86-test repository suite pass; strict TypeScript checking passes.
- Integration: The local review pipeline indexes both analysis chunks and evidence-backed derived claims, then retrieves citation-ready repository paths and line ranges.

## Handoff

- Do not edit root configuration, task records, evaluation code, canonical docs, or other agents' paths.
- Report the public types and adapter needed to consume analysis chunks and generated review concepts.
