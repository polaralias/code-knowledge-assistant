---
type: Decision
title: Select an Evidence-Backed Code Documentation Assistant
description: Records why the product uses repository review documents as a grounded navigation layer over canonical source evidence.
timestamp: 2026-08-25T20:56:52Z
authority: canonical
decision_status: accepted
navigation:
  role: foundational
  order: 60
---

# Select an evidence-backed code documentation assistant

## Decision

Build a code knowledge assistant. The system first reviews a repository and produces structured derived documentation, then provides conversational exploration over that documentation and the underlying source evidence.

Chat-with-documents is an internal retrieval pattern within the product rather than its public identity.

## Rationale

- It demonstrates more than conventional source-chunk retrieval.
- Derived documentation gives users a coherent map of repository-wide concepts and flows.
- Returning to primary evidence preserves trust and makes citations inspectable.
- The approach creates a strong product journey while remaining compatible with a bounded MVP.
- It exposes meaningful engineering decisions around provenance, hierarchical retrieval, evaluation, and prompt-injection boundaries.

## Consequences

- The application must maintain separate primary-evidence and derived-knowledge representations.
- Generated documentation must preserve provenance and uncertainty.
- Chat cannot treat generated documents as unquestioned truth.
- Review quality becomes an evaluation surface because errors can affect many later answers.
- Scope discipline is essential; the product is not an autonomous coding agent.

## Related knowledge

- [Product contract](../product-contract.md)
- [Architecture concept](../architecture-concept.md)
- [Initial feature contracts](../feature-contracts.md)
