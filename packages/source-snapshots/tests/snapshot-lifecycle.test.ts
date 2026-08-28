import assert from "node:assert/strict";
import { access, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { inventoryRepository } from "../../intake/src/index.ts";
import {
  createSourceSnapshot,
  deleteSourceSnapshot,
  FileSystemObjectStore,
  purgeExpiredSourceSnapshots,
  rehydrateSourceSnapshot,
  SnapshotError,
} from "../src/index.ts";

async function readAllFiles(root: string): Promise<Buffer[]> {
  const contents: Buffer[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      if (entry.isFile()) contents.push(await readFile(target));
    }
  }
  await visit(root);
  return contents;
}

test("a source snapshot persists eligible bytes and an exclusion manifest without sensitive bodies", async () => {
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "cka-source-"));
  const objectRoot = await mkdtemp(path.join(os.tmpdir(), "cka-objects-"));
  await writeFile(path.join(sourceRoot, "README.md"), "# Example\n");
  await writeFile(path.join(sourceRoot, ".env"), "API_TOKEN=must-not-persist\n");
  const inventory = await inventoryRepository(sourceRoot);
  const store = new FileSystemObjectStore(objectRoot);

  const manifest = await createSourceSnapshot({
    snapshotId: "review-123",
    sourceRoot,
    inventory,
    store,
    now: () => new Date("2026-08-26T12:00:00Z"),
  });

  assert.equal(manifest.created_at, "2026-08-26T12:00:00.000Z");
  assert.equal(manifest.expires_at, "2026-08-28T12:00:00.000Z");
  assert.deepEqual(manifest.files.map((file) => file.path), ["README.md"]);
  assert.deepEqual(manifest.exclusions, [{ path: ".env", reason: "sensitive" }]);
  const stored = Buffer.concat(await readAllFiles(objectRoot)).toString("utf8");
  assert.match(stored, /# Example/);
  assert.doesNotMatch(stored, /must-not-persist/);
});

test("source drift aborts the snapshot and rolls back its object prefix", async () => {
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "cka-source-"));
  const objectRoot = await mkdtemp(path.join(os.tmpdir(), "cka-objects-"));
  const sourcePath = path.join(sourceRoot, "index.ts");
  await writeFile(sourcePath, "export const answer = 42;\n");
  const inventory = await inventoryRepository(sourceRoot);
  await writeFile(sourcePath, "export const answer = 43;\n");
  const store = new FileSystemObjectStore(objectRoot);

  await assert.rejects(
    createSourceSnapshot({ snapshotId: "drifted", sourceRoot, inventory, store }),
    (error: unknown) => error instanceof SnapshotError && error.code === "SOURCE_INTEGRITY_MISMATCH",
  );
  assert.deepEqual(await store.listKeys("snapshots"), []);
});

test("an active snapshot rehydrates eligible files into an isolated workspace and cleans up idempotently", async () => {
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "cka-source-"));
  const objectRoot = await mkdtemp(path.join(os.tmpdir(), "cka-objects-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "cka-workspaces-"));
  await writeFile(path.join(sourceRoot, "main.py"), "print('hello')\n");
  await writeFile(path.join(sourceRoot, ".env"), "TOKEN=not-in-workspace\n");
  const inventory = await inventoryRepository(sourceRoot);
  const store = new FileSystemObjectStore(objectRoot);
  await createSourceSnapshot({
    snapshotId: "rehydrate-me",
    sourceRoot,
    inventory,
    store,
    now: () => new Date("2026-08-26T12:00:00Z"),
  });

  const rehydrated = await rehydrateSourceSnapshot({
    snapshotId: "rehydrate-me",
    store,
    workspaceRoot,
    now: () => new Date("2026-08-27T12:00:00Z"),
  });

  assert.equal(await readFile(path.join(rehydrated.workspacePath, "main.py"), "utf8"), "print('hello')\n");
  await assert.rejects(access(path.join(rehydrated.workspacePath, ".env")));
  await rehydrated.cleanup();
  await rehydrated.cleanup();
  await assert.rejects(access(rehydrated.workspacePath));
});

test("an expired snapshot is rejected before a workspace is created", async () => {
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "cka-source-"));
  const objectRoot = await mkdtemp(path.join(os.tmpdir(), "cka-objects-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "cka-workspaces-"));
  await writeFile(path.join(sourceRoot, "README.md"), "active briefly\n");
  const store = new FileSystemObjectStore(objectRoot);
  await createSourceSnapshot({
    snapshotId: "expired",
    sourceRoot,
    inventory: await inventoryRepository(sourceRoot),
    store,
    now: () => new Date("2026-08-26T12:00:00Z"),
  });

  await assert.rejects(
    rehydrateSourceSnapshot({
      snapshotId: "expired",
      store,
      workspaceRoot,
      now: () => new Date("2026-08-28T12:00:00Z"),
    }),
    (error: unknown) => error instanceof SnapshotError && error.code === "SNAPSHOT_EXPIRED",
  );
  assert.deepEqual(await readdir(workspaceRoot), []);
});

