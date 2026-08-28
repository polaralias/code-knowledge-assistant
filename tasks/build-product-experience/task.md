---
type: Task
task: build-product-experience
title: Build the product experience
description: Deliver a polished repository, review, documentation, chat, and evidence-inspection
  journey around the working knowledge pipeline.
status: in-progress
created: '2026-08-25T20:30:45Z'
timestamp: '2026-08-28T05:50:34Z'
owner: James Whelan
depends_on:
- build-repository-review-pipeline/task
- build-grounded-conversation/task
time:
- id: 20260826t205200z-luna-web
  status: closed
  actor: luna-web
  started: '2026-08-26T20:50:47Z'
  method: tracked
  activity: implementation
  summary: Implemented and package-tested responsive pre-indexed review workspace
    shell with evidence inspection and deliberate operational states.
  basis: Active effort equals the 9-minute explicit start/stop interval.
  workstream: implement-review-workspace-shell
  finished: '2026-08-26T20:59:34Z'
  elapsed_minutes: 9
  effort_minutes: 9
- id: 20260827t065100z-luna-live-data
  status: closed
  actor: luna-web
  started: '2026-08-27T06:50:51Z'
  method: tracked
  activity: implementation
  summary: Implemented the validated live browser client and integrated review identity,
    question, error-state, and citation flows.
  basis: Active effort equals the 22-minute explicit start/stop interval.
  workstream: connect-live-review-data
  finished: '2026-08-27T07:12:43Z'
  elapsed_minutes: 22
  effort_minutes: 22
- id: 20260827t065200z-codex-api
  status: closed
  actor: codex
  started: '2026-08-27T06:51:26Z'
  method: tracked
  activity: implementation
  summary: Implemented the localhost API/runtime adapter, repaired browser-only integration
    defects, and verified a real cited question and source-span dialog.
  basis: Active effort equals the 21-minute explicit start/stop interval.
  workstream: serve-local-review-api
  finished: '2026-08-27T07:12:45Z'
  elapsed_minutes: 21
  effort_minutes: 21
- id: 20260827t073000z-terra-upload-api
  status: closed
  actor: terra-api
  started: '2026-08-27T16:05:20Z'
  method: tracked
  activity: implementation
  summary: Bounded upload and job HTTP routes implemented and integrated.
  basis: Active effort equals the 21-minute explicit start/stop interval.
  workstream: accept-zip-review-uploads
  finished: '2026-08-27T16:26:48Z'
  elapsed_minutes: 21
  effort_minutes: 21
- id: 20260827t073000z-luna-upload-ui
  status: closed
  actor: luna-web
  started: '2026-08-27T16:05:24Z'
  method: tracked
  activity: implementation
  summary: Upload, progress, recovery, and live review entry implemented and browser-verified.
  basis: Active effort equals the 21-minute explicit start/stop interval.
  workstream: build-upload-progress-experience
  finished: '2026-08-27T16:26:51Z'
  elapsed_minutes: 21
  effort_minutes: 21
- id: 20260827t171643z-luna-web-tracked
  status: closed
  actor: luna-web
  started: '2026-08-27T17:16:43Z'
  method: tracked
  activity: implementation
  summary: Public Git intake UI/client completed; web contract tests and full suite
    passed.
  basis: Active effort equals the 247-minute explicit start/stop interval.
  workstream: add-public-git-review-ui
  finished: '2026-08-27T21:23:58Z'
  elapsed_minutes: 247
  effort_minutes: 247
started: '2026-08-26T20:50:47Z'
effort_minutes: 341
---

# Build the product experience

## Outcome

A user can immediately explore a pre-indexed repository, understand the generated review, ask questions, inspect evidence and uncertainty, and recognise the product's value without needing setup or hidden context.

## Scope

- In scope: repository selection, review progress and coverage, documentation navigation, conversational workspace, citations, evidence inspection, limitations, responsive design, loading, empty, error, and constrained-demo states.
- Out of scope: enterprise administration, billing, collaborative editing, broad design-system infrastructure, and product surfaces not needed by the core user journey.

## Acceptance

- [x] Complete the main pre-indexed demonstration journey without configuration.
- [x] Make review state, evidence quality, citations, uncertainty, and limitations understandable.
- [x] Provide deliberate loading, empty, error, and abuse-limit states.
- [x] Meet the agreed accessibility and responsive-layout checks.
- [ ] Capture stable screenshots for the public project documentation.

## Dependencies and risks

- Depends on the review and conversation contracts, but design exploration can begin earlier once their interfaces stabilise.
- Visual polish must not conceal retrieval or evidence failures.

## Related knowledge

- [Product Contract](../../docs/knowledge/product-contract.md)

## Workstreams

- [Implement the review workspace shell](./workstreams/implement-review-workspace-shell.md) against a typed pre-indexed fixture seam.
- [Add public Git review input](./workstreams/add-public-git-review-ui.md) alongside the ZIP intake mode.
- [Redesign the code review workspace](./workstreams/redesign-code-review-workspace.md) around the chat, findings rail, progress rail, and future map stub.

## Evidence

- The responsive static workspace opens on a realistic pre-indexed review, presents coverage, capability, exclusions, generated-document navigation, uncertainty, example questions, cited answers, and inspectable source spans.
- The redesigned dependency-free workspace now maps the supplied wireframe to Review, Findings, and Map tabs, with a findings drill-in rail, central evidence conversation, progress/source context, responsive collapse, and explicit light/dark tokens. The Map view is intentionally labelled as a future stub.
- The redesign workstream is complete after desktop/mobile, light/dark, accessibility-tree, full regression, type-check, Docker build, and container liveness/readiness verification.
- Loading, empty, failed, expired, and abuse-limit states have explicit render paths; five automated fixture/state checks pass.
- Desktop and 390-by-844 mobile layouts were exercised in the in-app browser in light and dark emulation, including findings navigation, map boundary, keyboard-reachable citation inspection, and the expired-review replacement state.
- The dependency-free local server now wires a real materialized-repository review and deterministic cited answers into the same browser contract; live loading, question submission, and citation inspection are browser-verified, including the bundled Docker demo.
- ZIP and public Git upload controls, persisted review jobs/progress, and cited review navigation are now integrated; the Git client/API contract tests pass and a real server smoke reaches `ready`.
- Stable documentation screenshots, clean hosted-browser upload/Git/deletion verification, and external deployment remain open. Access-code gating and abuse persistence are implemented and covered by API/package tests.
