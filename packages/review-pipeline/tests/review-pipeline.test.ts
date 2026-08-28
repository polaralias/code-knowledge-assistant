import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { StructuredGenerationRequest, StructuredGenerationResult } from "@code-knowledge-assistant/model-provider";

import { inventoryRepository } from "@code-knowledge-assistant/intake";
import { buildLocalRepositoryReview, ReviewPipelineError } from "../src/index.ts";

test("a materialized repository becomes a review bundle and citation-ready lexical index", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-review-"));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "server.ts"), [
    "import { port } from './config';",
    "export function startServer() {",
    "  return { port };",
    "}",
  ].join("\n"));
  await writeFile(path.join(root, "src", "config.ts"), "export const port = 3000;\n");
  await writeFile(path.join(root, ".env"), "TOKEN=excluded\n");
  const inventory = await inventoryRepository(root);

  const result = await buildLocalRepositoryReview({
    root,
    inventory,
    reviewId: "review-123",
    sourceRevision: "upload:abc123",
    generatedAt: "2026-08-26T20:00:00.000Z",
  });

  assert.deepEqual(
    [...new Set(result.review.concepts.map((concept) => concept.kind))].sort(),
    ["component", "coverage", "flow", "integration", "overview", "uncertainty"],
  );
  assert.deepEqual(result.analysis.exclusions, [{ path: ".env", reason: "sensitive" }]);
  assert.deepEqual(result.analysis.capabilities.map(({ language, tier }) => ({ language, tier })), [
    { language: "typescript", tier: "structured" },
  ]);
  const answerEvidence = result.evidenceIndex.query("Where is startServer defined?");
  assert.equal(answerEvidence.status, "ok");
  if (answerEvidence.status === "ok") {
    assert.equal(answerEvidence.results[0]?.provenance.repository_path, "src/server.ts");
    assert.equal(answerEvidence.results[0]?.provenance.line_start, 2);
  }
});

test("a repository with no successfully analyzed evidence is refused", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-review-empty-"));
  await writeFile(path.join(root, ".env"), "TOKEN=excluded\n");
  const inventory = await inventoryRepository(root);

  await assert.rejects(
    buildLocalRepositoryReview({
      root,
      inventory,
      reviewId: "review-empty",
      sourceRevision: "upload:empty",
      generatedAt: "2026-08-26T20:00:00.000Z",
    }),
    (error: unknown) => error instanceof ReviewPipelineError && error.code === "REVIEW_EVIDENCE_EMPTY",
  );
});

test("provider concepts replace deterministic summaries only after evidence validation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-review-provider-"));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "main.ts"), "export function startServer() { return 'ready'; }\n");
  const inventory = await inventoryRepository(root);
  const kinds = ["overview", "component", "flow", "integration", "coverage", "uncertainty"] as const;
  let calls = 0;
  const result = await buildLocalRepositoryReview({
    root, inventory, reviewId: "review-provider", sourceRevision: "upload:provider", generatedAt: "2026-08-28T08:00:00.000Z",
    generation: { models: ["qwen3.6-flash"], client: { async generate<T>(input: StructuredGenerationRequest): Promise<StructuredGenerationResult<T>> {
      calls += 1;
      const evidenceId = /\[([^\]]+)\]/u.exec(input.prompt)?.[1] ?? "";
      const kind = /Concept kind: ([a-z]+)/u.exec(input.prompt)?.[1] ?? "overview";
      return { provider: "test", requestedModel: input.model, model: "served-qwen", prompt: input.prompt, schema: input.schema,
        output: { concept: { title: `${kind} title`, summary: `${kind} summary`, claims: [{ text: `${kind} claim`, evidence_ids: [evidenceId], confidence: "high" as const }] } }, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, latencyMs: 1, estimatedCostUsd: 0, request: { provider: "test", model: input.model, prompt: input.prompt, schema: input.schema } } as StructuredGenerationResult<T>;
    } } },
  });
  assert.equal(calls, 6);
  assert.equal(result.review.generation.model, "served-qwen");
  assert.equal(result.review.generation.generator, "model-provider");
  assert.deepEqual([...new Set(result.review.concepts.map((concept) => concept.kind))].sort(), [...kinds].sort());
  assert.deepEqual(result.review.concepts.map((concept) => concept.id), ["overview", "component-primary", "flow-evidence-path", "integration-configuration", "coverage", "uncertainty"]);
  assert.ok(result.review.concepts.every((concept) => concept.claims.every((claim) => claim.id.startsWith(`${concept.kind}-model-claim-`))));
});

test("provider failure preserves the deterministic evidence-backed review", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-review-provider-fallback-"));
  await writeFile(path.join(root, "main.py"), "def start_server():\n    return 'ready'\n");
  const inventory = await inventoryRepository(root);
  const result = await buildLocalRepositoryReview({
    root, inventory, reviewId: "review-fallback", sourceRevision: "upload:fallback", generatedAt: "2026-08-28T08:00:00.000Z",
    generation: { models: ["qwen3.6-flash", "deepseek-v4-flash-0731"], client: { async generate() { throw Object.assign(new Error("TIMEOUT"), { code: "TIMEOUT" }); } } },
  });
  assert.equal(result.review.generation.generator, "deterministic-baseline");
  assert.equal(result.review.generation.model, null);
  assert.equal(result.review.concepts.length, 6);
  assert.ok(result.review.concepts.every((concept) => concept.claims.every((claim) => claim.evidence_ids.length > 0)));
});

test("secondary model completes concept extraction when the primary model fails", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-review-provider-secondary-"));
  await writeFile(path.join(root, "main.js"), "export function startServer() { return 'ready'; }\n");
  const inventory = await inventoryRepository(root);
  const requested: string[] = [];
  const result = await buildLocalRepositoryReview({
    root, inventory, reviewId: "review-secondary", sourceRevision: "upload:secondary", generatedAt: "2026-08-28T08:00:00.000Z",
    generation: { models: ["qwen3.6-flash", "deepseek-v4-flash-0731"], client: { async generate<T>(input: StructuredGenerationRequest): Promise<StructuredGenerationResult<T>> {
      requested.push(input.model);
      if (input.model === "qwen3.6-flash") throw Object.assign(new Error("TIMEOUT"), { code: "TIMEOUT" });
      const evidenceId = /\[([^\]]+)\]/u.exec(input.prompt)?.[1] ?? "";
      const kind = /Concept kind: ([a-z]+)/u.exec(input.prompt)?.[1] ?? "overview";
      return { provider: "test", requestedModel: input.model, model: "served-deepseek", prompt: input.prompt, schema: input.schema,
        output: { concept: { title: `${kind} title`, summary: `${kind} summary`, claims: [{ text: `${kind} claim`, evidence_ids: [evidenceId], confidence: "medium" as const }] } }, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, latencyMs: 1, estimatedCostUsd: 0, request: { provider: "test", model: input.model, prompt: input.prompt, schema: input.schema } } as StructuredGenerationResult<T>;
    } } },
  });
  assert.equal(requested.filter((model) => model === "qwen3.6-flash").length, 6);
  assert.equal(requested.filter((model) => model === "deepseek-v4-flash-0731").length, 6);
  assert.equal(result.review.generation.generator, "model-provider");
  assert.equal(result.review.generation.model, "served-deepseek");
});
