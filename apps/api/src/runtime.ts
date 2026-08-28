import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { inventoryRepository } from "@code-knowledge-assistant/intake";
import { createGitCliTransport } from "@code-knowledge-assistant/git-intake";
import type { OperationalTelemetry } from "@code-knowledge-assistant/observability";
import type { AccessController } from "@code-knowledge-assistant/access-control";
import { loadDemoReview } from "@code-knowledge-assistant/demo-review";
import { FileSystemReviewJobStore } from "@code-knowledge-assistant/review-jobs";
import { FileSystemReviewArtifactStore } from "@code-knowledge-assistant/review-artifacts";
import { buildLocalRepositoryReview } from "@code-knowledge-assistant/review-pipeline";
import { createReviewExpiryScheduler, createReviewService } from "@code-knowledge-assistant/review-service";
import { FileSystemObjectStore } from "@code-knowledge-assistant/source-snapshots";

import { createReviewApiServer, ReviewApiError, type ReviewApiDependencies } from "./index.ts";
import { createLocalReviewApiDependencies, type LocalReviewViewMetadata } from "./local-review.ts";
import { createReviewServiceController } from "./review-service-controller.ts";

export type BuildLocalReviewServerInput = {
  repositoryRoot: string;
  webRoot: string;
  reviewId: string;
  generatedAt: string;
};

export async function buildLocalReviewServer(input: BuildLocalReviewServerInput) {
  const inventory = await inventoryRepository(input.repositoryRoot);
  const sourceRevision = createHash("sha256")
    .update(inventory.entries.filter((entry) => entry.eligibility === "eligible").map((entry) => `${entry.path}:${entry.sha256}`).join("\n"))
    .digest("hex");
  const review = await buildLocalRepositoryReview({
    root: input.repositoryRoot,
    inventory,
    reviewId: input.reviewId,
    sourceRevision,
    generatedAt: input.generatedAt,
  });
  return createReviewApiServer(
    createLocalReviewApiDependencies(review, { name: path.basename(path.resolve(input.repositoryRoot)), displayRevision: sourceRevision.slice(0, 12) }),
    { webRoot: input.webRoot, reviewEndpoint: "/api/reviews/demo" },
  );
}

export type BuildUploadReviewServerInput = {
  webRoot: string;
  dataRoot: string;
  maxUploadBytes?: number;
  expirySweepIntervalMs?: number;
  telemetry?: OperationalTelemetry;
  accessControl?: AccessController;
  demoReviewArtifactPath?: string;
  demoReviewMetadata?: LocalReviewViewMetadata;
};

export async function buildUploadReviewServer(input: BuildUploadReviewServerInput) {
  const dataRoot = path.resolve(input.dataRoot);
  const intakeWorkspaceRoot = path.join(dataRoot, "workspaces", "intake");
  const rehydratedWorkspaceRoot = path.join(dataRoot, "workspaces", "rehydrated");
  await Promise.all([
    path.join(dataRoot, "incoming-uploads"),
    path.join(dataRoot, "owned-uploads"),
    intakeWorkspaceRoot,
    rehydratedWorkspaceRoot,
  ].map((directory) => mkdir(directory, { recursive: true })));
  const service = createReviewService({
    jobs: new FileSystemReviewJobStore(path.join(dataRoot, "metadata")),
    artifacts: new FileSystemReviewArtifactStore(path.join(dataRoot, "metadata")),
    gitTransport: createGitCliTransport(),
    store: new FileSystemObjectStore(path.join(dataRoot, "objects")),
    uploadRoot: path.join(dataRoot, "owned-uploads"),
    intakeWorkspaceRoot,
    rehydratedWorkspaceRoot,
  });
  let demoAvailable = input.demoReviewArtifactPath === undefined;
  let demoDependencies: ReviewApiDependencies = {
    async loadReview(): Promise<unknown> { throw new ReviewApiError("DEMO_REVIEW_UNAVAILABLE", 503); },
    async answerQuestion(_question: string, _reviewId: string): Promise<unknown> { throw new ReviewApiError("DEMO_REVIEW_UNAVAILABLE", 503); },
  };
  if (input.demoReviewArtifactPath !== undefined) {
    try {
      const loaded = await loadDemoReview({ artifactPath: input.demoReviewArtifactPath });
      demoAvailable = true;
      demoDependencies = createLocalReviewApiDependencies(
        loaded.review,
        input.demoReviewMetadata ?? {
          name: "pre-indexed-demo",
          owner: "demo",
          branch: "snapshot",
          displayRevision: loaded.review.review.source_revision.slice(0, 12),
        },
        loaded.questionAdapter,
      );
    } catch {
      demoAvailable = false;
    }
  }
  const server = createReviewApiServer(
    demoDependencies,
    {
      webRoot: input.webRoot,
      apiBaseEndpoint: "/api",
      reviewEndpoint: "/api/reviews/demo",
      reviewJobs: createReviewServiceController(service),
      maxUploadBytes: input.maxUploadBytes,
      uploadDirectory: path.join(dataRoot, "incoming-uploads"),
      telemetry: input.telemetry,
      accessControl: input.accessControl,
      readiness: input.demoReviewArtifactPath === undefined ? undefined : async () => demoAvailable,
    },
  );
  const expiryScheduler = createReviewExpiryScheduler({
    target: service,
    intervalMs: input.expirySweepIntervalMs ?? 15 * 60 * 1_000,
    onSweepComplete: input.telemetry ? (result) => input.telemetry?.record({ event: "review.expiry.completed", ...result }) : undefined,
  });
  expiryScheduler.start();
  server.once("close", () => void expiryScheduler.stop());
  return server;
}
