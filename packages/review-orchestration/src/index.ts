import {
  ingestZipArchive,
  IntakePolicyError,
  type RepositoryInventory,
  type ZipIntakePolicy,
} from "@code-knowledge-assistant/intake";
import {
  createSourceSnapshot,
  deleteSourceSnapshot,
  rehydrateSourceSnapshot,
  SnapshotError,
  type ObjectStore,
  type RehydratedSourceSnapshot,
} from "@code-knowledge-assistant/source-snapshots";
import {
  buildLocalRepositoryReview,
  ReviewPipelineError,
  type LocalRepositoryReview,
} from "@code-knowledge-assistant/review-pipeline";

export type ZipRepositoryReviewInput = {
  archivePath: string;
  intakeWorkspaceRoot: string;
  rehydratedWorkspaceRoot: string;
  store: ObjectStore;
  snapshotId: string;
  reviewId: string;
  sourceRevision: string;
  generatedAt: string;
  now?: () => Date;
  zipPolicy?: Partial<ZipIntakePolicy>;
};

export type ZipRepositoryReview = {
  snapshot: {
    id: string;
    expires_at: string;
  };
  review: LocalRepositoryReview;
};

export type MaterializedRepositoryReviewInput = {
  sourceRoot: string;
  inventory: RepositoryInventory;
  cleanup: () => Promise<void>;
  rehydratedWorkspaceRoot: string;
  store: ObjectStore;
  snapshotId: string;
  reviewId: string;
  sourceRevision: string;
  generatedAt: string;
  now?: () => Date;
};

export type MaterializedRepositoryReview = ZipRepositoryReview;

export type MaterializedReviewOrchestrationErrorCode =
  | "MATERIALIZED_REVIEW_CLEANUP_FAILED"
  | "MATERIALIZED_REVIEW_EVIDENCE_EMPTY"
  | "MATERIALIZED_REVIEW_ROLLBACK_FAILED"
  | "MATERIALIZED_REVIEW_SNAPSHOT_DRIFTED"
  | "MATERIALIZED_REVIEW_SNAPSHOT_EXPIRED"
  | "MATERIALIZED_REVIEW_SNAPSHOT_FAILED"
  | "MATERIALIZED_REVIEW_SOURCE_DRIFTED";

export class MaterializedReviewOrchestrationError extends Error {
  readonly code: MaterializedReviewOrchestrationErrorCode;

  constructor(code: MaterializedReviewOrchestrationErrorCode) {
    super(code);
    this.name = "MaterializedReviewOrchestrationError";
    this.code = code;
  }
}

export type ZipReviewOrchestrationErrorCode =
  | "ZIP_REVIEW_CLEANUP_FAILED"
  | "ZIP_REVIEW_EVIDENCE_EMPTY"
  | "ZIP_REVIEW_INTAKE_FAILED"
  | "ZIP_REVIEW_ROLLBACK_FAILED"
  | "ZIP_REVIEW_SNAPSHOT_DRIFTED"
  | "ZIP_REVIEW_SNAPSHOT_EXPIRED"
  | "ZIP_REVIEW_SNAPSHOT_FAILED"
  | "ZIP_REVIEW_SOURCE_DRIFTED";

export class ZipReviewOrchestrationError extends Error {
  readonly code: ZipReviewOrchestrationErrorCode;

  constructor(code: ZipReviewOrchestrationErrorCode) {
    super(code);
    this.name = "ZipReviewOrchestrationError";
    this.code = code;
  }
}

function materializedErrorCode(error: unknown): MaterializedReviewOrchestrationErrorCode {
  if (error instanceof MaterializedReviewOrchestrationError) return error.code;
  if (error instanceof ReviewPipelineError && error.code === "REVIEW_EVIDENCE_EMPTY") {
    return "MATERIALIZED_REVIEW_EVIDENCE_EMPTY";
  }
  if (error instanceof SnapshotError) {
    if (error.code === "SNAPSHOT_EXPIRED") return "MATERIALIZED_REVIEW_SNAPSHOT_EXPIRED";
    if (error.code === "SOURCE_INTEGRITY_MISMATCH") return "MATERIALIZED_REVIEW_SOURCE_DRIFTED";
    if (error.code === "SNAPSHOT_OBJECT_INTEGRITY_MISMATCH") return "MATERIALIZED_REVIEW_SNAPSHOT_DRIFTED";
  }
  return "MATERIALIZED_REVIEW_SNAPSHOT_FAILED";
}

