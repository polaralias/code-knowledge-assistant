---
type: Architecture Concept
title: Initial Repository Knowledge Architecture
description: Describes the evidence, review, retrieval, model, storage, and deployment boundaries, including provider-interpreted review generation and its deterministic safety control.
timestamp: 2026-08-28T16:10:00Z
authority: canonical
verification: verified-limited
verified_at: 2026-08-28T16:10:00Z
verified_against:
  - packages/intake/tests/inventory.test.ts
  - packages/intake/tests/zip-intake.test.ts
  - packages/source-snapshots/tests/snapshot-lifecycle.test.ts
  - packages/analysis/tests/analysis.test.ts
  - packages/review-generation/tests/review-generation.test.ts
  - packages/retrieval/tests/retrieval.test.ts
  - packages/review-pipeline/tests/review-pipeline.test.ts
  - packages/model-provider/tests/model-provider.test.ts
  - local provider-backed Cozylife extraction with six validated Qwen 3.6 Flash concepts
  - packages/review-orchestration/tests/orchestration.test.ts
  - packages/review-jobs/tests/review-jobs.test.ts
  - packages/review-artifacts/tests/review-artifacts.test.ts
  - packages/review-service/tests/review-service.test.ts
  - packages/answering/tests/grounded-answering.test.ts
  - apps/api/tests/runtime.test.ts
  - deploy/policy.test.mjs
  - packages/review-service/tests/git-review-service.test.ts
  - apps/api/tests/server.test.ts
  - apps/web/tests/upload-client.test.mjs
  - direct runtime smoke against https://github.com/pallets/click at main
  - browser observation at http://127.0.0.1:4174/
  - pnpm test
  - pnpm typecheck
  - docker build --tag code-knowledge-assistant:release-candidate .
  - release-candidate container healthz and readyz smoke on port 4273
navigation:
  role: foundational
  order: 40
---

# Initial repository knowledge architecture

The path from a browser-submitted ZIP or public GitHub URL through bounded intake, durable body-free job transitions, deterministic inventory, immutable snapshotting, conservative lexical analysis, evidence-constrained provider interpretation, restart-safe artifact reconstruction, summary-plus-source conversational answering, scheduled expiry, access-code enforcement, and the browser workspace is implementation-verified. Initial review generation runs one bounded model pass for each required concept family. The model receives selected source evidence and may author titles, summaries, and claims, but the application assigns internal identifiers and accepts only exact evidence references. Live questions combine lexical hits with review concepts and bounded primary excerpts before provider composition; the deterministic control remains available when provider output is unavailable or unverifiable. Qwen 3.6 Flash runs with hybrid thinking disabled for predictable structured-output budgets; DeepSeek V4 Flash is a per-concept fallback. Enhanced parsing, semantic vector retrieval, and multi-instance hosted storage remain proposed boundaries.

## Logical flow

```text
Repository input
  -> deterministic safety and inventory pass
  -> capability classification and source extraction
  -> primary evidence index
  -> six evidence-constrained model interpretation passes
  -> schema and claim-to-evidence validation
  -> derived documentation index
  -> bounded lexical retrieval plus summary/source context assembly
  -> provider composition and citation validation
  -> cited conversational answer
```

## Knowledge layers

### Primary evidence

- supported source files;
- tests and configuration;
- existing repository documentation;
- deterministic symbols, imports, metadata, and line locations.

### Derived knowledge

- system overview;
- component catalogue;
- important flows;
- API and integration reference;
- explicit uncertainties and coverage gaps.

The derived layer is an OKF 0.1-compatible bundle scoped to one review workspace. Its concepts are generated and non-authoritative: they carry the review revision, generation metadata, verification state, and links to separate primary evidence. The application never writes generated concepts back into the submitted repository.

## Language capability layers

- **Enhanced:** bespoke Tree-sitter queries and repository-pattern adapters for Python and TypeScript/JavaScript. Extract symbols, imports, framework landmarks, source ranges, and supported relationships.
- **Structured:** use an available parser or Universal Ctags language support to identify syntax or symbols and produce a generic review without bespoke framework claims.
- **Fallback:** inventory text files, existing documents, comments where safely identifiable, configuration landmarks, and bounded representative excerpts; use the LLM to produce a general overview with explicit lower confidence.

Tree-sitter supplies concrete syntax trees, not a complete semantic or runtime call graph. It is valuable because it makes boundaries, source ranges, and syntax-aware chunking deterministic. Cross-file relationships are emitted only when supported by imports, references, configuration, tests, or other inspectable evidence.

Derived knowledge provides orientation. Primary evidence remains the basis for material answer claims.

## Initial service boundaries

