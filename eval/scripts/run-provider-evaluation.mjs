#!/usr/bin/env node

import { runProviderEvaluation } from "../../packages/evaluation/src/provider-runner.mjs";
import { createProviderBudgetLedger } from "../../packages/provider-budget/src/index.ts";

function envNumber(environment, name) {
  const value = environment[name];
  return value === undefined || value === "" ? undefined : Number(value);
}

function optionValue(argumentsList, name) {
  const prefix = `${name}=`;
  const argument = argumentsList.find((item) => item.startsWith(prefix));
  return argument === undefined ? undefined : argument.slice(prefix.length);
}

function configurationFromEnvironment(environment, argumentsList) {
  return {
    provider: environment.EVAL_PROVIDER ?? environment.MODEL_PROVIDER,
    endpoint: environment.EVAL_PROVIDER_ENDPOINT ?? environment.MODEL_PROVIDER_ENDPOINT,
    apiKey: environment.EVAL_PROVIDER_API_KEY ?? environment.MODEL_PROVIDER_API_KEY,
    model: environment.EVAL_PROVIDER_MODEL ?? environment.MODEL_PROVIDER_MODEL,
    region: environment.EVAL_PROVIDER_REGION ?? environment.MODEL_PROVIDER_REGION,
    pricing: {
      inputCostPerMillionUsd: envNumber(environment, "EVAL_INPUT_COST_PER_MILLION_USD"),
      outputCostPerMillionUsd: envNumber(environment, "EVAL_OUTPUT_COST_PER_MILLION_USD"),
    },
    sourceId: optionValue(argumentsList, "--source"),
    limits: {
      maxInputTokens: envNumber(environment, "EVAL_MAX_INPUT_TOKENS"),
      maxOutputTokens: envNumber(environment, "EVAL_MAX_OUTPUT_TOKENS"),
      maxTotalTokens: envNumber(environment, "EVAL_MAX_TOTAL_TOKENS"),
      maxCostUsd: envNumber(environment, "EVAL_MAX_COST_USD"),
      requestByteLimit: envNumber(environment, "EVAL_REQUEST_BYTE_LIMIT"),
      responseByteLimit: envNumber(environment, "EVAL_RESPONSE_BYTE_LIMIT"),
      timeoutMs: envNumber(environment, "EVAL_TIMEOUT_MS"),
    },
  };
}

function budgetFromEnvironment(environment, live) {
  if (!live) return undefined;
  const rate = envNumber(environment, "EVAL_USD_TO_GBP_RATE");
  if (rate === undefined || !Number.isFinite(rate) || rate <= 0) {
    const failure = new Error("BUDGET_CONFIG_REQUIRED");
    failure.code = "BUDGET_CONFIG_REQUIRED";
    throw failure;
  }
  return {
    ledger: createProviderBudgetLedger({
      root: environment.EVAL_BUDGET_ROOT ?? ".local-data/provider-budget",
      monthlyCeilingGbp: envNumber(environment, "EVAL_MONTHLY_BUDGET_GBP"),
    }),
    usdToGbpRate: rate,
  };
}

const argumentsList = process.argv.slice(2);
const dryRun = !argumentsList.includes("--live");
const config = configurationFromEnvironment(process.env, argumentsList);

try {
  const outcome = await runProviderEvaluation({
    config,
    repositoryRoot: process.cwd(),
    sourceId: config.sourceId,
    dryRun,
    providerBudget: budgetFromEnvironment(process.env, !dryRun),
  });
  process.stdout.write(`${JSON.stringify(outcome, null, 2)}\n`);
} catch (failure) {
  // Never print provider errors, response bodies, endpoint credentials, or the API key.
  const code = typeof failure?.code === "string" ? failure.code : "EVALUATION_FAILED";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
}
