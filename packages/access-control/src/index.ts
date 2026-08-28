import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const DAY_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_REVIEW_START_LIMIT = 2;
const DEFAULT_QUESTION_LIMIT = 30;
const DEFAULT_REVIEW_LEASE_TTL_MS = 60 * 60 * 1_000;
const MAX_REVIEW_LEASE_TTL_MS = DAY_MS;
const MAX_REVIEW_START_LIMIT = 2;
const MAX_QUESTION_LIMIT = 30;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const SUBJECT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,127}$/u;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export type AccessControlErrorCode =
  | "ACCESS_CODE_INVALID"
  | "ACCESS_IDENTIFIER_INVALID"
  | "ACCESS_LIMIT_INVALID"
  | "ACCESS_ATOMIC_PUBLICATION_FAILED"
  | "ACCESS_STATE_IO_FAILED"
  | "ACCESS_STATE_CORRUPT"
  | "ACCESS_STATE_SCHEMA_INVALID"
  | "REVIEW_ALREADY_ACTIVE"
  | "REVIEW_START_LIMIT_EXCEEDED"
  | "REVIEW_LEASE_INVALID"
  | "QUESTION_LIMIT_EXCEEDED";

/** Every diagnostic intentionally contains only this stable, body-free code. */
export class AccessControlError extends Error {
  readonly code: AccessControlErrorCode;

  constructor(code: AccessControlErrorCode) {
    super(code);
    this.name = "AccessControlError";
    this.code = code;
  }
}

export type AccessCodeValidation = {
  valid: boolean;
  /** A stable opaque subject identifier is returned only for a valid code. */
  subject: string | null;
};

export type ReviewLease = {
  leaseId: string;
  subject: string;
  expiresAt: string;
  startsInWindow: number;
};

export type ReviewLeaseResult = {
  leaseId: string;
  subject: string;
  state: "completed" | "released" | "expired";
};

export type QuestionQuota = {
  subject: string;
  questionsInWindow: number;
  remaining: number;
};

export type AccessControlOptions = {
  root: string;
  accessCodes: readonly string[];
  now?: () => Date;
  /** Maximum review starts in the fixed rolling 24-hour window. Defaults to 2. */
  reviewStartLimit?: number;
  /** Compatibility spelling for configuration files that use a 24-hour suffix. */
  maxReviewStarts24h?: number;
  /** Maximum questions for a client subject in the fixed rolling 24-hour window. Defaults to 30. */
  questionLimit?: number;
  /** Compatibility spelling for configuration files that use a 24-hour suffix. */
  maxQuestions24h?: number;
  /** Lease lifetime in milliseconds. It must be positive and at most 24 hours. */
  reviewLeaseTtlMs?: number;
  leaseTtlMs?: number;
};

type LegacyAccessControlOptions = Omit<AccessControlOptions, "root">;

export type AccessController = {
  validateAccessCode(code: string): Promise<AccessCodeValidation>;
  authorizeAccessCode(code: string): Promise<{ subject: string }>;
  startReview(input: { accessCode: string }): Promise<ReviewLease>;
  completeReview(leaseId: string): Promise<ReviewLeaseResult>;
  releaseReview(leaseId: string): Promise<ReviewLeaseResult>;
  askQuestion(input: { subject?: string; clientSubject?: string }): Promise<QuestionQuota>;
  recordQuestion(input: { subject?: string; clientSubject?: string }): Promise<QuestionQuota>;
  mintAccessCode?(): Promise<{ id: string; code: string }>;
  revokeAccessCode?(id: string): Promise<{ id: string; revoked: boolean }>;
  listAccessCodes?(): Promise<readonly { id: string; createdAt: string; revoked: boolean }[]>;
};

type StoredAccessCode = { id: string; hash: string; created_at: string; revoked_at: string | null };
type StoredAccessCodes = { schema_version: 1; codes: StoredAccessCode[] };

type StoredLease = {
  status: "active" | "completed" | "released" | "expired";
  expires_at: string;
};

type StoredReviewSubject = {
  starts: string[];
  active_lease: string | null;
  leases: Record<string, StoredLease>;
};

type StoredState = {
  schema_version: 1;
  reviews: Record<string, StoredReviewSubject>;
  questions: Record<string, string[]>;
};

const stateKeys = ["schema_version", "reviews", "questions"] as const;
const operationLocks = new Map<string, Promise<void>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], code: AccessControlErrorCode): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) throw new AccessControlError(code);
}

