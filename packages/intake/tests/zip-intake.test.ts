import assert from "node:assert/strict";
import { access, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import yazl from "yazl";

import { ingestZipArchive, IntakePolicyError } from "../src/index.ts";

async function createZip(
  target: string,
  files: Record<string, string>,
  modes: Record<string, number> = {},
): Promise<void> {
  const archive = new yazl.ZipFile();
  for (const [name, content] of Object.entries(files)) {
    const mode = modes[name];
    archive.addBuffer(Buffer.from(content), name, mode === undefined ? undefined : { mode });
  }
  archive.end();
  const chunks: Buffer[] = [];
  for await (const chunk of archive.outputStream as Readable) chunks.push(Buffer.from(chunk));
  await writeFile(target, Buffer.concat(chunks));
}

async function replaceArchiveName(target: string, from: string, to: string): Promise<void> {
  assert.equal(Buffer.byteLength(from), Buffer.byteLength(to));
  const archive = await readFile(target);
  const source = Buffer.from(from);
  const replacement = Buffer.from(to);
  let offset = 0;
  let replacements = 0;
  while ((offset = archive.indexOf(source, offset)) !== -1) {
    replacement.copy(archive, offset);
    offset += replacement.length;
    replacements += 1;
  }
  assert.ok(replacements >= 2, "ZIP name should occur in local and central directory records");
  await writeFile(target, archive);
}

async function markArchiveEntriesEncrypted(target: string): Promise<void> {
  const archive = await readFile(target);
  for (const [signature, flagOffset] of [[0x04034b50, 6], [0x02014b50, 8]] as const) {
    let offset = 0;
    while (offset <= archive.length - 4) {
      offset = archive.indexOf(Buffer.from([
        signature & 0xff,
        (signature >>> 8) & 0xff,
        (signature >>> 16) & 0xff,
        (signature >>> 24) & 0xff,
      ]), offset);
      if (offset === -1) break;
      archive.writeUInt16LE(archive.readUInt16LE(offset + flagOffset) | 0x1, offset + flagOffset);
      offset += 4;
    }
  }
  await writeFile(target, archive);
}

async function replaceArchiveCrc(target: string, crc: number): Promise<void> {
  const archive = await readFile(target);
  for (const [signature, crcOffset] of [[0x04034b50, 14], [0x02014b50, 16]] as const) {
    const signatureBytes = Buffer.from([
      signature & 0xff,
      (signature >>> 8) & 0xff,
      (signature >>> 16) & 0xff,
      (signature >>> 24) & 0xff,
    ]);
    let offset = 0;
    while ((offset = archive.indexOf(signatureBytes, offset)) !== -1) {
      archive.writeUInt32LE(crc >>> 0, offset + crcOffset);
      offset += 4;
    }
  }
  await writeFile(target, archive);
}

test("a ZIP upload becomes an isolated inventory workspace and the raw archive is consumed", async () => {
  const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "cka-upload-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "cka-workspaces-"));
  const archivePath = path.join(uploadRoot, "repository.zip");
  await createZip(archivePath, {
    "example-main/README.md": "# Example\n",
    "example-main/src/main.ts": "export const answer = 42;\n",
  });

  const result = await ingestZipArchive(archivePath, workspaceRoot);

  assert.equal(path.dirname(result.workspacePath), workspaceRoot);
  assert.deepEqual(result.inventory.entries.map((entry) => entry.path), [
    "example-main/README.md",
    "example-main/src/main.ts",
  ]);
  assert.equal(await readFile(path.join(result.workspacePath, "example-main", "README.md"), "utf8"), "# Example\n");
  await assert.rejects(access(archivePath));

  await result.cleanup();
  await result.cleanup();
  await assert.rejects(access(result.workspacePath));
});

test("an archive path traversal is rejected before a review workspace is created", async () => {
  const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "cka-upload-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "cka-workspaces-"));
  const archivePath = path.join(uploadRoot, "repository.zip");
  await createZip(archivePath, { "safe.txt": "must not escape\n" });
  await replaceArchiveName(archivePath, "safe.txt", "../x.txt");

  await assert.rejects(
    ingestZipArchive(archivePath, workspaceRoot),
    (error: unknown) => error instanceof IntakePolicyError && error.code === "ARCHIVE_INVALID",
  );
  assert.deepEqual(await readdir(workspaceRoot), []);
  await assert.rejects(access(archivePath));
});

test("an archive exceeding the configured entry limit fails before extraction", async () => {
  const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "cka-upload-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "cka-workspaces-"));
  const archivePath = path.join(uploadRoot, "repository.zip");
  await createZip(archivePath, { "one.txt": "one\n", "two.txt": "two\n" });

  await assert.rejects(
    ingestZipArchive(archivePath, workspaceRoot, { maxEntries: 1 }),
    (error: unknown) => error instanceof IntakePolicyError && error.code === "ARCHIVE_ENTRY_COUNT_LIMIT",
  );
  assert.deepEqual(await readdir(workspaceRoot), []);
});

test("an oversized declared archive entry fails before extraction", async () => {
  const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "cka-upload-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "cka-workspaces-"));
  const archivePath = path.join(uploadRoot, "repository.zip");
  await createZip(archivePath, { "large.txt": "12345" });

  await assert.rejects(
    ingestZipArchive(archivePath, workspaceRoot, { maxEntryUncompressedBytes: 4 }),
    (error: unknown) => error instanceof IntakePolicyError && error.code === "ARCHIVE_ENTRY_SIZE_LIMIT" && error.path === "large.txt",
  );
  assert.deepEqual(await readdir(workspaceRoot), []);
});

test("excessive total declared archive bytes fail before extraction", async () => {
  const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "cka-upload-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "cka-workspaces-"));
  const archivePath = path.join(uploadRoot, "repository.zip");
  await createZip(archivePath, { "one.txt": "123", "two.txt": "456" });

  await assert.rejects(
    ingestZipArchive(archivePath, workspaceRoot, { maxTotalUncompressedBytes: 5 }),
    (error: unknown) => error instanceof IntakePolicyError && error.code === "ARCHIVE_TOTAL_SIZE_LIMIT",
  );
  assert.deepEqual(await readdir(workspaceRoot), []);
});

test("an excessive declared compression ratio is rejected as a decompression-bomb risk", async () => {
  const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "cka-upload-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "cka-workspaces-"));
  const archivePath = path.join(uploadRoot, "repository.zip");
  await createZip(archivePath, { "compressed.txt": "A".repeat(10_000) });

  await assert.rejects(
    ingestZipArchive(archivePath, workspaceRoot, { maxCompressionRatio: 2 }),
    (error: unknown) => error instanceof IntakePolicyError && error.code === "ARCHIVE_COMPRESSION_RATIO_LIMIT" && error.path === "compressed.txt",
  );
  assert.deepEqual(await readdir(workspaceRoot), []);
});

test("archive paths deeper than policy permits fail before extraction", async () => {
  const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "cka-upload-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "cka-workspaces-"));
  const archivePath = path.join(uploadRoot, "repository.zip");
  await createZip(archivePath, { "one/two/three.txt": "deep\n" });

  await assert.rejects(
    ingestZipArchive(archivePath, workspaceRoot, { maxPathDepth: 2 }),
    (error: unknown) => error instanceof IntakePolicyError && error.code === "ARCHIVE_PATH_DEPTH_LIMIT" && error.path === "one/two/three.txt",
  );
  assert.deepEqual(await readdir(workspaceRoot), []);
});

test("a symbolic-link archive entry is rejected before extraction", async () => {
  const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "cka-upload-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "cka-workspaces-"));
  const archivePath = path.join(uploadRoot, "repository.zip");
  await createZip(archivePath, { "linked.txt": "../outside.txt" }, { "linked.txt": 0o120777 });

  await assert.rejects(
    ingestZipArchive(archivePath, workspaceRoot),
    (error: unknown) => error instanceof IntakePolicyError && error.code === "ARCHIVE_SYMLINK_NOT_ALLOWED" && error.path === "linked.txt",
  );
  assert.deepEqual(await readdir(workspaceRoot), []);
});

test("case-colliding archive paths are rejected before extraction", async () => {
  const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "cka-upload-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "cka-workspaces-"));
  const archivePath = path.join(uploadRoot, "repository.zip");
  await createZip(archivePath, { "README.md": "one\n", "readme.md": "two\n" });

  await assert.rejects(
    ingestZipArchive(archivePath, workspaceRoot),
    (error: unknown) => error instanceof IntakePolicyError && error.code === "ARCHIVE_PATH_COLLISION" && error.path === "readme.md",
  );
  assert.deepEqual(await readdir(workspaceRoot), []);
});

test("encrypted archive entries are rejected before extraction", async () => {
  const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "cka-upload-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "cka-workspaces-"));
  const archivePath = path.join(uploadRoot, "repository.zip");
  await createZip(archivePath, { "secret.txt": "encrypted marker\n".repeat(100) });
  await markArchiveEntriesEncrypted(archivePath);

  await assert.rejects(
    ingestZipArchive(archivePath, workspaceRoot),
    (error: unknown) => error instanceof IntakePolicyError && error.code === "ARCHIVE_ENCRYPTED" && error.path === "secret.txt",
  );
  assert.deepEqual(await readdir(workspaceRoot), []);
});

test("an oversized raw ZIP upload is consumed without creating a workspace", async () => {
  const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "cka-upload-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "cka-workspaces-"));
  const archivePath = path.join(uploadRoot, "repository.zip");
  await createZip(archivePath, { "README.md": "content\n" });

  await assert.rejects(
    ingestZipArchive(archivePath, workspaceRoot, { maxArchiveBytes: 1 }),
    (error: unknown) => error instanceof IntakePolicyError && error.code === "ARCHIVE_SIZE_LIMIT",
  );
  assert.deepEqual(await readdir(workspaceRoot), []);
  await assert.rejects(access(archivePath));
});

test("ZIP intake applies configured inventory exclusions after safe extraction", async () => {
  const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "cka-upload-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "cka-workspaces-"));
  const archivePath = path.join(uploadRoot, "repository.zip");
  await createZip(archivePath, {
    "config/public.json": "{}\n",
    "config/private.json": "{\"token\":\"not-for-analysis\"}\n",
  });

  const result = await ingestZipArchive(archivePath, workspaceRoot, {
    inventoryPolicy: { sensitivePaths: ["config/private.json"] },
  });

  assert.equal(result.inventory.entries.find((entry) => entry.path === "config/public.json")?.eligibility, "eligible");
  assert.equal(result.inventory.entries.find((entry) => entry.path === "config/private.json")?.exclusion_reason, "sensitive");
  await result.cleanup();
});

test("a checksum mismatch removes partial extraction and consumes the raw archive", async () => {
  const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "cka-upload-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "cka-workspaces-"));
  const archivePath = path.join(uploadRoot, "repository.zip");
  await createZip(archivePath, { "README.md": "content whose checksum must match\n" });
  await replaceArchiveCrc(archivePath, 0);

  await assert.rejects(
    ingestZipArchive(archivePath, workspaceRoot),
    (error: unknown) => error instanceof IntakePolicyError && error.code === "ARCHIVE_CRC_MISMATCH" && error.path === "README.md",
  );
  assert.deepEqual(await readdir(workspaceRoot), []);
  await assert.rejects(access(archivePath));
});