function zipErrorCode(error: unknown): ZipReviewOrchestrationErrorCode {
  if (error instanceof IntakePolicyError) return "ZIP_REVIEW_INTAKE_FAILED";
  if (!(error instanceof MaterializedReviewOrchestrationError)) return "ZIP_REVIEW_SNAPSHOT_FAILED";
  const codes: Record<MaterializedReviewOrchestrationErrorCode, ZipReviewOrchestrationErrorCode> = {
    MATERIALIZED_REVIEW_CLEANUP_FAILED: "ZIP_REVIEW_CLEANUP_FAILED",
    MATERIALIZED_REVIEW_EVIDENCE_EMPTY: "ZIP_REVIEW_EVIDENCE_EMPTY",
    MATERIALIZED_REVIEW_ROLLBACK_FAILED: "ZIP_REVIEW_ROLLBACK_FAILED",
    MATERIALIZED_REVIEW_SNAPSHOT_DRIFTED: "ZIP_REVIEW_SNAPSHOT_DRIFTED",
    MATERIALIZED_REVIEW_SNAPSHOT_EXPIRED: "ZIP_REVIEW_SNAPSHOT_EXPIRED",
    MATERIALIZED_REVIEW_SNAPSHOT_FAILED: "ZIP_REVIEW_SNAPSHOT_FAILED",
    MATERIALIZED_REVIEW_SOURCE_DRIFTED: "ZIP_REVIEW_SOURCE_DRIFTED",
  };
  return codes[error.code];
}

async function cleanTemporaryWorkspaces(
  materializedCleanup: (() => Promise<void>) | undefined,
  rehydrated: RehydratedSourceSnapshot | undefined,
): Promise<boolean> {
  let complete = true;
  if (rehydrated) {
    try {
      await rehydrated.cleanup();
    } catch {
      complete = false;
    }
  }
  if (materializedCleanup) {
    try {
      await materializedCleanup();
    } catch {
      complete = false;
    }
  }
  return complete;
}

/**
 * Creates an immutable snapshot of already-safe materialized source, removes that
 * workspace, and generates the review only from a disposable rehydrated copy.
 */
export async function orchestrateMaterializedRepositoryReview(
  input: MaterializedRepositoryReviewInput,
): Promise<MaterializedRepositoryReview> {
  let materializedCleanup: (() => Promise<void>) | undefined = input.cleanup;
  let rehydrated: RehydratedSourceSnapshot | undefined;
  let snapshotCreated = false;
  try {
    const manifest = await createSourceSnapshot({
      snapshotId: input.snapshotId,
      sourceRoot: input.sourceRoot,
      inventory: input.inventory,
      store: input.store,
      now: input.now,
    });
    snapshotCreated = true;
    const cleanup = materializedCleanup;
    materializedCleanup = undefined;
    try {
      await cleanup();
    } catch {
      throw new MaterializedReviewOrchestrationError("MATERIALIZED_REVIEW_CLEANUP_FAILED");
    }
    rehydrated = await rehydrateSourceSnapshot({
      snapshotId: input.snapshotId,
      store: input.store,
      workspaceRoot: input.rehydratedWorkspaceRoot,
      now: input.now,
    });
    const review = await buildLocalRepositoryReview({
      root: rehydrated.workspacePath,
      inventory: input.inventory,
      reviewId: input.reviewId,
      sourceRevision: input.sourceRevision,
      generatedAt: input.generatedAt,
    });
    await rehydrated.cleanup();
    rehydrated = undefined;
    return { snapshot: { id: manifest.snapshot_id, expires_at: manifest.expires_at }, review };
  } catch (error) {
    const temporaryCleanupComplete = await cleanTemporaryWorkspaces(materializedCleanup, rehydrated);
    if (snapshotCreated) {
      try {
        await deleteSourceSnapshot(input.snapshotId, input.store);
      } catch {
        throw new MaterializedReviewOrchestrationError("MATERIALIZED_REVIEW_ROLLBACK_FAILED");
      }
    }
    if (!temporaryCleanupComplete) throw new MaterializedReviewOrchestrationError("MATERIALIZED_REVIEW_CLEANUP_FAILED");
    throw new MaterializedReviewOrchestrationError(materializedErrorCode(error));
  }
}

/**
 * Safely turns one ZIP upload into an immutable, policy-filtered snapshot and a
 * review generated only from a disposable rehydrated copy. Source is never run.
 */
export async function orchestrateZipRepositoryReview(
  input: ZipRepositoryReviewInput,
): Promise<ZipRepositoryReview> {
  let intake;
  try {
    intake = await ingestZipArchive(input.archivePath, input.intakeWorkspaceRoot, input.zipPolicy);
  } catch (error) {
    throw new ZipReviewOrchestrationError(zipErrorCode(error));
  }
  try {
    return await orchestrateMaterializedRepositoryReview({
      sourceRoot: intake.workspacePath,
      inventory: intake.inventory,
      cleanup: intake.cleanup,
      rehydratedWorkspaceRoot: input.rehydratedWorkspaceRoot,
      store: input.store,
      snapshotId: input.snapshotId,
      reviewId: input.reviewId,
      sourceRevision: input.sourceRevision,
      generatedAt: input.generatedAt,
      now: input.now,
    });
  } catch (error) {
    throw new ZipReviewOrchestrationError(zipErrorCode(error));
  }
}
