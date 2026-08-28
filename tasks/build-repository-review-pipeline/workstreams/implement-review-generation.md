---
type: Workstream
task: build-repository-review-pipeline
workstream: implement-review-generation
title: Implement evidence-backed review generation
description: Turn normalized repository evidence into schema-valid review concepts
  whose material claims retain resolvable provenance and explicit uncertainty.
status: done
created: '2026-08-26T20:51:35Z'
timestamp: '2026-08-28T13:25:00Z'
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
- [x] Run one bounded provider interpretation pass per required concept family, validate exact evidence references, keep identifiers application-owned, and fall back per concept without losing the deterministic control.
- [x] Test the public generation and validation boundary, including malformed provider output, missing citations, uncertainty, and deterministic ordering.

## Evidence

- Commit:
- Validation: Review-generation, model-provider, and review-pipeline tests pass; strict TypeScript checking passes. Local and Railway live-provider Cozylife runs produced six model-authored concepts/documents; production review `review-de0f80d6-03a8-4790-a72a-d33b0f391258` was explicitly checked as non-baseline.
- Integration: The local review pipeline maps analysis chunks into normalized evidence, invokes Qwen with thinking disabled for bounded JSON output, validates all six model-authored concept families, falls back to DeepSeek or the deterministic control per concept, and hands primary plus derived records to retrieval.

## Handoff

- Report the adapter required from capability extraction and the records handed to lexical retrieval.
- The production allocation is operational and live-verified but remains evaluation-gated; the wider quality, latency, and cost comparison is a separate evidence obligation.
