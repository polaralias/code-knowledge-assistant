---
type: Decision
title: Use Portable Hosting and an Evaluated Model Strategy
description: Records the accepted self-hosting, Railway reference deployment, and evidence-led DeepSeek and Qwen model strategy.
timestamp: 2026-08-26T11:46:00Z
authority: canonical
decision_status: accepted
navigation:
  role: supporting
  order: 70
---

# Use portable hosting and an evaluated model strategy

## Decision

- Keep the application self-hostable through containers and portable PostgreSQL, S3-compatible storage, and OpenAI-compatible model interfaces.
- Use Railway for the low-friction reference demonstration rather than hosting from a home machine.
- Evaluate DeepSeek and Qwen candidates before selecting generation roles.
- Consider a stronger model for one-time repository review and a cheaper model for repeated conversational questions.
- Avoid self-hosting a large generation model on Railway unless measured usage or privacy requirements justify the GPU cost.
- Use a TypeScript monorepo and database-backed worker initially; retain an adapter boundary for a separately deployed analysis service if evaluation later justifies one.

## Decisions intentionally deferred

No generation, embedding, or reranking model has been selected. The candidate set is accepted, but evaluation, provider privacy terms, measured latency, and cost determine role allocation. Exact Railway sizing and public limits likewise remain operational decisions.

As of 2026-08-25, Alibaba Cloud Model Studio is the preferred Qwen evaluation route because its official [privacy notice](https://www.alibabacloud.com/help/en/model-studio/privacy-notice) states that customer data is not used for model training and its [service documentation](https://www.alibabacloud.com/help/en/model-studio/what-is-model-studio) offers a Germany region. Direct DeepSeek service is not approved for private zip reviews until its applicable [privacy terms](https://platform.deepseek.com/downloads/DeepSeek%20Privacy%20Policy.pdf), retention, and model-improvement use are clarified. These are provider-screening conclusions, not final model selections.

OpenRouter is approved only as an optional, tightly pinned public-source generation-evaluation route. It does not replace the Frankfurt private-source boundary or the direct Model Studio embedding and reranking path. See [Use OpenRouter Only for Bounded Public-Source Evaluation](./005-openrouter-evaluation-boundary.md).

## Required implementation evidence

- A repeatable model and retrieval evaluation against the selected fixture.
- A provider and data-handling review appropriate to source-code uploads.
- A deployable container contract and local Compose path.
- A Railway resource and cost model with hard limits.
- A documented productionisation path that does not depend on Railway-specific application logic.

## Related knowledge

- [Architecture concept](../architecture-concept.md)
- [Decision queue](../decision-queue.md)
- [Product contract](../product-contract.md)
- [OpenRouter evaluation boundary](./005-openrouter-evaluation-boundary.md)
