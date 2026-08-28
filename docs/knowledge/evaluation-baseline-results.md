---
type: Evaluation Results
title: First Evaluation Baseline Results
description: Records the zero-cost lexical retrieval baseline and the first bounded Frankfurt provider safety results.
timestamp: 2026-08-28T00:00:00Z
authority: canonical
verification: verified-limited
verified_at: 2026-08-28T00:00:00Z
verified_against:
  - node eval/scripts/run-lexical-baseline.mjs
  - node --test packages/evaluation/tests/*.test.mjs
  - node eval/scripts/validate-scenarios.mjs
  - eval/results/lexical/baseline-v1.json
  - eval/results/provider-preflight-2026-08-26.json
  - Alibaba Model Studio Frankfurt workspace live safety run, 2026-08-28
navigation:
  role: supporting
  order: 49
---

# First evaluation baseline results

## Current conclusion

The dependency-free lexical control achieves **0.595238 retrieval recall@10** across all 42 checked scenarios and does not meet the provisional **0.85** retrieval gate. It made no provider calls, cost nothing, and did not execute repository content. This is a control result, not a product retrieval selection.

The embedding and reranking comparisons remain intentionally unrun. A Frankfurt Model Studio workspace is now configured locally and the first bounded generation safety lane has completed; the full generation matrix and normal-fixture quality comparison remain open.

## Retrieval result

| Source | Scenarios | Recall@10 |
| --- | ---: | ---: |
| Python fixture | 8 | 0.75 |
| TypeScript fixture | 8 | 0.75 |
| Poetry | 6 | 0.083333 |
| Uptime Kuma | 6 | 0.25 |
| PocketBase | 6 | 0.50 |
| Security-content fixture | 8 | 1.00 |
| **All sources** | **42** | **0.595238** |

The gap between small fixtures and large repositories supports the planned semantic-retrieval comparison. The perfect security-fixture retrieval result only shows that relevant evidence is easy to retrieve from a two-file corpus; it is not an injection-resistance result because the lexical runner performs no generation and executes no source content.

The raw result is [`eval/results/lexical/baseline-v1.json`](../../eval/results/lexical/baseline-v1.json). It records BM25 version 1.0, top-k 10, 40-line chunks with 10-line overlap, a 512 KiB file ceiling, indexed file/chunk counts, per-source indexing latency, per-scenario retrieval latency, ranked evidence ranges, zero provider calls, and zero cost.

## Provider preflight

Official provider documentation checked on 2026-08-26 establishes the following current candidates and constraints:

- DeepSeek's direct API documents `deepseek-v4-flash` and `deepseek-v4-pro`; the previous `deepseek-chat` and `deepseek-reasoner` aliases are deprecated.
- Alibaba Cloud Model Studio documents Frankfurt as `eu-central-1` with a workspace-specific OpenAI-compatible endpoint.
- The current Qwen comparison should resolve authenticated Frankfurt availability before freezing exact snapshots; official documentation currently identifies `qwen3.7-plus` and `qwen3.6-flash` as current Plus and Flash families.
- `text-embedding-v4` supports 1,024 dimensions and `qwen3-rerank` is the documented plain-text reranker.

Public documentation is not a substitute for an authenticated workspace model listing. The machine-readable preflight therefore keeps region availability false until credentials and a workspace exist: [`eval/results/provider-preflight-2026-08-26.json`](../../eval/results/provider-preflight-2026-08-26.json).

## First Frankfurt provider safety run

On 2026-08-28, the local runner made eight calls per model against the inert `security-content` fixture using the workspace-specific Frankfurt endpoint. The per-call ceiling was USD 0.02, the persistent evaluation ledger ceiling was GBP 1, and the exchange-rate policy input was 0.7363 GBP/USD. The API key was process-local and was not written to results or logs.

| Model | Scenarios | Behaviour matches | Security signals | Measured cost | Total latency |
| --- | ---: | ---: | ---: | ---: | ---: |
| `deepseek-v4-flash-0731` | 8 | 8/8 | 0 | USD 0.005115 | 158.5 s |
| `qwen3.6-flash` | 8 | 4/8 | 0 | USD 0.025285 | 204.2 s |

Both models returned schema-valid structured output and preserved all four adversarial security invariants. DeepSeek also qualified all four unsupported questions as required. Qwen refused those four questions instead of qualifying them, so it is currently safer but less compliant with the boundary contract. These are safety-lane observations, not a final generation-role selection. The normal Python-fixture run needs a bounded result-capture path before its quality metrics can be recorded.

## Next controlled run

Before the next provider call:

1. run the normal Python and TypeScript fixture generation comparison with bounded in-process result capture;
2. set a separate maximum GBP spend for the complete comparison and retain per-model result artefacts without prompts or credentials;
3. resolve and record the exact available model snapshots and prices in that workspace;
4. estimate the matrix cost from the checked corpus and abort if it exceeds the run ceiling;
5. run `text-embedding-v4` at 1,024 dimensions against the same chunks, then apply `qwen3-rerank` to the same candidate sets;
6. only then run the accepted public-source generation comparison, stopping immediately on a security-invariant failure.

The public-source generation comparison may use the bounded OpenRouter lane defined in [Use OpenRouter Only for Bounded Public-Source Evaluation](./decisions/005-openrouter-evaluation-boundary.md). That lane must use exact model and provider pins with fallbacks disabled; it does not change the direct Frankfurt route for private source, embeddings, or reranking.

No model, reranker, or public demo repository is selected by the lexical result alone. Uptime Kuma remains a candidate pending measured generation usefulness.

## Related knowledge

- [Evaluation baseline contract](./evaluation-contract.md)
- [Demonstration and evaluation policy](./decisions/004-demonstration-and-evaluation-policy.md)
- [Run-first-baseline workstream](../../tasks/define-evaluation-baseline/workstreams/run-first-baseline.md)
