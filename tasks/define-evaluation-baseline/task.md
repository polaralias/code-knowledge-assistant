---
type: Task
task: define-evaluation-baseline
title: Define the evaluation baseline
description: Build deterministic fixtures, pin the accepted real-world intakes, and
  implement the scenario, scoring, and result contracts needed to compare capability,
  retrieval, and model candidates.
status: in-progress
created: '2026-08-25T20:30:42Z'
timestamp: '2026-08-28T05:50:34Z'
owner: James Whelan
depends_on:
- resolve-product-and-stack-decisions/task
time:
- id: 20260825t223950z-codex-tracked
  status: closed
  actor: codex
  started: '2026-08-25T22:39:50Z'
  method: tracked
  activity: implementation
  summary: Implemented and validated original Python and TypeScript fixtures, line-sensitive
    answer keys, and a dependency-free fixture validator with nine passing tests.
  basis: Active effort equals the 12-minute explicit start/stop interval.
  workstream: create-deterministic-fixtures
  finished: '2026-08-25T22:51:31Z'
  elapsed_minutes: 12
  effort_minutes: 12
- id: 20260826t070917z-codex-tracked
  status: closed
  actor: codex
  started: '2026-08-26T07:09:17Z'
  method: tracked
  activity: implementation
  summary: Qualified immutable intakes, authored and validated 18 evidence-mapped
    scenarios, and promoted the evaluation contract.
  basis: Active effort equals the 14-minute explicit start/stop interval.
  workstream: qualify-real-world-intakes
  finished: '2026-08-26T07:23:25Z'
  elapsed_minutes: 14
  effort_minutes: 14
- id: 20260826t075528z-codex-tracked
  status: closed
  actor: codex
  started: '2026-08-26T07:55:28Z'
  method: tracked
  activity: implementation
  summary: Implemented the exact scenario corpus, corpus-bound deterministic scorer,
    result validator/schema, hard security gates, and tests.
  basis: Active effort equals the 17-minute explicit start/stop interval.
  workstream: implement-scenario-scoring
  finished: '2026-08-26T08:12:07Z'
  elapsed_minutes: 17
  effort_minutes: 17
- id: 20260826t081207z-codex-tracked
  status: closed
  actor: codex
  started: '2026-08-26T08:12:07Z'
  method: tracked
  activity: knowledge-maintenance
  summary: Updated and validated canonical evaluation knowledge, task acceptance,
    generated indexes, and final evidence.
  basis: Active effort equals the 2-minute explicit start/stop interval.
  workstream: implement-scenario-scoring
  finished: '2026-08-26T08:14:31Z'
  elapsed_minutes: 2
  effort_minutes: 2
- id: 20260826t090134z-codex-tracked
  status: closed
  actor: codex
  started: '2026-08-26T09:01:34Z'
  method: tracked-adjusted
  activity: implementation
  summary: Implemented and ran the dependency-free BM25 lexical baseline across the
    checked corpus.
  basis: 'Wall-clock session was 7 minutes. Active effort was adjusted to 4 minutes:
    Implemented and ran the dependency-free BM25 lexical baseline across the checked
    corpus.'
  workstream: run-first-baseline
  finished: '2026-08-26T09:08:28Z'
  elapsed_minutes: 7
  effort_minutes: 4
- id: 20260826t090828z-codex-manual
  status: closed
  actor: codex
  started: '2026-08-26T09:08:28Z'
  finished: '2026-08-26T09:08:28Z'
  elapsed_minutes: 0
  effort_minutes: 1
  method: manual
  activity: research
  summary: Verified current DeepSeek and Qwen model, pricing, retrieval, and Frankfurt
    endpoint documentation from official sources.
  basis: Verified current DeepSeek and Qwen model, pricing, retrieval, and Frankfurt
    endpoint documentation from official sources.
  workstream: run-first-baseline
- id: 20260826t090829z-codex-manual
  status: closed
  actor: codex
  started: '2026-08-26T09:08:29Z'
  finished: '2026-08-26T09:08:29Z'
  elapsed_minutes: 0
  effort_minutes: 1
  method: manual
  activity: knowledge-maintenance
  summary: Promoted measured baseline results and provider preflight boundaries into
    canonical evaluation knowledge.
  basis: Promoted measured baseline results and provider preflight boundaries into
    canonical evaluation knowledge.
  workstream: run-first-baseline
- id: 20260826t090830z-codex-manual
  status: closed
  actor: codex
  started: '2026-08-26T09:08:30Z'
  finished: '2026-08-26T09:08:30Z'
  elapsed_minutes: 0
  effort_minutes: 1
  method: manual
  activity: validation
  summary: Ran evaluation suites, source validators, strict task validation, and OKF
    conformance checks.
  basis: Ran evaluation suites, source validators, strict task validation, and OKF
    conformance checks.
  workstream: run-first-baseline
