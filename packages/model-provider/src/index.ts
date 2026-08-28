/**
 * A deliberately small, provider-neutral boundary for evaluating structured
 * generation models through an OpenAI-compatible chat-completions endpoint.
 * The transport is injected so this package never needs a live provider in
 * unit or integration tests.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonSchema = { [key: string]: JsonValue };

export type StructuredGenerationRequest = {
  model: string;
  prompt: string;
  schema: JsonSchema;
  /** Optional transport-level generation cap. */
  maxOutputTokens?: number;
  /** A caller cancellation signal, if available. */
  signal?: AbortSignal;
};

export type GenerationBudgets = {
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxTotalTokens?: number;
  maxCostUsd?: number;
};

export type Pricing = {
  /** Cost per input token, in USD. */
  inputCostPerTokenUsd?: number;
  /** Cost per output token, in USD. */
  outputCostPerTokenUsd?: number;
  /** Convenience units accepted by most provider price sheets. */
  inputCostPer1kUsd?: number;
  outputCostPer1kUsd?: number;
  inputCostPerMillionUsd?: number;
  outputCostPerMillionUsd?: number;
};

export type StructuredGenerationUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type StructuredGenerationResult<T = unknown> = {
  /** Exact provider configured for this evaluation. */
  provider: string;
  /** Exact model requested by the caller. */
  requestedModel: string;
  /** Exact model identity returned by the endpoint. */
  model: string;
  /** Exact prompt sent to the endpoint. */
  prompt: string;
  /** Exact JSON schema sent to the endpoint. */
  schema: JsonSchema;
  output: T;
  usage: StructuredGenerationUsage;
  latencyMs: number;
  estimatedCostUsd: number | null;
  /** A stable request envelope for evaluation result serializers. */
  request: {
    provider: string;
    model: string;
    prompt: string;
    schema: JsonSchema;
  };
};

export type StructuredGenerationClient = {
  generate<T = unknown>(request: StructuredGenerationRequest): Promise<StructuredGenerationResult<T>>;
};

export type ProviderErrorCode =
  | "ENDPOINT_INVALID"
  | "API_KEY_INVALID"
  | "PROVIDER_INVALID"
  | "LIMIT_INVALID"
  | "REQUEST_INVALID"
  | "REQUEST_TOO_LARGE"
  | "FETCH_FAILED"
  | "TIMEOUT"
  | "ABORTED"
  | "REDIRECT_DISALLOWED"
  | "HTTP_ERROR"
  | "RESPONSE_TOO_LARGE"
  | "RESPONSE_INVALID"
  | "MODEL_IDENTITY_INVALID"
  | "MODEL_IDENTITY_MISSING"
  | "USAGE_INVALID"
  | "COST_INVALID"
  | "INPUT_TOKEN_LIMIT"
  | "OUTPUT_TOKEN_LIMIT"
  | "TOTAL_TOKEN_LIMIT"
  | "COST_LIMIT"
  | "OUTPUT_INVALID";

/** All public failures intentionally contain only a stable code, never a provider body or credential. */
export class ProviderAdapterError extends Error {
  readonly code: ProviderErrorCode;
  readonly status: number | null;

  constructor(code: ProviderErrorCode, status: number | null = null) {
    super(code);
    this.name = "ProviderAdapterError";
    this.code = code;
    this.status = status;
  }
}

export type FetchResponseLike = {
  status: number;
  ok: boolean;
  redirected?: boolean;
  headers?: { get(name: string): string | null };
  body?: ReadableStream<Uint8Array> | null;
  arrayBuffer?: () => Promise<ArrayBuffer>;
  text?: () => Promise<string>;
};

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<FetchResponseLike>;

