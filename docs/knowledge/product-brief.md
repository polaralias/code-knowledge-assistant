---
type: Product Brief
title: Code Knowledge Assistant Product Brief
description: Summarises the user problem, product proposition, engineering goals, and public demonstration expectations.
timestamp: 2026-08-25T21:18:09Z
authority: canonical
navigation:
  role: foundational
  order: 10
---

# Code Knowledge Assistant product brief

Code Knowledge Assistant helps developers understand an unfamiliar repository by producing an evidence-backed documentation layer and supporting conversational exploration over that layer and the underlying source.

## User problem

Repository knowledge is commonly fragmented across source files, tests, configuration, existing documentation, and the experience of current maintainers. Direct retrieval over isolated code chunks can answer local questions while missing the repository-wide structure a developer needs to build a trustworthy mental model.

## Product proposition

The product combines deterministic repository analysis, evidence-backed documentation generation, and hierarchical retrieval:

- inspect supported repository content without executing it;
- accept a public Git repository URL or a bounded zip upload for local and private source;
- extract source evidence with stable provenance;
- generate navigable OKF-compatible system, component, flow, API, and integration knowledge;
- answer repository questions using both derived knowledge and primary evidence;
- expose citations, uncertainty, coverage, and retrieval evidence;
- qualify or refuse claims that the indexed repository cannot support.

## Engineering goals

- Keep primary evidence distinct from generated interpretation.
- Make retrieval and model choices measurable through a versioned evaluation fixture.
- Treat repository content as untrusted data and constrain model authority deterministically.
- Provide clean, testable, observable, containerised implementation boundaries.
- Remain self-hostable while offering a low-friction managed reference deployment.
- Document architectural decisions, limitations, cost controls, and a credible productionisation path.
- Reframe an unfamiliar repository into a concrete, inspectable review rather than hiding uncertainty behind fluent output.

## Public demonstration

The initial public experience should let a visitor explore a pre-indexed repository without configuration, navigate the generated documentation, ask representative questions, and inspect the source evidence behind each material answer. New repository reviews may be constrained separately to protect uploaded code, provider spend, and service capacity.

## Related knowledge

- [Product contract](./product-contract.md)
- [Feature contracts](./feature-contracts.md)
- [Architecture concept](./architecture-concept.md)
- [Delivery tasks](../../tasks/index.md)
