import assert from "node:assert/strict";
import { once } from "node:events";
import { request as createRequest } from "node:http";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createReviewApiServer, type ReviewJobController } from "../src/index.ts";

async function withServer(controller: ReviewJobController, run: (origin: string) => Promise<void>): Promise<void> {
  const server = createReviewApiServer({
    async loadReview() { return { reviewId: "demo", state: "ready" }; },
    async answerQuestion() { return {}; },
  }, { reviewJobs: controller, maxUploadBytes: 128 });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { server.close(); await once(server, "close"); }
}

test("streams a ZIP to controller-owned review work without leaking its temporary path", async () => {
  let uploadPath = "";
  await withServer({
    async createReview(input) {
      uploadPath = input.uploadPath;
      assert.equal(await readFile(input.uploadPath, "utf8"), "ZIP-BYTES");
      assert.equal(input.byteSize, 9);
      return { jobId: "job-1", reviewId: "review-1", state: "queued", uploadPath: input.uploadPath };
    },
    async getJob() { return null; },
    async getReview() { return null; },
    async answerQuestion() { return { state: "queued" }; },
    async deleteReview() { return { state: "deleted" }; },
  }, async (origin) => {
    const response = await fetch(`${origin}/api/reviews`, {
      method: "POST",
      headers: { "content-type": "application/zip" },
      body: "ZIP-BYTES",
    });
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.deepEqual(body, { jobId: "job-1", reviewId: "review-1", state: "queued" });
    assert.doesNotMatch(JSON.stringify(body), /[A-Z]:\\|\//u);
  });
  await rm(uploadPath.slice(0, uploadPath.lastIndexOf("\\")), { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

test("polls review jobs and maps review, question, deletion, and terminal states deliberately", async () => {
  await withServer({
    async createReview() { return { jobId: "job-new", reviewId: "review-new", state: "queued" }; },
    async getJob(jobId) {
      if (jobId === "missing") return null;
      return { jobId, reviewId: "review-1", state: jobId === "failed" ? "failed" : jobId === "expired" ? "expired" : jobId === "ready" ? "ready" : "processing" };
    },
    async getReview(reviewId) {
      if (reviewId === "missing") return null;
      if (reviewId === "processing") return { state: "processing" };
      if (reviewId === "expired") return { state: "expired" };
      return { state: "ready", review: { reviewId, path: "src/main.ts" } };
    },
    async answerQuestion(reviewId) {
      if (reviewId === "missing") return null;
      if (reviewId === "rate") return { state: "rate-limited" };
      if (reviewId === "failed") return { state: "failed" };
      return { state: "answered", answer: { text: "Evidence-backed answer." } };
    },
    async deleteReview(reviewId) {
      if (reviewId === "missing") return null;
      if (reviewId === "expired") return { state: "expired" };
      return { state: "deleted" };
    },
  }, async (origin) => {
    assert.deepEqual(await (await fetch(`${origin}/api/jobs/processing`)).json(), { jobId: "processing", reviewId: "review-1", state: "processing" });
    assert.equal((await fetch(`${origin}/api/jobs/failed`)).status, 422);
    assert.equal((await fetch(`${origin}/api/jobs/expired`)).status, 410);
    assert.equal((await fetch(`${origin}/api/jobs/missing`)).status, 404);

    const ready = await fetch(`${origin}/api/reviews/review-1`);
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { reviewId: "review-1", state: "ready", review: { reviewId: "review-1", path: "src/main.ts" } });
    assert.equal((await fetch(`${origin}/api/reviews/processing`)).status, 409);
    assert.equal((await fetch(`${origin}/api/reviews/expired`)).status, 410);

    const answer = await fetch(`${origin}/api/reviews/review-1/questions`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "Where is startup?" }),
    });
    assert.deepEqual(await answer.json(), { reviewId: "review-1", answer: { text: "Evidence-backed answer." } });
    const limited = await fetch(`${origin}/api/reviews/rate/questions`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "Where?" }),
    });
    assert.equal(limited.status, 429);

    const deleted = await fetch(`${origin}/api/reviews/review-1`, { method: "DELETE" });
    assert.deepEqual(await deleted.json(), { reviewId: "review-1", state: "deleted" });
    assert.equal((await fetch(`${origin}/api/reviews/expired`, { method: "DELETE" })).status, 410);
    assert.equal((await fetch(`${origin}/api/reviews/missing`, { method: "DELETE" })).status, 404);
  });
});

test("gates new reviews with an access-code lease and completes it when polling reaches ready", async () => {
  const lifecycle: string[] = [];
  const server = createReviewApiServer({ async loadReview() { return {}; }, async answerQuestion() { return {}; } }, {
    accessControl: {
      async startReview(input) {
        lifecycle.push(`start:${input.accessCode}`);
        if (input.accessCode !== "operator-code") throw Object.assign(new Error("must not leak"), { code: "ACCESS_CODE_INVALID" });
        return { leaseId: "lease-opaque" };
      },
      async completeReview(leaseId) { lifecycle.push(`complete:${leaseId}`); },
      async releaseReview(leaseId) { lifecycle.push(`release:${leaseId}`); },
      async recordQuestion() { return {}; },
    },
    reviewJobs: {
      async createReview() { return { jobId: "job-zip", reviewId: "review-zip", state: "queued" as const }; },
      async createGitReview() { return { jobId: "job-gated", reviewId: "review-gated", state: "queued" as const }; },
      async getJob() { return { jobId: "job-gated", reviewId: "review-gated", state: "ready" as const }; },
      async getReview() { return null; }, async answerQuestion() { return null; }, async deleteReview() { return null; },
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const denied = await fetch(`${origin}/api/git-reviews`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repositoryUrl: "https://github.com/example/repo" }) });
    assert.equal(denied.status, 401);
    assert.deepEqual(await denied.json(), { error: { code: "ACCESS_CODE_INVALID" } });
    const accepted = await fetch(`${origin}/api/git-reviews`, { method: "POST", headers: { "content-type": "application/json", "x-review-access-code": "operator-code" }, body: JSON.stringify({ repositoryUrl: "https://github.com/example/repo" }) });
    assert.equal(accepted.status, 202);
    assert.equal((await fetch(`${origin}/api/jobs/job-gated`)).status, 200);
    assert.deepEqual(lifecycle, ["start:", "start:operator-code", "complete:lease-opaque"]);
  } finally {
    server.close(); await once(server, "close");
  }
});