- id: 20260826t114426z-codex-tracked
  status: closed
  actor: codex
  started: '2026-08-26T11:44:26Z'
  method: tracked
  activity: research
  summary: Evaluated OpenRouter routing, privacy, residency, retrieval coverage, reproducibility,
    and cost controls; captured the bounded public-source decision.
  basis: Active effort equals the 1-minute explicit start/stop interval.
  workstream: run-first-baseline
  finished: '2026-08-26T11:45:38Z'
  elapsed_minutes: 1
  effort_minutes: 1
- id: 20260827t223836z-luna-provider-tracked
  status: closed
  actor: luna-provider
  started: '2026-08-27T22:38:36Z'
  method: tracked-adjusted
  activity: implementation
  summary: Provider package implementation is present and validated; close the stale
    running entry after the agent session ended at the usage limit.
  basis: 'Wall-clock session was 253 minutes. Active effort was adjusted to 53 minutes:
    Provider package implementation is present and validated; close the stale running
    entry after the agent session ended at the usage limit.'
  workstream: implement-provider-evaluation-adapter
  finished: '2026-08-28T02:52:00Z'
  elapsed_minutes: 253
  effort_minutes: 53
started: '2026-08-25T22:39:50Z'
effort_minutes: 106
---

# Define the evaluation baseline

## Outcome

The repository contains a versioned evaluation suite combining small ground-truth fixtures with pinned Poetry, Uptime Kuma, and PocketBase intakes, representative questions, scoring, cost and latency capture, and initial thresholds that distinguish extraction, retrieval, and model candidates before implementation choices are finalised.

## Scope

- In scope: purpose-built fixture design, real-world intake pinning, capability-tier coverage, ground-truth questions and evidence, retrieval metrics, answer and citation scoring, refusal and adversarial cases, structured-output checks, latency, token, and cost reporting.
- Out of scope: claiming general model superiority, large public benchmarks, fine-tuning, and production traffic simulation.

## Acceptance

- [x] Build small deterministic fixtures for exact extraction and relationship ground truth.
- [x] Verify licences and create fetch manifests for the pinned Poetry, Uptime Kuma, and PocketBase revisions without vendoring their source.
- [x] Define factual, cross-file, architectural, ambiguous, unsupported, and prompt-injection scenarios.
- [x] Record expected source files, symbols, or line evidence for objectively scorable questions.
- [x] Implement or specify repeatable retrieval, citation, faithfulness, refusal, latency, and cost measurements.
- [x] Define baseline thresholds and a result format that preserves model and prompt versions.
- [x] Document limitations and human-judgement surfaces.
- [ ] Compare review usefulness and failure disclosure across enhanced, structured, and fallback tiers.

## Dependencies and risks

- Depends on the accepted product profile and demonstration policy; both are now recorded.
- Evaluation design must precede model and retrieval selection to reduce confirmation bias.

## Related knowledge

- [Feature Contracts](../../docs/knowledge/feature-contracts.md)
- [Evaluation Baseline Contract](../../docs/knowledge/evaluation-contract.md)
- [Demonstration and Evaluation Policy](../../docs/knowledge/decisions/004-demonstration-and-evaluation-policy.md)

## Workstreams

- Create deterministic fixtures and their complete evidence answer keys.
- Pin and qualify the real-world repository intake manifests.
- Implement the scenario corpus, scorers, thresholds, and result schema.
- Run the first baseline matrix and publish the evidence-backed comparison.

## Evidence

- DDD contract established in `docs/knowledge/evaluation-contract.md`.
- Repository candidates measured through the GitHub API on 2026-08-25.
- Python and TypeScript fixture repositories, answer keys, and validator implemented under `eval/`; nine validator tests and the public validation command pass.
- Immutable manifests and ignored-cache verification implemented for Poetry, Uptime Kuma, and PocketBase, including exact commit, tree, licence blob, and deterministic inventory checks.
- Eighteen real-world questions are mapped to validated source ranges; enhanced intakes include cross-file paths and PocketBase includes a deployment-specific hooks limitation case.
- The checked corpus now contains exactly 42 uniquely tagged scenarios and 61 verified citations, including four unsupported or ambiguous cases and four adversarial repository-content cases.
- A dependency-free evaluation package validates corpus-bound result documents, calculates deterministic raw metrics and provisional gates, preserves exact pipeline/model versions and cost measurements, isolates bounded human review, and makes security violations hard failures.
- The provider-neutral OpenAI-compatible evaluation adapter is implemented and package-tested, including a Model Studio-compatible `json_object` request path with exact prompt/schema recording and local schema validation; the first paid DeepSeek/Qwen, embedding, and reranking comparison is blocked until the approved provider workspace/key and spend ceiling are supplied.
