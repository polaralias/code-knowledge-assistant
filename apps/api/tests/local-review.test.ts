import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { buildLexicalEvidenceIndex } from "@code-knowledge-assistant/retrieval";
import type { LocalRepositoryReview } from "@code-knowledge-assistant/review-pipeline";

import { ReviewApiError } from "../src/index.ts";
import { createLocalReviewApiDependencies } from "../src/local-review.ts";

function reviewFixture(): LocalRepositoryReview {
  const excerpt = "export function startServer() { return 'ready'; }";
  const sha256 = createHash("sha256").update(excerpt).digest("hex");
  const evidence = [{ id: "chunk-1", path: "src/main.ts", start_line: 1, end_line: 1, sha256, capability_tier: "structured" as const, evidence_kind: "source" as const, symbol: "startServer", excerpt }];
  return {
    analysis: {
      capabilities: [{ language: "typescript", tier: "structured", extractor: "lexical-v1", eligible_files: 1, analyzed_files: 1, failed_files: 0 }],
      files: [{ path: "src/main.ts", language: "typescript", tier: "structured", range: { path: "src/main.ts", start_line: 1, end_line: 1 }, symbols: [], imports: [] }],
      chunks: [{ id: "chunk-1", range: { path: "src/main.ts", start_line: 1, end_line: 1 }, content: excerpt }],
      exclusions: [], failures: [],
    },
    evidence,
    review: {
      schema_version: 1, review_id: "review-1", source_revision: "abc123", generated_at: "2026-08-27T06:00:00Z", authority: "derived", verification: "verified-limited",
      generation: { generator: "deterministic", model: null, prompt_version: "v1" }, capability: { tiers: ["structured"] },
      coverage: { eligible_files: 1, analyzed_files: 1, excluded_files: 0 },
      concepts: [{ id: "overview", kind: "overview", title: "Overview", summary: "Startup evidence.", claims: [{ id: "claim-1", text: "The repository exposes startServer.", evidence_ids: ["chunk-1"], confidence: "high" }] }],
    },
    evidenceIndex: buildLexicalEvidenceIndex([{ id: "primary:chunk-1", layer: "primary", content: excerpt, provenance: { repository_path: "src/main.ts", line_start: 1, line_end: 1 } }]),
  };
}

test("maps the local review and deterministic answers into the browser contract", async () => {
  const dependencies = createLocalReviewApiDependencies(reviewFixture(), { name: "sample" });
  const review = await dependencies.loadReview() as Record<string, any>;
  assert.equal(review.reviewId, "review-1");
  assert.equal(review.repository.name, "sample");
  assert.equal(review.documents[0].title, "Overview");

  const answer = await dependencies.answerQuestion("Where is startServer defined?", "review-1") as Record<string, any>;
  assert.equal(answer.confidence, "high");
  assert.deepEqual(answer.citations[0], {
    path: "src/main.ts", language: "TypeScript", lineStart: 1, lineEnd: 1,
    excerpt: "export function startServer() { return 'ready'; }", reason: "Repository evidence used by the answer.",
  });
});

test("refuses a question for another review without leaking repository state", async () => {
  const dependencies = createLocalReviewApiDependencies(reviewFixture(), { name: "sample" });
  await assert.rejects(() => dependencies.answerQuestion("Where?", "other"), (error: unknown) => {
    assert(error instanceof ReviewApiError);
    assert.equal(error.code, "REVIEW_NOT_FOUND");
    return true;
  });
});
