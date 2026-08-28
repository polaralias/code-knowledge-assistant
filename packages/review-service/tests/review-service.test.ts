import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildLexicalEvidenceIndex } from "@code-knowledge-assistant/retrieval";
import { FileSystemReviewJobStore } from "@code-knowledge-assistant/review-jobs";
import { FileSystemReviewArtifactStore } from "@code-knowledge-assistant/review-artifacts";
import { FileSystemObjectStore } from "@code-knowledge-assistant/source-snapshots";

import { createReviewService } from "../src/index.ts";

function completedReview() {
  const content = "export function startServer() { return 'ready'; }";
  const evidenceIndex = buildLexicalEvidenceIndex([{ id: "primary:chunk-1", layer: "primary", content, provenance: { repository_path: "src/main.ts", line_start: 1, line_end: 1 } }]);
  return {
    snapshot: { id: "snapshot-1", expires_at: "2026-08-29T12:00:00.000Z" },
    review: {
      analysis: { capabilities: [{ language: "typescript" as const, tier: "structured" as const, extractor: "lexical", eligible_files: 1, analyzed_files: 1, failed_files: 0 }], files: [], chunks: [], exclusions: [], failures: [] },
      review: { schema_version: 1 as const, review_id: "review-1", source_revision: "revision-1", generated_at: "2026-08-27T12:00:00.000Z", authority: "derived" as const, verification: "verified-limited" as const, generation: { generator: "deterministic", model: null, prompt_version: "v1" }, capability: { tiers: ["structured" as const] }, coverage: { eligible_files: 1, analyzed_files: 1, excluded_files: 0 }, concepts: [] },
      evidence: [], evidenceIndex,
    },
  };
}

