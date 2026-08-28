---
type: Task
task: build-repository-review-pipeline
title: Build the repository review pipeline
description: Safely ingest a supported repository and produce schema-valid, provenance-backed
  review documents and indexes.
status: in-progress
created: '2026-08-25T20:30:43Z'
timestamp: '2026-08-28T02:56:30Z'
owner: James Whelan
time:
- id: 20260826t115207z-codex-tracked
  status: closed
  actor: codex
  started: '2026-08-26T11:52:07Z'
  method: tracked
  activity: implementation
  summary: Implemented and validated the deterministic inventory core through vertical
    TDD.
  basis: Active effort equals the 9-minute explicit start/stop interval.
  workstream: implement-inventory-core
  finished: '2026-08-26T12:01:04Z'
  elapsed_minutes: 9
  effort_minutes: 9
- id: 20260826t120105z-codex-tracked
  status: closed
  actor: codex
  started: '2026-08-26T12:01:05Z'
  method: tracked
  activity: knowledge-maintenance
  summary: Promoted the verified inventory boundary into the repository guide and
    canonical intake and architecture concepts.
  basis: Active effort equals the 1-minute explicit start/stop interval.
  workstream: implement-inventory-core
  finished: '2026-08-26T12:01:58Z'
  elapsed_minutes: 1
  effort_minutes: 1
- id: 20260826t120159z-codex-tracked
  status: closed
  actor: codex
  started: '2026-08-26T12:01:59Z'
  method: tracked
  activity: validation
  summary: Passed 43 tests, strict typechecking, OKF knowledge conformance, and strict
    OKF Tasks validation.
  basis: Active effort equals the 1-minute explicit start/stop interval.
  workstream: implement-inventory-core
  finished: '2026-08-26T12:02:39Z'
  elapsed_minutes: 1
  effort_minutes: 1
- id: 20260826t182627z-codex-tracked
  status: closed
  actor: codex
  started: '2026-08-26T18:26:27Z'
  method: tracked
  activity: implementation
  summary: Implemented safe ZIP preflight, extraction, inventory integration, raw-upload
    consumption, CRC verification, and idempotent workspace cleanup through vertical
    TDD.
  basis: Active effort equals the 11-minute explicit start/stop interval.
  workstream: implement-safe-zip-intake
  finished: '2026-08-26T18:37:51Z'
  elapsed_minutes: 11
  effort_minutes: 11
- id: 20260826t183752z-codex-tracked
  status: closed
  actor: codex
  started: '2026-08-26T18:37:52Z'
  method: tracked
  activity: knowledge-maintenance
  summary: Promoted verified ZIP intake and clarified ephemeral processing versus
    retained 48-hour normalized source snapshots.
  basis: Active effort equals the 1-minute explicit start/stop interval.
  workstream: implement-safe-zip-intake
  finished: '2026-08-26T18:39:18Z'
  elapsed_minutes: 1
  effort_minutes: 1
- id: 20260826t183919z-codex-tracked
  status: closed
  actor: codex
  started: '2026-08-26T18:39:19Z'
  method: tracked
  activity: validation
  summary: Passed 56 tests, strict typechecking, OKF knowledge conformance, strict
    OKF Tasks validation, and publish-safety scanning.
  basis: Active effort equals the 3-minute explicit start/stop interval.
  workstream: implement-safe-zip-intake
  finished: '2026-08-26T18:41:58Z'
  elapsed_minutes: 3
  effort_minutes: 3
- id: 20260826t195344z-codex-tracked
  status: closed
  actor: codex
  started: '2026-08-26T19:53:44Z'
  method: tracked
  activity: implementation
  summary: Live effort session closed.
  basis: Active effort equals the 7-minute explicit start/stop interval.
  workstream: implement-source-snapshot-lifecycle
  finished: '2026-08-26T20:01:05Z'
  elapsed_minutes: 7
  effort_minutes: 7
- id: 20260826t200100z-codex-knowledge
  status: closed
  actor: codex
  started: '2026-08-26T20:01:06Z'
  method: tracked
  activity: knowledge-maintenance
  summary: Promoted the verified source-snapshot lifecycle into canonical architecture,
    intake, output, and repository guide surfaces.
  basis: Active effort equals the 2-minute explicit start/stop interval.
  workstream: implement-source-snapshot-lifecycle
  finished: '2026-08-26T20:02:42Z'
  elapsed_minutes: 2
  effort_minutes: 2