export type OpenAICompatibleEvaluationAdapterOptions = {
  provider: string;
  endpoint: string;
  apiKey: string;
  fetch?: FetchLike;
  clock?: () => number;
  timeoutMs?: number;
  requestByteLimit?: number;
  responseByteLimit?: number;
  /** Compatibility aliases for callers that name limits as maxima. */
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  maxLatencyMs?: number;
  /** Provider extension used by hybrid-thinking models during bounded JSON work. */
  enableThinking?: boolean;
  budgets?: GenerationBudgets;
  budget?: GenerationBudgets;
  pricing?: Pricing;
};

const encoder = new TextEncoder();
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_REQUEST_BYTE_LIMIT = 256 * 1024;
const DEFAULT_RESPONSE_BYTE_LIMIT = 2 * 1024 * 1024;

function fail(code: ProviderErrorCode, status: number | null = null): never {
  throw new ProviderAdapterError(code, status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 64) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  if (isRecord(value)) return Object.values(value).every((item) => isJsonValue(item, depth + 1));
  return false;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validToken(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function resolveLimit(value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) fail("LIMIT_INVALID");
  return resolved;
}

function validateOptions(options: OpenAICompatibleEvaluationAdapterOptions): {
  endpoint: string;
  timeoutMs: number;
  requestByteLimit: number;
  responseByteLimit: number;
  budgets: GenerationBudgets;
  pricing: Pricing;
  enableThinking: boolean | undefined;
} {
  if (typeof options.provider !== "string" || options.provider.length === 0 || /[\r\n]/u.test(options.provider)) {
    fail("PROVIDER_INVALID");
  }
  if (typeof options.apiKey !== "string" || options.apiKey.length === 0 || /[\r\n]/u.test(options.apiKey)) {
    fail("API_KEY_INVALID");
  }
  if (options.enableThinking !== undefined && typeof options.enableThinking !== "boolean") fail("LIMIT_INVALID");
  let parsed: URL;
  try {
    parsed = new URL(options.endpoint);
  } catch {
    fail("ENDPOINT_INVALID");
  }
  const credentialQuery = [...parsed.searchParams.entries()].some(([key, value]) =>
    /(?:api[-_]?key|authorization|credential|password|secret|token)/iu.test(key)
      || value === options.apiKey);
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== ""
    || credentialQuery || parsed.hash !== "") {
    fail("ENDPOINT_INVALID");
  }
  const timeoutMs = resolveLimit(options.timeoutMs ?? options.maxLatencyMs, DEFAULT_TIMEOUT_MS);
  const requestByteLimit = resolveLimit(options.requestByteLimit ?? options.maxRequestBytes, DEFAULT_REQUEST_BYTE_LIMIT);
  const responseByteLimit = resolveLimit(options.responseByteLimit ?? options.maxResponseBytes, DEFAULT_RESPONSE_BYTE_LIMIT);
  const budgets = { ...(options.budgets ?? options.budget ?? {}) };
  for (const value of [budgets.maxInputTokens, budgets.maxOutputTokens, budgets.maxTotalTokens]) {
    if (value !== undefined && !Number.isSafeInteger(value) || value !== undefined && value < 0) fail("LIMIT_INVALID");
  }
  if (budgets.maxCostUsd !== undefined && !finiteNonNegative(budgets.maxCostUsd)) fail("LIMIT_INVALID");
  const pricing = { ...(options.pricing ?? {}) };
  for (const value of [pricing.inputCostPerTokenUsd, pricing.outputCostPerTokenUsd,
    pricing.inputCostPer1kUsd, pricing.outputCostPer1kUsd,
    pricing.inputCostPerMillionUsd, pricing.outputCostPerMillionUsd]) {
    if (value !== undefined && !finiteNonNegative(value)) fail("LIMIT_INVALID");
  }
  return { endpoint: parsed.toString(), timeoutMs, requestByteLimit, responseByteLimit, budgets, pricing,
    enableThinking: options.enableThinking };
}

