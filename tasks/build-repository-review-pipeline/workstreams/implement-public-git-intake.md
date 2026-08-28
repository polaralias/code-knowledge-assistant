---
type: Workstream
task: build-repository-review-pipeline
workstream: implement-public-git-intake
title: Implement immutable public Git intake
description: Acquire an allowlisted public Git repository at a resolved immutable
  commit without executing repository content.
status: done
created: '2026-08-27T16:36:51Z'
timestamp: '2026-08-27T17:00:28Z'
owner: terra-git
---

# Implement immutable public Git intake

## Assigned outcome

Acquire an allowlisted public Git repository at a resolved immutable commit without executing repository content.

## Owned and shared paths

- Owned: `packages/git-intake/**`
- Shared: expose a materialized-repository contract compatible with existing inventory/orchestration; do not edit intake, review-service, API, root configuration, documentation, or task records.

## Acceptance and validation

- [x] Accept only bounded HTTPS GitHub repository URLs and reject credentials, query strings, fragments, local paths, alternate protocols, and ambiguous repository shapes.
- [x] Resolve a requested ref or default branch to an immutable commit through an injected Git transport boundary.
- [x] Fetch only the required commit with bounded depth into a unique temporary workspace and never execute repository hooks or checked-out content.
- [x] Verify the checked-out commit and return repository identity, immutable revision, workspace path, and idempotent cleanup.
- [x] Apply time, output, and repository-size limits with stable body-free errors and complete cleanup on failure.
- [x] Test the orchestration with a deterministic fake transport plus an optional local bare-repository integration fixture; do not require GitHub credentials.

## Evidence

- Commit: not created; repository has no initial Git commit and no commit was authorised.
- Validation: nine deterministic package tests pass and the full TypeScript check passes without network or credentials.
- Integration: `createGitCliTransport` provides the hardened no-shell production adapter consumed by `intakePublicGitRepository`.

## Handoff

- The package boundary is complete; HTTP/UI exposure remains a separate integration slice. Git servers must permit fetching the resolved SHA, and SHA-256 repositories are not yet supported.
