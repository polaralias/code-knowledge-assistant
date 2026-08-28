import assert from "node:assert/strict";
import test from "node:test";

import {
  ProviderAdapterError,
  createOpenAICompatibleEvaluationAdapter,
} from "../src/index.ts";

function response(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

const request = {
  model: "candidate-requested",
  prompt: "Return the bounded result.",
  schema: {
    type: "object",
    properties: { answer: { type: "string" } },
    required: ["answer"],
    additionalProperties: false,
  },
};

test("generates structured JSON and preserves exact request and returned model metadata", async () => {
  let fetchUrl = "";
  let fetchInit: RequestInit | undefined;
  const adapter = createOpenAICompatibleEvaluationAdapter({
    provider: "evaluation-provider",
    endpoint: "https://provider.example/v1/chat/completions",
    apiKey: "secret-key",
    clock: (() => {
      const values = [100, 142];
      return () => values.shift() ?? 142;
    })(),
    fetch: async (url, init) => {
      fetchUrl = String(url);
      fetchInit = init;
      return response({
        model: "candidate-served-2026-08-01",
        choices: [{ message: { content: '{"answer":"ok"}' } }],
        usage: { prompt_tokens: 12, completion_tokens: 4 },
        estimated_cost_usd: 0.003,
      });
    },
  });

  const result = await adapter.generate(request);

  assert.equal(fetchUrl, "https://provider.example/v1/chat/completions");
  assert.equal(result.provider, "evaluation-provider");
  assert.equal(result.requestedModel, "candidate-requested");
  assert.equal(result.model, "candidate-served-2026-08-01");
  const sent = JSON.parse(String(fetchInit?.body));
  assert.deepEqual(sent.response_format, { type: "json_object" });
  assert.match(sent.messages[0].content, /Return exactly one JSON object/u);
  assert.match(sent.messages[0].content, /"answer"/u);
  assert.equal(result.prompt, sent.messages[0].content);
  assert.deepEqual(result.schema, request.schema);
  assert.deepEqual(result.output, { answer: "ok" });
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 4, totalTokens: 16 });
  assert.equal(result.latencyMs, 42);
  assert.equal(result.estimatedCostUsd, 0.003);
  assert.equal((fetchInit?.headers as Record<string, string>).authorization, "Bearer secret-key");
  assert.equal(fetchInit?.redirect, "error");
  assert.equal(fetchInit?.method, "POST");
  assert.equal(String(fetchInit?.body).includes("secret-key"), false);
});

test("rejects credentialed or non-HTTPS endpoints before making a request", async () => {
  let calls = 0;
  const fetch = async () => {
    calls += 1;
    return response({});
  };
  for (const endpoint of [
    "http://provider.example/v1/chat/completions",
    "https://user:password@provider.example/v1/chat/completions",
    "https://provider.example/v1/chat/completions?api_key=secret",
  ]) {
    assert.throws(
      () => createOpenAICompatibleEvaluationAdapter({ provider: "p", endpoint, apiKey: "secret", fetch }),
      (error: unknown) => error instanceof ProviderAdapterError && error.code === "ENDPOINT_INVALID",
    );
  }
  assert.equal(calls, 0);
});

test("rejects an oversized request before transport and keeps transport failures body-free", async () => {
  let calls = 0;
  const adapter = createOpenAICompatibleEvaluationAdapter({
    provider: "p",
    endpoint: "https://provider.example/v1/chat/completions?region=eu",
    apiKey: "secret",
    requestByteLimit: 32,
    fetch: async () => {
      calls += 1;
      throw new Error("provider body secret");
    },
  });
  await assert.rejects(() => adapter.generate(request), { code: "REQUEST_TOO_LARGE" });
  assert.equal(calls, 0);

  const failing = createOpenAICompatibleEvaluationAdapter({
    provider: "p",
    endpoint: "https://provider.example/v1/chat/completions",
    apiKey: "secret",
    fetch: async () => { throw new Error("upstream response has secret"); },
  });
  await assert.rejects(
    () => failing.generate({ ...request, prompt: "small" }),
    (error: unknown) => error instanceof ProviderAdapterError
      && error.code === "FETCH_FAILED"
      && error.message === "FETCH_FAILED"
      && !error.message.includes("secret"),
  );
});