function validateRequest(request: StructuredGenerationRequest): void {
  if (!isRecord(request) || typeof request.model !== "string" || request.model.length === 0
    || /[\r\n]/u.test(request.model) || typeof request.prompt !== "string"
    || !isRecord(request.schema) || !isJsonValue(request.schema)) {
    fail("REQUEST_INVALID");
  }
  if (request.maxOutputTokens !== undefined && !validToken(request.maxOutputTokens)) fail("REQUEST_INVALID");
}

function jsonObjectPrompt(request: StructuredGenerationRequest): string {
  return [
    request.prompt,
    "Return exactly one JSON object matching the JSON Schema below. Do not include Markdown or any text outside the JSON object.",
    JSON.stringify(request.schema),
  ].join("\n\n");
}

function bodyText(response: FetchResponseLike, limit: number): Promise<string> {
  const declared = response.headers?.get("content-length");
  if (declared !== null && declared !== undefined && /^\d+$/u.test(declared) && Number(declared) > limit) {
    fail("RESPONSE_TOO_LARGE");
  }
  if (response.body?.getReader) {
    return (async () => {
      const reader = response.body!.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          const chunk = part.value instanceof Uint8Array ? part.value : new Uint8Array(part.value);
          size += chunk.byteLength;
          if (size > limit) {
            await reader.cancel();
            fail("RESPONSE_TOO_LARGE");
          }
          chunks.push(chunk);
        }
      } finally {
        reader.releaseLock();
      }
      const joined = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new TextDecoder().decode(joined);
    })();
  }
  if (response.arrayBuffer) {
    return response.arrayBuffer().then((buffer) => {
      if (buffer.byteLength > limit) fail("RESPONSE_TOO_LARGE");
      return new TextDecoder().decode(buffer);
    });
  }
  if (response.text) {
    return response.text().then((text) => {
      if (encoder.encode(text).byteLength > limit) fail("RESPONSE_TOO_LARGE");
      return text;
    });
  }
  fail("RESPONSE_INVALID");
}

function extractContent(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return null;
  const texts: string[] = [];
  for (const part of value) {
    if (typeof part === "string") texts.push(part);
    else if (isRecord(part) && typeof part.text === "string") texts.push(part.text);
  }
  return texts.length > 0 ? texts.join("") : null;
}

function responseOutput(payload: unknown): { model: string; output: unknown; usage: unknown; cost: unknown } {
  if (!isRecord(payload) || !Object.prototype.hasOwnProperty.call(payload, "model")) {
    fail("MODEL_IDENTITY_MISSING");
  }
  if (typeof payload.model !== "string" || payload.model.length === 0) fail("MODEL_IDENTITY_INVALID");
  const choices = payload.choices;
  const first = Array.isArray(choices) ? choices[0] : undefined;
  const message = isRecord(first) && isRecord(first.message) ? first.message : null;
  const content = message === null ? null : extractContent(message.content);
  if (content === null) fail("OUTPUT_INVALID");
  let output: unknown;
  try {
    output = JSON.parse(content);
  } catch {
    fail("OUTPUT_INVALID");
  }
  return {
    model: payload.model,
    output,
    usage: payload.usage,
    cost: payload.cost_usd ?? payload.estimated_cost_usd
      ?? (isRecord(payload.usage) ? payload.usage.cost_usd ?? payload.usage.cost : undefined),
  };
}

function usageValues(raw: unknown): StructuredGenerationUsage {
  if (!isRecord(raw)) return { inputTokens: null, outputTokens: null, totalTokens: null };
  const input = raw.input_tokens ?? raw.prompt_tokens;
  const output = raw.output_tokens ?? raw.completion_tokens;
  const total = raw.total_tokens;
  for (const value of [input, output, total]) {
    if (value !== undefined && !validToken(value)) fail("USAGE_INVALID");
  }
  const inputTokens = input === undefined ? null : input as number;
  const outputTokens = output === undefined ? null : output as number;
  const totalTokens = total === undefined
    ? inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null
    : total as number;
  return { inputTokens, outputTokens, totalTokens };
}

