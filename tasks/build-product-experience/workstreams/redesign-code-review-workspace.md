---
type: Workstream
task: build-product-experience
workstream: redesign-code-review-workspace
title: Redesign the code review workspace
description: Replace the generic review page with a chat-centred three-pane workbench for repository findings, evidence conversation, and progress.
status: done
created: '2026-08-28T02:36:00Z'
timestamp: '2026-08-28T05:50:34Z'
owner: James Whelan
---

# Redesign the code review workspace

## Assigned outcome

Make the primary interaction a calm, easy-to-understand conversation with the reviewed repository. The intake path should hand the user into one coherent workspace where findings, evidence, and progress remain visible without turning every analysis function into a separate tool.

## Design read

Technical product workbench for engineers, with a clean editorial workbench language. Use a cool paper-and-ink palette, one cobalt signal accent, restrained transitions, and a responsive three-pane structure inspired by the supplied simple mockup.

The design dials are `DESIGN_VARIANCE: 7`, `MOTION_INTENSITY: 3`, and `VISUAL_DENSITY: 5`. The existing dependency-free browser stack remains in place; no visual library is introduced for this pass.

## Behaviour contract

- The top navigation exposes `Review`, `Findings`, and `Map` tabs. `Map` is an honest future-facing stub until evidence-supported relationships justify a graph.
- The `Review` tab keeps the chat composer and cited answer central. It also shows a concise repository summary and the current review status.
- The left findings rail lists generated documents, lets the user expand a finding summary, and opens the selected document in the `Findings` tab.
- The right progress rail shows review status, what is being read, reference counts, source coverage, and the current question allowance.
- Existing live and fixture intake, polling, access-code handling, citation inspection, loading, empty, failure, expiry, and abuse states remain reachable through the same DOM/API seams.
- Mobile collapses the rails into ordered sections without hiding the active tab or question composer.
- Light and dark themes use the same semantic tokens and preserve contrast. Motion is limited to state transitions and honours reduced-motion preferences.

## Non-goals

- No graph database or inferred call graph is added in this workstream.
- No provider, retrieval, API, or retention contract changes are required for the visual redesign.
- No embeddings, reranking, or conversation memory are implied by the new chat layout.

## Acceptance and validation

- [x] The supplied mockup maps to a working top tab bar, findings rail, central chat/review area, and progress rail.
- [x] Findings navigation drills into the `Findings` tab and preserves source-evidence inspection.
- [x] The `Map` tab is clearly labelled as a future stub and does not imply unsupported graph completeness.
- [x] Existing browser and API contract tests remain green.
- [x] The redesign is checked at desktop and narrow mobile widths in light and dark themes.
- [x] Copy, contrast, focus order, reduced motion, and failure states pass the frontend pre-flight review.

## Evidence

- The supplied wireframe was mapped to the rendered workspace and inspected at desktop and 390-by-844 mobile dimensions in the local Docker service.
- Light and dark browser emulation both retain readable contrast, visible focus targets, and the same information hierarchy.
- The findings tab, return-to-chat action, and future map boundary were exercised from the browser accessibility tree.
- `pnpm --filter @code-knowledge-assistant/web test`, `pnpm test`, and `pnpm typecheck` pass after the redesign.
- The production Docker image builds and its release-candidate container reports healthy liveness and readiness.

## Handoff

- The visual shell and local Docker verification are complete. Clean hosted-browser upload/Git/deletion verification, stable public screenshots, and Railway deployment evidence remain on the parent product and publication tasks rather than this completed redesign workstream.

## RAG boundary

The current path is a bounded lexical RAG-like loop: source and derived evidence are indexed by `buildLexicalEvidenceIndex`, ranked by query-term overlap, truncated to a context byte limit, and passed to `createDeterministicAnswerer`, which returns citations or explicit insufficiency. It is useful retrieval-augmented answering, but it is not semantic vector RAG. Embeddings, reranking, provider-backed synthesis, durable conversation history, and answer-time claim verification remain future work and should be represented as explicit review states rather than simulated in the UI.

## Related knowledge

- [Review output contract](../../../docs/knowledge/review-output-contract.md)
- [Chat-centred workspace and retrieval boundary](../../../docs/knowledge/decisions/006-chat-centred-workspace.md)
