---
type: Workstream
task: build-repository-review-pipeline
workstream: implement-source-snapshot-lifecycle
title: Implement source snapshot lifecycle
description: Persist eligible source and exclusion manifests through a provider-independent
  object-store boundary, rehydrate temporary workspaces, and enforce deletion and
  expiry.
status: done
created: '2026-08-26T19:53:43Z'
timestamp: '2026-08-26T20:04:03Z'
owner: James Whelan
---

# Implement source snapshot lifecycle

## Assigned outcome

Persist eligible source and exclusion manifests through a provider-independent object-store boundary, rehydrate temporary workspaces, and enforce deletion and expiry.

## Owned and shared paths

- Owned: `packages/source-snapshots/**`.
- Shared: root TypeScript workspace and test commands, package lockfile, and the `RepositoryInventory` contract from `packages/intake`.

## Acceptance and validation

- [x] Persist eligible source bytes only, with exclusion paths and reasons retained as metadata but excluded bodies never read or stored.
- [x] Verify every eligible file against the inventory byte size and SHA-256 before accepting the snapshot.
- [x] Write an immutable versioned manifest last so incomplete object sets never appear complete; roll back the snapshot prefix on failure.
- [x] Set a deterministic 48-hour expiry from an injected clock and reject expired snapshots before rehydration.
- [x] Rehydrate an active snapshot into a unique temporary directory, rechecking object size and digest and returning idempotent cleanup.
- [x] Delete one snapshot idempotently and sweep valid expired snapshots through the same provider-independent object-store boundary.
- [x] Supply a filesystem-backed object-store adapter for local self-hosting and integration tests without coupling the lifecycle to a mounted volume or to S3 SDK details.
- [x] Reject unsafe snapshot identifiers, object keys, malformed manifests, path collisions, and integrity drift with stable errors that do not contain source bodies.
- [x] Exercise public lifecycle interfaces against real temporary source, object-store, and rehydration directories through vertical red-green TDD tests.

## Evidence

- Commit:
- Validation: `pnpm test` passes 65 tests and `pnpm typecheck` passes.
- Integration: Nine source-snapshot lifecycle tests exercise the public API against real temporary source, object-store, and rehydration directories, including privacy, immutability, rollback, expiry, deletion, malformed metadata, and integrity drift.

## Handoff

- A later S3-compatible adapter should implement the same object-store contract with conditional create semantics, server-side encryption, and lifecycle/deletion observability.
- The upload/controller layer should create the snapshot before cleaning the ZIP workspace and store only the returned snapshot identity in review metadata.
- Chat and later extraction stages should rehydrate or fetch eligible source through this snapshot boundary rather than relying on generated documents alone.

## Related knowledge

- [Architecture Concept](../../../docs/knowledge/architecture-concept.md)
- [Language Support and Intake](../../../docs/knowledge/language-support-and-intake.md)
- [Repository Review Knowledge Contract](../../../docs/knowledge/review-output-contract.md)
