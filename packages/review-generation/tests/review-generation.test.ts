import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDeterministicReviewBundle,
  ReviewValidationError,
  validateReviewBundle,
  type ReviewEvidence,
} from "../src/index.ts";

const evidence: ReviewEvidence[] = [
  {
    id: "src-main",
    path: "src/main.ts",
    start_line: 1,
    end_line: 8,
    sha256: "a".repeat(64),
    capability_tier: "enhanced",
    evidence_kind: "source",
    symbol: "startServer",
    excerpt: "export function startServer() { return createApp(); }",
  },
  {
    id: "src-config",
    path: "src/config.ts",
    start_line: 1,
    end_line: 4,
    sha256: "b".repeat(64),
    capability_tier: "enhanced",
    evidence_kind: "configuration",
    symbol: null,
    excerpt: "export const port = process.env.PORT ?? 3000;",
  },
];

test("deterministic generation produces every required concept family with resolvable evidence", () => {
  const bundle = buildDeterministicReviewBundle({
    review_id: "review-123",
    source_revision: "upload:abc123",
    generated_at: "2026-08-26T20:00:00.000Z",
    evidence,
    coverage: { eligible_files: 2, analyzed_files: 2, excluded_files: 1 },
  });

  assert.deepEqual(
    [...new Set(bundle.concepts.map((concept) => concept.kind))].sort(),
    ["component", "coverage", "flow", "integration", "overview", "uncertainty"],
  );
  assert.equal(bundle.generation.generator, "deterministic-baseline");
  assert.ok(bundle.concepts.flatMap((concept) => concept.claims).every((claim) => claim.evidence_ids.length > 0));
  assert.equal(validateReviewBundle(bundle, evidence), bundle);
});

test("generation is stable regardless of evidence input order", () => {
  const input = {
    review_id: "review-123",
    source_revision: "commit:deadbeef",
    generated_at: "2026-08-26T20:00:00.000Z",
    coverage: { eligible_files: 2, analyzed_files: 2, excluded_files: 0 },
  } as const;
  assert.deepEqual(
    buildDeterministicReviewBundle({ ...input, evidence }),
    buildDeterministicReviewBundle({ ...input, evidence: [...evidence].reverse() }),
  );
});

test("validation rejects provider output whose claims cite missing evidence", () => {
  const bundle = buildDeterministicReviewBundle({
    review_id: "review-123",
    source_revision: "upload:abc123",
    generated_at: "2026-08-26T20:00:00.000Z",
    evidence,
    coverage: { eligible_files: 2, analyzed_files: 2, excluded_files: 0 },
  });
  bundle.concepts[0]!.claims[0]!.evidence_ids = ["invented"];

  assert.throws(
    () => validateReviewBundle(bundle, evidence),
    (error: unknown) => error instanceof ReviewValidationError && error.code === "CLAIM_EVIDENCE_UNKNOWN",
  );
});

test("validation rejects duplicate concept ids and unsafe repository paths", () => {
  const bundle = buildDeterministicReviewBundle({
    review_id: "review-123",
    source_revision: "upload:abc123",
    generated_at: "2026-08-26T20:00:00.000Z",
    evidence,
    coverage: { eligible_files: 2, analyzed_files: 2, excluded_files: 0 },
  });
  bundle.concepts.push(structuredClone(bundle.concepts[0]!));
  assert.throws(
    () => validateReviewBundle(bundle, evidence),
    (error: unknown) => error instanceof ReviewValidationError && error.code === "CONCEPT_ID_DUPLICATE",
  );

  assert.throws(
    () => validateReviewBundle(
      buildDeterministicReviewBundle({
        review_id: "review-safe",
        source_revision: "upload:abc123",
        generated_at: "2026-08-26T20:00:00.000Z",
        evidence,
        coverage: { eligible_files: 2, analyzed_files: 2, excluded_files: 0 },
      }),
      [{ ...evidence[0]!, path: "../secret" }, evidence[1]!],
    ),
    (error: unknown) => error instanceof ReviewValidationError && error.code === "EVIDENCE_PATH_INVALID",
  );
});

test("validation rejects unknown provider fields instead of accepting an unreviewed link surface", () => {
  const bundle = buildDeterministicReviewBundle({
    review_id: "review-123",
    source_revision: "upload:abc123",
    generated_at: "2026-08-26T20:00:00.000Z",
    evidence,
    coverage: { eligible_files: 2, analyzed_files: 2, excluded_files: 0 },
  });
  (bundle.concepts[0] as unknown as Record<string, unknown>).link = "javascript:alert(1)";

  assert.throws(
    () => validateReviewBundle(bundle, evidence),
    (error: unknown) => error instanceof ReviewValidationError && error.code === "CONCEPT_UNKNOWN_FIELD",
  );
});
