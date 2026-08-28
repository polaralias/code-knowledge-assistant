import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { inventoryRepository } from "../../../packages/intake/src/index.ts";
import { FileSystemReviewArtifactStore } from "../../../packages/review-artifacts/src/index.ts";
import { buildLocalRepositoryReview } from "../../../packages/review-pipeline/src/index.ts";
import { buildUploadReviewServer } from "../src/runtime.ts";

async function createArtifact(root: string): Promise<string> {
  const repositoryRoot = path.join(root, "repository");
  await mkdir(path.join(repositoryRoot, "src"), { recursive: true });
  await writeFile(path.join(repositoryRoot, "src", "main.ts"), "export function startServer() {\n  return 'ready';\n}\n", "utf8");
  const inventory = await inventoryRepository(repositoryRoot);
  const review = await buildLocalRepositoryReview({
    root: repositoryRoot,
    inventory,
    reviewId: "demo-runtime",
    sourceRevision: "revision-demo",
    generatedAt: "2026-08-27T12:00:00.000Z",
  });
  const store = new FileSystemReviewArtifactStore(path.join(root, "artifact-store"), { now: () => new Date("2026-08-27T12:00:00.000Z") });
  await store.save({ id: "demo-runtime", expires_at: "2026-08-29T12:00:00.000Z", review });
  return path.join(root, "artifact-store", "artifacts", "demo-runtime.json");
}

async function listen(server: Awaited<ReturnType<typeof buildUploadReviewServer>>): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Awaited<ReturnType<typeof buildUploadReviewServer>>): Promise<void> {
  if (server.listening) {
    server.close();
    await once(server, "close");
  }
}

test("serves a configured immutable demo artifact and answers through the anonymous deterministic path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cka-demo-runtime-"));
  const artifactPath = await createArtifact(root);
  const server = await buildUploadReviewServer({ webRoot: path.resolve("apps/web"), dataRoot: path.join(root, "data"), demoReviewArtifactPath: artifactPath });
  const origin = await listen(server);
  try {
    assert.equal((await fetch(`${origin}/readyz`)).status, 200);
    const review = await fetch(`${origin}/api/reviews/demo`);
    assert.equal(review.status, 200);
    assert.equal((await review.json()).reviewId, "demo-runtime");
    const landing = await fetch(`${origin}/`);
    assert.match(await landing.text(), /name="code-atlas-review-endpoint" content="\/api\/reviews\/demo"/u);
    const question = await fetch(`${origin}/api/reviews/demo/questions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ reviewId: "demo-runtime", question: "Where is startServer defined?" }),
    });
    assert.equal(question.status, 200);
    assert.equal((await question.json()).citations[0].path, "src/main.ts");
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps the demo deliberately unavailable when no artifact is configured", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cka-demo-absent-"));
  const server = await buildUploadReviewServer({ webRoot: path.resolve("apps/web"), dataRoot: path.join(root, "data") });
  const origin = await listen(server);
  try {
    const response = await fetch(`${origin}/api/reviews/demo`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: { code: "DEMO_REVIEW_UNAVAILABLE" } });
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
});

test("fails readiness closed for a corrupt or expired configured artifact without exposing its path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cka-demo-invalid-"));
  const artifactPath = path.join(root, "private-demo-artifact.json");
  await writeFile(artifactPath, "private source body is not valid JSON", "utf8");
  const server = await buildUploadReviewServer({ webRoot: path.resolve("apps/web"), dataRoot: path.join(root, "data"), demoReviewArtifactPath: artifactPath });
  const origin = await listen(server);
  try {
    assert.equal((await fetch(`${origin}/readyz`)).status, 503);
    const response = await fetch(`${origin}/api/reviews/demo`);
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.deepEqual(JSON.parse(body), { error: { code: "DEMO_REVIEW_UNAVAILABLE" } });
    assert.doesNotMatch(body, /private-demo-artifact|private source body/u);
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
});

test("fails readiness closed for an expired artifact without falling back to a live demo", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cka-demo-expired-"));
  const artifactPath = await createArtifact(root);
  const envelope = JSON.parse(await readFile(artifactPath, "utf8")) as { artifact: { expires_at: string }; sha256: string };
  envelope.artifact.expires_at = "2026-08-27T11:00:00.000Z";
  envelope.sha256 = createHash("sha256").update(JSON.stringify(envelope.artifact)).digest("hex");
  await writeFile(artifactPath, JSON.stringify(envelope), "utf8");
  const server = await buildUploadReviewServer({ webRoot: path.resolve("apps/web"), dataRoot: path.join(root, "data"), demoReviewArtifactPath: artifactPath });
  const origin = await listen(server);
  try {
    assert.equal((await fetch(`${origin}/readyz`)).status, 503);
    assert.equal((await fetch(`${origin}/api/reviews/demo`)).status, 503);
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
});

test("reloads the same configured demo artifact after an application restart", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cka-demo-restart-"));
  const artifactPath = await createArtifact(root);
  let server = await buildUploadReviewServer({ webRoot: path.resolve("apps/web"), dataRoot: path.join(root, "data"), demoReviewArtifactPath: artifactPath });
  let origin = await listen(server);
  try {
    assert.equal((await fetch(`${origin}/api/reviews/demo`)).status, 200);
    await close(server);
    server = await buildUploadReviewServer({ webRoot: path.resolve("apps/web"), dataRoot: path.join(root, "data"), demoReviewArtifactPath: artifactPath });
    origin = await listen(server);
    const review = await fetch(`${origin}/api/reviews/demo`);
    assert.equal(review.status, 200);
    assert.equal((await review.json()).state, "ready");
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
});
