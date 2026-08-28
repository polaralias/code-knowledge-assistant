import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildLexicalEvidenceIndex } from "@code-knowledge-assistant/retrieval";
import { FileSystemReviewJobStore } from "@code-knowledge-assistant/review-jobs";
import { FileSystemObjectStore } from "@code-knowledge-assistant/source-snapshots";
import type { GitTransport } from "@code-knowledge-assistant/git-intake";

import { createReviewService, type MaterializedRepositoryReviewInput } from "../src/index.ts";

const revision = "0123456789abcdef0123456789abcdef01234567";

function materializedResult(input: MaterializedRepositoryReviewInput) {
  const content = "export function startServer() { return 'ready'; }";
  return {
    snapshot: { id: input.snapshotId, expires_at: "2026-08-29T12:00:00.000Z" },
    review: {
      analysis: { capabilities: [{ language: "typescript" as const, tier: "structured" as const, extractor: "lexical", eligible_files: 1, analyzed_files: 1, failed_files: 0 }], files: [], chunks: [], exclusions: [], failures: [] },
      review: { schema_version: 1 as const, review_id: input.reviewId, source_revision: input.sourceRevision, generated_at: input.generatedAt, authority: "derived" as const, verification: "verified-limited" as const, generation: { generator: "deterministic", model: null, prompt_version: "v1" }, capability: { tiers: ["structured" as const] }, coverage: { eligible_files: 1, analyzed_files: 1, excluded_files: 0 }, concepts: [] },
      evidence: [],
      evidenceIndex: buildLexicalEvidenceIndex([{ id: "primary:chunk-1", layer: "primary", content, provenance: { repository_path: "src/main.ts", line_start: 1, line_end: 1 } }]),
    },
  };
}

test("a public Git request becomes a durable review job at its immutable revision and always cleans the Git workspace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-git-review-service-"));
  const scheduled: Array<() => Promise<void>> = [];
  let workspace = "";
  const transport: GitTransport = {
    async resolveCommit() { return revision; },
    async fetchCommit(input) { workspace = input.workspacePath; await writeFile(path.join(input.workspacePath, "main.ts"), "export function startServer() { return true; }\n"); },
    async readHead() { return revision; },
  };
  try {
    const service = createReviewService({
      jobs: new FileSystemReviewJobStore(path.join(root, "jobs")),
      store: new FileSystemObjectStore(path.join(root, "objects")),
      uploadRoot: path.join(root, "uploads"),
      intakeWorkspaceRoot: path.join(root, "intake"),
      rehydratedWorkspaceRoot: path.join(root, "rehydrated"),
      gitTransport: transport,
      gitIntakeOptions: { workspaceRoot: path.join(root, "git-workspaces") },
      createId: (kind) => `${kind}-1`,
      schedule: (work) => scheduled.push(work),
    });

    assert.deepEqual(await service.createGitReview({ url: "https://github.com/openai/example", ref: "main" }), { jobId: "job-1", reviewId: "review-1", state: "queued" });
    assert.equal(scheduled.length, 1);
    await scheduled[0]!();
    const job = await service.getJob("job-1");
    assert.equal(job.state, "ready");
    assert.equal((await service.getReview("review-1"))?.review.source_revision, revision);
    assert.equal((await service.answerQuestion("review-1", "Where is startServer defined?")).status, "answered");
    await assert.rejects(access(workspace));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid or unavailable Git requests fail closed before a job is persisted", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-git-review-service-invalid-"));
  try {
    const service = createReviewService({
      jobs: new FileSystemReviewJobStore(path.join(root, "jobs")),
      store: new FileSystemObjectStore(path.join(root, "objects")),
      uploadRoot: path.join(root, "uploads"), intakeWorkspaceRoot: path.join(root, "intake"), rehydratedWorkspaceRoot: path.join(root, "rehydrated"),
    });
    await assert.rejects(service.createGitReview({ url: "file:///private/repository" }), (error: unknown) => error instanceof Error && error.message === "GIT_REVIEW_INVALID");
    await assert.rejects(service.createGitReview({ url: "https://github.com/openai/example", ref: "--unsafe" }), (error: unknown) => error instanceof Error && error.message === "GIT_REVIEW_INVALID");
    await assert.rejects(service.createGitReview({ url: "https://github.com/openai/example" }), (error: unknown) => error instanceof Error && error.message === "GIT_REVIEW_UNAVAILABLE");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
