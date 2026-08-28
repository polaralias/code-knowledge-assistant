import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

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
