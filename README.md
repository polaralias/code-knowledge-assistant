---
type: Repository Guide
title: Code Knowledge Assistant
description: Start here to understand the evidence-backed repository review and conversational code exploration project.
timestamp: 2026-08-28T16:10:00Z
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
11. [Roadmap and known gaps](./docs/knowledge/roadmap-and-known-gaps.md)
12. [Delivery tasks](./tasks/index.md)

## Current state

- Product direction: selected and documented.
- Architecture and capability tiers: inventory, safe ZIP intake, retained source snapshots, structured lexical extraction, fallback extraction, evidence-constrained provider interpretation with a deterministic control, and lexical retrieval are implementation-verified.
- Model and retrieval choices: Qwen 3.6 Flash is the current production generation primary and DeepSeek V4 Flash is its per-concept fallback; the wider evaluation remains required before treating that allocation as final.
- Evaluation baseline: deterministic fixtures, scoring controls, and three immutable real-world intake manifests are present; paid provider comparison is implemented as a bounded runner, with the full model/retrieval matrix still pending measured runs.
- Application code: bounded ZIP and public-GitHub intake now pass through durable body-free job metadata, immutable source snapshotting, conservative Python/TypeScript/JavaScript structured extraction (plus unknown-text fallback), six bounded provider interpretation passes, strict claim-to-evidence validation, and bounded cited answering. Qwen hybrid thinking is disabled for these structured passes so its token budget is spent on the validated result; the model supplies interpretation while the application owns stable concept and claim identifiers. If a pass fails validation, DeepSeek is tried for that concept and any still-unavailable concept retains the deterministic evidence-backed control. Completed review artifacts and lexical evidence indexes survive restart, with a 48-hour expiry lifecycle. The browser presents a chat-centred Review, Findings, and Map workspace.
- Conversation retrieval: bounded lexical retrieval over primary and derived evidence, supplemented with review summaries and selected primary excerpts, feeds provider-backed cited answers with explicit insufficiency controls. This is retrieval-augmented generation in the broad sense, but not semantic vector RAG; semantic retrieval, reranking, conversation memory, and answer-time derived-claim verification are documented follow-on tranches.
- Deployment: the Dockerfile-backed singleton service is live at [code-knowledge-assistant-production.up.railway.app](https://code-knowledge-assistant-production.up.railway.app) with a persistent `/var/lib/code-atlas` volume. The latest provider-context deployment is tracked in [deployment readiness](./docs/knowledge/deployment-readiness.md); health and readiness are monitored by the Railway smoke path.
- Public source: [polaralias/code-knowledge-assistant](https://github.com/polaralias/code-knowledge-assistant).

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
