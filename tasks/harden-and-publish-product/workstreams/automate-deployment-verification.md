---
type: Workstream
task: harden-and-publish-product
workstream: automate-deployment-verification
title: Automate deployment verification
description: Provide a body-safe post-deploy lifecycle smoke and operator runbook
  for the singleton Railway service.
status: done
created: '2026-08-27T23:16:59Z'
timestamp: '2026-08-27T23:30:43Z'
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

- Commit:
- Validation: `node --test deploy/smoke.test.mjs` passes 4 tests.
- Integration: `deploy/smoke.mjs` is the post-deploy gate; `docs/operations/railway-operator-runbook.md` is the operator path.

## Handoff

- Record remaining risks, integration instructions, and knowledge-promotion needs.
