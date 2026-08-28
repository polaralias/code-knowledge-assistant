import { randomUUID } from "node:crypto";
import { lstat, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import { createDeterministicAnswerer, type GroundedAnswer } from "@code-knowledge-assistant/answering";
import { inventoryRepository, type InventoryPolicy } from "@code-knowledge-assistant/intake";
import {
  intakePublicGitRepository,
  parsePublicGitHubRepository,
  type GitTransport,
  type PublicGitIntakeOptions,
} from "@code-knowledge-assistant/git-intake";
import { JobStoreError, type ReviewJob, type ReviewJobStore } from "@code-knowledge-assistant/review-jobs";
import { ReviewArtifactStoreError, type ReviewArtifactStore } from "@code-knowledge-assistant/review-artifacts";
import {
  orchestrateMaterializedRepositoryReview,
  orchestrateZipRepositoryReview,
  type MaterializedRepositoryReviewInput,
  type ZipRepositoryReview,
  type ZipRepositoryReviewInput,
} from "@code-knowledge-assistant/review-orchestration";
import { deleteSourceSnapshot, purgeExpiredSourceSnapshots, type ObjectStore } from "@code-knowledge-assistant/source-snapshots";
import type { StructuredGenerationClient } from "@code-knowledge-assistant/model-provider";

export type ReviewServiceErrorCode =
  | "REVIEW_CLEANUP_FAILED"
  | "REVIEW_JOB_NOT_READY"
  | "REVIEW_NOT_FOUND"
  | "UPLOAD_INVALID"
  | "UPLOAD_OWNERSHIP_FAILED"
  | "GIT_REVIEW_INVALID"
  | "GIT_REVIEW_UNAVAILABLE";

export class ReviewServiceError extends Error {
  readonly code: ReviewServiceErrorCode;

  constructor(code: ReviewServiceErrorCode) {
    super(code);
    this.name = "ReviewServiceError";
    this.code = code;
  }
}

export type ReviewServiceDependencies = {
  jobs: ReviewJobStore;
  artifacts?: ReviewArtifactStore;
  store: ObjectStore;
  uploadRoot: string;
  intakeWorkspaceRoot: string;
  rehydratedWorkspaceRoot: string;
  now?: () => Date;
  createId?: (kind: "job" | "review" | "snapshot") => string;
  schedule?: (work: () => Promise<void>) => void;
  runReview?: (input: ZipRepositoryReviewInput) => Promise<ZipRepositoryReview>;
  gitTransport?: GitTransport;
  gitIntakeOptions?: PublicGitIntakeOptions;
  /** Bounded inventory policy for public Git snapshots; ZIP intake remains independently governed. */
  gitInventoryPolicy?: Partial<InventoryPolicy>;
  runMaterializedReview?: (input: MaterializedRepositoryReviewInput) => Promise<ZipRepositoryReview>;
  questionAnswererFactory?: (review: ZipRepositoryReview["review"]) => { answer(question: string): GroundedAnswer | Promise<GroundedAnswer> };
  reviewGeneration?: { client: StructuredGenerationClient; models: string[] };
  onPipelineProgress?: (event: {
    source: "git" | "zip";
    phase: "acquire" | "inventory" | "snapshot" | "analysis" | "generation";
    state: "started" | "completed" | "failed";
    files: number;
    excludedFiles: number;
    bytes: number;
    durationMs: number;
    errorCode: string | null;
  }) => void;
};
export type { MaterializedRepositoryReviewInput } from "@code-knowledge-assistant/review-orchestration";

export type ReviewService = {
  createReview(input: { uploadPath: string; byteSize: number }): Promise<{ jobId: string; reviewId: string; state: "queued" }>;
  createGitReview(input: { url: string; ref?: string }): Promise<{ jobId: string; reviewId: string; state: "queued" }>;
  getJob(jobId: string): Promise<ReviewJob>;
  getJobSnapshot(jobId: string): Promise<{ jobId: string; reviewId: string; state: ReviewJob["state"] } | null>;
  getReviewJob(reviewId: string): Promise<ReviewJob | null>;
  getReview(reviewId: string): Promise<ZipRepositoryReview["review"] | null>;
  answerQuestion(reviewId: string, question: string): Promise<GroundedAnswer>;
  deleteReview(reviewId: string): Promise<{ state: "deleted" }>;
  listPending(): Promise<Array<{ jobId: string; reviewId: string; state: "queued" | "processing"; createdAt: string }>>;
  stopJob(jobId: string): Promise<{ state: "deleted" }>;
  purgeExpired(): Promise<{ expiredJobIds: string[] }>;
};

export type ReviewExpirySweepResult =
  | { state: "completed"; expiredJobIds: string[] }
  | { state: "failed" | "skipped" | "stopped" };

export type ReviewExpiryScheduler = {
  start(): void;
  stop(): Promise<void>;
  sweepNow(): Promise<ReviewExpirySweepResult>;
};

export function createReviewExpiryScheduler(input: {
  target: Pick<ReviewService, "purgeExpired">;
  intervalMs: number;
  scheduleRepeating?: (callback: () => void, intervalMs: number) => { cancel(): void };
  onError?: (error: { code: "EXPIRY_SWEEP_FAILED" }) => void;
  monotonicNow?: () => number;
  onSweepComplete?: (result: { outcome: "failure" | "success"; expiredCount: number; durationMs: number }) => void;
}): ReviewExpiryScheduler {
  if (!Number.isSafeInteger(input.intervalMs) || input.intervalMs < 1) throw new ReviewServiceError("UPLOAD_INVALID");
  const scheduleRepeating = input.scheduleRepeating ?? ((callback, intervalMs) => {
    const timer = setInterval(callback, intervalMs);
    timer.unref();
    return { cancel: () => clearInterval(timer) };
  });
  let timer: { cancel(): void } | null = null;
  let stopped = false;
  let active: Promise<ReviewExpirySweepResult> | null = null;
  const monotonicNow = input.monotonicNow ?? (() => performance.now());

  function reportSweep(outcome: "failure" | "success", expiredCount: number, startedAt: number): void {
    try {
      const elapsed = Math.max(0, Math.round(monotonicNow() - startedAt));
      input.onSweepComplete?.({ outcome, expiredCount, durationMs: Number.isSafeInteger(elapsed) ? elapsed : 0 });
    } catch {
      // Operational reporting cannot alter retention behavior.
    }
  }

  async function sweepNow(): Promise<ReviewExpirySweepResult> {
    if (stopped) return { state: "stopped" };
    if (active) return { state: "skipped" };
    const sweep = (async (): Promise<ReviewExpirySweepResult> => {
      let startedAt = 0;
      try { startedAt = monotonicNow(); } catch { /* Telemetry clocks cannot block retention. */ }
      try {
        const result = await input.target.purgeExpired();
        reportSweep("success", result.expiredJobIds.length, startedAt);
        return { state: "completed", expiredJobIds: result.expiredJobIds };
      } catch {
        try { input.onError?.({ code: "EXPIRY_SWEEP_FAILED" }); } catch { /* Error reporting is best-effort. */ }
        reportSweep("failure", 0, startedAt);
        return { state: "failed" };
      }
    })();
    active = sweep;
    try {
      return await sweep;
    } finally {
      if (active === sweep) active = null;
    }
  }

  return Object.freeze({
    start() {
      if (timer || stopped) return;
      timer = scheduleRepeating(() => void sweepNow(), input.intervalMs);
    },
    async stop() {
      if (!stopped) {
        stopped = true;
        timer?.cancel();
        timer = null;
      }
      await active;
    },
    sweepNow,
  });
}

const RETENTION_MILLISECONDS = 48 * 60 * 60 * 1_000;
const PROCESSING_DEADLINE_MILLISECONDS = 60 * 60 * 1_000;

function defaultId(kind: "job" | "review" | "snapshot"): string {
  return `${kind}-${randomUUID()}`;
}

function validGitRef(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 255 && value.trim() === value
    && !value.startsWith("-") && !value.startsWith("/") && !value.endsWith("/") && !value.endsWith(".")
    && !value.includes("..") && !value.includes("//") && !value.includes("@{") && !/[\u0000-\u0020~^:?*\\[\]]/u.test(value);
}

export function createReviewService(dependencies: ReviewServiceDependencies): ReviewService {
  const now = dependencies.now ?? (() => new Date());
  const createId = dependencies.createId ?? defaultId;
  const runReview = dependencies.runReview ?? orchestrateZipRepositoryReview;
  const runMaterializedReview = dependencies.runMaterializedReview ?? orchestrateMaterializedRepositoryReview;
  const schedule = dependencies.schedule ?? ((work) => queueMicrotask(() => void work()));
  const report = (event: Parameters<NonNullable<ReviewServiceDependencies["onPipelineProgress"]>>[0]) => {
    try { dependencies.onPipelineProgress?.(event); } catch { /* progress reporting cannot fail a review */ }
  };
  const uploadRoot = path.resolve(dependencies.uploadRoot);
  const reviews = new Map<string, ZipRepositoryReview["review"]>();
  const reviewToJob = new Map<string, string>();
  const jobToReview = new Map<string, string>();
  const reviewToSnapshot = new Map<string, string>();
  const deletedReviews = new Set<string>();

  async function processJob(jobId: string, reviewId: string, snapshotId: string, archivePath: string): Promise<void> {
    const queued = await dependencies.jobs.get(jobId);
    const processing = await dependencies.jobs.transition(jobId, queued.version, { state: "processing" });
    try {
      const result = await runReview({
        archivePath,
        intakeWorkspaceRoot: dependencies.intakeWorkspaceRoot,
        rehydratedWorkspaceRoot: dependencies.rehydratedWorkspaceRoot,
        store: dependencies.store,
        snapshotId,
        reviewId,
        sourceRevision: `upload-${jobId}`,
        generatedAt: now().toISOString(),
        now,
        generation: dependencies.reviewGeneration,
      });
      if (result.snapshot.id !== snapshotId || result.review.review.review_id !== reviewId) {
        throw new ReviewServiceError("UPLOAD_OWNERSHIP_FAILED");
      }
      const expiresAt = new Date(now().getTime() + RETENTION_MILLISECONDS).toISOString();
      await dependencies.artifacts?.save({ id: reviewId, expires_at: expiresAt, review: result.review });
      await dependencies.jobs.transition(jobId, processing.version, {
        state: "ready",
        review_id: reviewId,
        expires_at: expiresAt,
        capability_summary: {
          ...result.review.review.coverage,
          languages: result.review.analysis.capabilities.map((capability) => ({
            language: capability.language,
            tier: capability.tier,
            eligible_files: capability.eligible_files,
            analyzed_files: capability.analyzed_files,
            failed_files: capability.failed_files,
          })).sort((left, right) => left.language < right.language ? -1 : left.language > right.language ? 1 : 0),
        },
      });
      reviews.set(reviewId, result.review);
      reviewToSnapshot.set(reviewId, snapshotId);
    } catch (error) {
      reviews.delete(reviewId);
      reviewToSnapshot.delete(reviewId);
      await dependencies.artifacts?.delete(reviewId).catch(() => undefined);
      await deleteSourceSnapshot(snapshotId, dependencies.store).catch(() => undefined);
      await rm(archivePath, { force: true }).catch(() => undefined);
      const current = await dependencies.jobs.get(jobId);
      if (current.state === "processing") {
        const code = error instanceof Error && /^[A-Z][A-Z0-9_]{0,79}$/u.test(error.message) ? error.message : "REVIEW_PROCESSING_FAILED";
        await dependencies.jobs.transition(jobId, current.version, { state: "failed", error: { code } });
      }
    }
  }

  async function processGitJob(jobId: string, reviewId: string, snapshotId: string, source: { url: string; ref?: string }): Promise<void> {
    const queued = await dependencies.jobs.get(jobId);
    const processing = await dependencies.jobs.transition(jobId, queued.version, { state: "processing" });
    let acquired: Awaited<ReturnType<typeof intakePublicGitRepository>> | undefined;
    const startedAt = Date.now();
    report({ source: "git", phase: "acquire", state: "started", files: 0, excludedFiles: 0, bytes: 0, durationMs: 0, errorCode: null });
    try {
      if (!dependencies.gitTransport) throw new ReviewServiceError("GIT_REVIEW_UNAVAILABLE");
      acquired = await intakePublicGitRepository(source, dependencies.gitTransport, dependencies.gitIntakeOptions);
      const inventoryStartedAt = Date.now();
      report({ source: "git", phase: "inventory", state: "started", files: 0, excludedFiles: 0, bytes: 0, durationMs: 0, errorCode: null });
      const inventory = await inventoryRepository(acquired.workspacePath, dependencies.gitInventoryPolicy);
      report({ source: "git", phase: "acquire", state: "completed", files: inventory.summary.discovered_files, excludedFiles: inventory.summary.excluded_files, bytes: inventory.summary.total_bytes, durationMs: Math.max(0, Date.now() - startedAt), errorCode: null });
      report({ source: "git", phase: "inventory", state: "completed", files: inventory.summary.eligible_files, excludedFiles: inventory.summary.excluded_files, bytes: inventory.summary.total_bytes, durationMs: Math.max(0, Date.now() - inventoryStartedAt), errorCode: null });
      report({ source: "git", phase: "snapshot", state: "started", files: inventory.summary.eligible_files, excludedFiles: inventory.summary.excluded_files, bytes: inventory.summary.total_bytes, durationMs: 0, errorCode: null });
      report({ source: "git", phase: "analysis", state: "started", files: inventory.summary.eligible_files, excludedFiles: inventory.summary.excluded_files, bytes: inventory.summary.total_bytes, durationMs: 0, errorCode: null });
      report({ source: "git", phase: "generation", state: "started", files: inventory.summary.eligible_files, excludedFiles: inventory.summary.excluded_files, bytes: inventory.summary.total_bytes, durationMs: 0, errorCode: null });
      const result = await runMaterializedReview({
        sourceRoot: acquired.workspacePath,
        inventory,
        cleanup: acquired.cleanup,
        rehydratedWorkspaceRoot: dependencies.rehydratedWorkspaceRoot,
        store: dependencies.store,
        snapshotId,
        reviewId,
        sourceRevision: acquired.revision,
        generatedAt: now().toISOString(),
        now,
        generation: dependencies.reviewGeneration,
      });
      report({ source: "git", phase: "snapshot", state: "completed", files: inventory.summary.eligible_files, excludedFiles: inventory.summary.excluded_files, bytes: inventory.summary.total_bytes, durationMs: 0, errorCode: null });
      report({ source: "git", phase: "analysis", state: "completed", files: result.review.analysis.files.length, excludedFiles: inventory.summary.excluded_files, bytes: inventory.summary.total_bytes, durationMs: 0, errorCode: null });
      report({ source: "git", phase: "generation", state: "completed", files: result.review.analysis.files.length, excludedFiles: inventory.summary.excluded_files, bytes: inventory.summary.total_bytes, durationMs: 0, errorCode: null });
      if (result.snapshot.id !== snapshotId || result.review.review.review_id !== reviewId || result.review.review.source_revision !== acquired.revision) {
        throw new ReviewServiceError("UPLOAD_OWNERSHIP_FAILED");
      }
      const expiresAt = new Date(now().getTime() + RETENTION_MILLISECONDS).toISOString();
      await dependencies.artifacts?.save({ id: reviewId, expires_at: expiresAt, review: result.review });
      await dependencies.jobs.transition(jobId, processing.version, {
        state: "ready",
        review_id: reviewId,
        expires_at: expiresAt,
        capability_summary: {
          ...result.review.review.coverage,
          languages: result.review.analysis.capabilities.map((capability) => ({
            language: capability.language,
            tier: capability.tier,
            eligible_files: capability.eligible_files,
            analyzed_files: capability.analyzed_files,
            failed_files: capability.failed_files,
          })).sort((left, right) => left.language < right.language ? -1 : left.language > right.language ? 1 : 0),
        },
      });
      reviews.set(reviewId, result.review);
      reviewToSnapshot.set(reviewId, snapshotId);
    } catch (error) {
      reviews.delete(reviewId);
      reviewToSnapshot.delete(reviewId);
      await dependencies.artifacts?.delete(reviewId).catch(() => undefined);
      await deleteSourceSnapshot(snapshotId, dependencies.store).catch(() => undefined);
      const current = await dependencies.jobs.get(jobId);
      if (current.state === "processing") {
        const code = error instanceof Error && /^[A-Z][A-Z0-9_]{0,79}$/u.test(error.message) ? error.message : "GIT_REVIEW_PROCESSING_FAILED";
        report({ source: "git", phase: "generation", state: "failed", files: 0, excludedFiles: 0, bytes: 0, durationMs: Math.max(0, Date.now() - startedAt), errorCode: code });
        await dependencies.jobs.transition(jobId, current.version, { state: "failed", error: { code } });
      }
    } finally {
      await acquired?.cleanup().catch(() => undefined);
    }
  }

  return Object.freeze({
    async createReview(input) {
      if (!Number.isSafeInteger(input.byteSize) || input.byteSize < 1) throw new ReviewServiceError("UPLOAD_INVALID");
      const source = path.resolve(input.uploadPath);
      const metadata = await lstat(source).catch(() => null);
      if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size !== input.byteSize) throw new ReviewServiceError("UPLOAD_INVALID");
      const jobId = createId("job");
      const reviewId = createId("review");
      const snapshotId = createId("snapshot");
      const expiresAt = new Date(now().getTime() + PROCESSING_DEADLINE_MILLISECONDS).toISOString();
      const ownedUpload = path.join(uploadRoot, `${jobId}.zip`);
      await mkdir(uploadRoot, { recursive: true });
      try {
        await rename(source, ownedUpload);
        await dependencies.jobs.create({ id: jobId, snapshot_id: snapshotId, expires_at: expiresAt });
      } catch {
        await rm(ownedUpload, { force: true }).catch(() => undefined);
        throw new ReviewServiceError("UPLOAD_OWNERSHIP_FAILED");
      }
      reviewToJob.set(reviewId, jobId);
      jobToReview.set(jobId, reviewId);
      schedule(() => processJob(jobId, reviewId, snapshotId, ownedUpload));
      return { jobId, reviewId, state: "queued" };
    },

    async createGitReview(input) {
      try { parsePublicGitHubRepository(input.url); } catch { throw new ReviewServiceError("GIT_REVIEW_INVALID"); }
      if (input.ref !== undefined && !validGitRef(input.ref)) throw new ReviewServiceError("GIT_REVIEW_INVALID");
      if (!dependencies.gitTransport) throw new ReviewServiceError("GIT_REVIEW_UNAVAILABLE");
      const jobId = createId("job");
      const reviewId = createId("review");
      const snapshotId = createId("snapshot");
      const expiresAt = new Date(now().getTime() + PROCESSING_DEADLINE_MILLISECONDS).toISOString();
      try {
        await dependencies.jobs.create({ id: jobId, snapshot_id: snapshotId, expires_at: expiresAt });
      } catch {
        throw new ReviewServiceError("UPLOAD_OWNERSHIP_FAILED");
      }
      reviewToJob.set(reviewId, jobId);
      jobToReview.set(jobId, reviewId);
      schedule(() => processGitJob(jobId, reviewId, snapshotId, { url: input.url, ...(input.ref === undefined ? {} : { ref: input.ref }) }));
      return { jobId, reviewId, state: "queued" };
    },

    async getJob(jobId) { return dependencies.jobs.get(jobId); },

    async getJobSnapshot(jobId) {
      let job: ReviewJob;
      try { job = await dependencies.jobs.get(jobId); }
      catch (error) {
        if (error instanceof JobStoreError && error.code === "JOB_NOT_FOUND") return null;
        throw error;
      }
      const reviewId = jobToReview.get(jobId) ?? job.review_id;
      if (!reviewId) return null;
      return { jobId, reviewId, state: job.state };
    },

    async getReviewJob(reviewId) {
      const jobId = reviewToJob.get(reviewId);
      return jobId ? dependencies.jobs.get(jobId) : dependencies.jobs.findByReviewId(reviewId);
    },

    async getReview(reviewId) {
      const active = reviews.get(reviewId);
      if (active) return active;
      if (!dependencies.artifacts) return null;
      try {
        const loaded = await dependencies.artifacts.get(reviewId);
        reviews.set(reviewId, loaded.review);
        return loaded.review;
      } catch (error) {
        if (error instanceof ReviewArtifactStoreError && error.code === "ARTIFACT_NOT_FOUND") return null;
        throw error;
      }
    },

    async answerQuestion(reviewId, question) {
      const review = await this.getReview(reviewId);
      if (!review) throw new ReviewServiceError("REVIEW_NOT_FOUND");
      return (dependencies.questionAnswererFactory?.(review) ?? createDeterministicAnswerer(review.evidenceIndex)).answer(question);
    },

    async deleteReview(reviewId) {
      if (deletedReviews.has(reviewId)) return { state: "deleted" };
      const job = await this.getReviewJob(reviewId);
      if (!job) throw new ReviewServiceError("REVIEW_NOT_FOUND");
      const jobId = job.id;
      const snapshotId = reviewToSnapshot.get(reviewId) ?? job.snapshot_id;
      if (snapshotId) await deleteSourceSnapshot(snapshotId, dependencies.store);
      await dependencies.artifacts?.delete(reviewId);
      await dependencies.jobs.delete(jobId);
      reviews.delete(reviewId);
      reviewToJob.delete(reviewId);
      jobToReview.delete(jobId);
      reviewToSnapshot.delete(reviewId);
      deletedReviews.add(reviewId);
      await rm(path.join(uploadRoot, `${jobId}.zip`), { force: true });
      return { state: "deleted" };
    },

    async listPending() {
      return (await dependencies.jobs.list()).filter((job): job is typeof job & { state: "queued" | "processing" } => job.state === "queued" || job.state === "processing").map((job) => ({ jobId: job.id, reviewId: job.review_id ?? jobToReview.get(job.id) ?? "", state: job.state, createdAt: job.created_at }));
    },

    async stopJob(jobId) {
      const job = await dependencies.jobs.get(jobId);
      if (job.state === "deleted") return { state: "deleted" };
      if (job.review_id) await dependencies.artifacts?.delete(job.review_id).catch(() => undefined);
      await deleteSourceSnapshot(job.snapshot_id, dependencies.store).catch(() => undefined);
      await dependencies.jobs.delete(job.id);
      await rm(path.join(uploadRoot, `${job.id}.zip`), { force: true });
      if (job.review_id) { reviews.delete(job.review_id); reviewToJob.delete(job.review_id); reviewToSnapshot.delete(job.review_id); deletedReviews.add(job.review_id); }
      jobToReview.delete(job.id);
      return { state: "deleted" };
    },

    async purgeExpired() {
      const asOf = now();
      const expiredJobIds: string[] = [];
      for (const job of await dependencies.jobs.listExpired(asOf)) {
        await dependencies.jobs.transition(job.id, job.version, { state: "expired" });
        await deleteSourceSnapshot(job.snapshot_id, dependencies.store).catch(() => undefined);
        if (job.review_id) {
          await dependencies.artifacts?.delete(job.review_id).catch(() => undefined);
          reviews.delete(job.review_id);
          reviewToJob.delete(job.review_id);
          jobToReview.delete(job.id);
          reviewToSnapshot.delete(job.review_id);
          deletedReviews.add(job.review_id);
        }
        await rm(path.join(uploadRoot, `${job.id}.zip`), { force: true });
        expiredJobIds.push(job.id);
      }
      const snapshotSweep = await purgeExpiredSourceSnapshots({ store: dependencies.store, now: () => asOf });
      if (snapshotSweep.invalid_manifest_keys.length > 0) throw new ReviewServiceError("REVIEW_CLEANUP_FAILED");
      if (dependencies.artifacts) {
        for (const artifact of await dependencies.artifacts.listExpired(asOf)) await dependencies.artifacts.delete(artifact.id);
      }
      return { expiredJobIds };
    },
  });
}
