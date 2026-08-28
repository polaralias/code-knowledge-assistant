---
type: Workstream
task: define-evaluation-baseline
workstream: implement-provider-evaluation-adapter
title: Implement bounded provider evaluation adapter
description: Expose a provider-neutral OpenAI-compatible evaluation client with exact
  model identity, deterministic budgets, bounded HTTP behaviour, and no secret leakage.
status: done
created: '2026-08-27T22:38:34Z'
timestamp: '2026-08-28T05:50:34Z'
owner: luna-provider
---

# Implement bounded provider evaluation adapter

## Assigned outcome

Expose a provider-neutral OpenAI-compatible evaluation client with exact model identity, deterministic budgets, bounded HTTP behaviour, and no secret leakage.

## Owned and shared paths

- Owned: `packages/model-provider/**`.
- Shared: root integration will connect the package to evaluation and application boundaries after package validation.

## Acceptance and validation

- [x] Define a provider-neutral structured-generation interface carrying exact provider, model, prompt, schema, token, latency, and cost metadata.
- [x] Implement a bounded OpenAI-compatible HTTP adapter with HTTPS endpoint validation, no redirects, timeout/abort, response-size limits, and stable body-free failures.
- [x] Keep API keys server-side and out of errors, request URLs, result artifacts, and diagnostics.
- [x] Enforce input/output token and monetary ceilings before accepting a result; reject missing or non-finite usage/cost data when budget enforcement requires it.
- [x] Require exact model identity and validate structured JSON output as untrusted data.
- [x] Test all behaviour through injected fetch/clock seams without making provider calls.

## Evidence

- Commit:
- Validation: provider and evaluation suites pass 29 adapter/runner tests with injected transport and clock; the CLI dry-run makes no provider call.
- Integration: `eval/scripts/run-provider-evaluation.mjs` loads checked expectations, defaults to dry-run, and requires explicit `--live` plus bounded `EVAL_*` configuration for network use.
- Compatibility: the adapter requests OpenAI-compatible `json_object` output, includes the exact local JSON Schema in the recorded prompt, and still treats provider output as untrusted by validating it locally. This matches the current Alibaba Cloud Model Studio chat contract without weakening the schema gate.
- Cost enforcement: providers that omit a monetary response field can use explicit per-million input/output token rates; measured cost is calculated from reported usage before the existing per-call and persistent GBP budget gates accept the result.

## Handoff

- Record remaining risks, integration instructions, and knowledge-promotion needs.
