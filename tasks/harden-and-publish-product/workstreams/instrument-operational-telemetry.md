---
type: Workstream
task: harden-and-publish-product
workstream: instrument-operational-telemetry
title: Instrument operational telemetry
description: Emit body-safe structured lifecycle events and bounded process metrics
  for HTTP requests and expiry sweeps.
status: done
created: '2026-08-27T22:41:40Z'
timestamp: '2026-08-27T23:30:38Z'
owner: codex
---

# Instrument operational telemetry

## Assigned outcome

Emit body-safe structured lifecycle events and bounded process metrics for HTTP requests and expiry sweeps.

## Owned and shared paths

- Owned: `packages/observability/**`.
- Shared: `apps/api/**` and workspace manifests for application integration.

## Acceptance and validation

- [x] Emit versioned JSON records through an injected writer and clock.
- [x] Accept only enumerated event names, outcomes, route templates, status codes, durations, and counts.
- [x] Reject arbitrary metadata and never accept source bodies, questions, repository URLs, access codes, or provider credentials.
- [x] Maintain bounded request and expiry-sweep counters plus latency totals through the public interface.
- [x] Isolate writer failures so telemetry cannot fail an application request or sweep.
- [x] Instrument API completion and expiry sweeps with route templates rather than raw paths or identifiers.
- [x] Verify behavior without network access or wall-clock sleeps.

## Evidence

- Commit:
- Validation: observability, API, scheduler, and real runtime suites pass with injected writers/clocks and identifier-leak assertions.
- Integration: hosted entrypoints emit `code-knowledge-assistant.telemetry.v1` JSONL to standard output for platform collection.

## Handoff

- Record remaining risks, integration instructions, and knowledge-promotion needs.
