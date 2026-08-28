---
type: Deployment Readiness
title: Deployment Readiness and Outstanding Work
description: Records the verified deployment-shaped product path, the external launch gates, and the work that can remain deferred.
timestamp: 2026-08-28T03:04:00Z
authority: canonical
verification: verified-limited
verified_at: 2026-08-28T03:04:00Z
verified_against:
  - pnpm test
  - pnpm typecheck
  - node --test deploy/policy.test.mjs
  - apps/api/tests/runtime.test.ts
  - apps/api/tests/server.test.ts
  - apps/web/tests/upload-client.test.mjs
  - packages/evaluation/tests/provider-runner.test.mjs
  - deploy/policy.test.mjs
  - docker build --tag code-knowledge-assistant:local .
  - local container healthz readyz root endpoint demo review and cited question smoke
  - packages/review-service/tests/git-review-service.test.ts
  - direct runtime smoke against https://github.com/pallets/click at main
  - local Docker browser checks for Review, Findings, Map, responsive mobile, and light/dark emulation
  - tasks/index.md
navigation:
  role: supporting
  order: 55
---

# Deployment readiness and outstanding work

## Executive status

The application path is deployment-shaped but is not ready for an unrestricted public hosted launch. The local/reference service supports bounded ZIP uploads and public GitHub intake through the same durable review, restart, cited-question, deletion, and expiry lifecycle. Hosted access-code controls, persistent abuse limits, body-safe telemetry, CI/release policy, an immutable Uptime Kuma review artifact, provider evaluation context retrieval, provider-budget reservation integration, and post-deploy smoke tooling are now implemented and test-covered. The Docker image has also been built and exercised locally, including the anonymous demo question path. Railway provisioning, live provider credentials/evaluation, and clean hosted-browser evidence remain external or open gates.

The remaining launch work is concentrated in four areas: provider-backed generation and evaluation, external deployment verification, public browser evidence, and final documentation/release reconciliation. The deterministic lexical path remains the working control; no hosted model is selected until the evaluation gate passes.

## Current evidence matrix

| Area | Current state | Evidence class | Launch implication |
| --- | --- | --- | --- |
| Repository intake | ZIP and credential-free public GitHub URL/ref intake are bounded, body-safe, and no-execution. | Test-verified; live Git smoke | Core intake can be demonstrated, but private Git provider access is not an MVP path. |
| Review lifecycle | Inventory, source snapshots, disposable rehydration, deterministic review generation, opaque jobs, completed-artifact persistence, restart reconstruction, cited questions, deletion, and 48-hour expiry are implemented for the filesystem adapter. | Test-verified; ZIP browser path verified | Suitable for a single-replica reference service with one persistent data volume. |
| Analysis | Python, TypeScript, and JavaScript are conservative lexical `structured` extraction; unknown eligible text uses labelled `fallback`. No language is currently `enhanced`. | Test-verified | Do not market Tree-sitter or semantic graph coverage as shipped capability. |
| Conversation | Deterministic lexical retrieval and bounded cited answering are live. | Test-verified | The baseline recall is 0.595238 at 10 results against a provisional 0.85 gate; provider-backed synthesis and answer-time claim verification remain open. |
| Browser experience | Bundled anonymous demo navigation, cited question interaction, and the ZIP/Git client contracts are local runtime/test verified. | Mixed test-verified and runtime-verified | Capture a clean hosted-browser upload, Git, deletion, and screenshot run before claiming the public journey is demonstrated. |
| Workspace composition | Chat-centred Review, Findings, and Map tabs are implemented with a findings drill-in rail, progress/source context, responsive collapse, and an honest future map stub. | Local Docker browser-verified in light and dark emulation | The interaction model is ready for hosted evidence; relationship graph extraction remains deliberately deferred. |
| Persistence and expiry | Local JSON/job, object, snapshot, and artifact stores are restart-safe and swept by a non-overlapping scheduler. | Test-verified | Multi-instance coordination, hosted object storage, PostgreSQL/pgvector, and backup deletion are not present. |
| Container and hosting | Non-root Node 24 Dockerfile, bundled demo artifact, real API startup, `/healthz`, `/readyz`, and Dockerfile-backed singleton Railway manifest exist. | Policy-test and local image smoke verified | Railway provisioning, volume persistence, restart, and public health checks remain external gates. |
| Security and abuse | No repository code executes; input, path, size, ref, output, retention, hashed access-code, persistent quota, provider reservation, and anonymous-demo question boundaries are enforced. | Test-verified | External security scans and production secret configuration still need release evidence. |
| Operations and release | Documentation-led task and knowledge bundles, pinned CI/release workflows, JSONL telemetry, smoke checks, and rollback/runbook guidance are present. | Test/policy and local image verified | Run the workflows in CI and complete the external deployment evidence. |

