import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadDemoReview } from "../../packages/demo-review/src/index.ts";
import {
  DemoReviewGenerationError,
  generateDemoReview,
} from "../scripts/generate-demo-review.mjs";

async function repository() {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-demo-source-"));
  await writeFile(path.join(root, "main.ts"), "export function start() { return true; }\n", "utf8");
  await writeFile(path.join(root, "README.md"), "# Demo repository\n\nA bounded local source.\n", "utf8");
  return root;
}

test("generates a loader-verifiable artifact from a real local inventory and pipeline", async () => {
  const sourceRoot = await repository();
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "cka-demo-output-"));
  try {
    const generated = await generateDemoReview({
      sourceRoot,
      outputRoot,
      reviewId: "demo-local",
      sourceRevision: "local-v1",
      generatedAt: "2026-08-28T12:00:00.000Z",
    });
    assert.equal(generated.reviewId, "demo-local");
    assert.equal(generated.path, path.join(outputRoot, "demo-local.json"));
    const artifact = JSON.parse(await readFile(generated.path, "utf8"));
    assert.equal(artifact.artifact.review.review_id, "demo-local");
    assert.equal(artifact.artifact.review.source_revision, "local-v1");
    assert.equal(artifact.artifact.review.generated_at, "2026-08-28T12:00:00.000Z");
    assert.equal(artifact.artifact.analysis.files.some((file) => file.path === "main.ts"), true);
    const loaded = await loadDemoReview({ artifactPath: generated.path, now: () => new Date("2026-08-28T13:00:00.000Z") });
    assert.equal(loaded.state, "ready");
    assert.equal(loaded.review.review.review_id, "demo-local");
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("rejects unsafe identifiers, timestamps, symlink roots, overwrite, and excessive output without exposing bodies", async () => {
  const sourceRoot = await repository();
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "cka-demo-output-invalid-"));
  try {
    const base = { sourceRoot, outputRoot, sourceRevision: "local-v1", generatedAt: "2026-08-28T12:00:00.000Z" };
    await assert.rejects(() => generateDemoReview({ ...base, reviewId: "../secret" }), { code: "DEMO_ID_INVALID" });
    await assert.rejects(() => generateDemoReview({ ...base, reviewId: "demo", generatedAt: "tomorrow" }), { code: "DEMO_TIMESTAMP_INVALID" });
    await assert.rejects(() => generateDemoReview({ ...base, reviewId: "demo", expiresInMs: 31 * 24 * 60 * 60 * 1_000 }), { code: "DEMO_EXPIRY_INVALID" });
    await assert.rejects(() => generateDemoReview({ ...base, outputRoot: path.join(sourceRoot, "artifacts"), reviewId: "nested" }), { code: "DEMO_OUTPUT_ROOT_INVALID" });
    await assert.rejects(() => generateDemoReview({ ...base, reviewId: "demo", maxOutputBytes: 1 }), { code: "DEMO_OUTPUT_TOO_LARGE" });
    await generateDemoReview({ ...base, reviewId: "demo" });
    await assert.rejects(() => generateDemoReview({ ...base, reviewId: "demo" }), { code: "DEMO_OUTPUT_EXISTS" });
    const symlinkRoot = path.join(outputRoot, "source-link");
    try {
      await (await import("node:fs/promises")).symlink(sourceRoot, symlinkRoot, "junction");
      await assert.rejects(() => generateDemoReview({ ...base, sourceRoot: symlinkRoot, reviewId: "linked" }), { code: "DEMO_SOURCE_INVALID" });
    } catch (error) {
      if (error?.code !== "EPERM") throw error;
    }
    const failure = new DemoReviewGenerationError("DEMO_GENERATION_FAILED");
    assert.equal(failure.message, "DEMO_GENERATION_FAILED");
    assert.equal(failure.message.includes("secret"), false);
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("does not treat a source repository as a fixture or make network/provider calls", async () => {
  const sourceRoot = await repository();
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "cka-demo-output-network-"));
  try {
    const generated = await generateDemoReview({ sourceRoot, outputRoot, reviewId: "no-provider", sourceRevision: "commit-local", generatedAt: "2026-08-28T12:00:00.000Z" });
    const text = await readFile(generated.path, "utf8");
    assert.equal(text.includes("uptime-kuma"), false);
    assert.equal(text.includes("api_key"), false);
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
    await rm(outputRoot, { recursive: true, force: true });
  }
});
