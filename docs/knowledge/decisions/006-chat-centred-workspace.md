---
type: Decision
title: Centre the review workspace on evidence conversation
description: Defines the three-pane chat-centred workspace and records the current lexical retrieval boundary without implying semantic RAG or graph completeness.
timestamp: 2026-08-28T02:36:00Z
authority: canonical
decision_status: accepted
navigation:
  role: supporting
  order: 90
---

# Centre the review workspace on evidence conversation

## Decision

- Make repository conversation the primary workspace rather than presenting each analysis function as a separate product surface.
- Use three persistent regions: a left findings rail, a central review and chat area, and a right progress and source context rail.
- Use top-level `Review`, `Findings`, and `Map` tabs. The map is an explicitly labelled stub until extracted relationships demonstrate material value and evidence support.
- Preserve the current API and browser seams while changing composition, typography, spacing, and visual hierarchy.
- Keep the visual system dependency-free for this redesign, with one cobalt accent, shared light/dark tokens, restrained transitions, and accessible state handling.

## Retrieval boundary

The product already has a real bounded retrieval path. `packages/retrieval` builds an immutable lexical evidence index over primary and derived records, ranks query-term matches deterministically, and enforces result and context limits. `packages/answering` consumes that index and returns cited evidence or explicit insufficiency. The API maps those results into the browser review contract.

This is retrieval-augmented answering in the broad sense, but not semantic vector RAG. Embeddings, reranking, provider-backed synthesis, durable conversation history, and answer-time claim verification remain deferred until the evaluation contract proves they improve grounded usefulness without weakening privacy, cost, or citation guarantees.

## Consequences

- The UI can truthfully show evidence-backed answers and retrieval limits today.
- The UI must not show a fake graph, semantic-search badge, or model status that the backend cannot substantiate.
- Future semantic retrieval can replace or augment the lexical index behind the same question and citation contract.

## Related knowledge

- [Review output contract](../review-output-contract.md)
- [Evaluation contract](../evaluation-contract.md)
- [Redesign code review workspace](../../tasks/build-product-experience/workstreams/redesign-code-review-workspace.md)