function validDate(now: () => Date): Date {
  let date: Date;
  try {
    date = now();
  } catch {
    throw new AccessControlError("ACCESS_STATE_IO_FAILED");
  }
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new AccessControlError("ACCESS_STATE_CORRUPT");
  return new Date(date.getTime());
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !ISO_TIMESTAMP_PATTERN.test(value)) throw new AccessControlError("ACCESS_STATE_SCHEMA_INVALID");
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) throw new AccessControlError("ACCESS_STATE_SCHEMA_INVALID");
  return value;
}

function hash(value: string): string {
  return createHash("sha256").update("code-knowledge-assistant/access-control/v1\0").update(value, "utf8").digest("hex");
}

function hashesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function validCode(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(value);
}

function validSubject(value: unknown): value is string {
  return typeof value === "string" && SUBJECT_PATTERN.test(value) && !value.includes("..") && !value.endsWith(".");
}

function validateLimit(value: unknown, fallback: number, maximum: number): number {
  const candidate = value === undefined ? fallback : value;
  if (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate < 1 || candidate > maximum) {
    throw new AccessControlError("ACCESS_LIMIT_INVALID");
  }
  return candidate;
}

function validateOptions(options: AccessControlOptions): {
  root: string;
  codeHashes: string[];
  now: () => Date;
  reviewStartLimit: number;
  questionLimit: number;
  reviewLeaseTtlMs: number;
} {
  if (!isRecord(options) || typeof options.root !== "string" || options.root.length === 0 || !Array.isArray(options.accessCodes)) {
    throw new AccessControlError("ACCESS_LIMIT_INVALID");
  }
  const codeHashes: string[] = [];
  for (const code of options.accessCodes) {
    if (!validCode(code)) throw new AccessControlError("ACCESS_CODE_INVALID");
    const digest = hash(code);
    if (!codeHashes.some((existing) => hashesEqual(existing, digest))) codeHashes.push(digest);
  }
  const now = options.now ?? (() => new Date());
  if (typeof now !== "function") throw new AccessControlError("ACCESS_LIMIT_INVALID");
  const reviewLeaseTtlMs = options.reviewLeaseTtlMs ?? options.leaseTtlMs ?? DEFAULT_REVIEW_LEASE_TTL_MS;
  if (!Number.isSafeInteger(reviewLeaseTtlMs) || reviewLeaseTtlMs < 1 || reviewLeaseTtlMs > MAX_REVIEW_LEASE_TTL_MS) {
    throw new AccessControlError("ACCESS_LIMIT_INVALID");
  }
  return {
    root: path.resolve(options.root),
    codeHashes,
    now,
    reviewStartLimit: validateLimit(options.reviewStartLimit ?? options.maxReviewStarts24h, DEFAULT_REVIEW_START_LIMIT, MAX_REVIEW_START_LIMIT),
    questionLimit: validateLimit(options.questionLimit ?? options.maxQuestions24h, DEFAULT_QUESTION_LIMIT, MAX_QUESTION_LIMIT),
    reviewLeaseTtlMs,
  };
}

function emptyState(): StoredState {
  return { schema_version: 1, reviews: {}, questions: {} };
}

function parseAccessCodes(data: string): StoredAccessCodes {
  let parsed: unknown;
  try { parsed = JSON.parse(data); } catch { throw new AccessControlError("ACCESS_STATE_CORRUPT"); }
  if (!isRecord(parsed) || parsed.schema_version !== 1 || !Array.isArray(parsed.codes)) throw new AccessControlError("ACCESS_STATE_SCHEMA_INVALID");
  const codes: StoredAccessCode[] = [];
  for (const item of parsed.codes) {
    if (!isRecord(item) || typeof item.id !== "string" || !/^[a-f0-9]{12}$/u.test(item.id) || typeof item.hash !== "string" || !HASH_PATTERN.test(item.hash)
      || typeof item.created_at !== "string" || !ISO_TIMESTAMP_PATTERN.test(item.created_at) || (item.revoked_at !== null && (typeof item.revoked_at !== "string" || !ISO_TIMESTAMP_PATTERN.test(item.revoked_at)))) {
      throw new AccessControlError("ACCESS_STATE_SCHEMA_INVALID");
    }
    codes.push({ id: item.id, hash: item.hash, created_at: item.created_at, revoked_at: item.revoked_at as string | null });
  }
  return { schema_version: 1, codes };
}

