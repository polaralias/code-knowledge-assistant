import assert from "node:assert/strict";
import test from "node:test";

import { parseHostedAccessCodes } from "../src/hosted-config.ts";

test("accepts a non-empty JSON array without normalising access-code secrets", () => {
  assert.deepEqual(parseHostedAccessCodes('["code one","code-two"]'), ["code one", "code-two"]);
});

test("fails closed with a body-free code for missing or malformed hosted access configuration", () => {
  for (const value of [undefined, "", "[]", '"code"', '["", "code"]', '["duplicate","duplicate"]']) {
    assert.throws(() => parseHostedAccessCodes(value), (error: unknown) => error instanceof Error && error.message === "REVIEW_ACCESS_CODES_INVALID");
  }
});
