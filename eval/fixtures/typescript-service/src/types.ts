export interface WebhookEvent {
  id: string;
  type: "ticket.created" | "ticket.closed";
  payload: Record<string, unknown>;
}

export type WebhookHandler = (event: WebhookEvent) => Promise<void>;
