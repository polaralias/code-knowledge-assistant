import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, open, readFile, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export type ReviewJobState = "queued" | "processing" | "ready" | "failed" | "expired" | "deleted";

export type ReviewJobCapabilitySummary = {
  eligible_files: number;
  analyzed_files: number;
  excluded_files: number;
  languages: Array<{
    language: string;
    tier: "enhanced" | "fallback" | "structured";
    eligible_files: number;
    analyzed_files: number;
    failed_files: number;
  }>;
};

export type ReviewJobFailure = { code: string };

export type ReviewJob = {
  schema_version: 1;
  id: string;
  version: number;
  state: ReviewJobState;
  created_at: string;
  updated_at: string;
  expires_at: string;
  snapshot_id: string;
  review_id: string | null;
  capability_summary: ReviewJobCapabilitySummary | null;
  error: ReviewJobFailure | null;
};

export type CreateReviewJobInput = {
  id: string;
  snapshot_id: string;
  expires_at: string;
};

export type ReviewJobNext = {
  state: ReviewJobState;
  review_id?: string;
  capability_summary?: ReviewJobCapabilitySummary;
  error?: ReviewJobFailure;
  expires_at?: string;
};

export type JobStoreErrorCode =
  | "JOB_CORRUPT"
  | "JOB_EXISTS"
  | "JOB_ID_INVALID"
  | "JOB_INPUT_INVALID"
  | "JOB_IO_FAILED"
  | "JOB_LOCK_TIMEOUT"
  | "JOB_NOT_FOUND"
  | "JOB_SCHEMA_INVALID"
  | "JOB_TRANSITION_INVALID"
  | "JOB_VERSION_CONFLICT";

export class JobStoreError extends Error {
  readonly code: JobStoreErrorCode;

  constructor(code: JobStoreErrorCode) {
    super(code);
    this.name = "JobStoreError";
    this.code = code;
  }
}

export interface ReviewJobStore {
  create(input: CreateReviewJobInput): Promise<ReviewJob>;
  get(id: string): Promise<ReviewJob>;
  findByReviewId(reviewId: string): Promise<ReviewJob | null>;
  transition(id: string, expectedVersion: number, next: ReviewJobNext): Promise<ReviewJob>;
  listExpired(asOf: Date): Promise<ReviewJob[]>;
  delete(id: string): Promise<ReviewJob>;
}

const ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,79}$/u;
const LANGUAGE_PATTERN = /^[a-z][a-z0-9+._-]{0,63}$/u;
const STATES = new Set<ReviewJobState>(["queued", "processing", "ready", "failed", "expired", "deleted"]);
const TERMINAL_STATES = new Set<ReviewJobState>(["expired", "deleted"]);
const TRANSITIONS: Readonly<Record<ReviewJobState, ReadonlySet<ReviewJobState>>> = {
  queued: new Set(["processing", "failed", "expired", "deleted"]),
  processing: new Set(["ready", "failed", "expired", "deleted"]),
  ready: new Set(["expired", "deleted"]),
  failed: new Set(["expired", "deleted"]),
  expired: new Set(["deleted"]),
  deleted: new Set(),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], code: JobStoreErrorCode): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) throw new JobStoreError(code);
}

function opaqueId(value: unknown, code: JobStoreErrorCode): string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new JobStoreError(code);
  return value;
}

function timestamp(value: unknown, code: JobStoreErrorCode): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    throw new JobStoreError(code);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) throw new JobStoreError(code);
  return value;
}

function count(value: unknown, code: JobStoreErrorCode): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new JobStoreError(code);
  return value;
}

function capabilitySummary(value: unknown, code: JobStoreErrorCode): ReviewJobCapabilitySummary {
  if (!isRecord(value)) throw new JobStoreError(code);
  exactKeys(value, ["eligible_files", "analyzed_files", "excluded_files", "languages"], code);
  if (!Array.isArray(value.languages)) throw new JobStoreError(code);
  const languages = value.languages.map((candidate) => {
    if (!isRecord(candidate)) throw new JobStoreError(code);
    exactKeys(candidate, ["language", "tier", "eligible_files", "analyzed_files", "failed_files"], code);
    if (typeof candidate.language !== "string" || !LANGUAGE_PATTERN.test(candidate.language)) throw new JobStoreError(code);
    if (candidate.tier !== "enhanced" && candidate.tier !== "fallback" && candidate.tier !== "structured") {
      throw new JobStoreError(code);
    }
    const tier = candidate.tier as "enhanced" | "fallback" | "structured";
    return {
      language: candidate.language,
      tier,
      eligible_files: count(candidate.eligible_files, code),
      analyzed_files: count(candidate.analyzed_files, code),
      failed_files: count(candidate.failed_files, code),
    };
  });
  const ordered = [...languages].sort((left, right) => left.language.localeCompare(right.language));
  if (languages.some((item, index) => item.language !== ordered[index]?.language)) throw new JobStoreError(code);
  return {
    eligible_files: count(value.eligible_files, code),
    analyzed_files: count(value.analyzed_files, code),
    excluded_files: count(value.excluded_files, code),
    languages,
  };
}

