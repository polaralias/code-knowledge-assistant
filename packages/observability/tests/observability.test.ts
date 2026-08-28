import assert from "node:assert/strict";
import test from "node:test";

import { createOperationalTelemetry, OperationalTelemetryError } from "../src/index.ts";

test("writes a versioned, allowlisted HTTP completion event and updates metrics", () => {
  const records: string[] = [];
  const telemetry = createOperationalTelemetry({
    now: () => new Date("2026-08-27T12:00:00.000Z"),
    write: (record) => records.push(record),
  });

  telemetry.record({
    event: "http.request.completed",
    method: "POST",
    route: "/api/reviews/:reviewId/questions",
    status: 200,
    durationMs: 17,
  });

  assert.deepEqual(JSON.parse(records[0]!), {
    schema: "code-knowledge-assistant.telemetry.v1",
    timestamp: "2026-08-27T12:00:00.000Z",
    event: "http.request.completed",
    method: "POST",
    route: "/api/reviews/:reviewId/questions",
    status: 200,
    outcome: "success",
    duration_ms: 17,
  });
  assert.deepEqual(telemetry.snapshot(), {
    httpRequests: 1,
    httpErrors: 0,
    httpDurationMs: 17,
    expirySweeps: 0,
    expirySweepFailures: 0,
    expiredReviews: 0,
  });
});

test("records bounded expiry outcomes and never throws when the writer fails", () => {
  const telemetry = createOperationalTelemetry({ write() { throw new Error("disk record with secret"); } });

  assert.doesNotThrow(() => telemetry.record({ event: "review.expiry.completed", outcome: "success", expiredCount: 2, durationMs: 4 }));
  assert.doesNotThrow(() => telemetry.record({ event: "review.expiry.completed", outcome: "failure", expiredCount: 0, durationMs: 3 }));
  assert.deepEqual(telemetry.snapshot(), {
    httpRequests: 0,
    httpErrors: 0,
    httpDurationMs: 0,
    expirySweeps: 2,
    expirySweepFailures: 1,
    expiredReviews: 2,
  });
});

test("rejects raw paths, unknown fields, invalid values, and unsafe clock output", () => {
  const telemetry = createOperationalTelemetry({ write() {} });
  for (const event of [
    { event: "http.request.completed", method: "GET", route: "/api/jobs/job-secret", status: 200, durationMs: 1 },
    { event: "http.request.completed", method: "GET", route: "/healthz", status: 200, durationMs: 1, question: "secret" },
    { event: "review.expiry.completed", outcome: "success", expiredCount: -1, durationMs: 1 },
  ]) {
    assert.throws(() => telemetry.record(event as never), (error: unknown) => error instanceof OperationalTelemetryError && error.code === "TELEMETRY_EVENT_INVALID");
  }

  const badClock = createOperationalTelemetry({ now: () => new Date(Number.NaN), write() {} });
  assert.throws(
    () => badClock.record({ event: "review.expiry.completed", outcome: "success", expiredCount: 0, durationMs: 1 }),
    (error: unknown) => error instanceof OperationalTelemetryError && error.code === "TELEMETRY_CLOCK_INVALID",
  );
  assert.equal(badClock.snapshot().expirySweeps, 0);
});

test("classifies only known routes without retaining identifiers or query strings", () => {
  const telemetry = createOperationalTelemetry({ write() {} });
  assert.equal(telemetry.routeTemplate("/api/jobs/job-secret?token=secret"), "/api/jobs/:jobId");
  assert.equal(telemetry.routeTemplate("/api/reviews/review-secret/questions"), "/api/reviews/:reviewId/questions");
  assert.equal(telemetry.routeTemplate("/not/a/route"), "unmatched");
});
