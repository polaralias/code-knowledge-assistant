#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { inventoryRepository, IntakePolicyError } from "../../packages/intake/src/index.ts";
import { buildLocalRepositoryReview, ReviewPipelineError } from "../../packages/review-pipeline/src/index.ts";
import { validateReviewBundle } from "../../packages/review-generation/src/index.ts";
import { loadDemoReview } from "../../packages/demo-review/src/index.ts";

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const DEFAULT_EXPIRY_MS = 48 * 60 * 60 * 1_000;
const MAX_EXPIRY_MS = 30 * 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_OUTPUT_BYTES = 50 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 100 * 1024 * 1024;

export class DemoReviewGenerationError extends Error {
  constructor(code) {
    super(code);
    this.name = "DemoReviewGenerationError";
    this.code = code;
  }
}

function fail(code) {
  throw new DemoReviewGenerationError(code);
}

function validTimestamp(value) {
  if (typeof value !== "string" || !ISO.test(value)) fail("DEMO_TIMESTAMP_INVALID");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) fail("DEMO_TIMESTAMP_INVALID");
  return value;
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function ensureOutputRoot(outputRoot, sourceRoot) {
  if (typeof outputRoot !== "string" || outputRoot.length === 0) fail("DEMO_OUTPUT_ROOT_INVALID");
  const resolvedOutput = path.resolve(outputRoot);
  const resolvedSource = path.resolve(sourceRoot);
  const relativeOutput = path.relative(resolvedSource, resolvedOutput);
  if (resolvedOutput === resolvedSource || (relativeOutput !== "" && relativeOutput !== ".." && !relativeOutput.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeOutput))) {
    fail("DEMO_OUTPUT_ROOT_INVALID");
  }
  try {
    const information = await lstat(resolvedOutput);
    if (information.isSymbolicLink() || !information.isDirectory()) fail("DEMO_OUTPUT_ROOT_INVALID");
  } catch (failure) {
    if (failure instanceof DemoReviewGenerationError) throw failure;
    if (failure?.code !== "ENOENT") fail("DEMO_OUTPUT_ROOT_INVALID");
    try {
      await mkdir(resolvedOutput, { recursive: true });
      const information = await lstat(resolvedOutput);
      if (information.isSymbolicLink() || !information.isDirectory()) fail("DEMO_OUTPUT_ROOT_INVALID");
    } catch {
      fail("DEMO_OUTPUT_ROOT_INVALID");
    }
  }
  return resolvedOutput;
}

function resolveExpiry(generatedAt, expiresAt, expiresInMs) {
  const created = Date.parse(generatedAt);
  let resolved;
  if (expiresAt !== undefined) {
    resolved = Date.parse(validTimestamp(expiresAt));
  } else {
    const duration = expiresInMs ?? DEFAULT_EXPIRY_MS;
    if (!Number.isSafeInteger(duration) || duration < 1 || duration > MAX_EXPIRY_MS) fail("DEMO_EXPIRY_INVALID");
    resolved = created + duration;
  }
  if (!Number.isFinite(resolved) || resolved <= created || resolved - created > MAX_EXPIRY_MS) fail("DEMO_EXPIRY_INVALID");
  return new Date(resolved).toISOString();
}

async function publish(outputPath, content) {
  try {
    await lstat(outputPath);
    fail("DEMO_OUTPUT_EXISTS");
  } catch (failure) {
    if (failure instanceof DemoReviewGenerationError) throw failure;
    if (failure?.code !== "ENOENT") fail("DEMO_OUTPUT_WRITE_FAILED");
  }
  const temporary = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, outputPath);
  } catch {
    await rm(temporary, { force: true }).catch(() => undefined);
    fail("DEMO_OUTPUT_WRITE_FAILED");
  }
}

