# Evaluation fixtures

This directory contains original, non-executable repository fixtures, immutable real-world
intake definitions, and machine-readable evaluation expectations for the Code Knowledge
Assistant baseline.

## Validate

```powershell
node --test eval/tests/validate-fixtures.test.mjs
node eval/scripts/validate-fixtures.mjs
node --test eval/tests/verify-intakes.test.mjs
node eval/scripts/verify-intakes.mjs --fetch
node eval/scripts/verify-intakes.mjs
node --test packages/evaluation/tests/*.test.mjs
node eval/scripts/validate-scenarios.mjs
node eval/scripts/evaluate-result.mjs <result.json>
node eval/scripts/run-lexical-baseline.mjs
```

The public validator checks:

- manifest metadata and fixture-root containment;
- complete eligible/excluded inventory classification;
- SHA-256 and line-count integrity records;
- symbol source ranges and names;
- relationship endpoints;
- question evidence paths, ranges, and anchor text.

The intake verifier fetches each exact upstream commit into the ignored `eval/cache/temp/intakes/`
directory, then checks its commit, root tree, licence blob, deterministic inventory, and
six-question scenario set. A later verification run does not require network access.

## Fixture contract

- `fixtures/python-service/` models a small taskboard service with configuration, protocols,
  in-memory persistence, endpoint validation, tests, generated content, and a dynamically
  loaded notifier whose concrete implementation cannot be proven statically.
- `fixtures/typescript-service/` models a webhook router with runtime and type-only imports,
  interfaces, re-exports, validation, persistence-before-dispatch, tests, and generated content.
- `ground-truth/*.json` defines the bounded expectation scope, inventory, integrity records,
  symbols, imports, selected relationships, questions, expected behaviour, and exact evidence.

Fixture code is evidence only. The product and validation command read it as text and never
execute it. When a fixture changes, update its line-sensitive answer key and integrity records
in the same change.

## Real-world intake contract

- `intakes/*.json` pins the source URL, commit, root tree, licence blob, capability tier,
  observed inventory, scenario file, and replacement rule for Poetry, Uptime Kuma, and
  PocketBase.
- `scenarios/real-world/*.json` is a sparse golden evaluation layer: six questions with concise
  expected behaviour and exact source evidence. It is not a predefined repository review or a
  demo response.
- The assistant must generate its review and answers from the submitted repository. Evaluations
  compare those generated results with the evidence and rubric represented by the scenarios.
- Poetry and Uptime Kuma exercise enhanced Python and JavaScript analysis, including cross-file
  reasoning. PocketBase exercises the structured/general-overview path and requires the model to
  qualify what cannot be known about deployment-specific `pb_hooks` content.
- Cached upstream source is deliberately ignored, isolated under a temporary graph-excluded
  directory, and must not be committed. Replace a pinned
  intake only under its manifest rule, with new provenance and a recorded decision.

## Scenario and result contract

- The normalised corpus contains exactly 42 cases: 16 deterministic fixture questions, 18
  real-world questions, four unsupported or ambiguous questions, and four adversarial cases.
- `schema/evaluation-result.schema.json` preserves source, evaluator, extractor, chunking, prompt,
  output schema, provider region, exact generation model, retrieval, embedding, and reranking
  versions alongside raw scenario measurements.
- `packages/evaluation/` calculates deterministic inventory, extraction, provenance, retrieval,
  citation, faithfulness, behaviour, refusal, injection-resistance, capability-disclosure,
  latency, token, retry, and cost results. Bounded human usefulness review is reported separately.
- Security invariants are hard failures and cannot be concealed by an aggregate score.
- `results/lexical/baseline-v1.json` is the retrieval-only, zero-provider-cost control. It must
  not be represented as a generated-answer result.

## Related knowledge

- [Evaluation baseline contract](../docs/knowledge/evaluation-contract.md)
- [Evaluation baseline task](../tasks/define-evaluation-baseline/task.md)
