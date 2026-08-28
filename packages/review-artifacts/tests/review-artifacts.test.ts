import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildLexicalEvidenceIndex } from "@code-knowledge-assistant/retrieval";
import { buildDeterministicReviewBundle } from "@code-knowledge-assistant/review-generation";
import type { LocalRepositoryReview } from "@code-knowledge-assistant/review-pipeline";
import { FileSystemReviewArtifactStore, ReviewArtifactStoreError } from "../src/index.ts";

function completedReview(): LocalRepositoryReview {
  const evidence = [{
    id: "src-server-ts:1-1",
    path: "src/server.ts",
    start_line: 1,
    end_line: 1,
    sha256: "a".repeat(64),
    capability_tier: "structured" as const,
    evidence_kind: "source" as const,
    symbol: "startServer",
    excerpt: "export function startServer() { return 3000; }\n",
  }];
  const review = buildDeterministicReviewBundle({
    review_id: "review-123",
    source_revision: "upload:review-123",
    generated_at: "2026-08-27T12:00:00.000Z",
    evidence,
    coverage: { eligible_files: 1, analyzed_files: 1, excluded_files: 0 },
  });
  const documents = [{
    id: "primary:src-server-ts:1-1",
    layer: "primary" as const,
    content: evidence[0]!.excerpt,
    provenance: { repository_path: "src/server.ts", line_start: 1, line_end: 1 },
  }];
  return {
    analysis: {
      capabilities: [{ language: "typescript", tier: "structured" as const, extractor: "deterministic-typescript-javascript-lexical-v1", eligible_files: 1, analyzed_files: 1, failed_files: 0 }],
      files: [{ path: "src/server.ts", language: "typescript" as const, tier: "structured" as const, range: { path: "src/server.ts", start_line: 1, end_line: 1 }, symbols: [{ name: "startServer", kind: "function" as const, range: { path: "src/server.ts", start_line: 1, end_line: 1 } }], imports: [] }],
      chunks: [{ id: "src-server-ts:1-1", range: { path: "src/server.ts", start_line: 1, end_line: 1 }, content: evidence[0]!.excerpt }],
      exclusions: [],
      failures: [],
    },
    review,
    evidence,
    evidenceIndex: buildLexicalEvidenceIndex(documents),
  };
}

test("a completed review survives store reconstruction and answers with a citation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-review-artifacts-"));
  try {
    const first = new FileSystemReviewArtifactStore(root, { now: () => new Date("2026-08-27T12:00:00.000Z") });
    await first.save({ id: "review-123", expires_at: "2026-08-29T12:00:00.000Z", review: completedReview() });
    const restarted = new FileSystemReviewArtifactStore(root);

    const loaded = await restarted.get("review-123");
    const answer = loaded.review.evidenceIndex.query("Where is startServer defined?");
    assert.equal(answer.status, "ok");
    if (answer.status === "ok") assert.deepEqual(answer.results[0]?.provenance, { repository_path: "src/server.ts", line_start: 1, line_end: 1 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("duplicate, mismatched, unsafe, and integrity-drifted artifacts are refused without body-bearing errors", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-review-artifacts-"));
  try {
    const store = new FileSystemReviewArtifactStore(root, { now: () => new Date("2026-08-27T12:00:00.000Z") });
    const payload = completedReview();
    await store.save({ id: "review-123", expires_at: "2026-08-29T12:00:00.000Z", review: payload });
    await assert.rejects(
      store.save({ id: "review-123", expires_at: "2026-08-29T12:00:00.000Z", review: payload }),
      (error: unknown) => error instanceof ReviewArtifactStoreError && error.code === "ARTIFACT_EXISTS",
    );
    await assert.rejects(
      store.save({ id: "different-id", expires_at: "2026-08-29T12:00:00.000Z", review: payload }),
      (error: unknown) => error instanceof ReviewArtifactStoreError && error.code === "ARTIFACT_ID_MISMATCH",
    );
    const unsafe = completedReview();
    unsafe.analysis.files[0]!.path = "C:\\absolute.ts";
    await assert.rejects(
      store.save({ id: "review-unsafe", expires_at: "2026-08-29T12:00:00.000Z", review: unsafe }),
      (error: unknown) => error instanceof ReviewArtifactStoreError && error.code === "ARTIFACT_UNSAFE",
    );
    const artifactPath = path.join(root, "artifacts", "review-123.json");
    const envelope = JSON.parse(await readFile(artifactPath, "utf8"));
    envelope.sha256 = "0".repeat(64);
    await writeFile(artifactPath, JSON.stringify(envelope));
    await assert.rejects(
      store.get("review-123"),
      (error: unknown) => error instanceof ReviewArtifactStoreError
        && error.code === "ARTIFACT_INTEGRITY_INVALID"
        && !error.message.includes("startServer"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("expiry discovery and physical deletion are idempotent", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-review-artifacts-"));
  try {
    const store = new FileSystemReviewArtifactStore(root, { now: () => new Date("2026-08-27T12:00:00.000Z") });
    await store.save({ id: "review-expired", expires_at: "2026-08-28T12:00:00.000Z", review: { ...completedReview(), review: { ...completedReview().review, review_id: "review-expired" } } });

    assert.deepEqual(await store.listExpired(new Date("2026-08-28T12:00:00.000Z")), [{ id: "review-expired", expires_at: "2026-08-28T12:00:00.000Z" }]);
    await store.delete("review-expired");
    await store.delete("review-expired");
    await assert.rejects(
      store.get("review-expired"),
      (error: unknown) => error instanceof ReviewArtifactStoreError && error.code === "ARTIFACT_NOT_FOUND",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("corrupt and unknown-field envelopes are rejected through stable errors", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-review-artifacts-"));
  try {
    const store = new FileSystemReviewArtifactStore(root, { now: () => new Date("2026-08-27T12:00:00.000Z") });
    await store.save({ id: "review-corrupt", expires_at: "2026-08-29T12:00:00.000Z", review: { ...completedReview(), review: { ...completedReview().review, review_id: "review-corrupt" } } });
    const artifactPath = path.join(root, "artifacts", "review-corrupt.json");
    await writeFile(artifactPath, "not-json");
    await assert.rejects(
      store.get("review-corrupt"),
      (error: unknown) => error instanceof ReviewArtifactStoreError && error.code === "ARTIFACT_CORRUPT",
    );
    await writeFile(artifactPath, JSON.stringify({ schema_version: 1, artifact: {}, sha256: "a".repeat(64), uncontrolled: true }));
    await assert.rejects(
      store.get("review-corrupt"),
      (error: unknown) => error instanceof ReviewArtifactStoreError && error.code === "ARTIFACT_SCHEMA_INVALID",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("malformed public save input is rejected with a store error", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-review-artifacts-"));
  try {
    const store = new FileSystemReviewArtifactStore(root);
    await assert.rejects(
      store.save({ id: "review-invalid", expires_at: "2026-08-29T12:00:00.000Z", review: null } as never),
      (error: unknown) => error instanceof ReviewArtifactStoreError && error.code === "ARTIFACT_SCHEMA_INVALID",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
