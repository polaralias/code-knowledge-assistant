---
type: Roadmap
title: Roadmap and Known Gaps
description: Records the intentionally deferred implementation work and the evidence required to promote each item.
timestamp: 2026-08-28T16:00:00Z
authority: canonical
navigation:
  role: supporting
  order: 60
---

# Roadmap and known gaps

The reference product is a working, bounded code knowledge assistant. The items below are deliberate follow-on tranches, not hidden requirements for the current demo. Each tranche has an implementation shape and a promotion gate so future work does not expand the system without evidence.

## Tranche 1: semantic and hybrid retrieval

**Goal:** improve repository-wide recall for questions that lexical overlap cannot resolve.

**How:** retain the deterministic lexical index as the control; add a provider-neutral embedding adapter and a versioned vector index over primary excerpts and derived claims; retrieve lexical and vector candidates, fuse with a deterministic rule, optionally rerank the bounded candidate set, then expand citations back to source ranges. Keep embeddings and reranking behind configuration so private-source routing and cost ceilings remain explicit.

**Gate:** run the checked 42-scenario corpus against lexical-only, hybrid, and reranked configurations. Promote only if retrieval recall, citation resolution, latency, and cost meet the evaluation contract without weakening prompt-injection or insufficiency tests.

## Tranche 2: conversational memory and multi-hop answers

**Goal:** support follow-up questions such as “what do they say?” and “how does that connect to auth?” without losing review scope.

**How:** persist a bounded question/answer turn record per review, resolve pronouns and references through a small query-rewrite step, retrieve from the prior answer’s cited evidence plus the full index, and send a capped conversation window to the provider. Never persist provider chain-of-thought; store only the user question, answer, citations, qualification, model identity, and bounded usage metadata.

**Gate:** multi-turn scenarios must resolve references, preserve citations, expire with the review, and remain within question, token, latency, and cost limits.

## Tranche 3: answer-time source verification

**Goal:** prevent a fluent answer from outrunning the generated review summary.

**How:** require each material answer assertion to map to a retrieved primary span or a derived claim whose supporting primary spans are also present. Add a deterministic post-generation verifier for citation existence, path/range integrity, contradiction flags, and unsupported specificity; downgrade to qualification or retry with a smaller context when verification fails.

**Gate:** adversarial, ambiguous, contradictory, and unsupported scenarios must pass with no uncited material claims.

## Tranche 4: enhanced language and relationship extraction

**Goal:** add syntax-aware understanding where it materially improves the supported language set.

**How:** introduce Tree-sitter adapters behind the existing capability interface for Python, TypeScript, and JavaScript; emit syntax ranges and conservative imports/exports/framework landmarks, never an assumed runtime call graph. Add relationship records only when directly supported by syntax, configuration, tests, or explicit references.

**Gate:** compare against the deterministic fixture ground truth and real-world intake scenarios. Keep the current structured/fallback path as a safe fallback for unsupported constructs.

## Tranche 5: hosted scale and operations

**Goal:** move beyond the single-replica Railway reference service.

**How:** replace filesystem job/artifact/object adapters with PostgreSQL and S3-compatible implementations, add distributed expiry leases, idempotent worker claims, lifecycle deletion rules, backups and restore tests, and source-free metrics/traces. Keep ephemeral worker workspaces and the 48-hour retention contract.

**Gate:** multi-instance concurrency, restart, deletion, expiry, backup-restore, and secret/source-body redaction tests pass in a production-like environment.

## Intentionally outside the next tranches

Continuous repository synchronisation, private Git provider integrations, unrestricted language parity, autonomous code changes, enterprise identity and billing, and an MCP surface remain separate product decisions. They should not be smuggled into retrieval or hosting work.

## Current accepted limitations

The shipped conversation path is bounded hybrid-in-context answering: lexical retrieval over primary and derived evidence, supplemented by review summaries and selected primary excerpts for broad questions, followed by provider composition and citation validation. It is retrieval-augmented generation in the broad sense, but it is not semantic vector RAG and it does not retain conversation history. The deterministic control remains available when provider output is unavailable or unverifiable.