- id: 20260826t200400z-codex-validation
  status: closed
  actor: codex
  started: '2026-08-26T20:02:43Z'
  method: tracked
  activity: validation
  summary: Passed 65 tests, strict typechecking, OKF knowledge conformance, strict
    OKF Tasks validation, and publish-safety scanning.
  basis: Active effort equals the 1-minute explicit start/stop interval.
  workstream: implement-source-snapshot-lifecycle
  finished: '2026-08-26T20:04:04Z'
  elapsed_minutes: 1
  effort_minutes: 1
- id: 20260826t205200z-terra-analysis
  status: closed
  actor: terra-analysis
  started: '2026-08-26T20:50:46Z'
  method: tracked
  activity: implementation
  summary: Implemented and package-tested conservative structured Python/TypeScript/JavaScript
    lexical extraction plus honest text fallback, provenance, chunks, exclusions,
    and integrity failures.
  basis: Active effort equals the 7-minute explicit start/stop interval.
  workstream: implement-capability-extraction
  finished: '2026-08-26T20:58:12Z'
  elapsed_minutes: 7
  effort_minutes: 7
- id: 20260826t205400z-codex-review-generation
  status: closed
  actor: codex
  started: '2026-08-26T20:51:37Z'
  method: tracked
  activity: implementation
  summary: Implemented and package-tested deterministic evidence-backed review bundle
    generation and validation; repository-wide integration waits on parallel owned
    packages.
  basis: Active effort equals the 3-minute explicit start/stop interval.
  workstream: implement-review-generation
  finished: '2026-08-26T20:54:12Z'
  elapsed_minutes: 3
  effort_minutes: 3
- id: 20260826t210100z-codex-review-integration
  status: closed
  actor: codex
  started: '2026-08-26T20:59:51Z'
  method: tracked-adjusted
  activity: implementation
  summary: Integrated parallel analysis, review-generation, and retrieval packages;
    hardened validation; ran 87-test and typecheck evidence. Effort adjusted to exclude
    overnight inactivity between active continuations.
  basis: 'Wall-clock session was 586 minutes. Active effort was adjusted to 8 minutes:
    Integrated parallel analysis, review-generation, and retrieval packages; hardened
    validation; ran 87-test and typecheck evidence. Effort adjusted to exclude overnight
    inactivity between active continuations.'
  workstream: integrate-local-review-pipeline
  finished: '2026-08-27T06:45:51Z'
  elapsed_minutes: 586
  effort_minutes: 8
- id: 20260827t064500z-codex-knowledge
  status: closed
  actor: codex
  started: '2026-08-27T06:46:18Z'
  method: tracked
  activity: knowledge-maintenance
  summary: Updated canonical repository, architecture, language/intake, and review-output
    truth; regenerated and validated OKF knowledge indexes.
  basis: Active effort equals the 0-minute explicit start/stop interval.
  workstream: integrate-local-review-pipeline
  finished: '2026-08-27T06:46:38Z'
  elapsed_minutes: 0
  effort_minutes: 0
- id: 20260827t065100z-terra-orchestration
  status: closed
  actor: terra-orchestration
  started: '2026-08-27T06:50:37Z'
  method: tracked
  activity: implementation
  summary: Implemented and integrated ZIP-to-snapshot-to-rehydrated-review orchestration
    with cleanup and rollback coverage.
  basis: Active effort equals the 22-minute explicit start/stop interval.
  workstream: orchestrate-zip-review-lifecycle
  finished: '2026-08-27T07:12:38Z'
  elapsed_minutes: 22
  effort_minutes: 22
- id: 20260827t073000z-terra-jobs
  status: closed
  actor: terra-jobs
  started: '2026-08-27T16:05:17Z'
  method: tracked
  activity: implementation
  summary: Durable job store implemented and independently validated.
  basis: Active effort equals the 21-minute explicit start/stop interval.
  workstream: persist-review-jobs
  finished: '2026-08-27T16:26:42Z'
  elapsed_minutes: 21
  effort_minutes: 21
