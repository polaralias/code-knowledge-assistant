---
type: Workstream
task: define-evaluation-baseline
workstream: implement-scenario-scoring
title: Implement scenario and scoring contracts
description: Define the checked question corpus, expected evidence, metric implementations,
  provisional gates, and machine-readable result schema.
status: done
created: '2026-08-25T22:17:56Z'
timestamp: '2026-08-26T08:14:32Z'
owner: James Whelan
---

# Implement scenario and scoring contracts

## Assigned outcome

Define the checked question corpus, expected evidence, metric implementations, provisional gates, and machine-readable result schema.

## Owned and shared paths

- Owned: `eval/scenarios/**`, `eval/schema/**`, and evaluation-library modules under `packages/evaluation/**`.
- Shared: fixture answer keys, real-world manifests, and later result output.

## Acceptance and validation

- [x] Encode the approximately 42-scenario matrix with repository, tier, difficulty, evidence, and scoring metadata.
- [x] Implement inventory, extraction, provenance, retrieval, citation, faithfulness, refusal, injection-resistance, capability-disclosure, latency, token, retry, and cost measurements.
- [x] Make deterministic metrics independent of a judge model and isolate bounded human or judge-assisted rubric fields.
- [x] Validate the machine-readable result schema and preserve exact model, prompt, extractor, chunking, embedding, and reranking versions.
- [x] Enforce security invariants as hard failures that aggregate scores cannot hide.
- [x] Add automated tests for scorer correctness, missing evidence, malformed results, and threshold boundaries.

## Evidence

- Commit: not yet committed; current branch delta is the reviewable evidence boundary.
- Validation: `node --test eval/tests/*.test.mjs packages/evaluation/tests/*.test.mjs` passes 27 tests; `node eval/scripts/validate-scenarios.mjs` verifies 42 scenarios and 61 source citations.
- Integration: `node eval/scripts/evaluate-result.mjs <result.json>` loads the checked corpus, rejects self-declared expectations, validates the result contract, and emits raw metrics, gates, hard failures, usage totals, and isolated human-review results.

## Handoff

- Provide the checked corpus, runner contract, and empty result template to the baseline-run workstream.

## Related knowledge

- [Evaluation Baseline Contract](../../../docs/knowledge/evaluation-contract.md)
