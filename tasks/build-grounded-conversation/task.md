---
type: Task
task: build-grounded-conversation
title: Build grounded repository conversation
description: Answer repository questions through hierarchical retrieval with source
  verification, citations, qualification, and refusal behaviour.
status: in-progress
created: '2026-08-25T20:30:44Z'
timestamp: '2026-08-28T16:05:00Z'
owner: James Whelan
depends_on:
- build-repository-review-pipeline/task
time:
- id: 20260826t205200z-terra-retrieval
  status: closed
  actor: terra-retrieval
  started: '2026-08-26T20:50:47Z'
  method: tracked
  activity: implementation
  summary: Implemented and package-tested deterministic lexical evidence indexing
    and provenance-preserving bounded queries.
  basis: Active effort equals the 7-minute explicit start/stop interval.
  workstream: implement-lexical-retrieval
  finished: '2026-08-26T20:57:51Z'
  elapsed_minutes: 7
  effort_minutes: 7
- id: 20260827t065100z-terra-answering
  status: closed
  actor: terra-answering
  started: '2026-08-27T06:50:44Z'
  method: tracked
  activity: implementation
  summary: Implemented and integrated bounded deterministic cited answering with insufficiency
    and malicious-evidence coverage.
  basis: Active effort equals the 22-minute explicit start/stop interval.
  workstream: compose-grounded-answers
  finished: '2026-08-27T07:12:40Z'
  elapsed_minutes: 22
  effort_minutes: 22
started: '2026-08-26T20:50:47Z'
effort_minutes: 29
---

# Build grounded repository conversation

## Outcome

A user can ask questions about a reviewed repository and receive concise, useful answers that retrieve across derived documentation and primary evidence, expose source citations, and qualify or refuse unsupported claims.

## Scope

- In scope: query classification where justified, hybrid retrieval, provenance expansion, optional evaluated reranking, context assembly, cited generation, conversation bounds, refusal, prompt-injection resistance, and evidence inspection.
- Out of scope: autonomous tool execution, source modification, unrestricted agent loops, and answers unsupported by the indexed repository.

## Acceptance

- [ ] Retrieve relevant derived and primary evidence for the agreed question set.
- [ ] Verify material derived claims against source evidence before answering.
- [x] Return resolvable citations and expose retrieved evidence.
- [x] Qualify or refuse when evidence is insufficient or contradictory.
- [x] Keep repository content unable to grant instructions or authority.
- [ ] Meet the agreed correctness, citation, refusal, latency, and cost thresholds.

## Dependencies and risks

- Depends on stable review artefacts, source provenance, and the evaluation baseline.
- Conversation history must be bounded so cost and stale context do not grow silently.

## Related knowledge

- [Feature Contracts](../../docs/knowledge/feature-contracts.md)

## Workstreams

- [Implement lexical retrieval](./workstreams/implement-lexical-retrieval.md) across primary and derived evidence with deterministic bounds and provenance.
- [Compose grounded cited answers](./workstreams/compose-grounded-answers.md) with bounded deterministic qualification and explicit insufficiency.

## Evidence

- The provider-independent lexical index searches immutable primary and derived evidence records, returns deterministic ranked results with citation provenance and bounded context, and explicitly reports insufficient evidence.
- The deterministic answerer enforces query, retrieval, context, and answer bounds; qualifies multiple potentially contradictory records; and treats malicious repository text only as quoted evidence.
- The local API and browser workspace returned and opened real citations from the checked TypeScript repository fixture.
- Six focused retrieval tests plus the integrated local-review test cover ranking, mixed layers, ties, invalid input, immutable snapshots, query bounds, insufficient evidence, and source citation recovery.
- `pnpm test` passes 233 tests, including restart reconstruction and cited follow-up questions through the real local service.
- The product workspace now presents this bounded retrieval path through a chat-centred Review tab with cited answers, while the Findings tab exposes the underlying generated documents and source inspection boundary.
- Provider-backed answer synthesis is implemented and deployed: live questions combine lexical hits with review concepts and bounded primary excerpts before cited composition. Answer-time derived-claim verification, bounded conversation history, semantic retrieval/reranking, and the agreed-corpus quality gate remain open; the zero-cost lexical control is 0.595238 recall@10 against a provisional 0.85 gate.