function jobFailure(value: unknown, code: JobStoreErrorCode): ReviewJobFailure {
  if (!isRecord(value)) throw new JobStoreError(code);
  exactKeys(value, ["code"], code);
  if (typeof value.code !== "string" || !ERROR_CODE_PATTERN.test(value.code)) throw new JobStoreError(code);
  return { code: value.code };
}

function validState(value: unknown, code: JobStoreErrorCode): ReviewJobState {
  if (typeof value !== "string" || !STATES.has(value as ReviewJobState)) throw new JobStoreError(code);
  return value as ReviewJobState;
}

function validateJobInvariants(job: ReviewJob, code: JobStoreErrorCode): ReviewJob {
  if (job.state === "ready" && (job.review_id === null || job.capability_summary === null || job.error !== null)) {
    throw new JobStoreError(code);
  }
  if (job.state === "failed" && job.error === null) throw new JobStoreError(code);
  if (["queued", "processing"].includes(job.state) && (job.review_id !== null || job.capability_summary !== null || job.error !== null)) {
    throw new JobStoreError(code);
  }
  return job;
}

function parseJob(data: Buffer): ReviewJob {
  let value: unknown;
  try {
    value = JSON.parse(data.toString("utf8"));
  } catch {
    throw new JobStoreError("JOB_CORRUPT");
  }
  if (!isRecord(value)) throw new JobStoreError("JOB_SCHEMA_INVALID");
  exactKeys(value, [
    "schema_version", "id", "version", "state", "created_at", "updated_at", "expires_at", "snapshot_id",
    "review_id", "capability_summary", "error",
  ], "JOB_SCHEMA_INVALID");
  if (value.schema_version !== 1 || typeof value.version !== "number" || !Number.isSafeInteger(value.version) || value.version < 1) {
    throw new JobStoreError("JOB_SCHEMA_INVALID");
  }
  const job: ReviewJob = {
    schema_version: 1,
    id: opaqueId(value.id, "JOB_SCHEMA_INVALID"),
    version: value.version,
    state: validState(value.state, "JOB_SCHEMA_INVALID"),
    created_at: timestamp(value.created_at, "JOB_SCHEMA_INVALID"),
    updated_at: timestamp(value.updated_at, "JOB_SCHEMA_INVALID"),
    expires_at: timestamp(value.expires_at, "JOB_SCHEMA_INVALID"),
    snapshot_id: opaqueId(value.snapshot_id, "JOB_SCHEMA_INVALID"),
    review_id: value.review_id === null ? null : opaqueId(value.review_id, "JOB_SCHEMA_INVALID"),
    capability_summary: value.capability_summary === null ? null : capabilitySummary(value.capability_summary, "JOB_SCHEMA_INVALID"),
    error: value.error === null ? null : jobFailure(value.error, "JOB_SCHEMA_INVALID"),
  };
  if (Date.parse(job.expires_at) <= Date.parse(job.created_at) || Date.parse(job.updated_at) < Date.parse(job.created_at)) {
    throw new JobStoreError("JOB_SCHEMA_INVALID");
  }
  return validateJobInvariants(job, "JOB_SCHEMA_INVALID");
}

function createInput(value: CreateReviewJobInput): CreateReviewJobInput {
  if (!isRecord(value)) throw new JobStoreError("JOB_INPUT_INVALID");
  exactKeys(value, ["id", "snapshot_id", "expires_at"], "JOB_INPUT_INVALID");
  return {
    id: opaqueId(value.id, "JOB_INPUT_INVALID"),
    snapshot_id: opaqueId(value.snapshot_id, "JOB_INPUT_INVALID"),
    expires_at: timestamp(value.expires_at, "JOB_INPUT_INVALID"),
  };
}

