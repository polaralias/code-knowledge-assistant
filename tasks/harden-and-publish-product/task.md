---
type: Task
task: harden-and-publish-product
title: Harden and publish the product
description: Validate, secure, containerise, deploy, document, and publish the product
  for reliable public use.
status: in-progress
created: '2026-08-25T20:30:47Z'
timestamp: '2026-08-28T02:26:59Z'
owner: James Whelan
depends_on:
- build-repository-review-pipeline/task
- build-grounded-conversation/task
- build-product-experience/task
time:
- id: 20260827t163737z-luna-deploy-tracked
  status: closed
  actor: luna-deploy
  started: '2026-08-27T16:37:37Z'
  method: tracked
  activity: implementation
  summary: Completed real-runtime container and Railway deployment contract; Docker
    image build unavailable locally.
  basis: Active effort equals the 23-minute explicit start/stop interval.
  workstream: containerise-local-application
  finished: '2026-08-27T17:01:01Z'
  elapsed_minutes: 23
  effort_minutes: 23
- id: 20260827t212250z-codex-tracked
  status: closed
  actor: codex
  started: '2026-08-27T21:22:50Z'
  method: tracked
  activity: knowledge-maintenance
  summary: Deployment-readiness documentation pass complete; canonical docs, task
    evidence, RCC record, and OKF validation aligned.
  basis: Active effort equals the 14-minute explicit start/stop interval.
  workstream: containerise-local-application
  finished: '2026-08-27T21:36:33Z'
  elapsed_minutes: 14
  effort_minutes: 14
- id: 20260827t223835z-luna-access-tracked
  status: closed
  actor: luna-access
  started: '2026-08-27T22:38:35Z'
  method: tracked
  activity: implementation
  summary: Live effort session closed.
  basis: Active effort equals the 53-minute explicit start/stop interval.
  workstream: enforce-hosted-access-controls
  finished: '2026-08-27T23:31:12Z'
  elapsed_minutes: 53
  effort_minutes: 53
- id: 20260827t223835z-luna-ci-tracked
  status: closed
  actor: luna-ci
  started: '2026-08-27T22:38:35Z'
  method: tracked
  activity: implementation
  summary: Live effort session closed.
  basis: Active effort equals the 53-minute explicit start/stop interval.
  workstream: add-ci-release-gates
  finished: '2026-08-27T23:31:18Z'
  elapsed_minutes: 53
  effort_minutes: 53
- id: 20260827t224142z-codex-tracked
  status: closed
  actor: codex
  started: '2026-08-27T22:41:42Z'
  method: tracked
  activity: implementation
  summary: Live effort session closed.
  basis: Active effort equals the 50-minute explicit start/stop interval.
  workstream: instrument-operational-telemetry
  finished: '2026-08-27T23:31:24Z'
  elapsed_minutes: 50
  effort_minutes: 50
started: '2026-08-27T16:37:37Z'
effort_minutes: 193
---

# Harden and publish the product

## Outcome

The application is reproducibly runnable, secured within its declared boundaries, observable, tested, deployed for low-friction use, and published with clear documentation and visual evidence.

## Scope

- In scope: containerisation, environment contract, migrations, health checks, CI, security and cost controls, Railway reference deployment, live smoke testing, README completion, architecture and productionisation documentation, screenshots, and optional video.
- Out of scope: claiming enterprise production readiness, implementing every roadmap item, or creating hyperscaler infrastructure solely for demonstration.

## Acceptance

- [ ] Start the application locally from clean documented steps.
- [ ] Pass lint, type, unit, integration, security, evaluation, and build gates selected for the project.
- [ ] Deploy the reference application with secrets, budgets, retention, and abuse controls configured.
- [ ] Verify the public demo and pre-indexed journey from a clean browser session.
- [ ] Complete the product README with project-specific setup, architecture, engineering rationale, productionisation, limitations, and operating guidance.
- [ ] Capture screenshots and, if useful, a concise demonstration video.
- [ ] Reconcile OKF Tasks, canonical knowledge, known limitations, and final evidence before completion.

## Dependencies and risks

- Depends on the material product capabilities and their validation evidence.
- External GitHub and Railway writes require separately confirmed destinations and credentials.

## Related knowledge

- [Product Brief](../../docs/knowledge/product-brief.md)

## Workstreams

- [Containerise the local application](./workstreams/containerise-local-application.md) for the deployment-shaped Node/Railway reference contract.
- [Add CI and release gates](./workstreams/add-ci-release-gates.md).
- [Enforce hosted access and abuse controls](./workstreams/enforce-hosted-access-controls.md).
- [Enforce the provider budget](./workstreams/enforce-provider-budget.md).
- [Instrument operational telemetry](./workstreams/instrument-operational-telemetry.md).
- [Automate deployment verification](./workstreams/automate-deployment-verification.md).

## Evidence

- A non-root Node 24 Dockerfile, bundled demo artifact, real API startup script, `/healthz` and `/readyz`, and singleton Railway manifest are implemented. Deployment policy tests pass and the image builds/starts healthy locally with Docker Desktop; no Railway project or volume has been created.
- Hosted access-code gating, persistent review/question limits, structured body-safe telemetry, CI/release policy, smoke tooling, and an immutable Uptime Kuma demo artifact are implemented and test-covered. The provider adapter exists but is not yet integrated into an evaluated production path; hosted object/database adapters remain intentionally deferred.
- Public launch still requires Railway provisioning and persistence checks, provider evaluation with approved credentials, a clean hosted-browser run, screenshots, and final task/knowledge reconciliation.
- Current local verification: `pnpm test` passes 233 tests, `pnpm typecheck` passes, deployment policy checks pass, and `docker build --tag code-knowledge-assistant:local .` produces a healthy image whose `/healthz`, `/readyz`, root demo endpoint, bundled Uptime Kuma review, and cited browser question were checked.
