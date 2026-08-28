import type { WebhookEvent, WebhookHandler } from "./types.js";
import type { EventStore } from "./store.js";

export class WebhookRouter {
  readonly #handlers = new Map<WebhookEvent["type"], WebhookHandler[]>();

  constructor(private readonly store: EventStore) {}

  register(type: WebhookEvent["type"], handler: WebhookHandler): void {
    const handlers = this.#handlers.get(type) ?? [];
    handlers.push(handler);
    this.#handlers.set(type, handlers);
  }

  async dispatch(event: WebhookEvent): Promise<void> {
    await this.store.save(event);
    for (const handler of this.#handlers.get(event.type) ?? []) {
      await handler(event);
    }
  }
}
