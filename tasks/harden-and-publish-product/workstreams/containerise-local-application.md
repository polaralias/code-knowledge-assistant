---
type: Workstream
task: harden-and-publish-product
workstream: containerise-local-application
title: Containerise the local application
description: Build and run the upload-review application in a portable least-privilege
  container with health and readiness checks.
status: done
created: '2026-08-27T16:36:54Z'
timestamp: '2026-08-27T17:00:41Z'
owner: luna-deploy
---

# Containerise the local application

## Assigned outcome

Build and run the upload-review application in a portable least-privilege container with health and readiness checks.

## Owned and shared paths

- Owned: `Dockerfile`, `.dockerignore`, and `deploy/**`.
- Shared: define the runtime/environment expectations; root integration owns API health routes, root scripts, documentation, and task records.

## Acceptance and validation

- [x] Build the monorepo application into a reproducible Node container without source-control, local-data, evaluation-cache, or secret leakage.
- [x] Run as a non-root user with one explicit writable data directory and a configurable port.
- [x] Add a provider-neutral container healthcheck targeting the application health contract.
- [x] Document the minimal environment contract and local build/run commands without Railway credentials or platform-specific application logic.
- [x] Add deterministic static policy checks for runtime user, ignored paths, exposed port, healthcheck, and startup command.
- [x] Build and smoke-test the image locally when Docker is available; otherwise report the exact unavailable validation axis without claiming it passed.

## Evidence

- Commit: not created; repository has no initial Git commit and no commit was authorised.
- Validation: four deployment policy tests, startup syntax, and direct real-API smoke checks pass; Docker image build is unavailable and explicitly unverified.
- Integration: `Dockerfile` launches `deploy/start.mjs`; `railway.toml` uses the same image and `/healthz`; `/readyz` exposes readiness.

## Handoff

- Railway requires one persistent volume at `/var/lib/code-atlas`, `DATA_ROOT` set to that path, `HOST=0.0.0.0`, and one replica. The image now builds successfully with Docker Desktop and starts healthy with the bundled demo; Railway deployment and volume persistence remain external validation.