function nextInput(value: ReviewJobNext): ReviewJobNext {
  if (!isRecord(value)) throw new JobStoreError("JOB_INPUT_INVALID");
  const allowed = ["state", "review_id", "capability_summary", "error", "expires_at"];
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new JobStoreError("JOB_INPUT_INVALID");
  const state = validState(value.state, "JOB_INPUT_INVALID");
  const reviewId = value.review_id === undefined ? undefined : opaqueId(value.review_id, "JOB_INPUT_INVALID");
  const summary = value.capability_summary === undefined ? undefined : capabilitySummary(value.capability_summary, "JOB_INPUT_INVALID");
  const error = value.error === undefined ? undefined : jobFailure(value.error, "JOB_INPUT_INVALID");
  const expiresAt = value.expires_at === undefined ? undefined : timestamp(value.expires_at, "JOB_INPUT_INVALID");
  if (state === "ready" && (reviewId === undefined || summary === undefined || error !== undefined || expiresAt === undefined)) {
    throw new JobStoreError("JOB_INPUT_INVALID");
  }
  if (state === "failed" && (error === undefined || reviewId !== undefined || summary !== undefined)) {
    throw new JobStoreError("JOB_INPUT_INVALID");
  }
  if (state !== "ready" && (expiresAt !== undefined || (state !== "failed" && (reviewId !== undefined || summary !== undefined || error !== undefined)))) {
    throw new JobStoreError("JOB_INPUT_INVALID");
  }
  return { state, ...(reviewId === undefined ? {} : { review_id: reviewId }), ...(summary === undefined ? {} : { capability_summary: summary }), ...(error === undefined ? {} : { error }), ...(expiresAt === undefined ? {} : { expires_at: expiresAt }) };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class FileSystemReviewJobStore implements ReviewJobStore {
  readonly root: string;
  private readonly now: () => Date;

  constructor(root: string, options: { now?: () => Date } = {}) {
    this.root = path.resolve(root);
    this.now = options.now ?? (() => new Date());
  }

  private jobsDirectory(): string {
    return path.join(this.root, "jobs");
  }

  private jobPath(id: string): string {
    return path.join(this.jobsDirectory(), `${opaqueId(id, "JOB_ID_INVALID")}.json`);
  }

  private lockPath(id: string): string {
    return path.join(this.jobsDirectory(), `${opaqueId(id, "JOB_ID_INVALID")}.lock`);
  }

  private async ensureDirectory(): Promise<void> {
    await mkdir(this.jobsDirectory(), { recursive: true });
  }

  private async withLock<T>(id: string, run: () => Promise<T>): Promise<T> {
    await this.ensureDirectory();
    const lockPath = this.lockPath(id);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        handle = await open(lockPath, "wx", 0o600);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new JobStoreError("JOB_IO_FAILED");
        await wait(5);
      }
    }
    if (!handle) throw new JobStoreError("JOB_LOCK_TIMEOUT");
    try {
      return await run();
    } finally {
      await handle.close().catch(() => undefined);
      await unlink(lockPath).catch(() => undefined);
    }
  }

  private async readPath(id: string): Promise<ReviewJob> {
    try {
      return parseJob(await readFile(this.jobPath(id)));
    } catch (error) {
      if (error instanceof JobStoreError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new JobStoreError("JOB_NOT_FOUND");
      throw new JobStoreError("JOB_IO_FAILED");
    }
  }

  private async publish(job: ReviewJob): Promise<void> {
    const target = this.jobPath(job.id);
    const temporary = path.join(this.jobsDirectory(), `.${job.id}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, `${JSON.stringify(job)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
      for (let attempt = 0; ; attempt += 1) {
        try {
          await rename(temporary, target);
          break;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (attempt >= 9 || !["EACCES", "EBUSY", "EPERM"].includes(code ?? "")) throw error;
          await wait(5 * (attempt + 1));
        }
      }
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      if (error instanceof JobStoreError) throw error;
      throw new JobStoreError("JOB_IO_FAILED");
    }
  }

  async create(input: CreateReviewJobInput): Promise<ReviewJob> {
    const validInput = createInput(input);
    return this.withLock(validInput.id, async () => {
      try {
        await readFile(this.jobPath(validInput.id));
        throw new JobStoreError("JOB_EXISTS");
      } catch (error) {
        if (error instanceof JobStoreError) throw error;
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new JobStoreError("JOB_IO_FAILED");
      }
      const now = this.now().toISOString();
      const job = validateJobInvariants({
        schema_version: 1,
        id: validInput.id,
        version: 1,
        state: "queued",
        created_at: now,
        updated_at: now,
        expires_at: validInput.expires_at,
        snapshot_id: validInput.snapshot_id,
        review_id: null,
        capability_summary: null,
        error: null,
      }, "JOB_INPUT_INVALID");
      if (Date.parse(job.expires_at) <= Date.parse(now)) throw new JobStoreError("JOB_INPUT_INVALID");
      await this.publish(job);
      return job;
    });
  }

  async get(id: string): Promise<ReviewJob> {
    opaqueId(id, "JOB_ID_INVALID");
    return this.readPath(id);
  }

  async findByReviewId(reviewId: string): Promise<ReviewJob | null> {
    opaqueId(reviewId, "JOB_ID_INVALID");
    await this.ensureDirectory();
    let entries: Dirent[];
    try {
      entries = await readdir(this.jobsDirectory(), { withFileTypes: true });
    } catch {
      throw new JobStoreError("JOB_IO_FAILED");
    }
    const ids = entries
      .filter((entry) => entry.isFile() && /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.json$/u.test(entry.name))
      .map((entry) => entry.name.slice(0, -5))
      .sort();
    for (const id of ids) {
      const job = await this.readPath(id);
      if (job.review_id === reviewId) return job;
    }
    return null;
  }

  async transition(id: string, expectedVersion: number, next: ReviewJobNext): Promise<ReviewJob> {
    opaqueId(id, "JOB_ID_INVALID");
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new JobStoreError("JOB_INPUT_INVALID");
    const validNext = nextInput(next);
    return this.withLock(id, async () => {
      const current = await this.readPath(id);
      if (current.version !== expectedVersion) throw new JobStoreError("JOB_VERSION_CONFLICT");
      if (!TRANSITIONS[current.state].has(validNext.state)) throw new JobStoreError("JOB_TRANSITION_INVALID");
      const updatedAt = this.now().toISOString();
      if (validNext.expires_at !== undefined && Date.parse(validNext.expires_at) <= Date.parse(updatedAt)) {
        throw new JobStoreError("JOB_INPUT_INVALID");
      }
      const updated = validateJobInvariants({
        ...current,
        version: current.version + 1,
        state: validNext.state,
        updated_at: updatedAt,
        expires_at: validNext.expires_at ?? current.expires_at,
        review_id: validNext.state === "ready" ? validNext.review_id! : current.review_id,
        capability_summary: validNext.state === "ready" ? validNext.capability_summary! : current.capability_summary,
        error: validNext.state === "failed" ? validNext.error! : current.error,
      }, "JOB_INPUT_INVALID");
      await this.publish(updated);
      return updated;
    });
  }

  async listExpired(asOf: Date): Promise<ReviewJob[]> {
    if (!(asOf instanceof Date) || !Number.isFinite(asOf.getTime())) throw new JobStoreError("JOB_INPUT_INVALID");
    await this.ensureDirectory();
    let entries: Dirent[];
    try {
      entries = await readdir(this.jobsDirectory(), { withFileTypes: true });
    } catch {
      throw new JobStoreError("JOB_IO_FAILED");
    }
    const ids = entries
      .filter((entry) => entry.isFile() && /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.json$/u.test(entry.name))
      .map((entry) => entry.name.slice(0, -5))
      .sort();
    const expired: ReviewJob[] = [];
    for (const id of ids) {
      const job = await this.get(id);
      if (!TERMINAL_STATES.has(job.state) && Date.parse(job.expires_at) <= asOf.getTime()) expired.push(job);
    }
    return expired;
  }

  async delete(id: string): Promise<ReviewJob> {
    opaqueId(id, "JOB_ID_INVALID");
    return this.withLock(id, async () => {
      const current = await this.readPath(id);
      if (current.state === "deleted") return current;
      const updated = validateJobInvariants({
        ...current,
        version: current.version + 1,
        state: "deleted",
        updated_at: this.now().toISOString(),
      }, "JOB_INPUT_INVALID");
      await this.publish(updated);
      return updated;
    });
  }
}
