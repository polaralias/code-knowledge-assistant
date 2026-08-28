import { MemoryEventStore } from "./store.js";
import { WebhookRouter } from "./router.js";
import type { WebhookEvent } from "./types.js";

export interface WebhookRequest {
  body: unknown;
}

export async function receiveWebhook(request: WebhookRequest): Promise<{ status: number }> {
  const event = parseEvent(request.body);
  const router = new WebhookRouter(new MemoryEventStore());
  await router.dispatch(event);
  return { status: 202 };
}

function parseEvent(value: unknown): WebhookEvent {
  if (!isRecord(value) || typeof value.id !== "string") {
    throw new TypeError("webhook id is required");
  }
  if (value.type !== "ticket.created" && value.type !== "ticket.closed") {
    throw new TypeError("unsupported webhook type");
  }
  return { id: value.id, type: value.type, payload: isRecord(value.payload) ? value.payload : {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
