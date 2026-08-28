import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { FileSystemReviewJobStore, JobStoreError } from "../src/index.ts";

const capabilitySummary = {
  eligible_files: 2,
  analyzed_files: 2,
  excluded_files: 1,
  languages: [{ language: "typescript", tier: "structured" as const, eligible_files: 2, analyzed_files: 2, failed_files: 0 }],
};

test("a queued job survives a filesystem-store restart without source content", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-review-jobs-"));
  try {
    const first = new FileSystemReviewJobStore(root, { now: () => new Date("2026-08-27T12:00:00.000Z") });
    const created = await first.create({
      id: "review-123",
      snapshot_id: "snapshot-123",
      expires_at: "2026-08-29T12:00:00.000Z",
    });
    const restarted = new FileSystemReviewJobStore(root);

    assert.deepEqual(await restarted.get("review-123"), created);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a ready job can be recovered by its review id after restart", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-jobs-lookup-"));
  try {
    const clock = new Date("2026-08-27T12:00:00.000Z");
    const first = new FileSystemReviewJobStore(root, { now: () => clock });
    const created = await first.create({ id: "job-lookup", snapshot_id: "snapshot-lookup", expires_at: "2026-08-27T13:00:00.000Z" });
    const processing = await first.transition(created.id, created.version, { state: "processing" });
    await first.transition(processing.id, processing.version, {
      state: "ready",
      review_id: "review-lookup",
      expires_at: "2026-08-29T12:00:00.000Z",
      capability_summary: { eligible_files: 1, analyzed_files: 1, excluded_files: 0, languages: [] },
    });
    const restarted = new FileSystemReviewJobStore(root);
    assert.equal((await restarted.findByReviewId("review-lookup"))?.id, "job-lookup");
    assert.equal(await restarted.findByReviewId("review-missing"), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("transitions compare versions and reject stale or invalid lifecycle changes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-review-jobs-"));
  try {
    const store = new FileSystemReviewJobStore(root, { now: () => new Date("2026-08-27T12:00:00.000Z") });
    const created = await store.create({ id: "review-456", snapshot_id: "snapshot-456", expires_at: "2026-08-29T12:00:00.000Z" });
    const processing = await store.transition(created.id, created.version, { state: "processing" });
    const ready = await store.transition(processing.id, processing.version, {
      state: "ready", review_id: "review-output-456", capability_summary: capabilitySummary,
      expires_at: "2026-08-29T12:30:00.000Z",
    });

    assert.equal(ready.version, 3);
    assert.equal(ready.expires_at, "2026-08-29T12:30:00.000Z");
    await assert.rejects(
      store.transition(created.id, created.version, { state: "failed", error: { code: "REVIEW_FAILED" } }),
      (error: unknown) => error instanceof JobStoreError && error.code === "JOB_VERSION_CONFLICT",
    );
    await assert.rejects(
      store.transition(ready.id, ready.version, { state: "processing" }),
      (error: unknown) => error instanceof JobStoreError && error.code === "JOB_TRANSITION_INVALID",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("only a ready transition can replace the processing deadline with the review retention deadline", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-review-jobs-"));
  try {
    const store = new FileSystemReviewJobStore(root, { now: () => new Date("2026-08-27T12:00:00.000Z") });
    const created = await store.create({ id: "review-deadline", snapshot_id: "snapshot-deadline", expires_at: "2026-08-27T13:00:00.000Z" });
    await assert.rejects(
      store.transition(created.id, created.version, { state: "processing", expires_at: "2026-08-29T12:00:00.000Z" } as never),
      (error: unknown) => error instanceof JobStoreError && error.code === "JOB_INPUT_INVALID",
    );
    const processing = await store.transition(created.id, created.version, { state: "processing" });
    await assert.rejects(
      store.transition(processing.id, processing.version, {
        state: "ready", review_id: "review-output-deadline", capability_summary: capabilitySummary,
        expires_at: "2026-08-27T12:00:00.000Z",
      }),
      (error: unknown) => error instanceof JobStoreError && error.code === "JOB_INPUT_INVALID",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persisted records reject corruption and unknown fields while containing no source bodies", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-review-jobs-"));
  try {
    const store = new FileSystemReviewJobStore(root, { now: () => new Date("2026-08-27T12:00:00.000Z") });
    await assert.rejects(
      store.create({ id: "review-unsafe", snapshot_id: "snapshot-unsafe", expires_at: "2026-08-29T12:00:00.000Z", source_body: "secret" } as never),
      (error: unknown) => error instanceof JobStoreError && error.code === "JOB_INPUT_INVALID",
    );
    await store.create({ id: "review-safe", snapshot_id: "snapshot-safe", expires_at: "2026-08-29T12:00:00.000Z" });
    const recordPath = path.join(root, "jobs", "review-safe.json");
    const stored = await readFile(recordPath, "utf8");
    assert.equal(stored.includes("source_body"), false);
    assert.equal(stored.includes("secret"), false);
    await writeFile(recordPath, `${stored.trimEnd().slice(0, -1)},"unexpected":true}`);

    await assert.rejects(
      store.get("review-safe"),
      (error: unknown) => error instanceof JobStoreError && error.code === "JOB_SCHEMA_INVALID",
    );
    await writeFile(recordPath, "not-json");
    await assert.rejects(
      store.get("review-safe"),
      (error: unknown) => error instanceof JobStoreError && error.code === "JOB_CORRUPT",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("expiry discovery ignores deleted tombstones and deletion is idempotent", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-review-jobs-"));
  try {
    const store = new FileSystemReviewJobStore(root, { now: () => new Date("2026-08-27T12:00:00.000Z") });
    await store.create({ id: "review-expiring", snapshot_id: "snapshot-expiring", expires_at: "2026-08-28T12:00:00.000Z" });

    assert.deepEqual((await store.listExpired(new Date("2026-08-28T12:00:00.000Z"))).map((job) => job.id), ["review-expiring"]);
    const deleted = await store.delete("review-expiring");
    const repeated = await store.delete("review-expiring");
    assert.equal(deleted.state, "deleted");
    assert.deepEqual(repeated, deleted);
    assert.deepEqual(await store.listExpired(new Date("2026-08-30T12:00:00.000Z")), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("expiry discovery does not re-offer a job already transitioned to expired", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-review-jobs-"));
  try {
    const store = new FileSystemReviewJobStore(root, { now: () => new Date("2026-08-27T12:00:00.000Z") });
    const job = await store.create({ id: "review-expired", snapshot_id: "snapshot-expired", expires_at: "2026-08-28T12:00:00.000Z" });
    await store.transition(job.id, job.version, { state: "expired" });

    assert.deepEqual(await store.listExpired(new Date("2026-08-30T12:00:00.000Z")), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("opaque identifiers cannot escape the filesystem-backed job namespace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-review-jobs-"));
  try {
    const store = new FileSystemReviewJobStore(root);
    await assert.rejects(
      store.get("../escape"),
      (error: unknown) => error instanceof JobStoreError && error.code === "JOB_ID_INVALID",
    );
    await assert.rejects(
      store.create({ id: "../escape", snapshot_id: "snapshot-safe", expires_at: "2026-08-29T12:00:00.000Z" }),
      (error: unknown) => error instanceof JobStoreError && error.code === "JOB_INPUT_INVALID",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
