import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createReviewApiServer } from "../src/index.ts";

async function listen(server: ReturnType<typeof createReviewApiServer>): Promise<{ origin: string; close: () => Promise<void> }> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("address");
  return { origin: `http://127.0.0.1:${address.port}`, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

test("admin credentials protect mint/list/revoke and mint returns a one-time code", async () => {
  let revoked = "";
  const server = createReviewApiServer({ async loadReview() { return {}; }, async answerQuestion() { return {}; } }, {
    admin: { username: "operator", password: "correct-password", accessControl: {
      async mintAccessCode() { return { id: "abcdef123456", code: "one-time-code" }; },
      async revokeAccessCode(id) { revoked = id; return { id, revoked: true }; },
      async listAccessCodes() { return [{ id: "abcdef123456", createdAt: "2026-08-28T00:00:00.000Z", revoked: false }]; },
    } },
  });
  const running = await listen(server);
  try {
    const denied = await fetch(`${running.origin}/api/admin/access-codes`, { headers: { "x-admin-csrf": "bad" } });
    assert.equal(denied.status, 401);
    const login = await fetch(`${running.origin}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "operator", password: "correct-password" }) });
    assert.equal(login.status, 200);
    const loginBody = await login.json() as { csrf: string };
    const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(cookie);
    const minted = await fetch(`${running.origin}/api/admin/access-codes`, { method: "POST", headers: { cookie, "x-admin-csrf": loginBody.csrf, "content-type": "application/json" }, body: "{}" });
    assert.deepEqual(await minted.json(), { id: "abcdef123456", code: "one-time-code" });
    const revokedResponse = await fetch(`${running.origin}/api/admin/access-codes/abcdef123456`, { method: "DELETE", headers: { cookie, "x-admin-csrf": loginBody.csrf } });
    assert.equal(revokedResponse.status, 200); assert.equal(revoked, "abcdef123456");
  } finally { await running.close(); }
});
