---
type: Capability Contract
title: Language Support and Repository Intake
description: Defines input modes, analysis capability tiers, initial enhanced languages, and the limits of static repository understanding.
timestamp: 2026-08-27T21:35:00Z
authority: canonical
verification: verified-limited
verified_at: 2026-08-27T21:35:00Z
verified_against:
  - packages/intake/tests/inventory.test.ts
  - packages/intake/tests/zip-intake.test.ts
  - packages/git-intake/tests/public-git-intake.test.ts
  - packages/source-snapshots/tests/snapshot-lifecycle.test.ts
  - packages/analysis/tests/analysis.test.ts
  - packages/review-pipeline/tests/review-pipeline.test.ts
  - packages/review-orchestration/tests/orchestration.test.ts
  - packages/review-jobs/tests/review-jobs.test.ts
  - packages/review-service/tests/review-service.test.ts
  - packages/review-service/tests/git-review-service.test.ts
  - apps/api/tests/server.test.ts
  - apps/api/tests/runtime.test.ts
  - apps/web/tests/upload-client.test.mjs
  - browser observation at http://127.0.0.1:4174/
  - pnpm test
  - pnpm typecheck
navigation:
  role: foundational
  order: 45
---

# Language support and repository intake

## Accepted inputs

- A public Git repository URL resolved to an immutable commit for the review.
- A bounded zip upload for local or private source.
- A pre-indexed public demonstration workspace.

The hosted product never executes submitted code. Local self-hosting uses the same no-execution review boundary. Direct local-folder ingestion may be added to a local-only adapter later, but zip is the portable MVP path.

## Current implementation evidence

The materialized-directory inventory stage is verified working through the public `inventoryRepository` interface. It walks files without executing repository content; emits stable relative paths, byte sizes, SHA-256 digests, line counts, eligibility, and exclusion reasons; excludes common dependency, generated, build, binary/media, and sensitive paths; and fails closed on symlinks and configured file-count, per-file, and total analyzed-byte limits.

The `ingestZipArchive` interface now consumes a bounded raw ZIP into a unique temporary workspace, preflights the complete archive before creating that workspace, safely extracts regular content, invokes the same inventory policy, deletes the raw upload, and returns idempotent workspace cleanup. It rejects malformed or encrypted ZIPs, unsafe or colliding paths, symbolic links and special files, excessive paths, entries, declared bytes, and compression ratios, and checksum mismatches through stable error codes.

Inventory exclusions are application policy, not `.gitignore` behaviour. Known dependency, build, generated, binary/media, and sensitive paths are reported with explicit reasons; known-excluded file contents are not read. Callers may add repository-relative sensitive paths. A future policy may interpret repository ignore files as disclosed hints, but source-controlled ignore rules do not currently decide review coverage.

The `createSourceSnapshot`, `rehydrateSourceSnapshot`, `deleteSourceSnapshot`, and `purgeExpiredSourceSnapshots` interfaces now implement the provider-independent source lifecycle. Creation reads eligible inventory entries only, rechecks their byte sizes and SHA-256 digests, retains exclusion paths and reasons without their bodies, and publishes an immutable manifest only after its objects exist. Active snapshots rehydrate into unique temporary directories with object integrity checks and idempotent cleanup. Expired snapshots are rejected before workspace creation; early deletion and expiry sweeping are idempotent. The filesystem-backed adapter supports local self-hosting and integration tests without requiring one mounted volume per review.

The inventory interface reproduces the exact eligible and excluded path sets in the Python and TypeScript deterministic evaluation fixtures. The public analysis interface consumes that inventory and emits deterministic files, symbols, imports, bounded evidence chunks, exclusions, and body-free failures. Python, TypeScript, and JavaScript are labelled `structured` because extraction is conservative and lexical; eligible unknown text is labelled `fallback`. `orchestrateZipRepositoryReview` and the materialized-directory coordinator connect intake to an immutable snapshot, dispose the acquired workspace, review a fresh disposable rehydration, and clean up or roll back through stable body-free failures. The local HTTP application accepts bounded ZIP bodies and public GitHub URL/ref JSON, persists body-free lifecycle state and completed review artifacts, reconstructs cited answers after restart, and schedules cross-store expiry. The public Git intake boundary accepts only unambiguous credential-free GitHub HTTPS repository URLs, resolves a requested ref or default branch to an immutable 40-character commit, and materializes a shallow detached checkout through a no-shell, non-interactive Git transport. Hooks, submodules, credential helpers, prompts, inherited Git configuration, unbounded process output, and unbounded runtimes are disabled or constrained. It verifies `HEAD`, enforces a repository-size limit, and cleans its unique workspace idempotently. Enhanced Tree-sitter analysis and a hosted S3-compatible adapter remain unimplemented.

