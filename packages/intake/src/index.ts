import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { crc32 } from "node:zlib";

import { openPromise, type Entry, type ZipFile } from "yauzl";

export type InventoryEntry = {
  kind: "file" | "directory";
  path: string;
  byte_size: number | null;
  sha256: string | null;
  line_count: number | null;
  eligibility: "eligible" | "excluded";
  exclusion_reason: string | null;
};

export type RepositoryInventory = {
  entries: InventoryEntry[];
  summary: {
    discovered_files: number;
    eligible_files: number;
    excluded_files: number;
    excluded_directories: number;
    total_bytes: number;
  };
};

export type InventoryPolicy = {
  maxFiles: number;
  maxAnalyzedFileBytes: number;
  maxAnalyzedBytes: number;
  sensitivePaths: string[];
};

const DEFAULT_POLICY: InventoryPolicy = Object.freeze({
  maxFiles: 10_000,
  maxAnalyzedFileBytes: 1024 * 1024,
  maxAnalyzedBytes: 50 * 1024 * 1024,
  sensitivePaths: [],
});

export class IntakePolicyError extends Error {
  readonly code: string;
  readonly path: string | null;

  constructor(code: string, relativePath: string | null = null) {
    super(relativePath === null ? code : `${code}: ${relativePath}`);
    this.name = "IntakePolicyError";
    this.code = code;
    this.path = relativePath;
  }
}

export type ZipIntakeResult = {
  workspacePath: string;
  inventory: RepositoryInventory;
  cleanup: () => Promise<void>;
};

export type ZipIntakePolicy = {
  maxArchiveBytes: number;
  maxEntries: number;
  maxEntryUncompressedBytes: number;
  maxTotalUncompressedBytes: number;
  maxCompressionRatio: number;
  maxPathDepth: number;
  inventoryPolicy: Partial<InventoryPolicy>;
};

const DEFAULT_ZIP_POLICY: ZipIntakePolicy = Object.freeze({
  maxArchiveBytes: 50 * 1024 * 1024,
  maxEntries: 10_000,
  maxEntryUncompressedBytes: 250 * 1024 * 1024,
  maxTotalUncompressedBytes: 250 * 1024 * 1024,
  maxCompressionRatio: 100,
  maxPathDepth: 12,
  inventoryPolicy: {},
});

function validateArchivePath(entry: Entry, policy: ZipIntakePolicy): void {
  const name = entry.fileName;
  const withoutTrailingSlash = name.endsWith("/") ? name.slice(0, -1) : name;
  const segments = withoutTrailingSlash.split("/");
  const invalidSegment = segments.some((segment) =>
    segment === "" || segment === "." || segment === ".." ||
    /[<>:"|?*\u0000-\u001f]/u.test(segment) || /[. ]$/u.test(segment)
  );
  if (
    name.includes("\\") || path.posix.isAbsolute(name) || /^[a-zA-Z]:/u.test(name) ||
    invalidSegment
  ) {
    throw new IntakePolicyError("ARCHIVE_PATH_INVALID", name);
  }
  if (segments.length > policy.maxPathDepth) {
    throw new IntakePolicyError("ARCHIVE_PATH_DEPTH_LIMIT", name);
  }
}

function validateArchiveEntryType(entry: Entry): void {
  if (entry.isEncrypted()) throw new IntakePolicyError("ARCHIVE_ENCRYPTED", entry.fileName);
  if (!entry.canDecodeFileData()) {
    throw new IntakePolicyError("ARCHIVE_UNSUPPORTED_COMPRESSION", entry.fileName);
  }
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  const fileType = mode & 0o170000;
  if (fileType === 0o120000) {
    throw new IntakePolicyError("ARCHIVE_SYMLINK_NOT_ALLOWED", entry.fileName);
  }
  if (fileType !== 0 && fileType !== 0o100000 && fileType !== 0o040000) {
    throw new IntakePolicyError("ARCHIVE_SPECIAL_FILE_NOT_ALLOWED", entry.fileName);
  }
}

function validateArchivePathCollisions(entries: Entry[]): void {
  const paths = new Map<string, "file" | "directory">();
  for (const entry of entries) {
    const normalized = (entry.fileName.endsWith("/") ? entry.fileName.slice(0, -1) : entry.fileName)
      .normalize("NFC")
      .toLowerCase();
    if (paths.has(normalized)) throw new IntakePolicyError("ARCHIVE_PATH_COLLISION", entry.fileName);
    paths.set(normalized, entry.fileName.endsWith("/") ? "directory" : "file");
  }
  for (const entry of entries) {
    const normalized = (entry.fileName.endsWith("/") ? entry.fileName.slice(0, -1) : entry.fileName)
      .normalize("NFC")
      .toLowerCase();
    const segments = normalized.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      if (paths.get(segments.slice(0, index).join("/")) === "file") {
        throw new IntakePolicyError("ARCHIVE_PATH_COLLISION", entry.fileName);
      }
    }
  }
}