The review pipeline exposes a provider-independent inventory core, safe ZIP adapter, immutable public-GitHub intake boundary, source-snapshot lifecycle, materialized review coordinator, lexical analysis, deterministic review generator, lexical evidence index, bounded deterministic answerer, durable job and completed-artifact stores, asynchronous application service, and HTTP adapter. `buildUploadReviewServer` wires the filesystem job, object, and completed-artifact stores through `createReviewService` and `createReviewServiceController` into the browser API. The service owns accepted uploads and Git workspaces, records lifecycle transitions, persists validated completed reviews before ready publication, reconstructs their evidence index after restart, and schedules non-overlapping expiry sweeps. Python, TypeScript, and JavaScript currently receive conservative lexical `structured` extraction; eligible unknown text receives `fallback`, and no language is yet labelled `enhanced`.

- **Web application:** repository selection, review status, documentation navigation, chat, and evidence inspection.
- **Review pipeline:** safe Git or zip intake, capability classification, extraction, chunking, review generation, validation, and indexing.
- **Retrieval pipeline:** deterministic lexical retrieval across both knowledge layers, exact-path prioritisation, bounded summary/source context assembly, and a documented future vector/reranking seam.
- **Generation adapter:** OpenAI-compatible provider boundary supporting configurable review and chat models.
- **Persistence:** local job metadata and integrity-wrapped completed-review artifacts are stored as atomic versioned JSON records. Lexical indexes are deterministically rebuilt from persisted evidence after restart. PostgreSQL with pgvector remains the proposed hosted store for multi-instance metadata and vector retrieval.
- **Object storage:** a provider-independent object-store contract now implements immutable, policy-filtered source snapshots. Its filesystem adapter is verified for local self-hosting and tests; a hosted S3-compatible adapter remains to be implemented. Snapshots store eligible source and an exclusion manifest, not raw ZIP uploads or excluded sensitive file bodies.
- **Worker filesystem:** one ephemeral temporary directory per active intake or extraction pass. A later pass rehydrates from the retained source snapshot rather than depending on a dedicated per-review volume.
- **Observability:** structured events for pipeline stages, retrieval, generation, validation, latency, tokens, and estimated cost.

## Deployment hypothesis

The application uses a TypeScript monorepo for the web application, shared contracts, and evaluation harness. A separate Python analysis service is deferred until evaluation demonstrates a library or isolation need that justifies it. The repository contains a non-root Node container, application health/readiness routes, and a Dockerfile-backed Railway manifest. The release-candidate image builds successfully and its production startup serves healthy `/healthz` and ready `/readyz` responses in a local container. The current filesystem stores require one persistent `DATA_ROOT` and a single replica; PostgreSQL, S3-compatible storage, and product-runtime model integration remain portable future boundaries.

The review is a bounded, resumable multi-stage workflow rather than an unrestricted agent loop. Queue state, retries, idempotency, structured outputs, and stage budgets are persisted. A future read-only MCP interface may expose reviewed knowledge after the core web journey is proven; it is not an MVP dependency.

## Security boundaries

- Never execute repository code or source-supplied commands.
- Treat source, comments, documents, and generated output as untrusted data.
- Enforce archive, file, path, size, count, and content-type limits outside the model.
- Keep provider credentials server-side and least-privileged.
- Validate structured model output and provenance deterministically.
- Apply query, token, repository-review, and monetary budgets.
- Define retention and deletion behaviour before accepting non-demo uploads.
- Delete raw archives after extraction; automatically delete non-demo extracted source, evidence, and derived knowledge 48 hours after completion; verify deletion and offer an earlier delete action.

The implemented service gives queued/processing work a one-hour deadline, replaces it atomically with a 48-hour deadline when a review becomes ready, and starts a non-overlapping periodic expiry scheduler with the API runtime. Sweeps reconcile job metadata, source snapshots, completed artifacts, memory state, and owned uploads; early deletion follows the same boundaries. Restart recovery of ready review metadata, generated knowledge, evidence, and lexical answering is runtime-tested. S3 lifecycle configuration, deletion observability, multi-instance coordination, vectors, and backup deletion remain open integration work.

## Open architecture decisions

The selected model allocation is operational but still subject to the measured evaluation matrix. Embedding model, reranking threshold, conversation-memory contract, answer-time verification depth, exact enhanced extraction libraries, provider privacy terms, and public-demo access limits remain open in the [decision queue](./decision-queue.md) and [roadmap](./roadmap-and-known-gaps.md).

## Related knowledge

- [Product contract](./product-contract.md)
- [Feature contracts](./feature-contracts.md)
- [Product direction decision](./decisions/001-product-direction.md)
- [Hosting and model strategy proposal](./decisions/002-hosting-and-model-strategy.md)
- [Capability, intake, and review format decision](./decisions/003-capability-intake-and-review-format.md)
- [Language support and intake](./language-support-and-intake.md)
- [Review output contract](./review-output-contract.md)
- [Deployment readiness](./deployment-readiness.md)
