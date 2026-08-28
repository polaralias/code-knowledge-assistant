import type { WebhookEvent } from "./types.js";

export interface EventStore {
  save(event: WebhookEvent): Promise<void>;
  list(): readonly WebhookEvent[];
}

export class MemoryEventStore implements EventStore {
  readonly #events: WebhookEvent[] = [];

  async save(event: WebhookEvent): Promise<void> {
    this.#events.push(event);
  }

  list(): readonly WebhookEvent[] {
    return [...this.#events];
  }
}
