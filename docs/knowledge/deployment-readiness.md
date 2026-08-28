---
type: Deployment Readiness
title: Deployment Readiness and Outstanding Work
description: Records the verified deployment-shaped product path, the external launch gates, and the work that can remain deferred.
timestamp: 2026-08-28T16:10:00Z
authority: canonical
verification: verified-limited
verified_at: 2026-08-28T16:10:00Z
verified_against:
  - pnpm test
  - pnpm typecheck
  - node --test deploy/policy.test.mjs
  - apps/api/tests/runtime.test.ts
  - apps/api/tests/server.test.ts
  - apps/web/tests/upload-client.test.mjs
  - packages/evaluation/tests/provider-runner.test.mjs
  - packages/model-provider/tests/model-provider.test.ts
  - packages/review-pipeline/tests/review-pipeline.test.ts
  - local provider-backed Cozylife extraction with six validated Qwen 3.6 Flash concepts
  - Railway production deployment 51feeb96-da65-41d5-99a0-31b4b33cbdfe at commit 9cc72b9
  - hosted Cozylife review review-de0f80d6-03a8-4790-a72a-d33b0f391258 with six non-baseline model-authored documents
  - deploy/policy.test.mjs
  - docker build --tag code-knowledge-assistant:local .
  - local container healthz readyz root endpoint demo review and cited question smoke
  - packages/review-service/tests/git-review-service.test.ts
  - direct runtime smoke against https://github.com/pallets/click at main
  - local Docker browser checks for Review, Findings, Map, responsive mobile, and light/dark emulation
  - Railway production deployment 51feeb96-da65-41d5-99a0-31b4b33cbdfe at commit 9cc72b9
  - hosted deploy/smoke.mjs lifecycle against code-knowledge-assistant-production.up.railway.app
  - https://github.com/polaralias/code-knowledge-assistant/actions/runs/33148773548
  - tasks/index.md
navigation:
  role: supporting
  order: 55
---

# Deployment readiness and outstanding work

## Executive status

The access-gated reference service is publicly deployed on Railway and supports bounded ZIP uploads and public GitHub intake through the same durable review, cited-question, deletion, and expiry lifecycle. The Dockerfile-backed singleton runs with a persistent `/var/lib/code-atlas` volume. Evidence-constrained initial review generation is production-verified against Cozylife: the job reached `ready` and served six repository-specific model-authored documents, while the deterministic-baseline detector remained false. Qwen 3.6 Flash is the primary, with DeepSeek V4 Flash and the deterministic baseline as bounded per-concept fallbacks. Live questions now pass retrieved evidence through the configured provider answerer for conversational synthesis with verifiable citations; generated visualization HTML is excluded from intake. The wider quality/cost evaluation and clean hosted-browser presentation evidence remain launch checks.

The remaining launch work is concentrated in the wider model/retrieval evaluation, public browser presentation evidence, and final release presentation. The deployed allocation is operational and verified, not a final evaluation winner.

## Current evidence matrix

| Area | Current state | Evidence class | Launch implication |
| --- | --- | --- | --- |
| Repository intake | ZIP and credential-free public GitHub URL/ref intake are bounded, body-safe, and no-execution. | Test-verified; live Git smoke | Core intake can be demonstrated, but private Git provider access is not an MVP path. |
| Review lifecycle | Inventory, source snapshots, disposable rehydration, six evidence-constrained provider concept passes with strict validation and deterministic fallback, opaque jobs, completed-artifact persistence, restart reconstruction, cited questions, deletion, and 48-hour expiry are implemented for the filesystem adapter. | Test-verified; local and Railway live-provider Cozylife extraction | Provider-authored review generation is demonstrable; broader usefulness and cost remain evaluation questions. |
| Analysis | Python, TypeScript, and JavaScript are conservative lexical `structured` extraction; unknown eligible text uses labelled `fallback`. No language is currently `enhanced`. | Test-verified | Do not market Tree-sitter or semantic graph coverage as shipped capability. |
| Conversation | Lexical retrieval and bounded provider-backed cited answering are live, with deterministic insufficiency behaviour. | Test-verified and deployed | The lexical baseline recall is 0.595238 at 10 results against a provisional 0.85 gate; semantic retrieval and answer-time derived-claim verification remain open. |
| Browser experience | Bundled anonymous demo navigation, cited question interaction, and the ZIP/Git client contracts are local runtime/test verified. | Mixed test-verified and runtime-verified | Capture a clean hosted-browser upload, Git, deletion, and screenshot run before claiming the public journey is demonstrated. |
| Workspace composition | Chat-centred Review, Findings, and Map tabs are implemented with a findings drill-in rail, progress/source context, responsive collapse, and an honest future map stub. | Local Docker browser-verified in light and dark emulation | The interaction model is ready for hosted evidence; relationship graph extraction remains deliberately deferred. |
| Persistence and expiry | Local JSON/job, object, snapshot, and artifact stores are restart-safe and swept by a non-overlapping scheduler. | Test-verified | Multi-instance coordination, hosted object storage, PostgreSQL/pgvector, and backup deletion are not present. |
| Container and hosting | Node 24 Dockerfile, bundled demo artifact, real API startup, `/healthz`, `/readyz`, and a Dockerfile-backed singleton Railway service with a persistent volume are live. Railway's root-owned volume requires the documented `RAILWAY_RUN_UID=0` deployment override. | Policy-test, local image, Railway deployment, and hosted lifecycle smoke verified | Restart recovery and controlled expiry remain operator checks; multi-replica storage is not supported. |
| Security and abuse | No repository code executes; input, path, size, ref, output, retention, hashed access-code, persistent quota, provider reservation, and anonymous-demo question boundaries are enforced. | Test-verified | External security scans and production secret configuration still need release evidence. |
| Operations and release | Documentation-led task and knowledge bundles, pinned CI/release workflows, JSONL telemetry, smoke checks, and rollback/runbook guidance are present. | Test/policy and local image verified | Run the workflows in CI and complete the external deployment evidence. |

