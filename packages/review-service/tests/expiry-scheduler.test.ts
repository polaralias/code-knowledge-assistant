import assert from "node:assert/strict";
import test from "node:test";

import { createReviewExpiryScheduler } from "../src/index.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("the expiry scheduler starts once, prevents overlapping sweeps, and stops cleanly", async () => {
  let tick: (() => void) | undefined;
  let cancelled = 0;
  let calls = 0;
  const first = deferred<{ expiredJobIds: string[] }>();
  const scheduler = createReviewExpiryScheduler({
    target: {
      async purgeExpired() {
        calls += 1;
        return calls === 1 ? first.promise : { expiredJobIds: ["job-2"] };
      },
    },
    intervalMs: 1_000,
    scheduleRepeating(callback) { tick = callback; return { cancel() { cancelled += 1; } }; },
  });

  scheduler.start();
  scheduler.start();
  assert.ok(tick);
  tick();
  tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);

  const stopping = scheduler.stop();
  assert.equal(cancelled, 1);
  first.resolve({ expiredJobIds: ["job-1"] });
  await stopping;
  assert.deepEqual(await scheduler.sweepNow(), { state: "stopped" });
  assert.equal(calls, 1);
});

test("a failed scheduled sweep reports a body-free error and a later sweep can succeed", async () => {
  let calls = 0;
  const errors: string[] = [];
  const scheduler = createReviewExpiryScheduler({
    target: {
      async purgeExpired() {
        calls += 1;
        if (calls === 1) throw new Error("PRIVATE SOURCE MUST NOT LEAK");
        return { expiredJobIds: ["job-safe"] };
      },
    },
    intervalMs: 1_000,
    onError(error) { errors.push(error.code); },
  });

  assert.deepEqual(await scheduler.sweepNow(), { state: "failed" });
  assert.deepEqual(errors, ["EXPIRY_SWEEP_FAILED"]);
  assert.deepEqual(await scheduler.sweepNow(), { state: "completed", expiredJobIds: ["job-safe"] });
});

test("expiry completion reports bounded operational facts without exposing identifiers", async () => {
  const completions: Array<{ outcome: "failure" | "success"; expiredCount: number; durationMs: number }> = [];
  let time = 10;
  const scheduler = createReviewExpiryScheduler({
    target: { async purgeExpired() { return { expiredJobIds: ["private-job-id", "another-private-id"] }; } },
    intervalMs: 1_000,
    monotonicNow: () => { time += 7; return time; },
    onSweepComplete(completion) { completions.push(completion); throw new Error("telemetry unavailable"); },
  });

  assert.deepEqual(await scheduler.sweepNow(), { state: "completed", expiredJobIds: ["private-job-id", "another-private-id"] });
  assert.deepEqual(completions, [{ outcome: "success", expiredCount: 2, durationMs: 7 }]);
});

test("an unavailable telemetry clock cannot prevent retention work", async () => {
  let purged = 0;
  const scheduler = createReviewExpiryScheduler({
    target: { async purgeExpired() { purged += 1; return { expiredJobIds: [] }; } },
    intervalMs: 1_000,
    monotonicNow() { throw new Error("clock unavailable"); },
    onSweepComplete() { throw new Error("must not be reached"); },
  });
  assert.deepEqual(await scheduler.sweepNow(), { state: "completed", expiredJobIds: [] });
  assert.equal(purged, 1);
});
