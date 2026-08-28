import test from "node:test";
import assert from "node:assert/strict";

import { buildLexicalEvidenceIndex } from "@code-knowledge-assistant/retrieval";
import { createProviderAnswerer } from "../src/provider-answerer.ts";
import type { StructuredGenerationRequest, StructuredGenerationResult } from "@code-knowledge-assistant/model-provider";

test("provider answerer sends bounded retrieved evidence and returns only verifiable citations", async () => {
  const index = buildLexicalEvidenceIndex([{ id: "chunk-1", layer: "primary", content: "export function startServer() { return 'ready'; }", provenance: { repository_path: "src/main.ts", line_start: 1, line_end: 1 } }]);
  let request: { prompt: string; schema: unknown } | undefined;
  const answerer = createProviderAnswerer(index, {
    async generate<T>(input: StructuredGenerationRequest): Promise<StructuredGenerationResult<T>> {
      request = { prompt: input.prompt, schema: input.schema };
      return { provider: "test", requestedModel: input.model, model: input.model, prompt: input.prompt, schema: input.schema, output: { answer: "The server starts in startServer.", qualification: "", citations: [{ evidence_id: "primary:chunk-1" }, { evidence_id: "invented" }] }, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, latencyMs: 1, estimatedCostUsd: 0, request: { provider: "test", model: input.model, prompt: input.prompt, schema: input.schema } } as StructuredGenerationResult<T>;
    },
  }, "test-model");
  const result = await answerer.answer("Where is startServer defined?");
  assert.equal(result.status, "answered");
  assert.equal(result.citations.length, 1);
  assert.equal(result.citations[0]?.repository_path, "src/main.ts");
  assert.match(request?.prompt ?? "", /startServer/u);
  assert.equal((request?.prompt ?? "").includes("invented"), false);
});