## Completed reference-deployment evidence

1. The public source is published at `polaralias/code-knowledge-assistant`.
2. Railway project `Code Knowledge Assistant` runs commit `84cc163` as a one-replica Dockerfile service with a persistent volume mounted at `/var/lib/code-atlas`.
3. `deploy/smoke.mjs` passed against the public HTTPS domain, including pinned Uptime Kuma Git intake and a cited question.
4. Deployment `ed6459d9-2512-4192-bb57-5ff086fd03b6` served a fresh Cozylife review with six non-baseline model-authored documents; the temporary validation access code was revoked after acceptance.

## Still required before final presentation

1. Run the checked comparative evaluation matrix for `qwen3.6-flash` and `deepseek-v4-flash-0731` using the configured provider budget. Record exact model snapshots, latency, cost, retrieval, citation, refusal, and security results; this determines whether the current allocation remains the default.
2. Complete a clean hosted-browser ZIP and Git journey, verify restart recovery against retained state, and capture stable screenshots.
3. Reconcile the measured model and hosted-browser evidence into the final release presentation.

## Required for a stronger production service, but not the first reference demo

- Replace filesystem JSON/object stores with hosted PostgreSQL and S3-compatible storage when more than one replica, larger repositories, or independent worker scaling is needed.
- Add distributed expiry coordination, lifecycle rules, backup deletion, structured logs, metrics, traces, dashboards, and alerts that never record source bodies or secrets.
- Add semantic embeddings, reranking, bounded conversation history, answer-time derived-claim verification, and measured model fallback only after the evaluation contract passes. Provider-backed review and chat generation are already implemented with strict validation and deterministic fallback.
- Add enhanced Tree-sitter adapters and evidence-supported relationships only where evaluation demonstrates material usefulness; complete call-graph reconstruction is not an MVP requirement.

## Next execution tranches

1. Run the configured Qwen/DeepSeek evaluation matrix within the checked cost and safety ceilings.
2. Run the clean hosted-browser journey and restart/persistence check, then capture stable public screenshots.
3. Implement semantic retrieval only if the measured hybrid-RAG comparison clears the retrieval and cost gates; follow the [roadmap](roadmap-and-known-gaps.md) for the tranche shape.

## Safe to defer after the reference demo

Continuous GitHub synchronisation, private Git provider integrations, a separate Python analysis service, unrestricted language parity, autonomous code changes, enterprise identity/billing, and a read-only MCP surface are explicitly outside the first deployment gate.

## Task and knowledge traceability

- [Build the repository review pipeline](../../tasks/build-repository-review-pipeline/task.md) owns intake, evidence, and review lifecycle work.
- [Build grounded repository conversation](../../tasks/build-grounded-conversation/task.md) owns retrieval, cited answers, and the open model-quality gate.
- [Build the product experience](../../tasks/build-product-experience/task.md) owns the browser journey and remaining screenshot/Git-browser evidence.
- [Harden and publish the product](../../tasks/harden-and-publish-product/task.md) owns external deployment, abuse controls, CI, operational evidence, and release readiness.
- [Engineering quality and operational evidence](engineering-quality-contract.md) defines the required proof categories.
- [Evaluation baseline contract](evaluation-contract.md) defines the checked corpus and provider gate.
