import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import yazl from "yazl";

import { createOperationalTelemetry } from "../../../packages/observability/src/index.ts";
import { buildLocalReviewServer, buildUploadReviewServer } from "../src/runtime.ts";

async function writeZip(target: string, entries: Record<string, string>): Promise<void> {
  const archive = new yazl.ZipFile();
  for (const [name, contents] of Object.entries(entries)) archive.addBuffer(Buffer.from(contents), name);
  archive.end();
  const chunks: Buffer[] = [];
  for await (const chunk of archive.outputStream) chunks.push(Buffer.from(chunk));
  await writeFile(target, Buffer.concat(chunks));
}

test("serves a real materialized repository review and cited question through the browser contract", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "review-api-"));
  const repositoryRoot = path.join(root, "sample-repository");
  await mkdir(path.join(repositoryRoot, "src"), { recursive: true });
  await writeFile(path.join(repositoryRoot, "src", "main.ts"), "export function startServer() {\n  return 'ready';\n}\n", "utf8");
  const server = await buildLocalReviewServer({
    repositoryRoot,
    webRoot: path.resolve("apps/web"),
    reviewId: "review-runtime",
    generatedAt: "2026-08-27T06:00:00Z",
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const reviewResponse = await fetch(`${origin}/api/reviews/demo`);
    assert.equal(reviewResponse.status, 200);
    const review = await reviewResponse.json() as Record<string, any>;
    assert.equal(review.repository.name, "sample-repository");
    assert.equal(review.coverage.indexedFiles, 1);

    const answerResponse = await fetch(`${origin}/api/reviews/demo/questions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ reviewId: "review-runtime", question: "Where is startServer defined?" }),
    });
    assert.equal(answerResponse.status, 200);
    const answer = await answerResponse.json() as Record<string, any>;
    assert.equal(answer.citations[0].path, "src/main.ts");
    assert.equal(answer.citations[0].lineStart, 1);
  } finally {
    server.close();
    await once(server, "close");
    await rm(root, { recursive: true, force: true });
  }
});

test("accepts a real ZIP, reports durable job progress, serves the review, answers, and deletes it", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "review-upload-runtime-"));
  const zipPath = path.join(root, "repository.zip");
  await writeZip(zipPath, {
    "README.md": "# Sample service\n",
    "src/main.ts": "export function startServer() {\n  return 'ready';\n}\n",
  });
  const telemetryRecords: string[] = [];
  const telemetry = createOperationalTelemetry({ write: (record) => telemetryRecords.push(record) });
  const server = await buildUploadReviewServer({ webRoot: path.resolve("apps/web"), dataRoot: path.join(root, "data"), telemetry });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const landing = await fetch(origin);
    assert.match(await landing.text(), /name="code-atlas-api-base" content="\/api"/u);
    assert.equal((await fetch(`${origin}/src/upload-client.js`)).status, 200);

    const archiveBytes = await readFile(zipPath);
    const upload = await fetch(`${origin}/api/reviews`, {
      method: "POST",
      headers: { "content-type": "application/zip" },
      body: archiveBytes.buffer.slice(archiveBytes.byteOffset, archiveBytes.byteOffset + archiveBytes.byteLength) as ArrayBuffer,
    });
    assert.equal(upload.status, 202);
    const accepted = await upload.json() as { jobId: string; reviewId: string; state: string };
    assert.equal(accepted.state, "queued");

    let job: { jobId: string; reviewId: string; state: string } = accepted;
    for (let attempt = 0; attempt < 100 && job.state !== "ready"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const response = await fetch(`${origin}/api/jobs/${accepted.jobId}`);
      const diagnostic = response.status === 200 ? "" : await readFile(path.join(root, "data", "metadata", "jobs", `${accepted.jobId}.json`), "utf8");
      assert.equal(response.status, 200, diagnostic);
      job = await response.json() as typeof job;
    }
    assert.equal(job.state, "ready");
    assert.equal(job.reviewId, accepted.reviewId);

    const completed = await fetch(`${origin}/api/reviews/${accepted.reviewId}`);
    assert.equal(completed.status, 200);
    const reviewEnvelope = await completed.json() as Record<string, any>;
    assert.equal(reviewEnvelope.state, "ready");
    assert.equal(reviewEnvelope.review.reviewId, accepted.reviewId);
    assert.equal(reviewEnvelope.review.coverage.indexedFiles, 2);

    const question = await fetch(`${origin}/api/reviews/${accepted.reviewId}/questions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "Where is startServer defined?" }),
    });
    assert.equal(question.status, 200);
    const answer = await question.json() as Record<string, any>;
    assert.equal(answer.answer.citations[0].path, "src/main.ts");

    const deleted = await fetch(`${origin}/api/reviews/${accepted.reviewId}`, { method: "DELETE" });
    assert.equal(deleted.status, 200);
    assert.equal((await fetch(`${origin}/api/reviews/${accepted.reviewId}`)).status, 410);
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(telemetryRecords.some((record) => JSON.parse(record).route === "/api/reviews/:reviewId/questions"));
    assert.doesNotMatch(telemetryRecords.join("\n"), new RegExp(accepted.reviewId, "u"));
  } finally {
    server.close();
    await once(server, "close");
    await rm(root, { recursive: true, force: true });
  }
});

test("serves and answers from a completed review after an application restart", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "review-restart-runtime-"));
  const dataRoot = path.join(root, "data");
  const zipPath = path.join(root, "repository.zip");
  await writeZip(zipPath, { "src/main.ts": "export function startServer() { return 'ready'; }\n" });
  let server = await buildUploadReviewServer({ webRoot: path.resolve("apps/web"), dataRoot });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  let address = server.address();
  assert(address && typeof address === "object");
  let origin = `http://127.0.0.1:${address.port}`;
  try {
    const archiveBytes = await readFile(zipPath);
    const upload = await fetch(`${origin}/api/reviews`, {
      method: "POST",
      headers: { "content-type": "application/zip" },
      body: archiveBytes.buffer.slice(archiveBytes.byteOffset, archiveBytes.byteOffset + archiveBytes.byteLength) as ArrayBuffer,
    });
    const accepted = await upload.json() as { jobId: string; reviewId: string };
    let state = "queued";
    for (let attempt = 0; attempt < 100 && state !== "ready"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const response = await fetch(`${origin}/api/jobs/${accepted.jobId}`);
      state = ((await response.json()) as { state: string }).state;
    }
    assert.equal(state, "ready");
    server.close();
    await once(server, "close");

    server = await buildUploadReviewServer({ webRoot: path.resolve("apps/web"), dataRoot });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    address = server.address();
    assert(address && typeof address === "object");
    origin = `http://127.0.0.1:${address.port}`;

    const job = await fetch(`${origin}/api/jobs/${accepted.jobId}`);
    assert.equal(job.status, 200);
    assert.equal(((await job.json()) as { reviewId: string }).reviewId, accepted.reviewId);
    const review = await fetch(`${origin}/api/reviews/${accepted.reviewId}`);
    assert.equal(review.status, 200);
    assert.equal(((await review.json()) as Record<string, any>).review.reviewId, accepted.reviewId);
    const question = await fetch(`${origin}/api/reviews/${accepted.reviewId}/questions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "Where is startServer defined?" }),
    });
    assert.equal(question.status, 200);
    assert.equal(((await question.json()) as Record<string, any>).answer.citations[0].path, "src/main.ts");
  } finally {
    if (server.listening) {
      server.close();
      await once(server, "close");
    }
    await rm(root, { recursive: true, force: true });
  }
});