async function collectZipEntries(zipFile: ZipFile, maxEntries: number): Promise<Entry[]> {
  const entries: Entry[] = [];
  for await (const entry of zipFile.eachEntry()) {
    if (entries.length >= maxEntries) throw new IntakePolicyError("ARCHIVE_ENTRY_COUNT_LIMIT");
    entries.push(entry);
  }
  return entries;
}

export async function ingestZipArchive(
  archivePath: string,
  workspaceRoot: string,
  policyOverrides: Partial<ZipIntakePolicy> = {},
): Promise<ZipIntakeResult> {
  let workspacePath: string | null = null;
  let zipFile: ZipFile | null = null;
  try {
    const policy = { ...DEFAULT_ZIP_POLICY, ...policyOverrides };
    const archiveMetadata = await lstat(archivePath);
    if (archiveMetadata.isSymbolicLink()) throw new IntakePolicyError("ARCHIVE_SYMLINK_NOT_ALLOWED");
    if (!archiveMetadata.isFile()) throw new IntakePolicyError("ARCHIVE_INVALID");
    if (archiveMetadata.size > policy.maxArchiveBytes) throw new IntakePolicyError("ARCHIVE_SIZE_LIMIT");
    zipFile = await openPromise(archivePath, {
      autoClose: false,
      lazyEntries: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });
    if (zipFile.entryCount > policy.maxEntries) throw new IntakePolicyError("ARCHIVE_ENTRY_COUNT_LIMIT");
    const entries = await collectZipEntries(zipFile, policy.maxEntries);
    for (const entry of entries) {
      validateArchivePath(entry, policy);
      validateArchiveEntryType(entry);
    }
    validateArchivePathCollisions(entries);
    const oversizedEntry = entries.find((entry) => entry.uncompressedSize > policy.maxEntryUncompressedBytes);
    if (oversizedEntry) throw new IntakePolicyError("ARCHIVE_ENTRY_SIZE_LIMIT", oversizedEntry.fileName);
    const totalUncompressedBytes = entries.reduce((total, entry) => total + entry.uncompressedSize, 0);
    if (totalUncompressedBytes > policy.maxTotalUncompressedBytes) {
      throw new IntakePolicyError("ARCHIVE_TOTAL_SIZE_LIMIT");
    }
    const excessiveRatio = entries.find((entry) =>
      entry.uncompressedSize > 0 && entry.uncompressedSize / Math.max(entry.compressedSize, 1) > policy.maxCompressionRatio
    );
    if (excessiveRatio) throw new IntakePolicyError("ARCHIVE_COMPRESSION_RATIO_LIMIT", excessiveRatio.fileName);
    workspacePath = await mkdtemp(path.join(path.resolve(workspaceRoot), "review-"));
    for (const entry of entries) {
      const target = path.join(workspacePath, ...entry.fileName.split("/"));
      if (entry.fileName.endsWith("/")) {
        await mkdir(target, { recursive: true });
        continue;
      }
      await mkdir(path.dirname(target), { recursive: true });
      const source = await zipFile.openReadStreamPromise(entry);
      let checksum = 0;
      const checksumStream = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          checksum = crc32(chunk, checksum);
          callback(null, chunk);
        },
      });
      await pipeline(source, checksumStream, createWriteStream(target, { flags: "wx", mode: 0o600 }));
      if ((checksum >>> 0) !== (entry.crc32 >>> 0)) {
        throw new IntakePolicyError("ARCHIVE_CRC_MISMATCH", entry.fileName);
      }
    }
    zipFile.close();
    zipFile = null;
    const inventory = await inventoryRepository(workspacePath, policy.inventoryPolicy);
    const retainedWorkspace = workspacePath;
    return {
      workspacePath: retainedWorkspace,
      inventory,
      cleanup: async () => rm(retainedWorkspace, { recursive: true, force: true }),
    };
  } catch (error) {
    zipFile?.close();
    if (workspacePath !== null) await rm(workspacePath, { recursive: true, force: true });
    throw error instanceof IntakePolicyError ? error : new IntakePolicyError("ARCHIVE_INVALID");
  } finally {
    await unlink(archivePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

const EXCLUDED_DIRECTORIES = new Map<string, string>([
  [".git", "repository-metadata"],
  [".next", "build-output"],
  [".nuxt", "build-output"],
  [".venv", "dependency"],
  ["build", "build-output"],
  ["coverage", "build-output"],
  ["dist", "build-output"],
  ["generated", "generated"],
  ["node_modules", "dependency"],
  ["target", "build-output"],
  ["vendor", "dependency"],
]);

const BINARY_MEDIA_EXTENSIONS = new Set([
  ".7z", ".avi", ".bin", ".bmp", ".dll", ".eot", ".exe", ".gif", ".gz", ".ico",
  ".jpeg", ".jpg", ".mov", ".mp3", ".mp4", ".otf", ".pdf", ".png", ".so", ".tar",
  ".ttf", ".wav", ".webm", ".webp", ".woff", ".woff2", ".xz", ".zip",
]);

function sensitivePath(relativePath: string): boolean {
  const name = path.posix.basename(relativePath).toLowerCase();
  return name === ".env" || (name.startsWith(".env.") && name !== ".env.example") ||
    [".key", ".p12", ".pfx", ".pem"].includes(path.posix.extname(name));
}

function repositoryPath(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function countLines(content: string): number {
  if (content.length === 0) return 0;
  const lines = content.split(/\r\n|\n|\r/);
  if (lines.at(-1) === "") lines.pop();
  return lines.length;
}

export async function inventoryRepository(
  root: string,
  policyOverrides: Partial<InventoryPolicy> = {},
): Promise<RepositoryInventory> {
  const sourceRoot = path.resolve(root);
  const rootMetadata = await lstat(sourceRoot);
  if (rootMetadata.isSymbolicLink()) throw new IntakePolicyError("SYMLINK_NOT_ALLOWED");
  if (!rootMetadata.isDirectory()) throw new IntakePolicyError("ROOT_NOT_DIRECTORY");
  const policy = { ...DEFAULT_POLICY, ...policyOverrides };
  const configuredSensitivePaths = new Set(policy.sensitivePaths.map((configuredPath) => {
    const normalized = configuredPath.replaceAll("\\", "/").replace(/^\.\//, "");
    if (!normalized || path.posix.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) {
      throw new IntakePolicyError("INVALID_SENSITIVE_PATH");
    }
    return normalized;
  }));
  const entries: InventoryEntry[] = [];
  let discoveredFiles = 0;
  let analyzedBytes = 0;
  let excludedDirectories = 0;

  async function visit(directory: string, inheritedExclusionReason: string | null = null): Promise<void> {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => compareText(left.name, right.name));
    for (const child of children) {
      const absolutePath = path.join(directory, child.name);
      if (child.isSymbolicLink()) {
        throw new IntakePolicyError("SYMLINK_NOT_ALLOWED", repositoryPath(sourceRoot, absolutePath));
      }
      if (child.isDirectory()) {
        const exclusionReason = inheritedExclusionReason ?? EXCLUDED_DIRECTORIES.get(child.name) ?? null;
        if (exclusionReason) {
          if (inheritedExclusionReason === null) excludedDirectories += 1;
          await visit(absolutePath, exclusionReason);
          continue;
        }
        await visit(absolutePath);
        continue;
      }
      if (!child.isFile()) continue;
      discoveredFiles += 1;
      if (discoveredFiles > policy.maxFiles) throw new IntakePolicyError("FILE_COUNT_LIMIT");
      const relativePath = repositoryPath(sourceRoot, absolutePath);
      const knownExclusionReason = inheritedExclusionReason ?? (sensitivePath(relativePath) || configuredSensitivePaths.has(relativePath)
        ? "sensitive"
        : BINARY_MEDIA_EXTENSIONS.has(path.extname(child.name).toLowerCase())
          ? "binary-media"
          : null);
      const metadata = await stat(absolutePath);
      if (!knownExclusionReason && metadata.size > policy.maxAnalyzedFileBytes) {
        throw new IntakePolicyError("FILE_SIZE_LIMIT", relativePath);
      }
      const bytes = knownExclusionReason ? null : await readFile(absolutePath);
      const exclusionReason = knownExclusionReason ?? (bytes?.includes(0) ? "binary-media" : null);
      if (!exclusionReason) {
        analyzedBytes += bytes!.byteLength;
        if (analyzedBytes > policy.maxAnalyzedBytes) throw new IntakePolicyError("TOTAL_SIZE_LIMIT");
      }
      entries.push({
        kind: "file",
        path: relativePath,
        byte_size: metadata.size,
        sha256: exclusionReason ? null : createHash("sha256").update(bytes!).digest("hex"),
        line_count: exclusionReason ? null : countLines(bytes!.toString("utf8")),
        eligibility: exclusionReason ? "excluded" : "eligible",
        exclusion_reason: exclusionReason,
      });
    }
  }

  await visit(sourceRoot);
  entries.sort((left, right) => compareText(left.path, right.path));
  return {
    entries,
    summary: {
      discovered_files: discoveredFiles,
      eligible_files: entries.filter((entry) => entry.kind === "file" && entry.eligibility === "eligible").length,
      excluded_files: entries.filter((entry) => entry.kind === "file" && entry.eligibility === "excluded").length,
      excluded_directories: excludedDirectories,
      total_bytes: entries.reduce((sum, entry) => sum + (entry.byte_size ?? 0), 0),
    },
  };
}
