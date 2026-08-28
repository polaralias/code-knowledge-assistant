---
type: Workstream
task: harden-and-publish-product
workstream: enforce-hosted-access-controls
title: Enforce hosted access and abuse controls
description: Require configured review access codes and enforce persistent bounded
  review-start and question limits without storing plaintext credentials.
status: done
created: '2026-08-27T22:38:33Z'
timestamp: '2026-08-27T23:30:35Z'
owner: luna-access
---

# Enforce hosted access and abuse controls

## Assigned outcome

Require configured review access codes and enforce persistent bounded review-start and question limits without storing plaintext credentials.

## Owned and shared paths

- Owned: `packages/access-control/**`.
- Shared: root integration will wire the package into `apps/api/**` and workspace manifests after package validation.

## Acceptance and validation

- [x] Validate configured access codes without persisting or returning plaintext values.
- [x] Persist rolling 24-hour review-start counts and reject more than two starts per subject.
- [x] Permit only one active review lease per subject, with bounded expiry and idempotent completion/release.
- [x] Persist rolling 24-hour question counts and reject more than thirty questions per client subject.
- [x] Fail closed on corrupt state, unsafe identifiers, invalid limits, and atomic-publication failures through body-free error codes.
- [x] Test behaviour through the public package interface without network access or wall-clock sleeps.

## Evidence

- Commit:
- Validation: package and API boundary suites pass, including persistent quotas, concurrent controllers, gated Git intake, lease completion, and proxy-derived anonymous question subjects.
- Integration: hosted entrypoints require `REVIEW_ACCESS_CODES_JSON`; only hashed subjects, timestamps, and lease state are stored below `DATA_ROOT/access-control`.

## Handoff

- Record remaining risks, integration instructions, and knowledge-promotion needs.