## Capability tiers

### Enhanced analysis

The intended initial enhanced languages are Python and TypeScript/JavaScript. The implemented extractors currently qualify only as `structured`: they identify conservative lexical symbols and imports with precise source ranges but do not claim syntax-tree or framework semantics. Future language adapters may add deterministic Tree-sitter queries for public interfaces, framework entry points, configuration bindings, tests, and supported relationships.

Enhanced does not mean complete. Static evidence cannot prove all dynamic dispatch, reflection, generated code, runtime configuration, or external behaviour.

### Structured analysis

When no bespoke adapter exists, an available Tree-sitter grammar or Universal Ctags parser can still provide syntax or symbol boundaries across many languages. The system uses those boundaries for better chunking, navigation, provenance, and a generic component review. It does not invent framework-specific semantics.

### General-overview fallback

For other text source, the system inventories paths and file types, reads existing documentation and configuration, extracts comments only when a reliable extractor is available, and selects bounded representative excerpts. An LLM may identify likely landmarks and key functions from that evidence, but output is labelled as fallback and lower confidence. Unknown syntax is never represented as a deterministic parse.

## Why Tree-sitter is useful without a full graph

Tree-sitter produces a concrete syntax tree with precise source ranges and robust error recovery. That is enough to make symbol boundaries, comment association, imports, syntax-aware chunks, and citations substantially more reliable. It is not a type checker and does not create a complete call graph. The product builds only evidence-supported relationships and treats graph depth as an evaluated enhancement rather than a prerequisite for usefulness.

## Capability disclosure

Every review records:

- detected languages and file coverage;
- extractor and adapter versions;
- achieved tier per language;
- exclusions and parse failures;
- supported relationship types;
- unresolved or inference-only areas.

The UI and generated knowledge use this record to prevent a general overview from appearing equivalent to enhanced analysis.

## Data lifecycle

- Raw zip upload: delete immediately after safe extraction.
- Active processing: use a unique ephemeral filesystem workspace inside the worker or local container; no dedicated mounted volume is required per review.
- Follow-up questions and reruns: retain one immutable, policy-filtered normalized source snapshot plus evidence and generated knowledge for the review lifetime. The local filesystem adapters retain the snapshot and an integrity-wrapped completed-review artifact; after restart the service reconstructs the generated review and lexical evidence index and can answer cited follow-up questions without reprocessing source. The snapshot contains eligible source bytes and the exclusion manifest, not sensitive or otherwise excluded file bodies. Generated documents alone are not sufficient primary evidence.
- Durable hosted storage: the implemented lifecycle is provider-independent and currently verified through its filesystem adapter. The hosted implementation will place the bounded snapshot in S3-compatible object storage and keep workspace, provenance, and index metadata in PostgreSQL/pgvector. A later extraction pass rehydrates a new ephemeral worker directory from the snapshot.
- Non-demo policy-filtered source snapshots, evidence, embeddings, and generated knowledge: expire 48 hours after review completion.
- User deletion: available before expiry and propagated across database, object storage, and indexes.
- Pre-indexed public demo: retained until explicitly replaced.
- Logs and metrics: never contain source bodies, secrets, or raw prompts with submitted code.

## Related knowledge

- [Architecture concept](./architecture-concept.md)
- [Review output contract](./review-output-contract.md)
- [Capability decision](./decisions/003-capability-intake-and-review-format.md)
- [Inventory implementation workstream](../../tasks/build-repository-review-pipeline/workstreams/implement-inventory-core.md)
- [Safe ZIP intake workstream](../../tasks/build-repository-review-pipeline/workstreams/implement-safe-zip-intake.md)
- [Source snapshot lifecycle workstream](../../tasks/build-repository-review-pipeline/workstreams/implement-source-snapshot-lifecycle.md)
- [Durable review job workstream](../../tasks/build-repository-review-pipeline/workstreams/persist-review-jobs.md)
- [Asynchronous review service workstream](../../tasks/build-repository-review-pipeline/workstreams/integrate-asynchronous-review-service.md)
- [Immutable public Git intake workstream](../../tasks/build-repository-review-pipeline/workstreams/implement-public-git-intake.md)
- [Completed review persistence workstream](../../tasks/build-repository-review-pipeline/workstreams/persist-completed-review-artifacts.md)
- [Deployment readiness](./deployment-readiness.md)
