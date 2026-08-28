---
type: Workstream
task: build-repository-review-pipeline
workstream: implement-capability-extraction
title: Implement capability extraction
description: Extract deterministic symbols, imports, source ranges, chunks, and disclosed
  capability tiers for Python, TypeScript, JavaScript, and fallback text.
status: done
created: '2026-08-26T20:49:51Z'
timestamp: '2026-08-27T06:46:54Z'
owner: terra-analysis
---

# Implement capability extraction

## Assigned outcome

Extract deterministic symbols, imports, source ranges, chunks, and disclosed capability tiers for Python, TypeScript, JavaScript, and fallback text.

## Owned and shared paths

- Owned: `packages/analysis/**`.
- Shared: none during parallel implementation. The lifecycle coordinator alone changes root workspace configuration, parent tasks, and canonical docs.

## Acceptance and validation

- [x] Expose one public analysis interface that consumes a materialized repository root plus its existing `RepositoryInventory` without executing repository content.
- [x] Emit deterministic capability disclosures, source ranges, symbols, imports, and bounded evidence chunks for Python, TypeScript, and JavaScript.
- [x] Emit an honest fallback overview input for other eligible text files without representing unknown syntax as a deterministic parse.
- [x] Preserve repository-relative paths and 1-based line ranges suitable for later citations.
- [x] Exclude every inventory-ineligible file and avoid placing source bodies in errors.
- [x] Keep relationships conservative: only emit facts directly supported by syntax, imports, or configuration visible to the extractor.
- [x] Exercise the public interface against deterministic fixture and temporary-directory paths, including malformed or drifting inputs.

## Evidence

- Commit:
- Validation: Four analysis tests and the 86-test repository suite pass; strict TypeScript checking passes.
- Integration: `buildLocalRepositoryReview` consumes the public `analyzeRepository` result and carries its structured/fallback disclosure, chunks, exclusions, and failures into review generation.

## Handoff

- Do not edit root configuration, task records, intake code, canonical docs, or other agents' paths.
- Report the public types and exact integration call needed by the review orchestrator.
- Current Python, TypeScript, and JavaScript extraction is deliberately disclosed as `structured` lexical analysis, not `enhanced`; Tree-sitter AST adapters remain open.