test("enforces token and cost ceilings using finite reported usage", async () => {
  const adapter = createOpenAICompatibleEvaluationAdapter({
    provider: "p",
    endpoint: "https://provider.example/v1/chat/completions",
    apiKey: "secret",
    budgets: { maxInputTokens: 10, maxOutputTokens: 10, maxCostUsd: 0.01 },
    fetch: async () => response({
      model: "served",
      choices: [{ message: { content: '{"answer":"ok"}' } }],
      usage: { prompt_tokens: 11, completion_tokens: 2 },
      cost_usd: 0.001,
    }),
  });

  await assert.rejects(
    () => adapter.generate(request),
    (error: unknown) => error instanceof ProviderAdapterError && error.code === "INPUT_TOKEN_LIMIT",
  );
});

test("calculates provider cost from explicit per-million-token pricing when the response omits cost", async () => {
  const adapter = createOpenAICompatibleEvaluationAdapter({
    provider: "p",
    endpoint: "https://provider.example/v1/chat/completions",
    apiKey: "secret",
    budgets: { maxCostUsd: 0.01 },
    pricing: { inputCostPerMillionUsd: 0.144, outputCostPerMillionUsd: 0.574 },
    fetch: async () => response({
      model: "served",
      choices: [{ message: { content: '{"answer":"ok"}' } }],
      usage: { prompt_tokens: 1_000, completion_tokens: 500 },
    }),
  });

  const result = await adapter.generate(request);

  assert.ok(Math.abs((result.estimatedCostUsd ?? 0) - 0.000431) < 1e-12);
});

test("rejects missing or non-finite measured usage when a relevant budget is configured", async () => {
  const make = (usage: unknown, budget: Record<string, number>, includeCost = true) => createOpenAICompatibleEvaluationAdapter({
    provider: "p",
    endpoint: "https://provider.example/v1/chat/completions",
    apiKey: "secret",
    budgets: budget,
    fetch: async () => response({
      model: "served",
      choices: [{ message: { content: '{"answer":"ok"}' } }],
      usage,
      ...(includeCost ? { cost_usd: 0.001 } : {}),
    }),
  });
  await assert.rejects(() => make(undefined, { maxInputTokens: 10 }).generate(request), { code: "USAGE_INVALID" });
  await assert.rejects(() => make({ prompt_tokens: Number.NaN }, { maxInputTokens: 10 }).generate(request), { code: "USAGE_INVALID" });
  await assert.rejects(() => make({ prompt_tokens: 1, completion_tokens: 1 }, { maxCostUsd: 0.01 }, false).generate(request), { code: "COST_INVALID" });
});

test("bounds response bytes and exposes stable body-free failures", async () => {
  const sensitiveBody = "provider internal secret-key response details";
  const adapter = createOpenAICompatibleEvaluationAdapter({
    provider: "p",
    endpoint: "https://provider.example/v1/chat/completions",
    apiKey: "secret-key",
    responseByteLimit: 10,
    fetch: async () => response(sensitiveBody),
  });
  await assert.rejects(
    () => adapter.generate(request),
    (error: unknown) => error instanceof ProviderAdapterError
      && error.code === "RESPONSE_TOO_LARGE"
      && error.message === "RESPONSE_TOO_LARGE"
      && !error.message.includes(sensitiveBody)
      && !error.message.includes("secret-key"),
  );
});

test("uses timeout abort and does not follow redirects", async () => {
  let seenSignal: AbortSignal | undefined;
  const adapter = createOpenAICompatibleEvaluationAdapter({
    provider: "p",
    endpoint: "https://provider.example/v1/chat/completions",
    apiKey: "secret",
    timeoutMs: 5,
    fetch: async (_url, init) => {
      seenSignal = init?.signal as AbortSignal;
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      if (seenSignal.aborted) throw new Error("transport details secret");
      return response({});
    },
  });
  await assert.rejects(() => adapter.generate(request), { code: "TIMEOUT" });
  assert.equal(seenSignal?.aborted, true);
});

test("rejects malformed or schema-incompatible structured output as untrusted", async () => {
  const make = (content: string) => createOpenAICompatibleEvaluationAdapter({
    provider: "p",
    endpoint: "https://provider.example/v1/chat/completions",
    apiKey: "secret",
    fetch: async () => response({ model: "served", choices: [{ message: { content } }] }),
  });
  await assert.rejects(() => make("not-json").generate(request), { code: "OUTPUT_INVALID" });
  await assert.rejects(() => make('{"answer":3}').generate(request), { code: "OUTPUT_INVALID" });
});
