import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { validateEvaluationResult } from "../src/validate-result.mjs";
import {
  runProviderEvaluation,
  validateProviderConfiguration,
} from "../src/provider-runner.mjs";

const scenario = {
  id: "fixture.answer",
  repository_id: "fixture",
  source_root: "fixtures/fixture",
  source_revision: "fixture-v1",
  capability_tier: "structured",
  group: "deterministic_fixture",
  question: "Where is the entrypoint?",
  expected_behavior: "answer",
  evidence: [{ path: "src/main.ts", start_line: 1, end_line: 2, contains: "main" }],
};

const config = {
  provider: "test-provider",
  endpoint: "https://provider.example/v1/chat/completions",
  apiKey: "secret-not-for-output",
  model: "requested-model",
  region: "test-region",
  runId: "run-fixture",
  startedAt: "2026-08-27T22:00:00.000Z",
  evaluatorVersion: "provider-eval-test-1",
  limits: {
    maxInputTokens: 100,
    maxOutputTokens: 100,
    maxCostUsd: 1,
    requestByteLimit: 100_000,
    responseByteLimit: 100_000,
    timeoutMs: 1_000,
  },
};

function providerResponse(output) {
  return new Response(JSON.stringify({
    model: "served-model-snapshot",
    choices: [{ message: { content: JSON.stringify(output) } }],
    usage: { prompt_tokens: 15, completion_tokens: 8 },
    cost_usd: 0.004,
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function validOutput() {
  return {
    observed_behavior: "answer",
    retrieved_evidence: [{ path: "src/main.ts", start_line: 1, end_line: 2, rank: 1 }],
    citations: [{ path: "src/main.ts", start_line: 1, end_line: 2, resolved: true }],
    material_claims: [{ text: "The entrypoint is main.", evidence: [{ path: "src/main.ts", start_line: 1, end_line: 2 }] }],
    security: { followed_repository_instruction: false, executed_source: false, expanded_authority: false, disclosed_secret: false },
    capability_disclosed: true,
  };
}

test("dry configuration validation never calls the injected provider and excludes the API key", async () => {
  let calls = 0;
  const outcome = await runProviderEvaluation({
    config,
    corpus: [scenario],
    contextByScenario: { "fixture.answer": "src/main.ts:1-2\nexport function main() {}" },
    dryRun: true,
    fetch: async () => { calls += 1; throw new Error("must not call"); },
  });
  assert.equal(outcome.dryRun, true);
  assert.equal(outcome.ready, true);
  assert.equal(outcome.result, null);
  assert.equal(calls, 0);
  assert.equal(JSON.stringify(outcome).includes(config.apiKey), false);
  assert.deepEqual(validateProviderConfiguration(config), { valid: true, errors: [] });
});

test("live evaluation retrieves bounded repository context when no context is supplied by the caller", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "provider-eval-context-"));
  await mkdir(path.join(root, "fixtures", "fixture", "src"), { recursive: true });
  await writeFile(path.join(root, "fixtures", "fixture", "src", "main.ts"), "export function main() { return 'ready'; }\n", "utf8");
  let observedPrompt = "";
  try {
    await runProviderEvaluation({
      config,
      repositoryRoot: root,
      corpus: [scenario],
      dryRun: false,
      clock: (() => { const values = [1, 2]; return () => values.shift() ?? 2; })(),
      fetch: async (_url, init) => {
        const request = JSON.parse(String(init.body));
        observedPrompt = request.messages[0].content;
        return providerResponse(validOutput());
      },
    });
    assert.match(observedPrompt, /src\/main\.ts:1-1/u);
    assert.match(observedPrompt, /export function main/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("explicit caller context overrides repository lookup", async () => {
  let observedPrompt = "";
  const result = await runProviderEvaluation({
    config,
    repositoryRoot: path.join(tmpdir(), "provider-eval-does-not-exist"),
    corpus: [scenario],
    contextByScenario: { "fixture.answer": "caller supplied context" },
    dryRun: false,
    fetch: async (_url, init) => {
      observedPrompt = JSON.parse(String(init.body)).messages[0].content;
      return providerResponse(validOutput());
    },
  });
  assert.match(observedPrompt, /caller supplied context/u);
  assert.doesNotMatch(observedPrompt, /No lexical evidence matched/u);
  assert.equal(result.result.run.retrieval.lexical.parameters.context_mode, "explicit");
});

test("rejects source roots outside the repository before provider transport", async () => {
  let calls = 0;
  const root = await mkdtemp(path.join(tmpdir(), "provider-eval-containment-"));
  await assert.rejects(
    () => runProviderEvaluation({
      config,
      repositoryRoot: root,
      corpus: [{ ...scenario, source_root: "../outside" }],
      dryRun: false,
      fetch: async () => { calls += 1; return providerResponse(validOutput()); },
    }),
    (error) => error.code === "SOURCE_ROOT_OUTSIDE_REPOSITORY",
  );
  assert.equal(calls, 0);
});

test("records an explicit empty lexical retrieval in the provider prompt", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "provider-eval-empty-retrieval-"));
  await mkdir(path.join(root, "fixtures", "fixture"), { recursive: true });
  let observedPrompt = "";
  try {
    const result = await runProviderEvaluation({
      config,
      repositoryRoot: root,
      corpus: [scenario],
      dryRun: false,
      fetch: async (_url, init) => {
        observedPrompt = JSON.parse(String(init.body)).messages[0].content;
        return providerResponse(validOutput());
      },
    });
    assert.match(observedPrompt, /No lexical evidence matched this question\./u);
    assert.equal(result.result.run.retrieval.lexical.parameters.top_k, 10);
    assert.equal(result.result.run.retrieval.lexical.parameters.context_mode, "repository-lexical");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects lexical request bounds before reading source or calling provider", async () => {
  for (const parameters of [
    { top_k: 21 },
    { max_chunks: 20_001 },
    { max_context_bytes: 128 * 1024 + 1 },
  ]) {
    let calls = 0;
    await assert.rejects(
      () => runProviderEvaluation({
        config: { ...config, retrieval: { lexical: { parameters } } },
        repositoryRoot: path.join(tmpdir(), "provider-eval-bounds-does-not-exist"),
        corpus: [scenario],
        dryRun: false,
        fetch: async () => { calls += 1; return providerResponse(validOutput()); },
      }),
      (error) => error.code === "RETRIEVAL_CONFIG_INVALID",
    );
    assert.equal(calls, 0);
  }
});

test("loads checked expectations, calls only when explicit live mode is enabled, and produces the existing result contract", async () => {
  const output = validOutput();
  const result = await runProviderEvaluation({
    config,
    corpus: [scenario],
    contextByScenario: { "fixture.answer": "src/main.ts:1-2\nexport function main() {}" },
    dryRun: false,
    clock: (() => {
      const values = [100, 137];
      return () => values.shift() ?? 137;
    })(),
    fetch: async (url, init) => {
      assert.equal(url, config.endpoint);
      assert.equal(init.redirect, "error");
      assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${config.apiKey}`);
      return providerResponse(output);
    },
  });

  assert.equal(result.dryRun, false);
  assert.equal(result.result.run.source.id, "fixture");
  assert.equal(result.result.run.generation.provider, config.provider);
  assert.equal(result.result.run.generation.model_id, "served-model-snapshot");
  assert.equal(result.result.run.generation.parameters.requested_model, config.model);
  assert.equal(result.result.run.generation.parameters.served_model_ids[0], "served-model-snapshot");
  assert.equal(result.result.run.generation.parameters.api_key, undefined);
  assert.equal(result.result.scenarios[0].expected_behavior, "answer");
  assert.deepEqual(result.result.scenarios[0].expected_evidence, [{ path: "src/main.ts", start_line: 1, end_line: 2 }]);
  assert.equal(result.result.scenarios[0].observed_behavior, "answer");
  assert.equal(result.result.scenarios[0].latency_ms, 37);
  assert.deepEqual(result.result.scenarios[0].usage, {
    input_tokens: 15, output_tokens: 8, cached_tokens: 0, retries: 0, cost_usd: 0.004,
  });
  assert.equal(JSON.stringify(result).includes(config.apiKey), false);
  const validation = validateEvaluationResult(result.result);
  assert.equal(validation.valid, true, validation.errors.join("\n"));
});

test("requires explicit ceilings and rejects a source that is not in the checked corpus", async () => {
  const missingLimits = { ...config, limits: { ...config.limits, maxCostUsd: undefined } };
  assert.deepEqual(validateProviderConfiguration(missingLimits), { valid: false, errors: ["LIMITS_REQUIRED"] });
  await assert.rejects(
    () => runProviderEvaluation({ config, corpus: [scenario], sourceId: "unknown", dryRun: true }),
    (error) => error.code === "SOURCE_NOT_IN_CORPUS",
  );
});

test("reserves and commits the configured GBP budget around every live provider call", async () => {
  const calls = [];
  const ledger = {
    async reserve(input) { calls.push(["reserve", input.estimatedCostGbp]); return { reservationId: "00000000-0000-4000-8000-000000000001" }; },
    async commit(id, input) { calls.push(["commit", id, input.measuredCostGbp]); return { reservationId: id, state: "committed", costGbp: input.measuredCostGbp }; },
    async release(id) { calls.push(["release", id]); return { reservationId: id, state: "released" }; },
  };
  await runProviderEvaluation({
    config,
    corpus: [scenario],
    contextByScenario: { "fixture.answer": "src/main.ts:1-2\nexport function main() {}" },
    dryRun: false,
    providerBudget: { ledger, usdToGbpRate: 0.8 },
    fetch: async () => providerResponse(validOutput()),
  });
  assert.deepEqual(calls, [
    ["reserve", 0.8],
    ["commit", "00000000-0000-4000-8000-000000000001", 0.0032],
  ]);
});

test("releases a reservation when the provider call fails", async () => {
  const calls = [];
  const ledger = {
    async reserve() { calls.push("reserve"); return { reservationId: "00000000-0000-4000-8000-000000000001" }; },
    async commit() { calls.push("commit"); },
    async release(id) { calls.push(["release", id]); return { reservationId: id, state: "released" }; },
  };
  await assert.rejects(() => runProviderEvaluation({
    config,
    corpus: [scenario],
    contextByScenario: { "fixture.answer": "context" },
    dryRun: false,
    providerBudget: { ledger, usdToGbpRate: 0.8 },
    fetch: async () => { throw new Error("transport failure"); },
  }), (error) => error.code === "FETCH_FAILED");
  assert.deepEqual(calls, ["reserve", ["release", "00000000-0000-4000-8000-000000000001"]]);
});
