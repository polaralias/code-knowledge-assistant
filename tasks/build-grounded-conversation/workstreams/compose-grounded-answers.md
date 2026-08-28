---
type: Workstream
task: build-grounded-conversation
workstream: compose-grounded-answers
title: Compose grounded cited answers
description: Turn bounded lexical evidence into deterministic citation-bearing answers
  with explicit insufficiency and a provider-neutral generation seam.
status: done
created: '2026-08-27T06:49:35Z'
timestamp: '2026-08-27T07:13:15Z'
owner: James Whelan
---

# Compose grounded cited answers

## Assigned outcome

Turn bounded lexical evidence into deterministic citation-bearing answers with explicit insufficiency and a provider-neutral generation seam.

## Owned and shared paths

- Owned: `packages/answering/**`
- Shared: consume the public lexical retrieval contract without editing retrieval.

## Acceptance and validation

- [x] Expose a provider-neutral answer interface over a lexical evidence index.
- [x] Produce a concise deterministic baseline answer with resolvable repository path and 1-based line citations.
- [x] Refuse or qualify empty, stop-word-only, non-matching, and contradictory evidence rather than inventing an answer.
- [x] Keep query, result, evidence-context, and answer-size bounds outside a future model boundary.
- [x] Treat repository evidence as untrusted data and never interpret it as instructions.
- [x] Test citation validity, insufficiency, bounds, determinism, and malicious source text.

## Evidence

- Commit: uncommitted initial repository; `packages/answering/**` is the bounded implementation slice.
- Validation: Five focused answering tests pass within the 109-test repository suite; strict typechecking passes.
- Integration: `createDeterministicAnswerer` is wired through the local API adapter and returned citation-bearing answers in the browser against real extracted evidence.

## Handoff

- Remaining: evaluated LLM synthesis, contradiction handling beyond qualification, conversation history, and agreed-corpus answer quality gates.