function parseState(data: string): StoredState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new AccessControlError("ACCESS_STATE_CORRUPT");
  }
  if (!isRecord(parsed)) throw new AccessControlError("ACCESS_STATE_SCHEMA_INVALID");
  exactKeys(parsed, stateKeys, "ACCESS_STATE_SCHEMA_INVALID");
  if (parsed.schema_version !== 1 || !isRecord(parsed.reviews) || !isRecord(parsed.questions)) {
    throw new AccessControlError("ACCESS_STATE_SCHEMA_INVALID");
  }
  const reviews: Record<string, StoredReviewSubject> = {};
  for (const [subject, candidate] of Object.entries(parsed.reviews)) {
    if (!HASH_PATTERN.test(subject) || !isRecord(candidate)) throw new AccessControlError("ACCESS_STATE_SCHEMA_INVALID");
    exactKeys(candidate, ["starts", "active_lease", "leases"], "ACCESS_STATE_SCHEMA_INVALID");
    if (!Array.isArray(candidate.starts) || !isRecord(candidate.leases)) throw new AccessControlError("ACCESS_STATE_SCHEMA_INVALID");
    const starts = candidate.starts.map(timestamp);
    if (starts.some((item, index) => index > 0 && item < starts[index - 1]!)) throw new AccessControlError("ACCESS_STATE_SCHEMA_INVALID");
    const active = candidate.active_lease;
    if (active !== null && (typeof active !== "string" || !HASH_PATTERN.test(active))) throw new AccessControlError("ACCESS_STATE_SCHEMA_INVALID");
    const leases: Record<string, StoredLease> = {};
    for (const [lease, stored] of Object.entries(candidate.leases)) {
      if (!HASH_PATTERN.test(lease) || !isRecord(stored)) throw new AccessControlError("ACCESS_STATE_SCHEMA_INVALID");
      exactKeys(stored, ["status", "expires_at"], "ACCESS_STATE_SCHEMA_INVALID");
      if (!["active", "completed", "released", "expired"].includes(stored.status as string)) throw new AccessControlError("ACCESS_STATE_SCHEMA_INVALID");
      leases[lease] = { status: stored.status as StoredLease["status"], expires_at: timestamp(stored.expires_at) };
    }
    if (active !== null && leases[active]?.status !== "active") throw new AccessControlError("ACCESS_STATE_SCHEMA_INVALID");
    reviews[subject] = { starts, active_lease: active, leases };
  }
  const questions: Record<string, string[]> = {};
  for (const [subject, candidate] of Object.entries(parsed.questions)) {
    if (!HASH_PATTERN.test(subject) || !Array.isArray(candidate)) throw new AccessControlError("ACCESS_STATE_SCHEMA_INVALID");
    const timestamps = candidate.map(timestamp);
    if (timestamps.some((item, index) => index > 0 && item < timestamps[index - 1]!)) throw new AccessControlError("ACCESS_STATE_SCHEMA_INVALID");
    questions[subject] = timestamps;
  }
  return { schema_version: 1, reviews, questions };
}

/**
 * A filesystem-backed, body-free ledger. The ledger is reloaded for every
 * operation so a controller recreated after a restart observes prior limits.
 */
export class FileSystemAccessControl implements AccessController {
  readonly root: string;
  private readonly codeHashes: string[];
  private readonly now: () => Date;
  private readonly reviewStartLimit: number;
  private readonly questionLimit: number;
  private readonly reviewLeaseTtlMs: number;

  constructor(options: AccessControlOptions);
  constructor(root: string, options: LegacyAccessControlOptions);
  constructor(optionsOrRoot: AccessControlOptions | string, legacyOptions?: LegacyAccessControlOptions) {
    const options: AccessControlOptions = typeof optionsOrRoot === "string"
      ? { root: optionsOrRoot, accessCodes: [], ...(legacyOptions ?? {}) }
      : optionsOrRoot;
    const configured = validateOptions(options);
    this.root = configured.root;
    this.codeHashes = configured.codeHashes;
    this.now = configured.now;
    this.reviewStartLimit = configured.reviewStartLimit;
    this.questionLimit = configured.questionLimit;
    this.reviewLeaseTtlMs = configured.reviewLeaseTtlMs;
  }

  private statePath(): string {
    return path.join(this.root, "access-control-ledger.json");
  }

  private codesPath(): string { return path.join(this.root, "access-codes.json"); }

  private async loadCodes(): Promise<StoredAccessCodes> {
    try { return parseAccessCodes(await readFile(this.codesPath(), "utf8")); }
    catch (error) { if (error instanceof AccessControlError) throw error; if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return { schema_version: 1, codes: [] }; throw new AccessControlError("ACCESS_STATE_IO_FAILED"); }
  }

