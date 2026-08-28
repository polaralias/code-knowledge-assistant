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
import { buildLocalRepositoryReview, type LocalRepositoryReview } from "@code-knowledge-assistant/review-pipeline";
import { createReviewExpiryScheduler, createReviewService } from "@code-knowledge-assistant/review-service";
import { FileSystemObjectStore } from "@code-knowledge-assistant/source-snapshots";

import { createReviewApiServer, ReviewApiError, type ReviewApiDependencies } from "./index.ts";
import { createLocalReviewApiDependencies, type LocalReviewViewMetadata } from "./local-review.ts";
import { createReviewServiceController } from "./review-service-controller.ts";
import { createProviderAnswerer, createProviderClientFromEnvironment } from "./provider-answerer.ts";

function providerContextDocuments(review: LocalRepositoryReview) {
  const evidenceById = new Map(review.evidence.map((item) => [item.id, item] as const));
  const primary = review.evidence.map((item) => ({ id: `primary:${item.id}`, layer: "primary" as const, content: item.excerpt,
    provenance: { repository_path: item.path, line_start: item.start_line, line_end: item.end_line } }));
  const derived = review.review.concepts.flatMap((concept) => concept.claims.map((claim) => {
    const source = evidenceById.get(claim.evidence_ids[0] ?? "");
    if (!source) return null;
    return { id: `derived:${concept.id}:${claim.id}`, layer: "derived" as const,
      content: `${concept.title}\n${concept.summary}\n${claim.text}`,
      provenance: { repository_path: source.path, line_start: source.start_line, line_end: source.end_line } };
  }).filter((item): item is NonNullable<typeof item> => item !== null));
  return [...primary, ...derived];
}

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
  admin?: { username: string; password: string; accessControl: {
    mintAccessCode(): Promise<{ id: string; code: string }>;
    revokeAccessCode(id: string): Promise<{ id: string; revoked: boolean }>;
    listAccessCodes(): Promise<readonly { id: string; createdAt: string; revoked: boolean }[]>;
  }; listPending?: () => Promise<Array<{ jobId: string; reviewId: string; state: "queued" | "processing"; createdAt: string }>>; stopJob?: (jobId: string) => Promise<{ state: "deleted" }> };
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
  const provider = createProviderClientFromEnvironment();
  const service = createReviewService({
    jobs: new FileSystemReviewJobStore(path.join(dataRoot, "metadata")),
    artifacts: new FileSystemReviewArtifactStore(path.join(dataRoot, "metadata")),
    gitTransport: createGitCliTransport(),
    store: new FileSystemObjectStore(path.join(dataRoot, "objects")),
    uploadRoot: path.join(dataRoot, "owned-uploads"),
    intakeWorkspaceRoot,
    rehydratedWorkspaceRoot,
    // Git repositories commonly carry generated documentation and visualisations larger
    // than the ZIP review ceiling. Keep the Git path bounded without rejecting the
    // entire repository because of one large non-executable document.
    gitInventoryPolicy: {
      maxAnalyzedFileBytes: 5 * 1024 * 1024,
      maxAnalyzedBytes: 100 * 1024 * 1024,
    },
    onPipelineProgress: input.telemetry ? (event) => input.telemetry!.record({ event: "review.pipeline.progress", ...event }) : undefined,
    questionAnswererFactory: provider ? (review) => createProviderAnswerer(review.evidenceIndex, provider.client, provider.model, providerContextDocuments(review)) : undefined,
    reviewGeneration: provider ? { client: provider.client, models: provider.models } : undefined,
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
        provider ? createProviderAnswerer(loaded.review.evidenceIndex, provider.client, provider.model, providerContextDocuments(loaded.review)) : loaded.questionAdapter,
      );
    } catch {
      demoAvailable = false;
    }
  }
  const wiredAdmin = input.admin && input.admin.listPending && input.admin.stopJob ? input.admin : input.admin ? {
    ...input.admin,
    listPending: service.listPending.bind(service),
    stopJob: service.stopJob.bind(service),
  } : undefined;
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
      admin: wiredAdmin,
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
