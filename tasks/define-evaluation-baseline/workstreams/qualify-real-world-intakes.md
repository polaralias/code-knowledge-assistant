---
type: Workstream
task: define-evaluation-baseline
workstream: qualify-real-world-intakes
title: Qualify real-world evaluation intakes
description: Create immutable, licence-checked fetch manifests and review questions
  for Poetry, Uptime Kuma, and PocketBase without vendoring their source.
status: done
created: '2026-08-25T22:17:54Z'
timestamp: '2026-08-26T07:27:06Z'
owner: James Whelan
---

# Qualify real-world evaluation intakes

## Assigned outcome

Create immutable, licence-checked fetch manifests and review questions for Poetry, Uptime Kuma, and PocketBase without vendoring their source.

## Owned and shared paths

- Owned: `eval/intakes/**` and real-world question specifications under `eval/scenarios/real-world/`.
- Shared: fetch and cache interfaces used by the evaluation runner.

## Acceptance and validation

- [x] Create a manifest for Poetry, Uptime Kuma, and PocketBase containing upstream URL, immutable commit, expected licence, capability tier, and source checksum procedure.
- [x] Fetch into an ignored cache and verify the resolved commit and licence before evaluation; do not vendor upstream source.
- [x] Record deterministic inventory statistics and exclusions for each pinned tree.
- [x] Author six answerable, evidence-mapped orientation or architecture questions per repository without assuming runtime execution.
- [x] Include at least one capability-limitation scenario for PocketBase and one cross-file scenario for each enhanced repository.
- [x] Document an objective replacement rule if an upstream source becomes unavailable or its licence changes.

## Evidence

- Commit: not yet committed; current branch delta is the reviewable evidence boundary.
- Validation: `node --test eval/tests/verify-intakes.test.mjs` passes four tests; `node eval/scripts/verify-intakes.mjs` verifies all three cached intakes and all 18 scenario citations.
- Integration: `eval/intakes/*.json` resolves to `eval/scenarios/real-world/*.json`; `eval/scripts/verify-intakes.mjs --fetch` materialises only the pinned revisions under ignored, graph-excluded `eval/cache/temp/intakes/`.

## Handoff

- Hand verified manifests, cache instructions, and evidence-mapped questions to the scenario-scoring workstream.

## Related knowledge

- [Demonstration and Evaluation Policy](../../../docs/knowledge/decisions/004-demonstration-and-evaluation-policy.md)
- [Evaluation Baseline Contract](../../../docs/knowledge/evaluation-contract.md)
