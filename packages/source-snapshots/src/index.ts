import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RepositoryInventory } from "@code-knowledge-assistant/intake";

export class SnapshotError extends Error {
  readonly code: string;
  readonly path: string | null;

  constructor(code: string, relativePath: string | null = null) {
    super(relativePath === null ? code : `${code}: ${relativePath}`);
    this.name = "SnapshotError";
    this.code = code;
    this.path = relativePath;
  }
}

export interface ObjectStore {
  putObject(key: string, data: Buffer, options?: { ifAbsent?: boolean }): Promise<void>;
  getObject(key: string): Promise<Buffer>;
  hasObject(key: string): Promise<boolean>;
  deleteObject(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
  listKeys(prefix: string): Promise<string[]>;
}

function validateObjectKey(key: string): string[] {
  if (!key || key.includes("\\") || path.posix.isAbsolute(key) || key.includes("\0")) {
    throw new SnapshotError("OBJECT_KEY_INVALID");
  }
  const segments = key.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new SnapshotError("OBJECT_KEY_INVALID");
  }
  return segments;
}

export class FileSystemObjectStore implements ObjectStore {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private target(key: string): string {
    return path.join(this.root, ...validateObjectKey(key));
  }

  async putObject(key: string, data: Buffer, options: { ifAbsent?: boolean } = {}): Promise<void> {
    const target = this.target(key);
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await writeFile(target, data, options.ifAbsent ? { flag: "wx", mode: 0o600 } : { mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new SnapshotError("OBJECT_EXISTS", key);
      throw error;
    }
  }

  async getObject(key: string): Promise<Buffer> {
    return readFile(this.target(key));
  }

  async hasObject(key: string): Promise<boolean> {
    try {
      return (await lstat(this.target(key))).isFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await unlink(this.target(key)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }

  async deletePrefix(prefix: string): Promise<void> {
    await rm(this.target(prefix), { recursive: true, force: true });
  }

  async listKeys(prefix: string): Promise<string[]> {
    const root = this.target(prefix);
    const keys: string[] = [];
    async function visit(directory: string): Promise<void> {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(target);
        if (entry.isFile()) keys.push(target);
      }
    }
    try {
      await visit(root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return keys.map((key) => path.relative(this.root, key).split(path.sep).join("/")).sort();
  }
}

export type SourceSnapshotManifest = {
  schema_version: 1;
  snapshot_id: string;
  created_at: string;
  expires_at: string;
  files: Array<{
    path: string;
    object_key: string;
    byte_size: number;
    sha256: string;
  }>;
  exclusions: Array<{
    path: string;
    reason: string;
  }>;
};

export type CreateSourceSnapshotInput = {
  snapshotId: string;
  sourceRoot: string;
  inventory: RepositoryInventory;
  store: ObjectStore;
  now?: () => Date;
};

function validateSnapshotId(snapshotId: string): void {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u.test(snapshotId)) {
    throw new SnapshotError("SNAPSHOT_ID_INVALID");
  }
}

function sourcePath(root: string, relativePath: string): string {
  if (path.posix.isAbsolute(relativePath) || relativePath.includes("\\")) {
    throw new SnapshotError("SNAPSHOT_PATH_INVALID", relativePath);
  }
  const segments = relativePath.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new SnapshotError("SNAPSHOT_PATH_INVALID", relativePath);
  }
  return path.join(root, ...segments);
}

export async function createSourceSnapshot(input: CreateSourceSnapshotInput): Promise<SourceSnapshotManifest> {
  validateSnapshotId(input.snapshotId);
  const sourceRoot = path.resolve(input.sourceRoot);
  const prefix = `snapshots/${input.snapshotId}`;
  const lockKey = `${prefix}/_write-lock`;
  const manifestKey = `${prefix}/manifest.json`;
  if (await input.store.hasObject(manifestKey)) throw new SnapshotError("SNAPSHOT_EXISTS");
  let ownsPrefix = false;
  try {
    try {
      await input.store.putObject(lockKey, Buffer.alloc(0), { ifAbsent: true });
    } catch (error) {
      if (error instanceof SnapshotError && error.code === "OBJECT_EXISTS") {
        throw new SnapshotError("SNAPSHOT_EXISTS");
      }
      throw error;
    }
    ownsPrefix = true;
    if (await input.store.hasObject(manifestKey)) {
      await input.store.deleteObject(lockKey);
      ownsPrefix = false;
      throw new SnapshotError("SNAPSHOT_EXISTS");
    }
    const files: SourceSnapshotManifest["files"] = [];
    for (const entry of input.inventory.entries.filter((candidate) => candidate.eligibility === "eligible")) {
      if (entry.byte_size === null || entry.sha256 === null) {
        throw new SnapshotError("INVENTORY_INCOMPLETE", entry.path);
      }
      const target = sourcePath(sourceRoot, entry.path);
      const metadata = await lstat(target);
      if (metadata.isSymbolicLink() || !metadata.isFile()) throw new SnapshotError("SOURCE_FILE_INVALID", entry.path);
      const data = await readFile(target);
      const digest = createHash("sha256").update(data).digest("hex");
      if (data.byteLength !== entry.byte_size || digest !== entry.sha256) {
        throw new SnapshotError("SOURCE_INTEGRITY_MISMATCH", entry.path);
      }
      const objectKey = `${prefix}/files/${createHash("sha256").update(entry.path).digest("hex")}`;
      await input.store.putObject(objectKey, data, { ifAbsent: true });
      files.push({ path: entry.path, object_key: objectKey, byte_size: data.byteLength, sha256: digest });
    }
    const createdAt = (input.now ?? (() => new Date()))();
    const manifest: SourceSnapshotManifest = {
      schema_version: 1,
      snapshot_id: input.snapshotId,
      created_at: createdAt.toISOString(),
      expires_at: new Date(createdAt.getTime() + 48 * 60 * 60 * 1000).toISOString(),
      files: files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
      exclusions: input.inventory.entries
        .filter((entry) => entry.eligibility === "excluded")
        .map((entry) => ({ path: entry.path, reason: entry.exclusion_reason ?? "excluded" }))
        .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
    };
    await input.store.putObject(manifestKey, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), { ifAbsent: true });
    await input.store.deleteObject(lockKey);
    return manifest;
  } catch (error) {
    if (ownsPrefix) await input.store.deletePrefix(prefix);
    throw error instanceof SnapshotError ? error : new SnapshotError("SNAPSHOT_WRITE_FAILED");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseManifest(data: Buffer, expectedSnapshotId: string): SourceSnapshotManifest {
  let value: unknown;
  try {
    value = JSON.parse(data.toString("utf8"));
  } catch {
    throw new SnapshotError("SNAPSHOT_MANIFEST_INVALID");
  }
  if (!isRecord(value) || value.schema_version !== 1 || value.snapshot_id !== expectedSnapshotId) {
    throw new SnapshotError("SNAPSHOT_MANIFEST_INVALID");
  }
  if (typeof value.created_at !== "string" || typeof value.expires_at !== "string") {
    throw new SnapshotError("SNAPSHOT_MANIFEST_INVALID");
  }
  const createdAt = Date.parse(value.created_at);
  const expiresAt = Date.parse(value.expires_at);
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || expiresAt <= createdAt) {
    throw new SnapshotError("SNAPSHOT_MANIFEST_INVALID");
  }
  if (!Array.isArray(value.files) || !Array.isArray(value.exclusions)) {
    throw new SnapshotError("SNAPSHOT_MANIFEST_INVALID");
  }

  const paths = new Set<string>();
  const objectKeys = new Set<string>();
  const files: SourceSnapshotManifest["files"] = value.files.map((candidate) => {
    if (!isRecord(candidate) || typeof candidate.path !== "string" || typeof candidate.object_key !== "string"
      || typeof candidate.byte_size !== "number" || !Number.isSafeInteger(candidate.byte_size) || candidate.byte_size < 0
      || typeof candidate.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(candidate.sha256)) {
      throw new SnapshotError("SNAPSHOT_MANIFEST_INVALID");
    }
    sourcePath(".", candidate.path);
    validateObjectKey(candidate.object_key);
    const expectedObjectKey = `snapshots/${expectedSnapshotId}/files/${createHash("sha256").update(candidate.path).digest("hex")}`;
    if (candidate.object_key !== expectedObjectKey || paths.has(candidate.path) || objectKeys.has(candidate.object_key)) {
      throw new SnapshotError("SNAPSHOT_MANIFEST_INVALID");
    }
    paths.add(candidate.path);
    objectKeys.add(candidate.object_key);
    return {
      path: candidate.path,
      object_key: candidate.object_key,
      byte_size: candidate.byte_size,
      sha256: candidate.sha256,
    };
  });
  const exclusions: SourceSnapshotManifest["exclusions"] = value.exclusions.map((candidate) => {
    if (!isRecord(candidate) || typeof candidate.path !== "string" || typeof candidate.reason !== "string") {
      throw new SnapshotError("SNAPSHOT_MANIFEST_INVALID");
    }
    sourcePath(".", candidate.path);
    if (paths.has(candidate.path)) throw new SnapshotError("SNAPSHOT_MANIFEST_INVALID");
    paths.add(candidate.path);
    return { path: candidate.path, reason: candidate.reason };
  });
  return {
    schema_version: 1,
    snapshot_id: expectedSnapshotId,
    created_at: value.created_at,
    expires_at: value.expires_at,
    files,
    exclusions,
  };
}

async function loadManifest(snapshotId: string, store: ObjectStore): Promise<SourceSnapshotManifest> {
  validateSnapshotId(snapshotId);
  const key = `snapshots/${snapshotId}/manifest.json`;
  try {
    return parseManifest(await store.getObject(key), snapshotId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new SnapshotError("SNAPSHOT_NOT_FOUND");
    throw error;
  }
}

export type RehydrateSourceSnapshotInput = {
  snapshotId: string;
  store: ObjectStore;
  workspaceRoot: string;
  now?: () => Date;
};

export type RehydratedSourceSnapshot = {
  workspacePath: string;
  manifest: SourceSnapshotManifest;
  cleanup: () => Promise<void>;
};

export async function rehydrateSourceSnapshot(
  input: RehydrateSourceSnapshotInput,
): Promise<RehydratedSourceSnapshot> {
  const manifest = await loadManifest(input.snapshotId, input.store);
  const now = (input.now ?? (() => new Date()))();
  if (now.getTime() >= Date.parse(manifest.expires_at)) throw new SnapshotError("SNAPSHOT_EXPIRED");

  const workspaceRoot = path.resolve(input.workspaceRoot);
  await mkdir(workspaceRoot, { recursive: true });
  const workspacePath = await mkdtemp(path.join(workspaceRoot, "snapshot-"));
  try {
    for (const file of manifest.files) {
      let data: Buffer;
      try {
        data = await input.store.getObject(file.object_key);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new SnapshotError("SNAPSHOT_OBJECT_MISSING", file.path);
        }
        throw error;
      }
      const digest = createHash("sha256").update(data).digest("hex");
      if (data.byteLength !== file.byte_size || digest !== file.sha256) {
        throw new SnapshotError("SNAPSHOT_OBJECT_INTEGRITY_MISMATCH", file.path);
      }
      const target = sourcePath(workspacePath, file.path);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, data, { flag: "wx", mode: 0o600 });
    }
  } catch (error) {
    await rm(workspacePath, { recursive: true, force: true });
    throw error instanceof SnapshotError ? error : new SnapshotError("SNAPSHOT_REHYDRATION_FAILED");
  }
  return {
    workspacePath,
    manifest,
    cleanup: async () => rm(workspacePath, { recursive: true, force: true }),
  };
}

export async function deleteSourceSnapshot(snapshotId: string, store: ObjectStore): Promise<void> {
  validateSnapshotId(snapshotId);
  await store.deletePrefix(`snapshots/${snapshotId}`);
}

export type PurgeExpiredSourceSnapshotsInput = {
  store: ObjectStore;
  now?: () => Date;
};

export type PurgeExpiredSourceSnapshotsResult = {
  deleted_snapshot_ids: string[];
  invalid_manifest_keys: string[];
};

export async function purgeExpiredSourceSnapshots(
  input: PurgeExpiredSourceSnapshotsInput,
): Promise<PurgeExpiredSourceSnapshotsResult> {
  const keys = await input.store.listKeys("snapshots");
  const manifestKeys = keys.filter((key) => /^snapshots\/[^/]+\/manifest\.json$/u.test(key)).sort();
  const deleted: string[] = [];
  const invalid: string[] = [];
  const now = (input.now ?? (() => new Date()))().getTime();
  for (const key of manifestKeys) {
    const snapshotId = key.split("/")[1]!;
    try {
      validateSnapshotId(snapshotId);
      const manifest = parseManifest(await input.store.getObject(key), snapshotId);
      if (now >= Date.parse(manifest.expires_at)) {
        await input.store.deletePrefix(`snapshots/${snapshotId}`);
        deleted.push(snapshotId);
      }
    } catch {
      invalid.push(key);
    }
  }
  return { deleted_snapshot_ids: deleted, invalid_manifest_keys: invalid };
}
