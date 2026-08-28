---
type: Workstream
task: build-repository-review-pipeline
workstream: expose-public-git-review-api
title: Expose public Git review API
description: Accept a bounded public GitHub repository request and route it into the
  durable review job lifecycle with body-free failure states.
status: done
created: '2026-08-27T17:16:02Z'
timestamp: '2026-08-27T21:33:37Z'
owner: codex-api
---

# Expose public Git review API

## Assigned outcome

Accept a bounded public GitHub repository request and route it into the durable review job lifecycle with body-free failure states.

## Owned and shared paths

- Owned: `packages/review-service/**`, `apps/api/**`, and their package manifests.
- Shared: consume the existing Git intake and materialized orchestration packages; do not edit the web application or canonical documentation.

## Acceptance and validation

- [x] Accept strict bounded JSON containing only a GitHub HTTPS repository URL and optional ref.
- [x] Create an opaque queued job, resolve and persist the immutable revision, and use the same ready/restart/question/delete/expiry lifecycle as ZIP reviews.
- [x] Run Git acquisition asynchronously with bounded transport controls and always clean its temporary workspace.
- [x] Map invalid input and stable intake failures to body-free API states without exposing Git output, paths, repository content, or credentials.
- [x] Preserve existing ZIP routes and controller contracts.
- [x] Test API acceptance, polling, completed review, cited question, restart recovery, invalid URLs/refs, transport failure, and cleanup.

## Evidence

- Commit: not yet committed; the current working tree is the reviewable evidence boundary.
- Validation: `pnpm test` passes 168 tests; `pnpm typecheck` passes; API/service tests cover strict JSON, lifecycle, failure mapping, and cleanup; direct runtime smoke against `https://github.com/pallets/click` (`main`) returned 202 and reached `ready`.
- Integration: `POST /api/git-reviews` accepts only `repositoryUrl` and optional `ref`, then reuses opaque jobs, review retrieval, cited questions, deletion, restart reconstruction, and expiry.

## Handoff

- Remaining risk: the route currently supports public GitHub only; authentication/access-code and hosted abuse controls remain deployment work.