export async function generateDemoReview({
  sourceRoot,
  outputRoot,
  reviewId,
  sourceRevision,
  generatedAt,
  expiresAt,
  expiresInMs,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  inventoryPolicy = {},
} = {}) {
  if (typeof sourceRoot !== "string" || sourceRoot.length === 0) fail("DEMO_SOURCE_INVALID");
  if (typeof reviewId !== "string" || !ID.test(reviewId)) fail("DEMO_ID_INVALID");
  if (typeof sourceRevision !== "string" || sourceRevision.length === 0 || sourceRevision.length > 512 || /[\r\n]/u.test(sourceRevision)) fail("DEMO_SOURCE_REVISION_INVALID");
  const createdAt = validTimestamp(generatedAt);
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > MAX_OUTPUT_BYTES) fail("DEMO_OUTPUT_LIMIT_INVALID");
  const resolvedSource = path.resolve(sourceRoot);
  const resolvedOutput = await ensureOutputRoot(outputRoot, resolvedSource);
  const outputPath = path.join(resolvedOutput, `${reviewId}.json`);
  try {
    const inventory = await inventoryRepository(resolvedSource, inventoryPolicy);
    const built = await buildLocalRepositoryReview({ root: resolvedSource, inventory, reviewId, sourceRevision, generatedAt: createdAt });
    validateReviewBundle(built.review, built.evidence);
    const artifact = {
      schema_version: 1,
      id: reviewId,
      created_at: createdAt,
      expires_at: resolveExpiry(createdAt, expiresAt, expiresInMs),
      analysis: built.analysis,
      review: built.review,
      evidence: built.evidence,
    };
    const envelope = { schema_version: 1, artifact, sha256: digest(JSON.stringify(artifact)) };
    const content = JSON.stringify(envelope);
    if (Buffer.byteLength(content, "utf8") > maxOutputBytes) fail("DEMO_OUTPUT_TOO_LARGE");
    await publish(outputPath, content);
    try {
      await loadDemoReview({ artifactPath: outputPath, now: () => new Date(createdAt), maxBytes: maxOutputBytes });
    } catch {
      await rm(outputPath, { force: true }).catch(() => undefined);
      fail("DEMO_CONTRACT_INVALID");
    }
    return { path: outputPath, reviewId, sourceRevision: built.review.source_revision, generatedAt: createdAt, expiresAt: artifact.expires_at, bytes: Buffer.byteLength(content, "utf8") };
  } catch (failure) {
    if (failure instanceof DemoReviewGenerationError) throw failure;
    if (failure instanceof IntakePolicyError || failure instanceof ReviewPipelineError) fail("DEMO_SOURCE_INVALID");
    fail("DEMO_GENERATION_FAILED");
  }
}

function argumentValue(argumentsList, name) {
  const prefix = `${name}=`;
  const argument = argumentsList.find((item) => item.startsWith(prefix));
  return argument === undefined ? undefined : argument.slice(prefix.length);
}

if (process.argv[1] !== undefined && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const argumentsList = process.argv.slice(2);
  try {
    const result = await generateDemoReview({
      sourceRoot: argumentValue(argumentsList, "--source-root"),
      outputRoot: argumentValue(argumentsList, "--output-root"),
      reviewId: argumentValue(argumentsList, "--review-id"),
      sourceRevision: argumentValue(argumentsList, "--source-revision"),
      generatedAt: argumentValue(argumentsList, "--generated-at"),
      expiresAt: argumentValue(argumentsList, "--expires-at"),
      expiresInMs: argumentValue(argumentsList, "--expires-in-ms") === undefined ? undefined : Number(argumentValue(argumentsList, "--expires-in-ms")),
      maxOutputBytes: argumentValue(argumentsList, "--max-output-bytes") === undefined ? undefined : Number(argumentValue(argumentsList, "--max-output-bytes")),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (failure) {
    process.stderr.write(`${failure?.code ?? "DEMO_GENERATION_FAILED"}\n`);
    process.exitCode = 1;
  }
}
