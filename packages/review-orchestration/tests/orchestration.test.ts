import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import yazl from "yazl";

import { inventoryRepository } from "@code-knowledge-assistant/intake";
import { FileSystemObjectStore } from "@code-knowledge-assistant/source-snapshots";
import { MaterializedReviewOrchestrationError, orchestrateMaterializedRepositoryReview, orchestrateZipRepositoryReview, ZipReviewOrchestrationError } from "../src/index.ts";

async function createZip(target: string, files: Record<string, string>): Promise<void> {
  const archive = new yazl.ZipFile();
  for (const [name, content] of Object.entries(files)) archive.addBuffer(Buffer.from(content), name);
  archive.end();
  const chunks: Buffer[] = [];
  for await (const chunk of archive.outputStream as Readable) chunks.push(Buffer.from(chunk));
  await writeFile(target, Buffer.concat(chunks));
}

async function withRoots(run: (roots: { upload: string; intake: string; rehydrated: string; objects: string }) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-orchestration-"));
  const roots = {
    upload: path.join(root, "upload"),
    intake: path.join(root, "intake"),
    rehydrated: path.join(root, "rehydrated"),
    objects: path.join(root, "objects"),
  };
  await Promise.all(Object.values(roots).map((directory) => mkdir(directory, { recursive: true })));
  try {
    await run(roots);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("a ZIP becomes a retained snapshot and a review from a disposable rehydrated workspace", async () => {
  await withRoots(async (roots) => {
    const archivePath = path.join(roots.upload, "repository.zip");
    await createZip(archivePath, {
      "src/server.ts": "export function startServer() { return 3000; }\n",
      ".env": "TOKEN=excluded\n",
    });
    const store = new FileSystemObjectStore(roots.objects);

    const result = await orchestrateZipRepositoryReview({
      archivePath,
      intakeWorkspaceRoot: roots.intake,
      rehydratedWorkspaceRoot: roots.rehydrated,
      store,
      snapshotId: "review-123",
      reviewId: "review-123",
      sourceRevision: "upload:review-123",
      generatedAt: "2026-08-27T12:00:00.000Z",
      now: () => new Date("2026-08-27T12:00:00.000Z"),
    });

    assert.deepEqual(result.snapshot, { id: "review-123", expires_at: "2026-08-29T12:00:00.000Z" });
    assert.equal(result.review.review.review_id, "review-123");
    assert.deepEqual(result.review.analysis.exclusions, [{ path: ".env", reason: "sensitive" }]);
    await assert.rejects(access(archivePath));
    assert.deepEqual(await readdir(roots.intake), []);
    assert.deepEqual(await readdir(roots.rehydrated), []);
    assert.equal(await store.hasObject("snapshots/review-123/manifest.json"), true);
  });
});

test("a safely materialized repository is snapshotted before its workspace is disposed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-materialized-review-"));
  const source = path.join(root, "source");
  const rehydrated = path.join(root, "rehydrated");
  const objects = path.join(root, "objects");
  await Promise.all([source, rehydrated, objects].map((directory) => mkdir(directory, { recursive: true })));
  try {
    await writeFile(path.join(source, "server.ts"), "export function startServer() { return 3000; }\n");
    const inventory = await inventoryRepository(source);
    const store = new FileSystemObjectStore(objects);
    let cleanupCalls = 0;

    const result = await orchestrateMaterializedRepositoryReview({
      sourceRoot: source,
      inventory,
      cleanup: async () => { cleanupCalls += 1; await rm(source, { recursive: true, force: true }); },
      rehydratedWorkspaceRoot: rehydrated,
      store,
      snapshotId: "materialized-123",
      reviewId: "materialized-123",
      sourceRevision: "commit:abc123",
      generatedAt: "2026-08-27T12:00:00.000Z",
      now: () => new Date("2026-08-27T12:00:00.000Z"),
    });

    assert.equal(cleanupCalls, 1);
    await assert.rejects(access(source));
    assert.deepEqual(await readdir(rehydrated), []);
    assert.equal(result.review.review.source_revision, "commit:abc123");
    assert.equal(await store.hasObject("snapshots/materialized-123/manifest.json"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a materialized cleanup failure rolls back the newly created snapshot exactly once", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-materialized-review-"));
  const source = path.join(root, "source");
  const rehydrated = path.join(root, "rehydrated");
  const objects = path.join(root, "objects");
  await Promise.all([source, rehydrated, objects].map((directory) => mkdir(directory, { recursive: true })));
  try {
    await writeFile(path.join(source, "server.ts"), "export const port = 3000;\n");
    const store = new FileSystemObjectStore(objects);
    let cleanupCalls = 0;
    await assert.rejects(
      orchestrateMaterializedRepositoryReview({
        sourceRoot: source,
        inventory: await inventoryRepository(source),
        cleanup: async () => { cleanupCalls += 1; throw new Error("cleanup failed"); },
        rehydratedWorkspaceRoot: rehydrated,
        store,
        snapshotId: "cleanup-failure",
        reviewId: "cleanup-failure",
        sourceRevision: "commit:abc123",
        generatedAt: "2026-08-27T12:00:00.000Z",
      }),
      (error: unknown) => error instanceof MaterializedReviewOrchestrationError
        && error.code === "MATERIALIZED_REVIEW_CLEANUP_FAILED"
        && !error.message.includes("cleanup failed"),
    );
    assert.equal(cleanupCalls, 1);
    assert.deepEqual(await store.listKeys("snapshots"), []);
    assert.deepEqual(await readdir(rehydrated), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("empty evidence rolls back the snapshot and removes every temporary workspace", async () => {
  await withRoots(async (roots) => {
    const archivePath = path.join(roots.upload, "repository.zip");
    await createZip(archivePath, { ".env": "TOKEN=excluded\n" });
    const store = new FileSystemObjectStore(roots.objects);

    await assert.rejects(
      orchestrateZipRepositoryReview({
        archivePath,
        intakeWorkspaceRoot: roots.intake,
        rehydratedWorkspaceRoot: roots.rehydrated,
        store,
        snapshotId: "empty-review",
        reviewId: "empty-review",
        sourceRevision: "upload:empty-review",
        generatedAt: "2026-08-27T12:00:00.000Z",
      }),
      (error: unknown) => error instanceof ZipReviewOrchestrationError && error.code === "ZIP_REVIEW_EVIDENCE_EMPTY",
    );

    await assert.rejects(access(archivePath));
    assert.deepEqual(await readdir(roots.intake), []);
    assert.deepEqual(await readdir(roots.rehydrated), []);
    assert.deepEqual(await store.listKeys("snapshots"), []);
  });
});

test("an expired rehydration is reported without retaining the failed review snapshot", async () => {
  await withRoots(async (roots) => {
    const archivePath = path.join(roots.upload, "repository.zip");
    await createZip(archivePath, { "main.ts": "export const answer = 42;\n" });
    const store = new FileSystemObjectStore(roots.objects);
    const times = [new Date("2026-08-27T12:00:00.000Z"), new Date("2026-08-30T12:00:00.000Z")];

    await assert.rejects(
      orchestrateZipRepositoryReview({
        archivePath,
        intakeWorkspaceRoot: roots.intake,
        rehydratedWorkspaceRoot: roots.rehydrated,
        store,
        snapshotId: "expired-review",
        reviewId: "expired-review",
        sourceRevision: "upload:expired-review",
        generatedAt: "2026-08-27T12:00:00.000Z",
        now: () => times.shift() ?? new Date("2026-08-30T12:00:00.000Z"),
      }),
      (error: unknown) => error instanceof ZipReviewOrchestrationError && error.code === "ZIP_REVIEW_SNAPSHOT_EXPIRED",
    );

    assert.deepEqual(await readdir(roots.intake), []);
    assert.deepEqual(await readdir(roots.rehydrated), []);
    assert.deepEqual(await store.listKeys("snapshots"), []);
  });
});

test("source drift between inventory and snapshot creation is body-free and cleaned up", async () => {
  await withRoots(async (roots) => {
    const archivePath = path.join(roots.upload, "repository.zip");
    await createZip(archivePath, { "main.ts": "export const answer = 42;\n" });
    const store = new FileSystemObjectStore(roots.objects);
    const putObject = store.putObject.bind(store);
    store.putObject = async (key, data, options) => {
      if (key.endsWith("/_write-lock")) {
        const [workspace] = await readdir(roots.intake);
        await writeFile(path.join(roots.intake, workspace!, "main.ts"), "export const answer = 43;\n");
      }
      await putObject(key, data, options);
    };

    await assert.rejects(
      orchestrateZipRepositoryReview({
        archivePath,
        intakeWorkspaceRoot: roots.intake,
        rehydratedWorkspaceRoot: roots.rehydrated,
        store,
        snapshotId: "drifted-review",
        reviewId: "drifted-review",
        sourceRevision: "upload:drifted-review",
        generatedAt: "2026-08-27T12:00:00.000Z",
      }),
      (error: unknown) => error instanceof ZipReviewOrchestrationError
        && error.code === "ZIP_REVIEW_SOURCE_DRIFTED"
        && !error.message.includes("answer"),
    );

    await assert.rejects(access(archivePath));
    assert.deepEqual(await readdir(roots.intake), []);
    assert.deepEqual(await readdir(roots.rehydrated), []);
    assert.deepEqual(await store.listKeys("snapshots"), []);
  });
});
