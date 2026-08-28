---
type: Repository Guide
title: Code Knowledge Assistant
description: Start here to understand the evidence-backed repository review and conversational code exploration project.
timestamp: 2026-08-28T02:56:30Z
authority: canonical
navigation:
  role: entry-point
  order: 0
---

# Code Knowledge Assistant

Code Knowledge Assistant reviews a repository, produces evidence-backed documentation, and lets a user explore that derived knowledge conversationally without losing its connection to the underlying source code.

The repository is intentionally documentation-led. Canonical product and architecture knowledge lives under [`docs/knowledge/`](./docs/knowledge/index.md); delivery state lives separately in the generated [`tasks/`](./tasks/index.md) OKF Tasks bundle.

## Reading order

1. [Product brief](./docs/knowledge/product-brief.md)
2. [Product contract](./docs/knowledge/product-contract.md)
3. [Feature contracts](./docs/knowledge/feature-contracts.md)
4. [Architecture concept](./docs/knowledge/architecture-concept.md)
5. [Language support and intake](./docs/knowledge/language-support-and-intake.md)
6. [Review output contract](./docs/knowledge/review-output-contract.md)
7. [Engineering quality contract](./docs/knowledge/engineering-quality-contract.md)
8. [Evaluation baseline contract](./docs/knowledge/evaluation-contract.md)
9. [Decision queue](./docs/knowledge/decision-queue.md)
10. [Deployment readiness and outstanding work](./docs/knowledge/deployment-readiness.md)
11. [Delivery tasks](./tasks/index.md)

## Current state

- Product direction: selected and documented.
- Architecture and capability tiers: inventory, safe ZIP intake, retained source snapshots, structured lexical extraction, fallback extraction, deterministic review generation, and lexical retrieval are implementation-verified.
- Model and retrieval choices: candidates only; evaluation must determine the deployed configuration.
- Evaluation baseline: deterministic fixtures, scoring controls, and three immutable real-world intake manifests are present; paid provider comparison is paused.
- Application code: bounded ZIP and public-GitHub intake now pass through durable body-free job metadata, immutable source snapshotting, conservative Python/TypeScript/JavaScript structured extraction (plus unknown-text fallback), deterministic evidence-backed review generation, and bounded cited answering. Completed review artifacts and lexical evidence indexes survive application restart, and a non-overlapping scheduler coordinates the 48-hour post-completion expiry across jobs, source snapshots, artifacts, memory, and owned uploads. Hosted access-code controls, persistent quotas, body-safe telemetry, CI/release policy, and a generated Uptime Kuma demo artifact are implemented. The browser now presents a chat-centred Review, Findings, and Map workspace over those contracts. The remaining product gates are provider evaluation/integration, hosted deployment, and clean hosted browser evidence.
- Conversation retrieval: the shipped path is bounded lexical retrieval over primary and derived evidence with deterministic ranking, context limits, citations, and explicit insufficiency. It is a useful RAG-like control but not semantic vector RAG; embeddings, reranking, provider synthesis, conversation memory, and answer-time claim verification remain evaluated follow-up work.
- Deployment code: a non-root Node container contract, bundled Uptime Kuma artifact, `/healthz`, `/readyz`, and a Railway manifest are present. The image builds and starts healthy locally with Docker Desktop; no Railway project has been created.
- Remote project repository and Railway project: not created.

See [Deployment readiness and outstanding work](./docs/knowledge/deployment-readiness.md) for the evidence matrix, launch gates, and explicit deferrals.

## Development

The current implementation requires Node.js 24 or newer and pnpm 11.

```text
pnpm install
pnpm test
pnpm typecheck
set REVIEW_ACCESS_CODES_JSON=["local-development-code"]
node apps/api/src/start.ts .local-data 4174
```

## Working principles

- Treat source code as canonical evidence and generated documentation as derived knowledge.
- Keep every material answer traceable to repository files, symbols, and line ranges.
- Prefer a small working product with strong evaluation and engineering evidence over a broad but fragile system.
- Record durable decisions and execution state in the repository rather than relying on chat history.
- Keep the application self-hostable even when the reference demo is deployed to a managed platform.