## Required before a public hosted demo

1. Confirm the GitHub owner/name and deploy branch, create the Railway project/service from that connected repository, and attach one persistent volume at `/var/lib/code-atlas`; set `DATA_ROOT`, `HOST=0.0.0.0`, and the Railway-provided `PORT` without placing secrets in the repository.
2. Deploy the built image, then verify `/healthz`, `/readyz`, the bundled Uptime Kuma demo, restart recovery, volume persistence, ZIP intake, public Git intake, deletion, and expiry from a clean browser session.
3. Establish an approved provider workspace and per-run ceiling, provide the provider API key through a local/host secret store, run the checked evaluation matrix against real repository context, and record exact model snapshots, latency, cost, retrieval, citation, refusal, and security results before enabling provider-backed generation. Do not imply that DeepSeek, Qwen, OpenRouter, embeddings, or reranking are selected until that evidence exists.
4. Run CI/release policy gates in the target environment, complete a clean hosted-browser journey, capture stable screenshots, and reconcile task/knowledge evidence before publishing.

## Required for a stronger production service, but not the first reference demo

- Replace filesystem JSON/object stores with hosted PostgreSQL and S3-compatible storage when more than one replica, larger repositories, or independent worker scaling is needed.
- Add distributed expiry coordination, lifecycle rules, backup deletion, structured logs, metrics, traces, dashboards, and alerts that never record source bodies or secrets.
- Add provider-backed generation, embeddings, reranking, conversation history, answer-time derived-claim verification, and measured model fallback only after the evaluation contract passes.
- Add enhanced Tree-sitter adapters and evidence-supported relationships only where evaluation demonstrates material usefulness; complete call-graph reconstruction is not an MVP requirement.

## Next execution tranches

1. Provision the Railway reference service and persistent volume, then run the HTTPS smoke and clean hosted browser journey.
2. Resume the blocked evaluation workstream with an approved provider key, exact model/endpoint metadata, and a bounded spend ceiling. Compare public-source DeepSeek/Qwen candidates, then run the approved private-source Frankfurt lane; do not enable provider-backed generation from an unmeasured choice.
3. Reconcile the measured model and retrieval result into the evaluation and hosting decisions, then decide whether semantic retrieval or provider synthesis earns a separate implementation tranche.
4. Capture stable public screenshots and finalise README, task, knowledge, and release evidence. Keep multi-replica storage, Tree-sitter enhancement, graph extraction, memory, and private-provider integrations deferred unless the evidence justifies reopening scope.

## Safe to defer after the reference demo

Continuous GitHub synchronisation, private Git provider integrations, a separate Python analysis service, unrestricted language parity, autonomous code changes, enterprise identity/billing, and a read-only MCP surface are explicitly outside the first deployment gate.

## Task and knowledge traceability

- [Build the repository review pipeline](../../tasks/build-repository-review-pipeline/task.md) owns intake, evidence, and review lifecycle work.
- [Build grounded repository conversation](../../tasks/build-grounded-conversation/task.md) owns retrieval, cited answers, and the open model-quality gate.
- [Build the product experience](../../tasks/build-product-experience/task.md) owns the browser journey and remaining screenshot/Git-browser evidence.
- [Harden and publish the product](../../tasks/harden-and-publish-product/task.md) owns external deployment, abuse controls, CI, operational evidence, and release readiness.
- [Engineering quality and operational evidence](engineering-quality-contract.md) defines the required proof categories.
- [Evaluation baseline contract](evaluation-contract.md) defines the checked corpus and provider gate.