test("an accepted upload becomes a durable ready job and a cited active review", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-review-service-"));
  const scheduled: Array<() => Promise<void>> = [];
  let clock = new Date("2026-08-27T12:00:00.000Z");
  try {
    const incoming = path.join(root, "incoming.zip");
    await writeFile(incoming, "ZIP", "utf8");
    await mkdir(path.join(root, "objects"));
    const jobs = new FileSystemReviewJobStore(path.join(root, "jobs"), { now: () => clock });
    const service = createReviewService({
      jobs,
      store: new FileSystemObjectStore(path.join(root, "objects")),
      uploadRoot: path.join(root, "uploads"),
      intakeWorkspaceRoot: path.join(root, "intake"),
      rehydratedWorkspaceRoot: path.join(root, "rehydrated"),
      now: () => clock,
      createId: (kind) => `${kind}-1`,
      schedule: (work) => scheduled.push(work),
      runReview: async (input) => { await rm(input.archivePath); return completedReview(); },
    });

    assert.deepEqual(await service.createReview({ uploadPath: incoming, byteSize: 3 }), { jobId: "job-1", reviewId: "review-1", state: "queued" });
    assert.equal((await jobs.get("job-1")).expires_at, "2026-08-27T13:00:00.000Z");
    assert.equal(scheduled.length, 1);
    clock = new Date("2026-08-27T12:30:00.000Z");
    await scheduled[0]!();

    const job = await jobs.get("job-1");
    assert.equal(job.state, "ready");
    assert.equal(job.review_id, "review-1");
    assert.equal(job.expires_at, "2026-08-29T12:30:00.000Z");
    assert.equal((await service.getReview("review-1"))?.review.review_id, "review-1");
    const answer = await service.answerQuestion("review-1", "Where is startServer defined?");
    assert.equal(answer.status, "answered");
    assert.equal(answer.citations[0]?.repository_path, "src/main.ts");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a failed review becomes a body-free failed job and removes the owned upload", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-review-service-failure-"));
  const scheduled: Array<() => Promise<void>> = [];
  try {
    const incoming = path.join(root, "incoming.zip");
    await writeFile(incoming, "PRIVATE-SOURCE-CONTENT", "utf8");
    const jobsRoot = path.join(root, "jobs");
    const jobs = new FileSystemReviewJobStore(jobsRoot, { now: () => new Date("2026-08-27T12:00:00.000Z") });
    const service = createReviewService({
      jobs,
      store: new FileSystemObjectStore(path.join(root, "objects")),
      uploadRoot: path.join(root, "uploads"), intakeWorkspaceRoot: path.join(root, "intake"), rehydratedWorkspaceRoot: path.join(root, "rehydrated"),
      now: () => new Date("2026-08-27T12:00:00.000Z"), createId: (kind) => `${kind}-failure`, schedule: (work) => scheduled.push(work),
      runReview: async () => { throw new Error("ZIP_REVIEW_INTAKE_FAILED"); },
    });

    await service.createReview({ uploadPath: incoming, byteSize: 22 });
    await scheduled[0]!();
    const failed = await jobs.get("job-failure");
    assert.equal(failed.state, "failed");
    assert.deepEqual(failed.error, { code: "ZIP_REVIEW_INTAKE_FAILED" });
    assert.doesNotMatch(JSON.stringify(failed), /PRIVATE-SOURCE-CONTENT/u);
    await assert.rejects(() => stat(path.join(root, "uploads", "job-failure.zip")), { code: "ENOENT" });
    assert.equal(await service.getReview("review-failure"), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("early deletion removes active review access and is idempotent at the job boundary", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-review-service-delete-"));
  const scheduled: Array<() => Promise<void>> = [];
  try {
    const incoming = path.join(root, "incoming.zip");
    await writeFile(incoming, "ZIP", "utf8");
    const jobs = new FileSystemReviewJobStore(path.join(root, "jobs"), { now: () => new Date("2026-08-27T12:00:00.000Z") });
    const service = createReviewService({
      jobs, store: new FileSystemObjectStore(path.join(root, "objects")), uploadRoot: path.join(root, "uploads"),
      intakeWorkspaceRoot: path.join(root, "intake"), rehydratedWorkspaceRoot: path.join(root, "rehydrated"),
      now: () => new Date("2026-08-27T12:00:00.000Z"), createId: (kind) => `${kind}-1`, schedule: (work) => scheduled.push(work),
      runReview: async (input) => { await rm(input.archivePath); return completedReview(); },
    });
    await service.createReview({ uploadPath: incoming, byteSize: 3 });
    await scheduled[0]!();

    assert.deepEqual(await service.deleteReview("review-1"), { state: "deleted" });
    assert.deepEqual(await service.deleteReview("review-1"), { state: "deleted" });
    assert.equal((await jobs.get("job-1")).state, "deleted");
    assert.equal(await service.getReview("review-1"), null);
    await assert.rejects(() => service.answerQuestion("review-1", "Where?"), { code: "REVIEW_NOT_FOUND" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("expiry sweeping removes active review access while retaining body-free expired job metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-review-service-expiry-"));
  const scheduled: Array<() => Promise<void>> = [];
  let clock = new Date("2026-08-27T12:00:00.000Z");
  try {
    const incoming = path.join(root, "incoming.zip");
    await writeFile(incoming, "ZIP", "utf8");
    const jobs = new FileSystemReviewJobStore(path.join(root, "jobs"), { now: () => clock });
    const service = createReviewService({
      jobs, store: new FileSystemObjectStore(path.join(root, "objects")), uploadRoot: path.join(root, "uploads"),
      intakeWorkspaceRoot: path.join(root, "intake"), rehydratedWorkspaceRoot: path.join(root, "rehydrated"),
      now: () => clock, createId: (kind) => `${kind}-1`, schedule: (work) => scheduled.push(work),
      runReview: async (input) => { await rm(input.archivePath); return completedReview(); },
    });
    await service.createReview({ uploadPath: incoming, byteSize: 3 });
    await scheduled[0]!();
    clock = new Date("2026-08-29T13:00:00.000Z");

    assert.deepEqual(await service.purgeExpired(), { expiredJobIds: ["job-1"] });
    assert.equal((await jobs.get("job-1")).state, "expired");
    assert.equal(await service.getReview("review-1"), null);
    assert.deepEqual(await service.purgeExpired(), { expiredJobIds: [] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("expiry reconciliation retries an artifact left by a partial cleanup failure", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-review-service-reconcile-"));
  const scheduled: Array<() => Promise<void>> = [];
  let clock = new Date("2026-08-27T12:00:00.000Z");
  try {
    const incoming = path.join(root, "incoming.zip");
    await writeFile(incoming, "ZIP", "utf8");
    const artifactStore = new FileSystemReviewArtifactStore(path.join(root, "artifacts"), { now: () => clock });
    let failNextDelete = false;
    const artifacts = {
      save: artifactStore.save.bind(artifactStore),
      get: artifactStore.get.bind(artifactStore),
      listExpired: artifactStore.listExpired.bind(artifactStore),
      async delete(id: string) {
        if (failNextDelete) { failNextDelete = false; throw new Error("TRANSIENT_DELETE_FAILURE"); }
        await artifactStore.delete(id);
      },
    };
    const jobs = new FileSystemReviewJobStore(path.join(root, "jobs"), { now: () => clock });
    const service = createReviewService({
      jobs, artifacts, store: new FileSystemObjectStore(path.join(root, "objects")), uploadRoot: path.join(root, "uploads"),
      intakeWorkspaceRoot: path.join(root, "intake"), rehydratedWorkspaceRoot: path.join(root, "rehydrated"),
      now: () => clock, createId: (kind) => `${kind}-1`, schedule: (work) => scheduled.push(work),
      runReview: async (input) => { await rm(input.archivePath); return completedReview(); },
    });
    await service.createReview({ uploadPath: incoming, byteSize: 3 });
    await scheduled[0]!();
    clock = new Date("2026-08-29T13:00:00.000Z");
    failNextDelete = true;

    assert.deepEqual(await service.purgeExpired(), { expiredJobIds: ["job-1"] });
    await assert.rejects(() => artifactStore.get("review-1"), { code: "ARTIFACT_NOT_FOUND" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