- id: 20260827t073000z-codex-review-service
  status: closed
  actor: codex
  started: '2026-08-27T16:05:28Z'
  method: tracked
  activity: implementation
  summary: Application service, runtime wiring, and real ZIP integration completed.
  basis: Active effort equals the 21-minute explicit start/stop interval.
  workstream: integrate-asynchronous-review-service
  finished: '2026-08-27T16:26:46Z'
  elapsed_minutes: 21
  effort_minutes: 21
- id: 20260827t162922z-codex-tracked
  status: closed
  actor: codex
  started: '2026-08-27T16:29:22Z'
  method: tracked
  activity: knowledge-maintenance
  summary: Canonical architecture, intake, review, and root guidance aligned and validated.
  basis: Active effort equals the 1-minute explicit start/stop interval.
  workstream: integrate-asynchronous-review-service
  finished: '2026-08-27T16:30:49Z'
  elapsed_minutes: 1
  effort_minutes: 1
- id: 20260827t163734z-terra-artifacts-tracked
  status: closed
  actor: terra-artifacts
  started: '2026-08-27T16:37:34Z'
  method: tracked
  activity: implementation
  summary: Completed restart-safe artifact store and root integration validation.
  basis: Active effort equals the 23-minute explicit start/stop interval.
  workstream: persist-completed-review-artifacts
  finished: '2026-08-27T17:00:51Z'
  elapsed_minutes: 23
  effort_minutes: 23
- id: 20260827t163735z-terra-git-tracked
  status: closed
  actor: terra-git
  started: '2026-08-27T16:37:35Z'
  method: tracked
  activity: implementation
  summary: Completed immutable Git intake and hardened CLI transport validation.
  basis: Active effort equals the 23-minute explicit start/stop interval.
  workstream: implement-public-git-intake
  finished: '2026-08-27T17:00:54Z'
  elapsed_minutes: 23
  effort_minutes: 23
- id: 20260827t163736z-codex-tracked
  status: closed
  actor: codex
  started: '2026-08-27T16:37:36Z'
  method: tracked
  activity: implementation
  summary: Integrated restart recovery, expiry scheduling, cleanup reconciliation,
    tests, and canonical knowledge.
  basis: Active effort equals the 23-minute explicit start/stop interval.
  workstream: schedule-review-expiry
  finished: '2026-08-27T17:00:58Z'
  elapsed_minutes: 23
  effort_minutes: 23
- id: 20260827t171636z-terra-orchestration-tracked
  status: closed
  actor: terra-orchestration
  started: '2026-08-27T17:16:36Z'
  method: tracked
  activity: implementation
  summary: Materialized orchestration completed and validated in the full 168-test
    suite and live Git review smoke.
  basis: Active effort equals the 247-minute explicit start/stop interval.
  workstream: generalise-materialized-review-orchestration
  finished: '2026-08-27T21:23:54Z'
  elapsed_minutes: 247
  effort_minutes: 247
- id: 20260827t171639z-codex-api-tracked
  status: closed
  actor: codex-api
  started: '2026-08-27T17:16:39Z'
  method: tracked
  activity: implementation
  summary: Public Git review API and service completed; full tests, typecheck, deploy
    checks, and live Git smoke passed.
  basis: Active effort equals the 247-minute explicit start/stop interval.
  workstream: expose-public-git-review-api
  finished: '2026-08-27T21:23:56Z'
  elapsed_minutes: 247
  effort_minutes: 247
started: '2026-08-26T11:52:07Z'
effort_minutes: 682
---

# Build the repository review pipeline

## Outcome

A supported repository can be ingested without executing its content, transformed into deterministic evidence, reviewed into the agreed derived document families, and indexed with resolvable provenance and explicit uncertainty.

## Scope

- In scope: public Git and zip intake, safety validation, inventory, capability classification, enhanced and fallback extraction, chunking, primary evidence storage, derived OKF review generation, schema validation, provenance, uncertainty, indexing, review progress, and deletion.
- Out of scope: executing repositories, universal language support, perfect static call graphs, continuous Git synchronisation, and autonomous code changes.

## Acceptance

