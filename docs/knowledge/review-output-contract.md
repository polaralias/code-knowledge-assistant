---
type: Output Contract
title: Repository Review Knowledge Contract
description: Defines the OKF-compatible generated review bundle, evidence separation, concept families, and review workflow.
timestamp: 2026-08-27T21:35:00Z
authority: canonical
verification: verified-limited
verified_at: 2026-08-27T21:35:00Z
verified_against:
  - packages/source-snapshots/tests/snapshot-lifecycle.test.ts
  - packages/review-generation/tests/review-generation.test.ts
  - packages/review-pipeline/tests/review-pipeline.test.ts
  - packages/review-artifacts/tests/review-artifacts.test.ts
  - packages/answering/tests/grounded-answering.test.ts
  - apps/api/tests/runtime.test.ts
  - apps/web/tests/upload-client.test.mjs
  - packages/review-service/tests/git-review-service.test.ts
  - browser observation at http://127.0.0.1:4174/
  - pnpm test
  - pnpm typecheck
navigation:
  role: foundational
  order: 47
---

# Repository review knowledge contract

## Output shape

Each repository review produces an isolated OKF 0.1-compatible derived knowledge bundle with a generated `index.md`. The product uses the OKF envelope and RKE separation of canonical, supporting, and generated knowledge, but a submitted repository's source remains outside the generated bundle as primary evidence.

Generated concepts use descriptive `type` values and include:

- repository overview and boundaries;
- component concepts;
- important flow concepts;
- API and integration concepts where evidence exists;
- coverage and capability concept;
- uncertainty and follow-up concept.

## Required generated metadata

Every generated concept records a stable review identifier, immutable source revision or upload digest, generation timestamp, model and prompt version, achieved capability tier, verification state, and resolvable evidence references. Generated output is `authority: derived`; it cannot claim `authority: canonical` for the submitted repository.

## Evidence separation

The implemented normalized evidence records contain repository-relative path, revision, line range, symbol where available, content digest, extraction method, capability tier, and a bounded excerpt. Every generated material claim links to input evidence, and validation rejects missing references, unsafe paths, duplicate identifiers, unsupported fields, and unreviewed link surfaces. The local path indexes both primary chunks and derived claims; `createDeterministicAnswerer` returns bounded answers with resolvable citations or explicit insufficiency, and the browser exposes the cited source span. Filesystem-backed completed artifacts and source snapshots are durable across restart; hosted S3/PostgreSQL/vector storage and evaluated provider-backed answer synthesis are not yet implemented.

The supporting source-snapshot, job, and completed-artifact lifecycles are verified limited. Eligible source plus the exclusion manifest—not excluded sensitive bodies—is retained behind an opaque snapshot identifier, while atomic body-free job records expose queued, processing, ready, failed, expired, and deleted state. Completed deterministic analysis, generated concepts, and bounded evidence are persisted inside a versioned integrity envelope; the lexical evidence index is rebuilt deterministically after restart. Browser execution verifies ZIP upload, bounded polling, generated review entry, cited follow-up questions, and source-evidence display, while runtime integration verifies the same review and cited question after application reconstruction. Public Git intake uses the same lifecycle and reaches `ready` in a production-shaped runtime smoke. A scheduled sweep and early deletion reconcile local job, snapshot, artifact, memory, and upload state. Durable conversations, vector records, provider verification, hosted adapters, and multi-instance cleanup coordination remain unimplemented.

## Review workflow

The app exposes a review workspace rather than a separate user-facing tool for every analysis function:

1. Intake and safety report.
2. Inventory and capability report.
3. Deterministic evidence extraction.
4. Bounded component and flow review passes.
5. Claim-to-evidence validation and uncertainty labelling.
6. Human-inspectable review summary with rerun or delete controls.
7. Publication into the workspace's derived OKF bundle and retrieval indexes.

This provides one coherent place to inspect progress and failures while preserving modular backend stages for testing, retry, and observability.

## Update behaviour

Reviews are immutable snapshots. A new commit or upload creates a new review revision. Future comparison may identify changed concepts, but generated knowledge is never silently overwritten or committed into the source repository.

## Related knowledge

- [Product contract](./product-contract.md)
- [Language support and intake](./language-support-and-intake.md)
- [Architecture concept](./architecture-concept.md)
- [Source snapshot lifecycle workstream](../../tasks/build-repository-review-pipeline/workstreams/implement-source-snapshot-lifecycle.md)
- [Upload experience workstream](../../tasks/build-product-experience/workstreams/build-upload-progress-experience.md)
- [Asynchronous review service workstream](../../tasks/build-repository-review-pipeline/workstreams/integrate-asynchronous-review-service.md)
- [Deployment readiness](./deployment-readiness.md)
