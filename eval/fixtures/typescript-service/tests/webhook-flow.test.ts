import assert from "node:assert/strict";
import test from "node:test";

import { receiveWebhook } from "../src/index.js";

test("a valid webhook is accepted", async () => {
  const response = await receiveWebhook({
    body: { id: "evt-1", type: "ticket.created", payload: { ticketId: 7 } },
  });

  assert.deepEqual(response, { status: 202 });
});
