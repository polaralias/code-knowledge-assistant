---
type: Decision
title: Adopt Tiered Analysis, Zip Intake, and Derived OKF Reviews
description: Records the language capability tiers, public Git and zip inputs, Tree-sitter boundary, OKF review format, and 48-hour retention policy.
timestamp: 2026-08-25T22:16:19Z
authority: canonical
decision_status: accepted
navigation:
  role: foundational
  order: 80
---

# Adopt tiered analysis, zip intake, and derived OKF reviews

## Decision

- Accept public Git URLs and bounded zip uploads.
- Provide enhanced adapters first for Python and TypeScript/JavaScript.
- Use Tree-sitter for deterministic syntax structure where supported and Universal Ctags as a candidate broad symbol extractor.
- Provide structured analysis for languages with a parser but no bespoke adapter.
- Provide a clearly labelled general-overview fallback for other text source.
- Generate an isolated, derived OKF 0.1-compatible review bundle with primary evidence stored separately.
- Delete raw archives after extraction and expire non-demo workspace data 48 hours after review completion.

## Rationale

The product must be useful on repositories beyond a narrow implementation-language demo without pretending that every language receives equivalent analysis. Python reflects the most relevant existing repository profile, while TypeScript/JavaScript covers the application stack and common web repositories. Tiering makes broader input support possible while keeping output claims and implementation complexity bounded.

Tree-sitter improves deterministic boundaries, chunks, and citations without requiring a complete call graph. Universal Ctags can broaden symbol coverage without a bespoke analyzer for every language. The LLM remains valuable for synthesis but cannot convert unknown syntax into verified structure.

OKF-compatible generated concepts make the review navigable and machine-checkable while preserving RKE's critical distinction between primary evidence and derived knowledge.

## Real-world evaluation intake candidates

The accepted intake set is maintained in the [evaluation baseline contract](../evaluation-contract.md). It uses Poetry for Python, Uptime Kuma for JavaScript, and PocketBase for Go. The earlier ComfyUI and Seal candidates were rejected because their domains were less suitable for the intended public positioning. A small purpose-built fixture remains necessary for exact ground truth; real repositories test usefulness, scale, and non-standard inputs.

## Consequences

- Every review must expose its achieved capability tier and coverage.
- A relationship graph is an optional evidence-supported view, not a universal completeness claim.
- Archive security and deletion verification become first-class acceptance surfaces.
- Evaluation must compare enhanced and non-enhanced paths.
- Generated reviews cannot be written into or represented as canonical documentation for the submitted repository.

## Related knowledge

- [Language support and intake](../language-support-and-intake.md)
- [Review output contract](../review-output-contract.md)
- [Architecture concept](../architecture-concept.md)
