---
type: Workstream
task: harden-and-publish-product
workstream: add-ci-release-gates
title: Add CI and release gates
description: Run reproducible install, type, test, security, and container policy
  checks in CI with a valid version source and least-privilege workflow permissions.
status: done
created: '2026-08-27T22:38:34Z'
timestamp: '2026-08-27T23:30:31Z'
owner: luna-ci
---

# Add CI and release gates

## Assigned outcome

Run reproducible install, type, test, security, and container policy checks in CI with a valid version source and least-privilege workflow permissions.

## Owned and shared paths

- Owned: `.github/**` and `VERSION`.
- Shared: root package commands remain integration-owned; do not edit `package.json`.

## Acceptance and validation

- [x] Add a least-privilege CI workflow for Node 24 and pinned pnpm with frozen installation, typecheck, tests, and deployment policy checks.
- [x] Add dependency and secret scanning without exposing repository or runtime secrets.
- [x] Ensure release automation has a valid repository version source and does not run release writes from untrusted pull-request code.
- [x] Pin third-party actions to stable major versions and use explicit permissions and concurrency controls.
- [x] Keep workflows usable before an external remote, registry, or deployment target exists.

## Evidence

- Commit:
- Validation: `node --test deploy/ci-policy.test.mjs` passes all release-policy checks; workspace validation will run at tranche close.
- Integration: `.github/workflows/ci.yml` gates tests, types, audit, secret/dependency review, and the image build; `release.yml` separates read-only verification from publishing.

## Handoff

- Record remaining risks, integration instructions, and knowledge-promotion needs.