test("rate-limits anonymous demo questions through an injected body-free client subject", async () => {
  let recorded = "";
  const server = createReviewApiServer({ async loadReview() { return {}; }, async answerQuestion() { return {}; } }, {
    accessControl: {
      async startReview() { return { leaseId: "unused" }; }, async completeReview() {}, async releaseReview() {},
      async recordQuestion(input) {
        recorded = input.clientSubject;
        throw Object.assign(new Error("private ledger path"), { code: "QUESTION_LIMIT_EXCEEDED" });
      },
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/reviews/demo/questions`, {
      method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.9, 203.0.113.4" }, body: JSON.stringify({ reviewId: "demo", question: "Where is startup?" }),
    });
    assert.equal(response.status, 429);
    assert.deepEqual(await response.json(), { error: { code: "QUESTION_RATE_LIMITED" } });
    assert.equal(recorded, "203.0.113.4");
  } finally {
    server.close(); await once(server, "close");
  }
});

test("rejects traversal-shaped identifiers, wrong methods, content types, and malformed questions before controller work", async () => {
  let calls = 0;
  await withServer({
    async createReview() { calls += 1; return { jobId: "job-1", reviewId: "review-1", state: "queued" }; },
    async getJob() { calls += 1; return null; },
    async getReview() { calls += 1; return null; },
    async answerQuestion() { calls += 1; return null; },
    async deleteReview() { calls += 1; return null; },
  }, async (origin) => {
    for (const route of ["/api/jobs/job..", "/api/jobs/job%2Fsecret", "/api/reviews/review..", "/api/reviews/review%2Fsecret/questions"]) {
      const response = await fetch(`${origin}${route}`, { method: route.endsWith("questions") ? "POST" : "GET", headers: { "content-type": "application/json" }, body: route.endsWith("questions") ? JSON.stringify({ question: "Where?" }) : undefined });
      assert.equal(response.status, 400, route);
      assert.deepEqual(await response.json(), { error: { code: "IDENTIFIER_INVALID" } });
    }
    const wrongMethod = await fetch(`${origin}/api/reviews`, { method: "GET" });
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get("allow"), "POST");
    assert.equal((await fetch(`${origin}/api/reviews`, { method: "POST", headers: { "content-type": "text/plain" }, body: "zip" })).status, 415);
    assert.equal((await fetch(`${origin}/api/reviews/review-1/questions`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: " padded " }),
    })).status, 400);
    assert.equal(calls, 0);
  });
});

test("removes oversized and controller-rejected uploads without exposing server paths", async () => {
  const uploadRoot = await mkdtemp(path.join(tmpdir(), "review-api-upload-"));
  const calls: string[] = [];
  const server = createReviewApiServer({
    async loadReview() { return {}; },
    async answerQuestion() { return {}; },
  }, {
    maxUploadBytes: 8,
    uploadDirectory: uploadRoot,
    reviewJobs: {
      async createReview(input) { calls.push(input.uploadPath); throw new Error(`failed ${input.uploadPath}`); },
      async getJob() { return null; },
      async getReview() { return null; },
      async answerQuestion() { return { state: "queued" }; },
      async deleteReview() { return { state: "deleted" }; },
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const tooLarge = await fetch(`${origin}/api/reviews`, {
      method: "POST", headers: { "content-type": "application/zip" }, body: "123456789",
    });
    assert.equal(tooLarge.status, 413);
    assert.deepEqual(await readdir(uploadRoot), []);

    const rejected = await fetch(`${origin}/api/reviews`, {
      method: "POST", headers: { "content-type": "application/zip" }, body: "1234",
    });
    assert.equal(rejected.status, 500);
    assert.deepEqual(await rejected.json(), { error: { code: "INTERNAL_ERROR" } });
    assert.equal(calls.length, 1);
    assert.deepEqual(await readdir(uploadRoot), []);
  } finally {
    server.close(); await once(server, "close");
    await rm(uploadRoot, { recursive: true, force: true });
  }
});

test("cleans a disconnected partial ZIP upload before it reaches the controller", async () => {
  const uploadRoot = await mkdtemp(path.join(tmpdir(), "review-api-upload-"));
  let creates = 0;
  const server = createReviewApiServer({ async loadReview() { return {}; }, async answerQuestion() { return {}; } }, {
    maxUploadBytes: 128,
    uploadDirectory: uploadRoot,
    reviewJobs: {
      async createReview() { creates += 1; return { jobId: "job-1", reviewId: "review-1", state: "queued" }; },
      async getJob() { return null; }, async getReview() { return null; },
      async answerQuestion() { return { state: "queued" }; }, async deleteReview() { return { state: "deleted" }; },
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  try {
    const client = createRequest({ host: "127.0.0.1", port: address.port, method: "POST", path: "/api/reviews", headers: { "content-type": "application/zip", "content-length": "20" } });
    client.on("error", () => undefined);
    client.write("partial");
    client.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(creates, 0);
    assert.deepEqual(await readdir(uploadRoot), []);
  } finally {
    server.close(); await once(server, "close");
    await rm(uploadRoot, { recursive: true, force: true });
  }
});