test("object drift aborts rehydration and removes the partial workspace", async () => {
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "cka-source-"));
  const objectRoot = await mkdtemp(path.join(os.tmpdir(), "cka-objects-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "cka-workspaces-"));
  await writeFile(path.join(sourceRoot, "a.ts"), "export const a = 1;\n");
  await writeFile(path.join(sourceRoot, "b.ts"), "export const b = 2;\n");
  const store = new FileSystemObjectStore(objectRoot);
  const manifest = await createSourceSnapshot({
    snapshotId: "object-drift",
    sourceRoot,
    inventory: await inventoryRepository(sourceRoot),
    store,
    now: () => new Date("2026-08-26T12:00:00Z"),
  });
  await store.putObject(manifest.files[1]!.object_key, Buffer.from("changed\n"));

  await assert.rejects(
    rehydrateSourceSnapshot({
      snapshotId: "object-drift",
      store,
      workspaceRoot,
      now: () => new Date("2026-08-27T12:00:00Z"),
    }),
    (error: unknown) => error instanceof SnapshotError && error.code === "SNAPSHOT_OBJECT_INTEGRITY_MISMATCH",
  );
  assert.deepEqual(await readdir(workspaceRoot), []);
});

test("explicit deletion is idempotent", async () => {
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "cka-source-"));
  const objectRoot = await mkdtemp(path.join(os.tmpdir(), "cka-objects-"));
  await writeFile(path.join(sourceRoot, "README.md"), "delete me\n");
  const store = new FileSystemObjectStore(objectRoot);
  await createSourceSnapshot({
    snapshotId: "delete-me",
    sourceRoot,
    inventory: await inventoryRepository(sourceRoot),
    store,
  });

  await deleteSourceSnapshot("delete-me", store);
  await deleteSourceSnapshot("delete-me", store);
  assert.deepEqual(await store.listKeys("snapshots"), []);
});

test("expiry sweeping deletes expired snapshots and reports malformed manifests without deleting them", async () => {
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "cka-source-"));
  const objectRoot = await mkdtemp(path.join(os.tmpdir(), "cka-objects-"));
  await writeFile(path.join(sourceRoot, "README.md"), "retained source\n");
  const inventory = await inventoryRepository(sourceRoot);
  const store = new FileSystemObjectStore(objectRoot);
  await createSourceSnapshot({
    snapshotId: "old-review",
    sourceRoot,
    inventory,
    store,
    now: () => new Date("2026-08-20T12:00:00Z"),
  });
  await createSourceSnapshot({
    snapshotId: "active-review",
    sourceRoot,
    inventory,
    store,
    now: () => new Date("2026-08-26T12:00:00Z"),
  });
  await store.putObject("snapshots/broken/manifest.json", Buffer.from("not-json"));

  const result = await purgeExpiredSourceSnapshots({
    store,
    now: () => new Date("2026-08-27T12:00:00Z"),
  });

  assert.deepEqual(result.deleted_snapshot_ids, ["old-review"]);
  assert.deepEqual(result.invalid_manifest_keys, ["snapshots/broken/manifest.json"]);
  assert.equal(await store.hasObject("snapshots/old-review/manifest.json"), false);
  assert.equal(await store.hasObject("snapshots/active-review/manifest.json"), true);
  assert.equal(await store.hasObject("snapshots/broken/manifest.json"), true);
});

test("unsafe snapshot identifiers and object keys are rejected with stable errors", async () => {
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "cka-source-"));
  const objectRoot = await mkdtemp(path.join(os.tmpdir(), "cka-objects-"));
  const store = new FileSystemObjectStore(objectRoot);
  await assert.rejects(
    createSourceSnapshot({
      snapshotId: "../escape",
      sourceRoot,
      inventory: await inventoryRepository(sourceRoot),
      store,
    }),
    (error: unknown) => error instanceof SnapshotError && error.code === "SNAPSHOT_ID_INVALID",
  );
  await assert.rejects(
    store.putObject("../escape", Buffer.alloc(0)),
    (error: unknown) => error instanceof SnapshotError && error.code === "OBJECT_KEY_INVALID",
  );
});

test("completed snapshots are immutable and malformed path collisions cannot be rehydrated", async () => {
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "cka-source-"));
  const objectRoot = await mkdtemp(path.join(os.tmpdir(), "cka-objects-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "cka-workspaces-"));
  await writeFile(path.join(sourceRoot, "index.js"), "export default 1;\n");
  const inventory = await inventoryRepository(sourceRoot);
  const store = new FileSystemObjectStore(objectRoot);
  const manifest = await createSourceSnapshot({
    snapshotId: "immutable",
    sourceRoot,
    inventory,
    store,
    now: () => new Date("2026-08-26T12:00:00Z"),
  });

  await assert.rejects(
    createSourceSnapshot({ snapshotId: "immutable", sourceRoot, inventory, store }),
    (error: unknown) => error instanceof SnapshotError && error.code === "SNAPSHOT_EXISTS",
  );
  assert.equal(await store.getObject(manifest.files[0]!.object_key).then((data) => data.toString()), "export default 1;\n");

  const malformed = { ...manifest, files: [manifest.files[0], manifest.files[0]] };
  await store.putObject("snapshots/immutable/manifest.json", Buffer.from(JSON.stringify(malformed)));
  await assert.rejects(
    rehydrateSourceSnapshot({
      snapshotId: "immutable",
      store,
      workspaceRoot,
      now: () => new Date("2026-08-27T12:00:00Z"),
    }),
    (error: unknown) => error instanceof SnapshotError && error.code === "SNAPSHOT_MANIFEST_INVALID",
  );
  assert.deepEqual(await readdir(workspaceRoot), []);
});