- [x] Reject unsafe, malformed, oversized, or unsupported inputs deterministically.
- [x] Produce an inspectable inventory and exclusion report.
- [x] Apply and disclose enhanced, structured, or fallback capability per detected language.
- [x] Preserve source file, symbol, and line provenance through extraction and storage.
- [x] Generate every required OKF-compatible review concept through schema-validated output.
- [x] Label incomplete coverage and unverified inference.
- [x] Delete raw archives after extraction and expire non-demo review data after 48 hours.
- [ ] Pass the agreed ingestion, review, security, and evaluation checks.

## Dependencies and risks

- Provider-independent intake, inventory, provenance, and deterministic extraction can proceed against the accepted repository profile while the paid evaluation is paused.
- Provider-backed review generation, embedding, reranking, and final model allocation still depend on the [evaluation baseline](../define-evaluation-baseline/task.md).
- Parser and provider limitations must not be hidden behind generated prose.

## Related knowledge

- [Architecture Concept](../../docs/knowledge/architecture-concept.md)
- [Evaluation Baseline](../define-evaluation-baseline/task.md)

## Workstreams

- [Implement deterministic repository inventory](./workstreams/implement-inventory-core.md) as the provider-independent foundation for Git and zip intake.
- [Implement safe ZIP intake](./workstreams/implement-safe-zip-intake.md) to consume uploaded archives into isolated temporary review workspaces before inventory.
- [Implement source snapshot lifecycle](./workstreams/implement-source-snapshot-lifecycle.md) to retain policy-filtered primary evidence for follow-up questions and bounded reruns.
- [Implement capability extraction](./workstreams/implement-capability-extraction.md) for conservative structured Python/TypeScript/JavaScript facts and explicit fallback evidence.
- [Implement review generation](./workstreams/implement-review-generation.md) for validated, evidence-linked derived concepts.
- [Integrate the local review pipeline](./workstreams/integrate-local-review-pipeline.md) from materialized source to citation-ready lexical retrieval.
- [Generalise materialized review orchestration](./workstreams/generalise-materialized-review-orchestration.md) so ZIP and Git share the same lifecycle.
- [Expose public Git review API](./workstreams/expose-public-git-review-api.md) through the durable service and HTTP boundary.

## Evidence

- The public `inventoryRepository` interface now inventories a materialized directory without executing repository content and returns deterministic eligibility, exclusion, digest, line-count, and summary records.
- The public `ingestZipArchive` interface preflights bounded ZIP uploads before workspace creation, extracts regular content into a unique temporary directory, invokes the shared inventory, consumes the raw upload, verifies CRCs, and exposes idempotent cleanup.
- The source-snapshot boundary persists inventory-verified eligible bytes and exclusion metadata through an object-store contract, rehydrates active snapshots into disposable workspaces, rejects expired or integrity-drifted state, and supports idempotent early deletion and expiry sweeping.
- Capability analysis now emits conservative structured Python/TypeScript/JavaScript facts, honest fallback evidence, bounded chunks, exclusions, and body-free failures with source provenance.
- Deterministic review generation emits every required concept family, requires evidence for material claims, records uncertainty and coverage, and fails closed on untrusted provider-shaped fields.
- The integrated local interface routes a materialized repository through inventory, analysis, review generation, and a primary-and-derived lexical evidence index with citation-ready source ranges.
- ZIP intake now proceeds through an immutable source snapshot and a fresh disposable rehydration before review, with cleanup and rollback on material failures.
- The materialized review coordinator is provider-neutral: ZIP and public Git intake share snapshot, rehydration, provenance, rollback, and cleanup behaviour.
- Public Git review is exposed at `POST /api/git-reviews`, with opaque job polling, restart-safe review retrieval, cited questions, deletion, and expiry on the same service lifecycle as ZIP.
- `pnpm test` passes 233 tests across evaluation, intake, Git, snapshots, analysis, review generation, retrieval, answering, orchestration, local API integration, browser contracts, and deployment policy.
- `pnpm typecheck` passes with the strict root TypeScript configuration.
- A production-shaped smoke against `https://github.com/pallets/click` (`main`) returned a queued response and reached `ready` without exposing source details.
- Hosted S3-compatible evidence storage, multi-instance expiry coordination, enhanced Tree-sitter analysis, evaluated provider-backed review/answer generation, and public deployment remain open acceptance scope.
