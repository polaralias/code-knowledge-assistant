---
type: Workstream
task: define-evaluation-baseline
workstream: create-deterministic-fixtures
title: Create deterministic evaluation fixtures
description: Create original Python and TypeScript fixture repositories with complete
  source-evidence answer keys for objective extraction and citation scoring.
status: done
created: '2026-08-25T22:17:52Z'
timestamp: '2026-08-25T22:51:32Z'
owner: James Whelan
---

# Create deterministic evaluation fixtures

## Assigned outcome

Create original Python and TypeScript fixture repositories with complete source-evidence answer keys for objective extraction and citation scoring.

## Owned and shared paths

- Owned: `eval/fixtures/python-service/**`, `eval/fixtures/typescript-service/**`, and their ground-truth manifests under `eval/ground-truth/`.
- Shared: evaluation schema and runner interfaces owned by the scenario-scoring workstream.

## Acceptance and validation

- [x] Create original, minimal Python and TypeScript repositories containing every construct required by the evaluation contract.
- [x] Include supported, ambiguous, deliberately excluded, and statically unprovable examples without depending on network access or execution.
- [x] Record expected inventory, symbols, imports, relationships, components, flows, source ranges, and exclusions in machine-readable answer keys.
- [x] Add fixture self-checks that fail when line-sensitive evidence drifts without an answer-key update.
- [x] Licence the fixtures as repository-owned MIT test data and keep them free of copied third-party source.

## Evidence

- Commit: not committed; current branch working tree.
- Validation: `node --test eval/tests/validate-fixtures.test.mjs` — 9 passed, 0 failed.
- Integration: `node eval/scripts/validate-fixtures.mjs` — validated `python-service` and `typescript-service`.

## Handoff

- Immutable fixture digests and the answer-key schema are ready for the scenario-scoring workstream. Fixture source remains text-only and was not executed.

## Related knowledge

- [Evaluation Baseline Contract](../../../docs/knowledge/evaluation-contract.md)
