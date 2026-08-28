---
type: Feature Contract
title: Initial Feature Contracts
description: Decomposes the product outcome into bounded user-visible capabilities and their high-level acceptance surfaces.
timestamp: 2026-08-26T18:44:00Z
authority: canonical
navigation:
  role: foundational
  order: 30
---

# Initial feature contracts

These contracts are intentionally high-level. Each implementation task must refine its scenarios and test targets before moving from proposed to ready.

## Repository intake

**Outcome:** A user can select an allowed repository input and receive a stable review workspace without the application executing repository content.

**Acceptance surface:**

- Reject unsupported, oversized, malformed, or unsafe archives clearly.
- Accept a public Git URL or a zip upload without requiring source execution or a GitHub account.
- Prevent path traversal, archive bombs, and secret leakage into logs.
- Reject archive path traversal, symlinks, excessive nesting, decompression bombs, and bounded file-count or byte-limit violations before review.
- Exclude binaries, dependencies, generated output, and configured sensitive files.
- Display deterministic file coverage and exclusion results.
- Delete the raw archive after extraction and expire non-demo workspace data after 48 hours.
- Retain an immutable, policy-filtered source snapshot for that review lifetime so follow-up questions and bounded extraction reruns can return to eligible primary evidence without retaining excluded sensitive bodies.

## Evidence extraction and review

**Outcome:** The application turns supported repository content into structured evidence and a navigable derived documentation set.

**Acceptance surface:**

- Preserve file, symbol, and line provenance.
- Assign and display the enhanced, structured, or fallback capability tier actually achieved.
- Separate deterministic extraction from LLM-derived interpretation.
- Generate the agreed OKF-compatible concept families using schema-validated output.
- Label uncertainty and incomplete coverage.
- Never claim execution or runtime behaviour from static evidence alone.

## Grounded conversation

**Outcome:** A user can ask repository questions and receive concise answers supported by the best available source evidence.

**Acceptance surface:**

- Retrieve across both derived knowledge and primary source indexes.
- Follow derived claims back to source evidence.
- Reopen retained source evidence when generated documentation is insufficient to answer or clarify a question.
- Expose citations and the retrieved evidence behind an answer.
- Refuse or qualify unsupported answers.
- Keep repository instructions separate from trusted application instructions.

## Evaluation and observability

**Outcome:** Model, embedding, retrieval, and prompt choices are selected from recorded evidence rather than preference alone.

**Acceptance surface:**

- Evaluate representative factual, cross-file, ambiguous, unsupported, and adversarial questions.
- Measure retrieval recall, citation precision, answer faithfulness, refusal quality, latency, and cost.
- Record pipeline-stage timings, token use, model identifiers, and failure classes without logging source secrets.
- Make evaluation repeatable against a versioned public repository fixture.
- Include small deterministic fixtures and pinned real-world repository intakes so objective scoring and realistic demonstrations do different jobs.

## Product experience and delivery

**Outcome:** A reviewer can understand the product quickly, complete the main journey, and inspect its engineering decisions.

**Acceptance surface:**

- Provide a polished but restrained repository, review, documentation, and chat experience.
- Offer a pre-indexed demo path requiring no reviewer setup.
- Support local container startup from documented configuration.
- Provide a hosted reference deployment with cost and abuse controls.
- Include clear setup, architecture, engineering rationale, screenshots, and public demonstration evidence.

## Related knowledge

- [Product contract](./product-contract.md)
- [Architecture concept](./architecture-concept.md)
- [Decision queue](./decision-queue.md)
- [Delivery tasks](../../tasks/index.md)
