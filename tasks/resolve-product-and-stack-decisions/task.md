---
type: Task
task: resolve-product-and-stack-decisions
title: Resolve product and stack decisions
description: Resolve the bounded product, fixture, stack, model, retrieval, security,
  and deployment choices needed to begin implementation.
status: done
created: '2026-08-25T20:30:40Z'
timestamp: '2026-08-25T22:19:22Z'
owner: James Whelan
estimate:
  effort_minutes: 180
  method: agent
  confidence: medium
  basis: QTK decision batches, DDD contract refinement, architecture promotion, validation,
    and user review; excludes implementation.
  actor: Codex
  timestamp: '2026-08-25T20:33:22Z'
sprint_points:
  value: 3.0
  scale: fibonacci
  timestamp: '2026-08-25T20:33:22Z'
  context: Code Knowledge Assistant
time:
- id: 20260825t203323z-codex-tracked
  status: closed
  actor: Codex
  started: '2026-08-25T20:33:23Z'
  method: tracked
  activity: knowledge-maintenance
  summary: Initial knowledge and execution graph established; further QTK resolution
    continues in a later slice.
  basis: Active effort equals the 0-minute explicit start/stop interval.
  finished: '2026-08-25T20:33:51Z'
  elapsed_minutes: 0
  effort_minutes: 0
- id: 20260825t210045z-codex-tracked
  status: closed
  actor: Codex
  started: '2026-08-25T21:00:45Z'
  method: tracked
  activity: research
  summary: Rebuilt the repository question surface and prepared the first QTK decision
    batch; awaiting user judgement.
  basis: Active effort equals the 1-minute explicit start/stop interval.
  finished: '2026-08-25T21:01:18Z'
  elapsed_minutes: 1
  effort_minutes: 1
- id: 20260825t211607z-codex-tracked
  status: closed
  actor: codex
  started: '2026-08-25T21:16:07Z'
  method: tracked
  activity: knowledge-maintenance
  summary: Resolved language tiers, Git and zip intake, derived OKF review format,
    48-hour retention, architecture boundaries, evaluation intakes, and provider screening;
    exact demo controls remain open.
  basis: Active effort equals the 10-minute explicit start/stop interval.
  finished: '2026-08-25T21:26:05Z'
  elapsed_minutes: 10
  effort_minutes: 10
- id: 20260825t221443z-codex-tracked
  status: closed
  actor: codex
  started: '2026-08-25T22:14:43Z'
  method: tracked
  activity: knowledge-maintenance
  summary: Replaced niche intake candidates, accepted the demo and access policy,
    and established an implementation-ready evaluation contract with four workstreams.
  basis: Active effort equals the 5-minute explicit start/stop interval.
  finished: '2026-08-25T22:19:21Z'
  elapsed_minutes: 5
  effort_minutes: 5
started: '2026-08-25T20:33:23Z'
effort_minutes: 16
finished: '2026-08-25T22:19:22Z'
---

# Resolve product and stack decisions

## Outcome

The repository contains accepted, evidence-backed decisions for the MVP product boundary, demonstration fixture, supported repository profile, application stack, retrieval design, model evaluation candidates, security posture, data lifecycle, and reference deployment. Dependent implementation can begin without inventing product behaviour or infrastructure assumptions.

## Scope

- In scope: resolve the questions currently recorded in the decision queue; update the product, architecture, feature, and decision concepts; identify any decisions that remain intentionally deferred.
- Out of scope: application implementation, provider account creation, external deployment, and irreversible infrastructure choices.

## Acceptance

- [x] Resolve the MVP input modes, supported language/repository profile, and public evaluation intake candidates.
- [x] Select the initial application boundaries and local development shape.
- [x] Approve an evaluation candidate set for generation, embeddings, retrieval, and reranking without pre-selecting a winner.
- [x] Define provider privacy constraints and exact public-demo abuse controls.
- [x] Define repository retention, execution prohibition, and prompt-injection boundary.
- [x] Record accepted decisions and update the canonical architecture and feature contracts.
- [x] Confirm every dependent task is either ready or explicitly blocked by a named remaining decision.

## Dependencies and risks

- Product branding can remain neutral without blocking implementation.
- Provider privacy and regional terms may narrow the model candidate set.
- The selected fixture must be public, stable, representative, and small enough for repeatable evaluation.
- Real-world repositories exercise usefulness and scale; a purpose-built fixture supplies exact ground truth.

## Related knowledge

- [Decision Queue](../../docs/knowledge/decision-queue.md)
- [Product Contract](../../docs/knowledge/product-contract.md)

## Workstreams

- No separate workstreams at this level; resolve the related questions as one bounded QTK and DDD tranche.

## Evidence

- QTK decision tranche recorded in `docs/knowledge/decisions/002-hosting-and-model-strategy.md` and `003-capability-intake-and-review-format.md`.
- Public repository profile measured through the GitHub API on 2026-08-25; Python is the relevant existing enhanced-language candidate.
- Candidate trees pinned and measured through the GitHub API on 2026-08-25.
- Demonstration, access, resource, rate, and budget defaults recorded in `docs/knowledge/decisions/004-demonstration-and-evaluation-policy.md`.
- Implementation-ready evaluation contract recorded in `docs/knowledge/evaluation-contract.md`.