  private async saveCodes(state: StoredAccessCodes): Promise<void> {
    const temporary = `${this.codesPath()}.${randomUUID()}.tmp`;
    try { await mkdir(this.root, { recursive: true }); await writeFile(temporary, JSON.stringify(state), { encoding: "utf8", flag: "wx", mode: 0o600 }); await rename(temporary, this.codesPath()); }
    catch { await rm(temporary, { force: true }).catch(() => undefined); throw new AccessControlError("ACCESS_ATOMIC_PUBLICATION_FAILED"); }
  }

  private async load(): Promise<StoredState> {
    try {
      const data = await readFile(this.statePath(), "utf8");
      return parseState(data);
    } catch (error) {
      if (error instanceof AccessControlError) throw error;
      const code = error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
      if (code) return emptyState();
      throw new AccessControlError("ACCESS_STATE_IO_FAILED");
    }
  }

  private async save(state: StoredState): Promise<void> {
    const temporary = `${this.statePath()}.${randomUUID()}.tmp`;
    try {
      await mkdir(this.root, { recursive: true });
      await writeFile(temporary, JSON.stringify(state), { encoding: "utf8", flag: "wx", mode: 0o600 });
      await rename(temporary, this.statePath());
    } catch {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw new AccessControlError("ACCESS_ATOMIC_PUBLICATION_FAILED");
    }
  }

  private async transact<T>(operation: (state: StoredState, now: Date) => Promise<{ value: T; changed: boolean }> | { value: T; changed: boolean }): Promise<T> {
    const previous = operationLocks.get(this.root) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    operationLocks.set(this.root, current);
    await previous;
    try {
      const state = await this.load();
      const result = await operation(state, validDate(this.now));
      if (result.changed) await this.save(state);
      return result.value;
    } finally {
      release();
      if (operationLocks.get(this.root) === current) operationLocks.delete(this.root);
    }
  }

  async validateAccessCode(code: string): Promise<AccessCodeValidation> {
    if (!validCode(code)) return { valid: false, subject: null };
    const digest = hash(code);
    const dynamic = await this.loadCodes();
    const revoked = new Set(dynamic.codes.filter((item) => item.revoked_at !== null).map((item) => item.hash));
    const match = [...this.codeHashes, ...dynamic.codes.filter((item) => item.revoked_at === null).map((item) => item.hash)].find((candidate) => !revoked.has(candidate) && hashesEqual(candidate, digest));
    return match === undefined ? { valid: false, subject: null } : { valid: true, subject: match };
  }

  async mintAccessCode(): Promise<{ id: string; code: string }> {
    return this.transact<{ id: string; code: string }>(async (_state, now) => {
      const code = randomBytes(24).toString("base64url");
      const digest = hash(code);
      const id = digest.slice(0, 12);
      const codes = await this.loadCodes();
      codes.codes.push({ id, hash: digest, created_at: now.toISOString(), revoked_at: null });
      await this.saveCodes(codes);
      return { value: { id, code }, changed: false };
    });
  }

  async revokeAccessCode(id: string): Promise<{ id: string; revoked: boolean }> {
    if (typeof id !== "string" || !/^[a-f0-9]{12}$/u.test(id)) throw new AccessControlError("ACCESS_IDENTIFIER_INVALID");
    return this.transact<{ id: string; revoked: boolean }>(async (_state, now) => {
      const codes = await this.loadCodes();
      const item = codes.codes.find((candidate) => candidate.id === id);
      if (!item) return { value: { id, revoked: false }, changed: false };
      if (item.revoked_at === null) { item.revoked_at = now.toISOString(); await this.saveCodes(codes); }
      return { value: { id, revoked: true }, changed: false };
    });
  }

  async listAccessCodes(): Promise<readonly { id: string; createdAt: string; revoked: boolean }[]> {
    const codes = await this.loadCodes();
    return codes.codes.map((item) => ({ id: item.id, createdAt: item.created_at, revoked: item.revoked_at !== null }));
  }

  async authorizeAccessCode(code: string): Promise<{ subject: string }> {
    const validation = await this.validateAccessCode(code);
    if (!validation.valid || validation.subject === null) throw new AccessControlError("ACCESS_CODE_INVALID");
    return { subject: validation.subject };
  }

