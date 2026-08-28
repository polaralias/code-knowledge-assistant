---
type: Workstream
task: harden-and-publish-product
workstream: automate-deployment-verification
title: Automate deployment verification
description: Provide a body-safe post-deploy lifecycle smoke and operator runbook
  for the singleton Railway service.
status: done
created: '2026-08-27T23:16:59Z'
timestamp: '2026-08-28T06:33:23Z'
owner: luna-deploy
---

# Automate deployment verification

## Assigned outcome

Provide a body-safe post-deploy lifecycle smoke and operator runbook for the singleton Railway service.

## Owned and shared paths

- Owned:
- Shared:

## Acceptance and validation

- [x] Verify HTTPS health, readiness, access-gated Git intake, bounded polling, review retrieval, a cited question, deletion, and terminal state.
- [x] Keep access codes, origins, repository URLs, response bodies, source, and identifiers out of diagnostics.
- [x] Make transport, clock, and sleep injectable so the smoke suite requires no live deployment.
- [x] Document Railway variables, volume, deploy, restart/persistence, deletion/expiry, telemetry, rollback, and exact smoke invocation.

## Evidence

- Commit: `84cc163` is deployed to the Railway production service.
- Validation: `node --test deploy/smoke.test.mjs` passes 5 tests.
- Integration: `deploy/smoke.mjs` passed against the public Railway domain, including pinned Git intake, review retrieval, a cited question, deletion, and terminal state. `docs/operations/railway-operator-runbook.md` records the operator path and Railway volume UID requirement.

## Handoff

- Record remaining risks, integration instructions, and knowledge-promotion needs.
