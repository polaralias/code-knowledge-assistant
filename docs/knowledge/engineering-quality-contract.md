---
type: Quality Contract
title: Engineering Quality and Operational Evidence
description: Defines the implementation, evaluation, security, observability, and delivery evidence expected from the product.
timestamp: 2026-08-27T21:35:00Z
authority: canonical
verification: verified-limited
verified_at: 2026-08-27T21:35:00Z
verified_against:
  - apps/api/tests/server.test.ts
  - apps/api/tests/runtime.test.ts
  - deploy/policy.test.mjs
  - packages/review-service/tests/git-review-service.test.ts
  - direct runtime smoke against https://github.com/pallets/click at main
  - direct deploy/start.mjs smoke test
  - pnpm test
  - pnpm typecheck
navigation:
  role: foundational
  order: 49
---

# Engineering quality and operational evidence

## Architecture and implementation

- Use clean module boundaries, dependency inversion at provider and parser edges, and domain language shared between contracts, code, and generated knowledge.
- Prefer a small explicit workflow over framework-heavy orchestration. Add event-driven or separately deployed services only when isolation, duration, scale, or evaluation evidence requires them.
- Keep configuration environment-driven, dependencies replaceable, processes disposable, and local and hosted behaviour aligned with twelve-factor principles.
- Build and verify containers for local self-hosting and the managed reference deployment.

The repository now defines a reproducible, non-root Node container with a single writable `DATA_ROOT`, application liveness/readiness routes, and a Dockerfile-backed Railway manifest. Static deployment policy checks, the full 168-test suite, strict typechecking, and direct ZIP/public-Git runtime smoke tests pass. The image build remains an explicit evidence gap because Docker is unavailable in the current environment; Railway provisioning and clean hosted-browser verification are also outstanding.

## AI quality

- Treat extraction, retrieval, structured generation, claim verification, refusal, and prompt-injection resistance as separate testable stages.
- Version model identifiers, prompts, schemas, chunking, embeddings, and reranking configuration with every evaluation result.
- Optimise accuracy, repeatability, latency, token use, and estimated cost together; do not present model fluency as correctness.
- Use retrieval augmentation only where the measured question set benefits from it, with hybrid lexical and vector retrieval as the baseline hypothesis.
- Keep review orchestration bounded and inspectable; do not grant repository content tools or authority.

## Test and release evidence

- Use test-driven development for behaviour-bearing implementation slices where practical.
- Gate changes with formatting, linting, type checks, unit tests, integration tests, security checks, evaluation regressions, and production builds appropriate to the changed surface.
- Maintain deterministic fixtures for exact checks and pinned real-world repositories for usefulness and scale checks.
- Record known failure modes and thresholds rather than hiding them behind aggregate scores.

## Security and operations

- Keep secrets out of source, logs, generated documentation, evaluation artefacts, and client bundles.
- Include dependency and secret scanning in CI; add static application security checks and targeted dynamic checks before public deployment. The current repository has release-drafter configuration but no complete install/typecheck/test/security/image-gate workflow, and its release workflow references a missing `VERSION` file.
- Emit structured logs, metrics, and traces for review stages, retrieval, generation, validation, deletion, failures, latency, tokens, and estimated cost without recording submitted source bodies.
- Provide health and readiness checks, migrations, idempotent jobs, bounded retries, and operator-visible failure classes.
- Enforce file, repository, token, request, concurrency, and monetary budgets outside the model.

## Demonstration evidence

The public repository should show a working product, repeatable setup, evaluation results, architectural reasoning, limitations, screenshots, and a credible productionisation path. A read-only MCP surface can be added after the core web flow if it improves interoperability without distracting from the demonstrated outcome.

## Related knowledge

- [Architecture concept](./architecture-concept.md)
- [Feature contracts](./feature-contracts.md)
- [Deployment readiness](./deployment-readiness.md)
- [Delivery tasks](../../tasks/index.md)
