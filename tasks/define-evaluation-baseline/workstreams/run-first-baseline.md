---
type: Workstream
task: define-evaluation-baseline
workstream: run-first-baseline
title: Run and publish the first baseline
description: Execute the accepted extraction, retrieval, model, embedding, and reranking
  matrix and publish costs, latency, failures, and selection evidence.
status: in-progress
created: '2026-08-25T22:17:57Z'
timestamp: '2026-08-28T16:10:00Z'
owner: James Whelan
---

# Run and publish the first baseline

## Assigned outcome

Execute the accepted extraction, retrieval, model, embedding, and reranking matrix and publish costs, latency, failures, and selection evidence.

## Owned and shared paths

- Owned: versioned evaluation outputs under `eval/results/**` and the human-readable comparison concept derived from them.
- Shared: runner, scenarios, manifests, fixtures, prompts, and provider adapters.

## Acceptance and validation

- [x] Verify all fixture, intake, scenario, schema, and provider prerequisites before spending provider budget.
- [x] Run the lexical-only baseline before embeddings, reranking, or stronger models.
- [ ] Compare the accepted DeepSeek and Qwen generation candidates on public-source scenarios and keep private-source evaluation inside the approved provider boundary.
- [ ] Compare lexical-only retrieval with `text-embedding-v4` at 1,024 dimensions and evaluate `qwen3-rerank` only on the same candidate sets.
- [ ] Publish raw results, aggregate comparisons, latency, tokens, cost, retries, failures, and bounded human-review notes.
- [ ] Record whether Uptime Kuma remains the public demo and which model or retrieval choices are accepted, rejected, or deferred.
- [ ] Keep the run within a separately configured evaluation budget and stop on any security-invariant failure.

## Evidence

- Commit:
- Validation: `node --test packages/evaluation/tests/*.test.mjs`; `node eval/scripts/validate-scenarios.mjs`; `node eval/scripts/run-lexical-baseline.mjs`; `okf-tasks validate --root . --strict`.
- Integration: `eval/results/lexical/baseline-v1.json` records 42 scenarios, 0.595238 recall@10, zero calls, and zero cost. `eval/results/provider-preflight-2026-08-26.json` records the missing credentials, workspace, and per-run spend ceiling that prevent provider execution.
- Provider decision: OpenRouter is accepted only as a pinned, no-fallback public-source generation-evaluation lane; Frankfurt Model Studio remains required for private source and the accepted embedding/reranking matrix.

## Handoff

- Provider credentials, exact model/endpoint values, and a spend ceiling are configured and provider-backed generation is enabled behind strict validation and deterministic fallback. The remaining work is the measured public-source DeepSeek/Qwen comparison and publication of quality, citation, refusal, latency, token, and cost results.

## Deferred / not completed

- Do not implement the optional OpenRouter adapter in the current build tranche. Reconsider it only after the provider-independent review pipeline works and the paid evaluation is resumed; the bounded decision is preserved for that later comparison.

## Related knowledge

- [Evaluation Baseline Contract](../../../docs/knowledge/evaluation-contract.md)
- [Hosting and Model Strategy](../../../docs/knowledge/decisions/002-hosting-and-model-strategy.md)
- [OpenRouter Evaluation Boundary](../../../docs/knowledge/decisions/005-openrouter-evaluation-boundary.md)
