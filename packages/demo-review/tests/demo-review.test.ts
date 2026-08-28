import assert from "node:assert/strict";
import test from "node:test";

import { createHash } from "node:crypto";
import { DemoReviewError, loadDemoReview } from "../src/index.ts";

function fixture() {
  const evidence = [{ id: "chunk-main", path: "src/main.ts", start_line: 1, end_line: 2, sha256: "a".repeat(64), capability_tier: "structured", evidence_kind: "source", symbol: "start", excerpt: "export function start() { return true; }" }];
  const analysis = {
    capabilities: [{ language: "typescript", tier: "structured", extractor: "deterministic", eligible_files: 1, analyzed_files: 1, failed_files: 0 }],
    files: [{ path: "src/main.ts", language: "typescript", tier: "structured", range: { path: "src/main.ts", start_line: 1, end_line: 2 }, symbols: [{ name: "start", kind: "function", range: { path: "src/main.ts", start_line: 1, end_line: 1 } }], imports: [] }],
    chunks: [{ id: "chunk-main", range: { path: "src/main.ts", start_line: 1, end_line: 2 }, content: evidence[0].excerpt }], exclusions: [], failures: [],
  };
  const concepts = [
    ["overview", "overview"], ["component", "component"], ["flow", "flow"], ["integration", "integration"], ["coverage", "coverage"], ["uncertainty", "uncertainty"],
  ].map(([id, kind]) => ({ id, kind, title: `${kind} title`, summary: `${kind} summary`, claims: [{ id: `${id}-claim`, text: `${kind} claim`, evidence_ids: ["chunk-main"], confidence: "high" }] }));
  const review = { schema_version: 1, review_id: "demo-review", source_revision: "revision-1", generated_at: "2026-08-27T12:00:00.000Z", authority: "derived", verification: "verified-limited", generation: { generator: "test", model: null, prompt_version: "test-v1" }, capability: { tiers: ["structured"] }, coverage: { eligible_files: 1, analyzed_files: 1, excluded_files: 0 }, concepts };
  const artifact = { schema_version: 1, id: "demo-review", created_at: "2026-08-27T12:00:00.000Z", expires_at: "2026-08-29T12:00:00.000Z", analysis, review, evidence };
  return JSON.stringify({ schema_version: 1, artifact, sha256: createHash("sha256").update(JSON.stringify(artifact)).digest("hex") });
}

const baseOptions = () => ({ artifactPath: "C:/demo-review.json", now: () => new Date("2026-08-28T12:00:00.000Z"), readFile: async () => fixture() });

test("loads a verified immutable ready review and answers from its evidence index", async () => {
  const loaded = await loadDemoReview(baseOptions());
  assert.equal(loaded.state, "ready");
  assert.equal(loaded.review.state, "ready");
  assert.equal(loaded.review.review.review_id, "demo-review");
  assert.equal(loaded.review.evidence[0].path, "src/main.ts");
  assert.equal(loaded.questionAdapter.answer("Where does start happen?").status, "answered");
  assert.equal(loaded.questionAdapter.answerQuestion("Where does start happen?").citations.length, 1);
  assert.equal(Object.isFrozen(loaded), true);
  assert.equal(Object.isFrozen(loaded.review.review), true);
  assert.equal(Object.isFrozen(loaded.review.evidence[0]), true);
});

test("rejects oversized, expired, corrupt, unsafe, extra-field, and integrity-invalid artifacts without echoing content", async () => {
  const options = baseOptions();
  await assert.rejects(loadDemoReview({ ...options, maxBytes: 2 }), (error) => error instanceof DemoReviewError && error.code === "DEMO_ARTIFACT_TOO_LARGE");
  await assert.rejects(loadDemoReview({ ...options, now: () => new Date("2026-08-30T00:00:00.000Z") }), (error) => error instanceof DemoReviewError && error.code === "DEMO_ARTIFACT_EXPIRED");
  await assert.rejects(loadDemoReview({ ...options, readFile: async () => "secret source body" }), (error) => error instanceof DemoReviewError && error.code === "DEMO_ARTIFACT_CORRUPT" && error.message === "DEMO_ARTIFACT_CORRUPT");
  const unsafe = JSON.parse(fixture());
  unsafe.artifact.evidence[0].path = "../secret.ts";
  unsafe.sha256 = createHash("sha256").update(JSON.stringify(unsafe.artifact)).digest("hex");
  await assert.rejects(loadDemoReview({ ...options, readFile: async () => JSON.stringify(unsafe) }), (error) => error instanceof DemoReviewError && error.code === "DEMO_ARTIFACT_UNSAFE");
  const extra = JSON.parse(fixture());
  extra.artifact.review.extra = "unexpected";
  extra.sha256 = createHash("sha256").update(JSON.stringify(extra.artifact)).digest("hex");
  await assert.rejects(loadDemoReview({ ...options, readFile: async () => JSON.stringify(extra) }), (error) => error instanceof DemoReviewError && error.code === "DEMO_ARTIFACT_SCHEMA_INVALID");
  const badDigest = JSON.parse(fixture());
  badDigest.sha256 = "b".repeat(64);
  await assert.rejects(loadDemoReview({ ...options, readFile: async () => JSON.stringify(badDigest) }), (error) => error instanceof DemoReviewError && error.code === "DEMO_ARTIFACT_INTEGRITY_INVALID");
});

test("rejects invalid limits, malformed dates, unsafe references, and invalid question input", async () => {
  const options = baseOptions();
  await assert.rejects(loadDemoReview({ ...options, maxBytes: 0 }), (error) => error instanceof DemoReviewError && error.code === "DEMO_CONFIG_INVALID");
  const malformed = JSON.parse(fixture());
  malformed.artifact.expires_at = "tomorrow";
  malformed.sha256 = createHash("sha256").update(JSON.stringify(malformed.artifact)).digest("hex");
  await assert.rejects(loadDemoReview({ ...options, readFile: async () => JSON.stringify(malformed) }), (error) => error instanceof DemoReviewError && error.code === "DEMO_ARTIFACT_SCHEMA_INVALID");
  const loaded = await loadDemoReview(options);
  assert.throws(() => loaded.questionAdapter.answer(7 as never), (error) => error instanceof DemoReviewError && error.code === "DEMO_QUESTION_INVALID");
});