function validateSchemaOutput(value: unknown, schema: JsonSchema, depth = 0): boolean {
  if (depth > 64 || !isRecord(schema)) return false;
  if (schema.enum !== undefined && Array.isArray(schema.enum)
    && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) return false;
  if (schema.const !== undefined && JSON.stringify(schema.const) !== JSON.stringify(value)) return false;
  const type = schema.type;
  if (typeof type === "string") {
    const valid = type === "null" ? value === null
      : type === "array" ? Array.isArray(value)
        : type === "object" ? isRecord(value)
          : type === "integer" ? typeof value === "number" && Number.isSafeInteger(value)
            : type === "number" ? typeof value === "number" && Number.isFinite(value)
              : typeof value === type;
    if (!valid) return false;
  }
  if (typeof schema.minLength === "number" && typeof value === "string" && value.length < schema.minLength) return false;
  if (typeof schema.maxLength === "number" && typeof value === "string" && value.length > schema.maxLength) return false;
  if (isRecord(schema.properties)) {
    if (!isRecord(value)) return false;
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) if (typeof key !== "string" || !Object.prototype.hasOwnProperty.call(value, key)) return false;
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties));
      if (Object.keys(value).some((key) => !allowed.has(key))) return false;
    }
    for (const [key, child] of Object.entries(schema.properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key) && isRecord(child)
        && !validateSchemaOutput(value[key], child as JsonSchema, depth + 1)) return false;
    }
  }
  if (isRecord(schema.items) && Array.isArray(value)
    && value.some((item) => !validateSchemaOutput(item, schema.items as JsonSchema, depth + 1))) return false;
  return true;
}

function reportedCost(raw: unknown, usage: StructuredGenerationUsage, pricing: Pricing): number | null {
  if (raw !== undefined) {
    if (!finiteNonNegative(raw)) fail("COST_INVALID");
    return raw;
  }
  const inputRate = pricing.inputCostPerTokenUsd
    ?? (pricing.inputCostPer1kUsd === undefined ? undefined : pricing.inputCostPer1kUsd / 1_000)
    ?? (pricing.inputCostPerMillionUsd === undefined ? undefined : pricing.inputCostPerMillionUsd / 1_000_000);
  const outputRate = pricing.outputCostPerTokenUsd
    ?? (pricing.outputCostPer1kUsd === undefined ? undefined : pricing.outputCostPer1kUsd / 1_000)
    ?? (pricing.outputCostPerMillionUsd === undefined ? undefined : pricing.outputCostPerMillionUsd / 1_000_000);
  let cost = 0;
  let measured = false;
  if (usage.inputTokens !== null && inputRate !== undefined) { cost += usage.inputTokens * inputRate; measured = true; }
  else if (usage.inputTokens !== null && outputRate !== undefined && usage.outputTokens === null) return null;
  if (usage.outputTokens !== null && outputRate !== undefined) { cost += usage.outputTokens * outputRate; measured = true; }
  else if (usage.outputTokens !== null && inputRate !== undefined && usage.inputTokens === null) return null;
  return measured ? cost : null;
}

function assertBudgets(usage: StructuredGenerationUsage, cost: number | null, budgets: GenerationBudgets): void {
  if (budgets.maxInputTokens !== undefined && usage.inputTokens === null) fail("USAGE_INVALID");
  if (budgets.maxOutputTokens !== undefined && usage.outputTokens === null) fail("USAGE_INVALID");
  if (budgets.maxTotalTokens !== undefined && usage.totalTokens === null) fail("USAGE_INVALID");
  if (budgets.maxCostUsd !== undefined && cost === null) fail("COST_INVALID");
  if (budgets.maxInputTokens !== undefined && usage.inputTokens! > budgets.maxInputTokens) fail("INPUT_TOKEN_LIMIT");
  if (budgets.maxOutputTokens !== undefined && usage.outputTokens! > budgets.maxOutputTokens) fail("OUTPUT_TOKEN_LIMIT");
  if (budgets.maxTotalTokens !== undefined && usage.totalTokens! > budgets.maxTotalTokens) fail("TOTAL_TOKEN_LIMIT");
  if (budgets.maxCostUsd !== undefined && cost! > budgets.maxCostUsd) fail("COST_LIMIT");
}

