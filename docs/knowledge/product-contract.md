---
type: Product Contract
title: Evidence-Backed Code Knowledge Assistant
description: Defines the product outcome, trust model, MVP boundary, and observable success conditions for the Code Knowledge Assistant.
timestamp: 2026-08-26T18:44:00Z
authority: canonical
navigation:
  role: foundational
  order: 20
---

# Evidence-backed code knowledge assistant

## Product outcome

A user can provide a supported source-code repository, allow the application to create a structured review and documentation pack, and ask conversational questions whose material claims remain traceable to primary source evidence.

The product combines code-repository analysis with document-grounded conversation:

1. inspect repository structure and supported source files;
2. extract deterministic metadata and source evidence;
3. generate an evidence-backed repository review;
4. publish the review as navigable derived documentation;
5. answer questions using both derived knowledge and canonical source evidence.

## Users

- A developer joining an unfamiliar codebase.
- A reviewer trying to locate behaviour, dependencies, APIs, or configuration.
- An engineering lead assessing documentation gaps and uncertain areas.

## MVP scope

- One repository per review workspace.
- A pre-indexed public demonstration repository.
- Public Git URL and safe zip-upload ingestion, including local and private source archives.
- A tiered language capability model: enhanced adapters for Python and TypeScript/JavaScript; broad symbol-assisted analysis where available; and an honest general-overview fallback for other text source.
- Generated OKF-compatible system overview, component catalogue, key-flow documentation, API or integration reference, coverage record, and uncertainty record.
- Conversational answers with file, symbol, and line-range citations.
- Visible review progress, coverage, evidence quality, and uncertainty.
- Containerised local execution and a low-friction hosted demonstration.
- A checked evaluation set for retrieval, answer faithfulness, refusal, latency, and cost.

## Non-goals for the initial product

- Autonomous code modification.
- Executing uploaded repository code.
- Complete call-graph reconstruction for every language.
- Multi-tenant enterprise administration.
- Equal-depth semantic analysis for every programming language.
- Continuous GitHub synchronisation.
- Production-grade identity, billing, or organisation controls.

## Trust invariants

- Source code, configuration, tests, and existing repository documents are primary evidence.
- Generated documentation is derived knowledge and never silently becomes primary evidence.
- Material generated claims retain provenance to resolvable source locations.
- Chat follows derived documentation back to source evidence before presenting important claims.
- Unsupported claims are qualified or refused.
- Repository content is untrusted data and cannot grant tools, execution, network access, credentials, or wider authority.
- Uploaded code is never executed by the review pipeline.
- Capability level and unsupported analysis are visible per review; fallback output must not imply adapter-level certainty.
- Raw zip files are deleted after safe extraction. One immutable, policy-filtered source snapshot retains eligible primary evidence and the exclusion manifest—but not excluded sensitive bodies—for follow-up questions and extraction reruns; non-demo source snapshots, evidence, and derived knowledge expire 48 hours after review completion and can be deleted earlier by the user.

## Observable success

- A reviewer can open the hosted demo and explore a pre-indexed repository without configuration.
- The system produces the agreed documentation set for a supported repository.
- Representative questions return correct answers with useful source citations.
- Unsupported questions result in an honest limitation or refusal.
- The repository contains repeatable setup, tests, evaluation evidence, architecture, decisions, and productionisation notes.
- The implementation remains self-hostable through documented container interfaces.

## Delivery traceability

The behavioural decomposition is in [feature contracts](./feature-contracts.md). Architecture is described separately in the [architecture concept](./architecture-concept.md), and execution state lives in the [OKF task bundle](../../tasks/index.md).
