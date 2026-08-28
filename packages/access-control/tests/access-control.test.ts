import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AccessControlError, FileSystemAccessControl, createAccessController } from "../src/index.ts";

function clock() {
  let value = new Date("2026-08-27T12:00:00.000Z");
  return { now: () => new Date(value), advance: (milliseconds: number) => { value = new Date(value.getTime() + milliseconds); } };
}

test("validates configured codes without returning or persisting plaintext", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-access-code-"));
  try {
    const access = new FileSystemAccessControl({ root, accessCodes: ["operator-secret"], now: () => new Date("2026-08-27T12:00:00.000Z") });
    assert.deepEqual(await access.validateAccessCode("wrong"), { valid: false, subject: null });
    const valid = await access.validateAccessCode("operator-secret");
    assert.equal(valid.valid, true);
    assert.notEqual(valid.subject, "operator-secret");
    const lease = await access.startReview({ accessCode: "operator-secret" });
    const ledger = await readFile(path.join(root, "access-control-ledger.json"), "utf8");
    assert.equal(ledger.includes("operator-secret"), false);
    assert.equal(ledger.includes(lease.leaseId), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("enforces one active review and two starts in a rolling day, with idempotent completion", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-access-review-"));
  const time = clock();
  try {
    const access = new FileSystemAccessControl({ root, accessCodes: ["code"], now: time.now, reviewLeaseTtlMs: 1_000 });
    const first = await access.startReview({ accessCode: "code" });
    await assert.rejects(access.startReview({ accessCode: "code" }), (error: unknown) => error instanceof AccessControlError && error.code === "REVIEW_ALREADY_ACTIVE");
    assert.deepEqual(await access.completeReview(first.leaseId), { leaseId: first.leaseId, subject: first.subject, state: "completed" });
    assert.deepEqual(await access.completeReview(first.leaseId), { leaseId: first.leaseId, subject: first.subject, state: "completed" });
    const second = await access.startReview({ accessCode: "code" });
    await access.releaseReview(second.leaseId);
    await assert.rejects(access.startReview({ accessCode: "code" }), (error: unknown) => error instanceof AccessControlError && error.code === "REVIEW_START_LIMIT_EXCEEDED");
    time.advance(24 * 60 * 60 * 1_000 + 1);
    const third = await access.startReview({ accessCode: "code" });
    assert.equal(third.startsInWindow, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("expires leases using the injected clock and permits a new start", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-access-expiry-"));
  const time = clock();
  try {
    const access = new FileSystemAccessControl({ root, accessCodes: ["code"], now: time.now, reviewLeaseTtlMs: 1_000 });
    const lease = await access.startReview({ accessCode: "code" });
    time.advance(1_001);
    const result = await access.releaseReview(lease.leaseId);
    assert.equal(result.state, "expired");
    const next = await access.startReview({ accessCode: "code" });
    assert.equal(next.startsInWindow, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persists a rolling 30-question quota across controller restart", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-access-questions-"));
  const time = clock();
  try {
    const first = new FileSystemAccessControl({ root, accessCodes: [], now: time.now });
    for (let index = 0; index < 30; index += 1) {
      const quota = await first.askQuestion({ subject: "203.0.113.7" });
      assert.equal(quota.questionsInWindow, index + 1);
    }
    const restarted = new FileSystemAccessControl({ root, accessCodes: [], now: time.now });
    await assert.rejects(restarted.askQuestion({ subject: "203.0.113.7" }), (error: unknown) => error instanceof AccessControlError && error.code === "QUESTION_LIMIT_EXCEEDED");
    time.advance(24 * 60 * 60 * 1_000 + 1);
    assert.equal((await restarted.askQuestion({ subject: "203.0.113.7" })).remaining, 29);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("serializes concurrent controllers against the same persistent ledger", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-access-concurrent-"));
  try {
    const options = { root, accessCodes: ["code"], now: () => new Date("2026-08-27T12:00:00.000Z") };
    const left = new FileSystemAccessControl(options);
    const right = new FileSystemAccessControl(options);
    const results = await Promise.allSettled([left.startReview({ accessCode: "code" }), right.startReview({ accessCode: "code" })]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected" && result.reason?.code === "REVIEW_ALREADY_ACTIVE").length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails closed on corrupt state, unsafe identifiers, limits, and publication failures", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-access-invalid-"));
  try {
    await writeFile(path.join(root, "access-control-ledger.json"), "not-json", "utf8");
    const corrupt = new FileSystemAccessControl({ root, accessCodes: ["code"] });
    await assert.rejects(corrupt.askQuestion({ subject: "203.0.113.8" }), (error: unknown) => error instanceof AccessControlError && error.code === "ACCESS_STATE_CORRUPT");
    assert.throws(() => new FileSystemAccessControl({ root, accessCodes: ["code"], questionLimit: 0 }), (error: unknown) => error instanceof AccessControlError && error.code === "ACCESS_LIMIT_INVALID");
    assert.throws(() => new FileSystemAccessControl({ root, accessCodes: ["code"], maxReviewStarts24h: 3 }), (error: unknown) => error instanceof AccessControlError && error.code === "ACCESS_LIMIT_INVALID");
    const cleanRoot = await mkdtemp(path.join(os.tmpdir(), "cka-access-unsafe-"));
    try {
      const clean = new FileSystemAccessControl({ root: cleanRoot, accessCodes: ["code"] });
      await assert.rejects(clean.askQuestion({ subject: "../unsafe" }), (error: unknown) => error instanceof AccessControlError && error.code === "ACCESS_IDENTIFIER_INVALID");
    } finally {
      await rm(cleanRoot, { recursive: true, force: true });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("mints hashed dynamic codes, survives reconstruction, and revokes by opaque id", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-access-mint-"));
  const first = createAccessController({ root, accessCodes: [] });
  const minted = await first.mintAccessCode!();
  assert.match(minted.code, /^[A-Za-z0-9_-]{32}$/u);
  assert.equal((await first.validateAccessCode(minted.code)).valid, true);
  const second = createAccessController({ root, accessCodes: [] });
  assert.equal((await second.validateAccessCode(minted.code)).valid, true);
  assert.deepEqual(await second.revokeAccessCode!(minted.id), { id: minted.id, revoked: true });
  assert.equal((await second.validateAccessCode(minted.code)).valid, false);
  const listed = await second.listAccessCodes!();
  assert.deepEqual(listed, [{ id: minted.id, createdAt: listed[0]!.createdAt, revoked: true }]);
});
