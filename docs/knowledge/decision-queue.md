---
type: Decision Queue
title: Open Product and Engineering Decisions
description: Lists the unresolved judgements that QTK must resolve before dependent implementation tasks become ready.
timestamp: 2026-08-27T21:35:00Z
authority: canonical
navigation:
  role: supporting
  order: 50
---

# Open product and engineering decisions

These questions are deliberately visible. Candidate answers are hypotheses, not accepted architecture.

## Product and demonstration

- Does the first measured Uptime Kuma review meet the quality, latency, cost, and presentation threshold to remain the default public demonstration?

## Review and retrieval

- What chunk representation best supports both code retrieval and evidence citations?
- Does reranking improve the selected evaluation set enough to justify latency and complexity?
- Which Tree-sitter packages and Universal Ctags distribution satisfy portability, licensing, and container-size constraints?

## Models

- Which reviewed model best balances correctness, structured-output reliability, latency, and cost?
- Does a stronger one-time review model materially improve downstream chat quality?
- Which embedding model and dimensionality performs best on the code evaluation set?
- Do the provider's binding terms define acceptable retention and deletion for submitted private source beyond its no-training statement?

Current screening: evaluate Qwen through Alibaba Cloud Model Studio's Germany region first; do not send private zip content to the direct DeepSeek service until contractual retention and improvement-use terms are acceptable.

OpenRouter is resolved as an optional public-source generation-evaluation adapter only. Private source remains on the approved Frankfurt route; OpenRouter's standard routing is not a substitute for regional residency, and it does not currently consolidate the accepted embedding and reranking matrix.

Current candidates are DeepSeek V4 Flash and Pro, Qwen Flash and Plus, Qwen text-embedding-v4, and Qwen reranking. No candidate is selected until the evaluation contract and results support it.

## Application and deployment

- How is 48-hour deletion verified across PostgreSQL, object storage, vectors, backups, and failed jobs?
- What measured Railway sizing is required after the first end-to-end review?

The current evidence matrix and external launch gates are maintained in [Deployment Readiness and Outstanding Work](./deployment-readiness.md). The reference deployment remains intentionally single-replica and filesystem-backed until hosted storage and sizing evidence justify a broader topology.

## Resolved in the current QTK tranche

- Input: public Git URL and bounded zip upload.
- Capability: enhanced Python and TypeScript/JavaScript; structured broad-language extraction; labelled general-overview fallback.
- Review output: isolated, derived OKF-compatible knowledge bundle with separate primary evidence.
- Application: TypeScript monorepo with a database-backed worker; Python service deferred pending evidence.
- Data: raw archive deleted after extraction and non-demo review data retained for 48 hours.
- Hosting: portable self-hosted containers plus Railway as the managed reference deployment.
- Models: DeepSeek and Qwen remain an agreed evaluation set, not a pre-selected winner.
- Demonstration: Uptime Kuma is preferred; Poetry and PocketBase provide enhanced Python and non-enhanced Go evaluation coverage.
- Hosted access: anonymous pre-indexed exploration, access-code-gated reviews, bounded input and rate limits, and a GBP 20 initial provider budget.
- Evaluation: provisional evidence thresholds are defined in the evaluation baseline contract.
- OpenRouter: useful for pinned, no-fallback public-source generation comparisons; excluded from private-source processing under the current boundary.

## Resolution route

Resolve related questions in dense QTK batches, record durable decisions under [`decisions/`](./decisions/001-product-direction.md), update the [architecture concept](./architecture-concept.md), and only then promote dependent OKF Tasks to ready.
