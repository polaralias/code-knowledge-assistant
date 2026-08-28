---
type: Workstream
task: build-repository-review-pipeline
workstream: implement-inventory-core
title: Implement deterministic repository inventory
description: Inventory materialized repository content safely with deterministic exclusions,
  provenance, and policy-limit enforcement.
status: done
created: '2026-08-26T11:51:32Z'
timestamp: '2026-08-26T12:02:39Z'
owner: James Whelan
---

# Implement deterministic repository inventory

## Assigned outcome

Inventory materialized repository content safely with deterministic exclusions, provenance, and policy-limit enforcement.

## Owned and shared paths

- Owned: `packages/intake/**` and the minimal root TypeScript workspace configuration needed to execute its public tests.
- Shared: repository-limit defaults and exclusion language already defined in canonical intake and feature contracts.

## Acceptance and validation

- [x] Inventory a materialized repository directory through one public interface without executing any repository content.
- [x] Return stable repository-relative paths, byte sizes, SHA-256 digests, line counts, eligibility, and explicit exclusion reasons.
- [x] Exclude common dependency, generated, build, binary/media, and configured sensitive paths deterministically.
- [x] Reject symlinks, path escapes, excessive file count, excessive total bytes, and excessive individual-file size with stable error codes.
- [x] Keep source content and suspected secret values out of errors and logs.
- [x] Exercise the public interface with real temporary directories in red-green TDD tests, including happy-path, exclusion, and failure cases.

## Evidence

- Commit: Uncommitted branch delta on `docs/initialise-project`; no commit was created in this slice.
- Validation: `pnpm test` passes 43 tests and `pnpm typecheck` passes.
- Integration: The public inventory reproduces the exact eligible and excluded path sets in the Python and TypeScript deterministic evaluation fixtures.

## Handoff

- Expose the inventory module to later safe ZIP extraction and bounded public-Git acquisition workstreams. Do not add archive or network acquisition to this slice.

## Related knowledge

- [Feature Contracts](../../../docs/knowledge/feature-contracts.md)
- [Language Support and Intake](../../../docs/knowledge/language-support-and-intake.md)
