---
type: Workstream
task: harden-and-publish-product
workstream: enforce-provider-budget
title: Enforce hosted provider budget
description: Persist bounded monthly provider reservations and measured spend so model-backed
  activity stops before the accepted budget ceiling.
status: done
created: '2026-08-27T23:16:41Z'
timestamp: '2026-08-27T23:16:50Z'
owner: luna-provider
---

# Enforce hosted provider budget

## Assigned outcome

Persist bounded monthly provider reservations and measured spend so model-backed activity stops before the accepted budget ceiling.

## Owned and shared paths

- Owned:
- Shared:

## Acceptance and validation

- [x] Persist aggregate monthly spend and bounded reservations without prompts, source, endpoints, keys, or responses.
- [x] Stop new work at the accepted 80% threshold and all model work at 100% of the configurable monthly ceiling.
- [x] Commit or release opaque reservations idempotently and expire abandoned reservations.
- [x] Fail closed on corrupt state, concurrent controllers, invalid money, and atomic-publication failure.
- [x] Verify through the public package interface with an injected clock and no network or sleeps.

## Evidence

- Commit: working-tree slice (repository is not yet committed).
- Validation: `packages/provider-budget/tests/provider-budget.test.ts` passes 7/7, including concurrent controllers and measured-cost overrun protection; strict package typecheck passes.
- Integration: live provider evaluation reserves `maxCostUsd * usdToGbpRate` before each call and commits measured cost in GBP; failed calls release the opaque reservation. The CLI requires `EVAL_USD_TO_GBP_RATE` for live mode and persists the ledger below `EVAL_BUDGET_ROOT` (default `.local-data/provider-budget`). No provider credentials are configured.

## Handoff

- Record remaining risks, integration instructions, and knowledge-promotion needs.
