---
type: Decision
title: Select the Demonstration Suite and Hosted Access Policy
description: Records the real-world repository suite, preferred public demo, initial hosted limits, provider boundary, and evaluation-first delivery sequence.
timestamp: 2026-08-25T22:16:19Z
authority: canonical
decision_status: accepted
navigation:
  role: foundational
  order: 90
---

# Select the demonstration suite and hosted access policy

## Decision

- Use Poetry, Uptime Kuma, and PocketBase as the pinned real-world evaluation intakes.
- Prefer Uptime Kuma as the pre-indexed public demonstration, subject to the first measured review confirming quality, latency, and cost.
- Let anonymous visitors explore and chat with the pre-indexed demo only.
- Require an operator-issued access code to start a new public Git or zip review.
- Use the evaluation baseline to select models, embeddings, reranking, and evidence thresholds before building the full application.

## Initial hosted limits

These defaults are configuration, not claims about infrastructure capacity:

- maximum uploaded zip: 50 MiB;
- maximum safely extracted content: 250 MiB;
- maximum archive entries: 10,000;
- maximum analyzable text after exclusions: 50 MiB;
- maximum individual analyzed text file: 1 MiB;
- maximum archive nesting depth: 12;
- maximum expansion ratio: 100:1;
- one running review per access code;
- two review starts per access code in 24 hours;
- anonymous demo chat: 30 questions per IP in 24 hours;
- new reviews stop automatically at 80% of the configured monthly provider budget;
- all model-backed public activity stops at 100% of that budget;
- initial monthly provider budget: GBP 20, independently configurable from hosting spend.

Limits are enforced deterministically before model calls. Operators can lower them without a code change. Evaluation may justify changing them before launch.

## Provider boundary

Use Alibaba Cloud Model Studio's Frankfurt region as the first private-source Qwen evaluation route. Evaluate DeepSeek V4 Flash and Pro on public fixtures through an approved Model Studio endpoint. Do not send private zip content to direct DeepSeek services or another region until the applicable retention and improvement-use terms have been reviewed and accepted.

## Rationale

Uptime Kuma is a widely recognisable full-stack monitoring application with a bounded source tree and sparse internal architecture material, making the generated review easy to explain visually. Poetry exercises a substantial Python developer tool. PocketBase proves that the general structured path is useful when no enhanced Go adapter exists. All three report MIT licensing at their pinned revisions.

Keeping new reviews behind an access code lets the public product demonstrate local and private zip support without exposing an unbounded anonymous cost or abuse surface.

## Consequences

- The hosted demo is not an unrestricted public repository-analysis service.
- The evaluation task can proceed without selecting a winning model in advance.
- The first Uptime Kuma evaluation may reject it as the final demo if the evidence, cost, or presentation is weak; replacement requires a recorded decision.
- Limits and deletion behaviour require observable enforcement and tests.

## Related knowledge

- [Evaluation baseline contract](../evaluation-contract.md)
- [Hosting and model strategy](./002-hosting-and-model-strategy.md)
- [Language support and intake](../language-support-and-intake.md)
