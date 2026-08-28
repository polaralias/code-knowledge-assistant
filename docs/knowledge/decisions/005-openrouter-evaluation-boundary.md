---
type: Decision
title: Use OpenRouter Only for Bounded Public-Source Evaluation
description: Defines where OpenRouter adds useful model-comparison leverage and where its routing, residency, and retrieval gaps make it unsuitable.
timestamp: 2026-08-26T11:46:00Z
authority: canonical
decision_status: accepted
navigation:
  role: supporting
  order: 100
---

# Use OpenRouter only for bounded public-source evaluation

## Decision

Add OpenRouter as an optional adapter for **public-source generation evaluation only**. It is not the default production provider and must not receive private zip uploads or other private repository content under the current policy.

Keep Alibaba Cloud Model Studio in Frankfurt as the approved first route for private-source evaluation. Keep the direct Model Studio integration for `text-embedding-v4` and `qwen3-rerank`; OpenRouter does not replace that dependency.

## Why it is useful

OpenRouter provides a common OpenAI-compatible interface, normalized token and cost reporting, API-key spending limits, and access to the accepted generation families. Its public model API currently lists pinned DeepSeek V4 Flash and Pro snapshots and Qwen 3.6 Flash and 3.7 Plus. This makes it useful for running a cheap, reproducible public-source comparison without opening several provider accounts.

OpenRouter passes through provider inference prices but charges 5.5% with a USD 0.80 minimum when credits are purchased. That overhead is acceptable for a small evaluation if it is included in the recorded run cost rather than hidden.

## Required evaluation configuration

An OpenRouter evaluation run must:

- use an exact model snapshot rather than a `latest` alias;
- resolve and record one exact provider endpoint per candidate;
- set `allow_fallbacks` to `false` so a failed endpoint cannot silently change the experiment;
- set `require_parameters` to `true` for structured-output comparability;
- set `data_collection` to `deny` and require zero-data-retention routing;
- record the requested model, returned model, selected provider, routing region, token usage, cache use, retries, and total and upstream cost;
- use a dedicated API key with a USD spending limit no greater than the separately approved evaluation ceiling;
- retain the application-side preflight and abort checks because provider-side limits are defence in depth;
- stop immediately on any security-invariant failure.

The initial candidate IDs are `deepseek/deepseek-v4-flash-0731`, `deepseek/deepseek-v4-pro-0813`, `qwen/qwen3.6-flash`, and `qwen/qwen3.7-plus`. Availability, endpoint policy, provider identity, parameter support, and price must be refreshed immediately before the run and preserved with its result.

## Why it is not the private-source route

OpenRouter's standard service may route across providers and regions. Its guaranteed EU in-region path is an enterprise feature, whereas this project already requires a Frankfurt boundary for private source. Zero data retention constrains storage but does not establish geographic residency, and OpenRouter explicitly treats in-memory prompt caching as compatible with its ZDR definition.

OpenRouter also remains an additional processor between the application and the eventual model provider. Its privacy controls are useful, but they do not remove the need to review the selected endpoint's terms. Private source therefore stays on the directly approved Frankfurt route unless a later enterprise agreement, DPA, EU model inventory, and cost comparison justify changing this decision.

## Retrieval limitation

The unauthenticated OpenRouter embedding-model API checked on 2026-08-26 offered Qwen 3 embedding models, but not the accepted Alibaba `text-embedding-v4`. OpenRouter documents an embeddings API but no equivalent `qwen3-rerank` endpoint was found. Using it would therefore add a generation gateway without consolidating the retrieval provider.

## Consequences

- OpenRouter can reduce evaluation setup friction and broaden future public-source model comparisons.
- The baseline runner needs a provider adapter boundary, not OpenRouter-specific orchestration.
- Automatic provider routing is a production convenience but an evaluation confound; it remains disabled in measured runs.
- OpenRouter is not required to continue: direct Model Studio remains the complete path for the accepted Qwen generation, embedding, and reranking matrix.
- A hosted public-demo chat route through OpenRouter remains unselected until model quality, user-input privacy, latency, and cost are measured separately.

## Official evidence

- [Provider routing and fallback controls](https://openrouter.ai/docs/guides/routing/provider-selection)
- [Zero data retention](https://openrouter.ai/docs/guides/features/zdr)
- [Provider logging and enterprise EU routing](https://openrouter.ai/docs/guides/privacy/provider-logging/)
- [Data collection](https://openrouter.ai/docs/guides/privacy/data-collection)
- [Pricing and BYOK fees](https://openrouter.ai/docs/faq)
- [API-key spending limits](https://openrouter.ai/docs/api/api-reference/api-keys/create-keys)
- [Usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting)
- [Embedding models API](https://openrouter.ai/docs/api/api-reference/embeddings/list-embeddings-models)

## Related knowledge

- [Hosting and model strategy](./002-hosting-and-model-strategy.md)
- [Demonstration and evaluation policy](./004-demonstration-and-evaluation-policy.md)
- [Evaluation baseline contract](../evaluation-contract.md)
- [Open decision queue](../decision-queue.md)
- [First evaluation results](../evaluation-baseline-results.md)
