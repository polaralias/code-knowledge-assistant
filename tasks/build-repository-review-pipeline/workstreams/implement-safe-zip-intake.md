---
type: Workstream
task: build-repository-review-pipeline
workstream: implement-safe-zip-intake
title: Implement safe ZIP intake
description: Consume a bounded ZIP upload into an isolated temporary review workspace,
  reject unsafe archives before extraction, inventory the result, and expose deterministic
  cleanup.
status: done
created: '2026-08-26T18:26:26Z'
timestamp: '2026-08-26T18:44:00Z'
owner: James Whelan
---

# Implement safe ZIP intake

## Assigned outcome

Consume a bounded ZIP upload into an isolated temporary review workspace, reject unsafe archives before extraction, inventory the result, and expose deterministic cleanup.

## Owned and shared paths

- Owned: `packages/intake/**` and intake-specific dependency declarations.
- Shared: root package lockfile, root test command, repository intake policy, and the existing `inventoryRepository` public interface.

## Acceptance and validation

- [x] Consume one ZIP path through a public interface that creates a unique temporary review directory under a caller-selected workspace root.
- [x] Preflight every archive entry before creating or writing the review directory.
- [x] Reject malformed or encrypted archives, absolute paths, parent traversal, backslash ambiguity, NULs, symbolic links, duplicate or case-colliding paths, excessive nesting, excessive entries, excessive declared bytes, oversized files, and excessive compression ratios with stable codes.
- [x] Extract regular files and directories without overwriting existing paths, then run the existing deterministic inventory interface over the materialized directory.
- [x] Delete the raw uploaded archive after success or failure without placing source bodies or suspected secret values in diagnostics.
- [x] Return an idempotent cleanup operation for the extracted temporary workspace; do not require a persistent volume per review.
- [x] Exercise the public interface with real ZIP files and real temporary directories through vertical red-green TDD tests.

## Evidence

- Commit: Uncommitted branch delta on `docs/initialise-project`; no commit was created in this slice.
- Validation: `pnpm test` passes 56 tests; `pnpm typecheck` passes; the knowledge bundle is OKF-conformant; strict OKF Tasks validation passes with zero warnings.
- Integration: Valid ZIP intake invokes `inventoryRepository` through the public boundary, applies caller-supplied sensitive-path policy, consumes the raw archive, and returns explicit workspace cleanup.

## Handoff

- A later upload/controller and persistence layer supplies the temporary raw archive path and configured workspace root, stores an immutable policy-filtered snapshot of eligible source plus the exclusion manifest in S3-compatible object storage for the 48-hour review lifetime, omits excluded sensitive bodies, and calls cleanup when processing ends.
- Public Git acquisition should materialize into the same inventory boundary without being coupled to ZIP parsing.