export function createOpenAICompatibleEvaluationAdapter(
  options: OpenAICompatibleEvaluationAdapterOptions,
): StructuredGenerationClient {
  const resolved = validateOptions(options);
  const transport: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const clock = options.clock ?? (() => performance.now());
  return Object.freeze({
    async generate<T = unknown>(request: StructuredGenerationRequest): Promise<StructuredGenerationResult<T>> {
      validateRequest(request);
      const maxOutputTokens = request.maxOutputTokens ?? resolved.budgets.maxOutputTokens;
      if (maxOutputTokens !== undefined && !validToken(maxOutputTokens)) fail("REQUEST_INVALID");
      if (resolved.budgets.maxOutputTokens !== undefined && maxOutputTokens !== undefined
        && maxOutputTokens > resolved.budgets.maxOutputTokens) fail("OUTPUT_TOKEN_LIMIT");
      let body: string;
      const prompt = jsonObjectPrompt(request);
      try {
        body = JSON.stringify({
          model: request.model,
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
          ...(resolved.enableThinking === undefined ? {} : { enable_thinking: resolved.enableThinking }),
          ...(maxOutputTokens === undefined ? {} : { max_tokens: maxOutputTokens }),
        });
      } catch {
        fail("REQUEST_INVALID");
      }
      if (body === undefined || body.includes(options.apiKey)) fail("REQUEST_INVALID");
      if (encoder.encode(body).byteLength > resolved.requestByteLimit) fail("REQUEST_TOO_LARGE");

      const controller = new AbortController();
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onAbort = () => controller.abort();
      if (request.signal) {
        if (request.signal.aborted) fail("ABORTED");
        request.signal.addEventListener("abort", onAbort, { once: true });
      }
      timer = setTimeout(() => { timedOut = true; controller.abort(); }, resolved.timeoutMs);
      const started = clock();
      let response: FetchResponseLike;
      try {
        response = await transport(resolved.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${options.apiKey}` },
          body,
          redirect: "error",
          signal: controller.signal,
        });
      } catch {
        if (timedOut) fail("TIMEOUT");
        if (request.signal?.aborted) fail("ABORTED");
        fail("FETCH_FAILED");
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        request.signal?.removeEventListener("abort", onAbort);
      }
      if (response.redirected) fail("REDIRECT_DISALLOWED");
      if (!response.ok || response.status < 200 || response.status >= 300) fail("HTTP_ERROR", response.status);
      let payload: unknown;
      try {
        payload = JSON.parse(await bodyText(response, resolved.responseByteLimit));
      } catch (error) {
        if (error instanceof ProviderAdapterError) throw error;
        fail("RESPONSE_INVALID");
      }
      const parsed = responseOutput(payload);
      const usage = usageValues(parsed.usage);
      const cost = reportedCost(parsed.cost, usage, resolved.pricing);
      assertBudgets(usage, cost, resolved.budgets);
      if (!isJsonValue(parsed.output) || !validateSchemaOutput(parsed.output, request.schema)) fail("OUTPUT_INVALID");
      const latencyMs = Math.max(0, clock() - started);
      return {
        provider: options.provider,
        requestedModel: request.model,
        model: parsed.model,
        prompt,
        schema: request.schema,
        output: parsed.output as T,
        usage,
        latencyMs,
        estimatedCostUsd: cost,
        request: { provider: options.provider, model: request.model, prompt, schema: request.schema },
      };
    },
  });
}

/** Short alias for callers that do not need the longer evaluation-specific name. */
export const createStructuredGenerationClient = createOpenAICompatibleEvaluationAdapter;
