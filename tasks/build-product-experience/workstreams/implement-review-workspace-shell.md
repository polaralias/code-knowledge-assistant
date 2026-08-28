---
type: Workstream
task: build-product-experience
workstream: implement-review-workspace-shell
title: Implement review workspace shell
description: Build the visible pre-indexed review, documentation, evidence, and chat
  workspace against a typed fixture boundary.
status: done
created: '2026-08-26T20:49:52Z'
timestamp: '2026-08-27T06:47:11Z'
owner: luna-web
---

# Implement review workspace shell

## Assigned outcome

Build the visible pre-indexed review, documentation, evidence, and chat workspace against a typed fixture boundary.

## Owned and shared paths

- Owned: `apps/web/**`.
- Shared: none during parallel implementation. The lifecycle coordinator alone changes root workspace configuration, parent tasks, and canonical docs.

## Acceptance and validation

- [x] Build a polished responsive review workspace that opens directly on a realistic pre-indexed repository fixture.
- [x] Present repository identity, review status, language capability, coverage, exclusions, generated documentation navigation, and uncertainty without hiding limitations.
- [x] Provide a conversational panel with example questions, cited answer presentation, and evidence inspection using a typed local fixture boundary.
- [x] Include deliberate loading, empty, failure, expired-review, and abuse-limit states in the view model and UI rendering path.
- [x] Meet basic keyboard, focus, semantic landmark, contrast, and reduced-motion expectations.
- [x] Keep the shell backend-agnostic and document the fixture-to-live API seam for coordinator integration.
- [x] Add proportionate automated checks for fixture validation and critical rendered states without requiring an external service.

## Evidence

- Commit:
- Validation: Five fixture/state tests and the 86-test repository suite pass; browser inspection verified desktop and 390-pixel layouts, citation-dialog interaction, and expired-state replacement.
- Integration: `apps/web/README.md` documents the fixture-to-live seam; the live API, ZIP upload, and public Git intake now reuse the workspace's review, polling, question, citation, and deletion contracts.

## Handoff

- Do not edit root configuration, task records, backend packages, canonical docs, or other agents' paths.
- Use the design-taste-frontend skill for visual direction and report the live API contract expected by the shell.
