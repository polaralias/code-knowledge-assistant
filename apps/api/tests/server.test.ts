import assert from "node:assert/strict";
import { once } from "node:events";
import path from "node:path";
import test from "node:test";

import { createOperationalTelemetry } from "../../../packages/observability/src/index.ts";
import { createReviewApiServer } from "../src/index.ts";

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const server = createReviewApiServer({
    async loadReview() { return { reviewId: "review-1", state: "ready" }; },
    async answerQuestion(question) {
      return { answer: `Evidence for ${question}`, citations: [{ path: "src/main.ts", lineStart: 1, lineEnd: 2 }] };
    },
  }, { webRoot: path.resolve("apps/web"), maxRequestBytes: 512, reviewEndpoint: "/api/reviews/demo" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { server.close(); await once(server, "close"); }
}

test("serves the injected review and the browser workspace from one origin", async () => {
  await withServer(async (origin) => {
    const review = await fetch(`${origin}/api/reviews/demo`);
    assert.equal(review.status, 200);
    assert.deepEqual(await review.json(), { reviewId: "review-1", state: "ready" });
    const page = await fetch(`${origin}/`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Code Atlas/);
    assert.match(html, /content="\/api\/reviews\/demo"/);
    const liveClient = await fetch(`${origin}/src/live-client.js`);
    assert.equal(liveClient.status, 200);
    assert.match(await liveClient.text(), /createReviewClient/);
  });
});

test("accepts bounded JSON questions and returns cited output", async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/api/reviews/demo/questions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reviewId: "review-1", question: "Where does startup happen?" }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      answer: "Evidence for Where does startup happen?",
      citations: [{ path: "src/main.ts", lineStart: 1, lineEnd: 2 }],
    });
  });
});

test("accepts a strict public Git review request without exposing source details", async () => {
  let received: { repositoryUrl: string; ref?: string } | undefined;
  const server = createReviewApiServer({ async loadReview() { return {}; }, async answerQuestion() { return {}; } }, {
    reviewJobs: {
      async createReview() { return { jobId: "job-zip", reviewId: "review-zip", state: "queued" as const }; },
      async createGitReview(input) { received = input; return { jobId: "job-git", reviewId: "review-git", state: "queued" as const }; },
      async getJob() { return null; }, async getReview() { return null; }, async answerQuestion() { return { state: "queued" as const }; }, async deleteReview() { return { state: "deleted" as const }; },
    },
    maxRequestBytes: 512,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(`${origin}/api/git-reviews`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ repositoryUrl: "https://github.com/example/repository", ref: "main" }),
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { jobId: "job-git", reviewId: "review-git", state: "queued" });
    assert.deepEqual(received, { repositoryUrl: "https://github.com/example/repository", ref: "main" });
    const extra = await fetch(`${origin}/api/git-reviews`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repositoryUrl: "https://github.com/example/repository", token: "secret" }) });
    assert.equal(extra.status, 400);
    assert.deepEqual(await extra.json(), { error: { code: "GIT_REQUEST_INVALID" } });
    const wrongMethod = await fetch(`${origin}/api/git-reviews`, { method: "GET" });
    assert.equal(wrongMethod.status, 405);
  } finally {
    server.close(); await once(server, "close");
  }
});

test("rejects methods, content types, malformed questions, large bodies, and unknown routes", async () => {
  await withServer(async (origin) => {
    const wrongMethod = await fetch(`${origin}/api/reviews/demo`, { method: "DELETE" });
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get("allow"), "GET");

    const wrongType = await fetch(`${origin}/api/reviews/demo/questions`, { method: "POST", body: "question=x" });
    assert.equal(wrongType.status, 415);

    const invalid = await fetch(`${origin}/api/reviews/demo/questions`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reviewId: "review-1", question: " padded " }),
    });
    assert.equal(invalid.status, 400);

    const large = await fetch(`${origin}/api/reviews/demo/questions`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reviewId: "review-1", question: "x".repeat(600) }),
    });
    assert.equal(large.status, 413);

    const missing = await fetch(`${origin}/secrets.env`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: { code: "ROUTE_NOT_FOUND" } });
  });
});

test("maps unexpected adapter failures to body-safe errors", async () => {
  const server = createReviewApiServer({
    async loadReview() { throw new Error("C:\\private\\repository\\secret.ts"); },
    async answerQuestion() { throw new Error("source body"); },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/reviews/demo`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: { code: "INTERNAL_ERROR" } });
  } finally {
    server.close(); await once(server, "close");
  }
});

test("exposes body-safe liveness and dependency-aware readiness contracts", async () => {
  let ready = false;
  const server = createReviewApiServer({ async loadReview() { return {}; }, async answerQuestion() { return {}; } }, {
    readiness: async () => ready,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const live = await fetch(`${origin}/healthz`);
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), { status: "ok" });
    const unavailable = await fetch(`${origin}/readyz`);
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), { status: "not-ready" });
    ready = true;
    const available = await fetch(`${origin}/readyz`);
    assert.equal(available.status, 200);
    assert.deepEqual(await available.json(), { status: "ready" });
  } finally {
    server.close(); await once(server, "close");
  }
});

test("records completed requests using sanitised route templates", async () => {
  const records: string[] = [];
  let elapsed = 40;
  const telemetry = createOperationalTelemetry({ write: (record) => records.push(record) });
  const server = createReviewApiServer({ async loadReview() { return {}; }, async answerQuestion() { return {}; } }, {
    telemetry,
    monotonicNow: () => { elapsed += 5; return elapsed; },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/jobs/job-secret?token=secret`);
    assert.equal(response.status, 404);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(records.length, 1);
    assert.deepEqual(JSON.parse(records[0]!), {
      schema: "code-knowledge-assistant.telemetry.v1",
      timestamp: JSON.parse(records[0]!).timestamp,
      event: "http.request.completed",
      method: "GET",
      route: "/api/jobs/:jobId",
      status: 404,
      outcome: "failure",
      duration_ms: 5,
    });
    assert.doesNotMatch(records[0]!, /job-secret|token|secret/u);
  } finally {
    server.close(); await once(server, "close");
  }
});