  async startReview(input: { accessCode: string }): Promise<ReviewLease> {
    if (!isRecord(input) || typeof input.accessCode !== "string") throw new AccessControlError("ACCESS_CODE_INVALID");
    const authorized = await this.authorizeAccessCode(input.accessCode);
    return this.transact<ReviewLease>((state, now) => {
      const subject = authorized.subject;
      const review = state.reviews[subject] ?? { starts: [], active_lease: null, leases: {} };
      const cutoff = now.getTime() - DAY_MS;
      review.starts = review.starts.filter((item) => Date.parse(item) > cutoff);
      if (review.active_lease !== null) {
        const current = review.leases[review.active_lease];
        if (current === undefined || current.status !== "active") throw new AccessControlError("ACCESS_STATE_SCHEMA_INVALID");
        if (Date.parse(current.expires_at) <= now.getTime()) {
          current.status = "expired";
          review.active_lease = null;
        }
      }
      if (review.active_lease !== null) throw new AccessControlError("REVIEW_ALREADY_ACTIVE");
      if (review.starts.length >= this.reviewStartLimit) throw new AccessControlError("REVIEW_START_LIMIT_EXCEEDED");
      const leaseToken = randomUUID();
      const leaseHash = hash(leaseToken);
      const expiresAt = new Date(now.getTime() + this.reviewLeaseTtlMs).toISOString();
      review.starts.push(now.toISOString());
      review.leases[leaseHash] = { status: "active", expires_at: expiresAt };
      review.active_lease = leaseHash;
      state.reviews[subject] = review;
      return { value: { leaseId: leaseToken, subject, expiresAt, startsInWindow: review.starts.length }, changed: true };
    });
  }

  private async finishReview(leaseId: string, finalState: "completed" | "released"): Promise<ReviewLeaseResult> {
    if (typeof leaseId !== "string" || !/^[0-9a-f-]{36}$/u.test(leaseId)) throw new AccessControlError("REVIEW_LEASE_INVALID");
    const leaseHash = hash(leaseId);
    return this.transact<ReviewLeaseResult>((state, now) => {
      for (const [subject, review] of Object.entries(state.reviews)) {
        const lease = review.leases[leaseHash];
        if (lease === undefined) continue;
        if (lease.status === "active" && Date.parse(lease.expires_at) <= now.getTime()) {
          lease.status = "expired";
          review.active_lease = null;
        }
        if (lease.status === "active") {
          lease.status = finalState;
          if (review.active_lease === leaseHash) review.active_lease = null;
          return { value: { leaseId, subject, state: finalState }, changed: true };
        }
        if (lease.status === finalState || (finalState === "released" && lease.status === "completed") || (finalState === "completed" && lease.status === "released")) {
          return { value: { leaseId, subject, state: lease.status }, changed: false };
        }
        if (lease.status === "expired") return { value: { leaseId, subject, state: "expired" }, changed: true };
      }
      throw new AccessControlError("REVIEW_LEASE_INVALID");
    });
  }

  completeReview(leaseId: string): Promise<ReviewLeaseResult> {
    return this.finishReview(leaseId, "completed");
  }

  releaseReview(leaseId: string): Promise<ReviewLeaseResult> {
    return this.finishReview(leaseId, "released");
  }

  async askQuestion(input: { subject?: string; clientSubject?: string }): Promise<QuestionQuota> {
    return this.recordQuestion(input);
  }

  async recordQuestion(input: { subject?: string; clientSubject?: string }): Promise<QuestionQuota> {
    if (!isRecord(input)) throw new AccessControlError("ACCESS_IDENTIFIER_INVALID");
    const clientSubject = input.subject ?? input.clientSubject;
    if (!validSubject(clientSubject)) throw new AccessControlError("ACCESS_IDENTIFIER_INVALID");
    const subject = hash(clientSubject);
    return this.transact((state, now) => {
      const cutoff = now.getTime() - DAY_MS;
      const questions = (state.questions[subject] ?? []).filter((item) => Date.parse(item) > cutoff);
      if (questions.length >= this.questionLimit) throw new AccessControlError("QUESTION_LIMIT_EXCEEDED");
      questions.push(now.toISOString());
      state.questions[subject] = questions;
      return { value: { subject: clientSubject, questionsInWindow: questions.length, remaining: this.questionLimit - questions.length }, changed: true };
    });
  }
}

export function createAccessController(options: AccessControlOptions): AccessController;
export function createAccessController(root: string, options: LegacyAccessControlOptions): AccessController;
export function createAccessController(optionsOrRoot: AccessControlOptions | string, legacyOptions?: LegacyAccessControlOptions): AccessController {
  return typeof optionsOrRoot === "string"
    ? new FileSystemAccessControl(optionsOrRoot, legacyOptions ?? { accessCodes: [] })
    : new FileSystemAccessControl(optionsOrRoot);
}

export const createFileSystemAccessControl = createAccessController;
export const createAccessControl = createAccessController;
export class FileSystemAccessControlStore extends FileSystemAccessControl {}
