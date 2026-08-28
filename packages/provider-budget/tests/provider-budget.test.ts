import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BudgetLedgerError,
  FileSystemProviderBudgetLedger,
  createProviderBudgetLedger,
} from "../src/index.ts";

function time() {
  let current = new Date("2026-08-28T12:00:00.000Z");
  return {
    now: () => new Date(current),
    advance: (milliseconds: number) => { current = new Date(current.getTime() + milliseconds); },
  };
}

test("reserves before work, commits measured cost idempotently, and persists aggregate state without sensitive metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-provider-budget-"));
  const clock = time();
  try {
    const ledger = createProviderBudgetLedger({ root, now: clock.now });
    const reservation = await ledger.reserve({ estimatedCostGbp: 1.25 });
    assert.match(reservation.reservationId, /^[0-9a-f-]{36}$/u);
    assert.equal(reservation.reservedGbp, 1.25);
    assert.equal((await ledger.status()).reservedGbp, 1.25);
    const committed = await ledger.commit(reservation.reservationId, { measuredCostGbp: 0.72 });
    assert.deepEqual(committed, { reservationId: reservation.reservationId, state: "committed", costGbp: 0.72 });
    assert.deepEqual(await ledger.commit(reservation.reservationId, { measuredCostGbp: 0.72 }), committed);
    assert.deepEqual(await ledger.status(), {
      month: "2026-08", monthlyCeilingGbp: 20, softStopGbp: 16, spentGbp: 0.72, reservedGbp: 0,
      availableGbp: 19.28,
    });
    const persisted = await readFile(path.join(root, "provider-budget-ledger.json"), "utf8");
    assert.equal(persisted.includes(reservation.reservationId), false);
    assert.equal(persisted.includes("prompt"), false);
    assert.equal(persisted.includes("provider"), false);
    assert.equal(persisted.includes("https://"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stops new work at 80 percent and never permits a reservation to cross the monthly ceiling", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-provider-budget-limit-"));
  try {
    const ledger = new FileSystemProviderBudgetLedger({ root, monthlyCeilingGbp: 10 });
    const first = await ledger.reserve({ estimatedCostGbp: 7.99 });
    await ledger.commit(first.reservationId, { measuredCostGbp: 7.99 });
    await assert.rejects(() => ledger.reserve({ estimatedCostGbp: 0.01 }), (error: unknown) => error instanceof BudgetLedgerError && error.code === "BUDGET_SOFT_STOP");
    const freshRoot = await mkdtemp(path.join(os.tmpdir(), "cka-provider-budget-release-"));
    const fresh = new FileSystemProviderBudgetLedger({ root: freshRoot, monthlyCeilingGbp: 10 });
    const smallReservation = await fresh.reserve({ estimatedCostGbp: 0.001 });
    const small = await fresh.release(smallReservation.reservationId);
    assert.equal(small.state, "released");
    await rm(freshRoot, { recursive: true, force: true });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release and abandoned-reservation expiry are idempotent across restart", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-provider-budget-expiry-"));
  const clock = time();
  try {
    const first = new FileSystemProviderBudgetLedger({ root, now: clock.now, reservationTtlMs: 1_000 });
    const released = await first.reserve({ estimatedCostGbp: 2 });
    assert.deepEqual(await first.release(released.reservationId), { reservationId: released.reservationId, state: "released" });
    assert.deepEqual(await first.release(released.reservationId), { reservationId: released.reservationId, state: "released" });
    const abandoned = await first.reserve({ estimatedCostGbp: 3 });
    clock.advance(1_001);
    const restarted = new FileSystemProviderBudgetLedger({ root, now: clock.now, reservationTtlMs: 1_000 });
    assert.deepEqual(await restarted.expireAbandonedReservations(), { expired: 1, releasedGbp: 3 });
    assert.deepEqual(await restarted.expireAbandonedReservations(), { expired: 0, releasedGbp: 0 });
    await assert.rejects(() => restarted.commit(abandoned.reservationId, { measuredCostGbp: 3 }), { code: "RESERVATION_EXPIRED" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("automatically excludes expired reservations and starts a fresh aggregate in a new month", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-provider-budget-month-"));
  const clock = time();
  try {
    const ledger = new FileSystemProviderBudgetLedger({ root, monthlyCeilingGbp: 10, now: clock.now, reservationTtlMs: 1_000 });
    await ledger.reserve(1);
    clock.advance(1_001);
    const next = await ledger.reserve(7.99);
    assert.equal(next.reservedGbp, 7.99);
    clock.advance(36 * 24 * 60 * 60 * 1_000);
    const newMonth = await ledger.status();
    assert.equal(newMonth.month, "2026-10");
    assert.equal(newMonth.spentGbp, 0);
    assert.equal(newMonth.reservedGbp, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("serializes concurrent controllers and fails closed on corrupt or unpublished state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-provider-budget-concurrent-"));
  try {
    const options = { root, monthlyCeilingGbp: 20, now: () => new Date("2026-08-28T12:00:00.000Z") };
    const left = new FileSystemProviderBudgetLedger(options);
    const right = new FileSystemProviderBudgetLedger(options);
    const results = await Promise.allSettled([
      left.reserve({ estimatedCostGbp: 16 }),
      right.reserve({ estimatedCostGbp: 1 }),
    ]);
    assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(results.filter((item) => item.status === "rejected" && item.reason?.code === "BUDGET_SOFT_STOP").length, 1);
    await writeFile(path.join(root, "provider-budget-ledger.json"), "not-json", "utf8");
    await assert.rejects(() => left.status(), (error: unknown) => error instanceof BudgetLedgerError && error.code === "STATE_CORRUPT");
    const fileRoot = path.join(root, "publication-failure");
    await mkdir(fileRoot, { recursive: true });
    await mkdir(path.join(fileRoot, "provider-budget-ledger.json"), { recursive: true });
    const broken = new FileSystemProviderBudgetLedger({ root: fileRoot });
    await assert.rejects(() => broken.reserve({ estimatedCostGbp: 1 }), (error: unknown) => error instanceof BudgetLedgerError && error.code === "STATE_IO_FAILED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects invalid amounts, measured costs, and reservation identifiers with body-free stable errors", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-provider-budget-invalid-"));
  try {
    const ledger = new FileSystemProviderBudgetLedger({ root });
    for (const amount of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await assert.rejects(() => ledger.reserve({ estimatedCostGbp: amount }), { code: "AMOUNT_INVALID" });
    }
    await assert.rejects(() => ledger.commit("secret-prompt", { measuredCostGbp: 1 }), (error: unknown) => error instanceof BudgetLedgerError && error.code === "RESERVATION_INVALID" && error.message === "RESERVATION_INVALID");
    const reservation = await ledger.reserve({ estimatedCostGbp: 1 });
    await assert.rejects(() => ledger.commit(reservation.reservationId, { measuredCostGbp: Number.NaN }), { code: "COST_INVALID" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("measured cost cannot exceed the pre-call reservation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-provider-budget-overrun-"));
  try {
    const ledger = createProviderBudgetLedger({ root, monthlyCeilingGbp: 20 });
    const reservation = await ledger.reserve({ estimatedCostGbp: 1 });
    await assert.rejects(
      () => ledger.commit(reservation.reservationId, { measuredCostGbp: 1.01 }),
      (error: unknown) => error instanceof BudgetLedgerError && error.code === "COST_INVALID",
    );
    assert.equal((await ledger.status()).spentGbp, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
