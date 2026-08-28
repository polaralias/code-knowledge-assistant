---
type: Workstream
task: build-repository-review-pipeline
workstream: implement-review-generation
title: Implement evidence-backed review generation
description: Turn normalized repository evidence into schema-valid review concepts
  whose material claims retain resolvable provenance and explicit uncertainty.
status: done
created: '2026-08-26T20:51:35Z'
timestamp: '2026-08-27T06:46:58Z'
owner: codex
---

# Implement evidence-backed review generation

## Assigned outcome

Turn normalized repository evidence into schema-valid review concepts whose material claims retain resolvable provenance and explicit uncertainty.

## Owned and shared paths

- Owned: `packages/review-generation/**`.
- Shared: root workspace and test commands are coordinator-owned and updated only after parallel slices finish.

## Acceptance and validation

- [x] Define a provider-neutral normalized evidence input with stable repository path, line range, source digest, capability tier, and bounded excerpt.
- [x] Define and validate the required overview, component, flow, integration, coverage, and uncertainty review concept families.
- [x] Require every material generated claim to cite one or more input evidence identifiers and reject missing or out-of-range references.
- [x] Keep deterministic generation metadata, model and prompt identity, source revision, capability disclosure, and verification state in the bundle.
- [x] Treat model output as untrusted structured data and reject unknown concept kinds, duplicate identifiers, invalid paths, unsupported claims, and unreviewed link fields.
- [x] Provide a deterministic evidence-derived baseline generator so the end-to-end journey works before a paid provider is configured.
- [x] Test the public generation and validation boundary, including malformed provider output, missing citations, uncertainty, and deterministic ordering.

## Evidence

- Commit:
- Validation: Five review-generation tests and the 87-test final repository suite pass; strict TypeScript checking passes.
- Integration: The local review pipeline maps analysis chunks into normalized evidence, validates all six concept families, and hands primary plus derived records to retrieval.

## Handoff

- Report the adapter required from capability extraction and the records handed to lexical retrieval.
- A later provider adapter may improve prose but must pass the same validator; provider selection remains evaluation-gated.
