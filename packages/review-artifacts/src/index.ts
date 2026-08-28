import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RepositoryAnalysis } from "@code-knowledge-assistant/analysis";
import { buildLexicalEvidenceIndex, type EvidenceDocument } from "@code-knowledge-assistant/retrieval";
import { type ReviewBundle, type ReviewEvidence, validateReviewBundle } from "@code-knowledge-assistant/review-generation";
import type { LocalRepositoryReview } from "@code-knowledge-assistant/review-pipeline";

export type CompletedReviewArtifact = {
  schema_version: 1;
  id: string;
  created_at: string;
  expires_at: string;
  analysis: RepositoryAnalysis;
  review: ReviewBundle;
  evidence: ReviewEvidence[];
};

export type SaveCompletedReviewArtifactInput = {
  id: string;
  expires_at: string;
  review: LocalRepositoryReview;
};

export type LoadedCompletedReviewArtifact = {
  artifact: CompletedReviewArtifact;
  review: LocalRepositoryReview;
};

export type ReviewArtifactMetadata = { id: string; expires_at: string };

export interface ReviewArtifactStore {
  save(input: SaveCompletedReviewArtifactInput): Promise<CompletedReviewArtifact>;
  get(id: string): Promise<LoadedCompletedReviewArtifact>;
  delete(id: string): Promise<void>;
  listExpired(asOf: Date): Promise<ReviewArtifactMetadata[]>;
}

export type ReviewArtifactStoreErrorCode =
  | "ARTIFACT_CORRUPT"
  | "ARTIFACT_EXISTS"
  | "ARTIFACT_ID_INVALID"
  | "ARTIFACT_ID_MISMATCH"
  | "ARTIFACT_INTEGRITY_INVALID"
  | "ARTIFACT_IO_FAILED"
  | "ARTIFACT_LOCK_TIMEOUT"
  | "ARTIFACT_NOT_FOUND"
  | "ARTIFACT_SCHEMA_INVALID"
  | "ARTIFACT_UNSAFE";

export class ReviewArtifactStoreError extends Error {
  readonly code: ReviewArtifactStoreErrorCode;
  constructor(code: ReviewArtifactStoreErrorCode) {
    super(code);
    this.name = "ReviewArtifactStoreError";
    this.code = code;
  }
}

const ID = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const SHA = /^[a-f0-9]{64}$/u;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
  }
}

function opaque(value: unknown, code: ReviewArtifactStoreErrorCode = "ARTIFACT_SCHEMA_INVALID"): string {
  if (typeof value !== "string" || !ID.test(value)) throw new ReviewArtifactStoreError(code);
  return value;
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !ISO.test(value) || new Date(value).toISOString() !== value) {
    throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
  }
  return value;
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
  return value;
}

function repoPath(value: unknown): string {
  const candidate = text(value);
  if (!candidate || candidate.includes("\\") || candidate.includes("\0") || path.posix.isAbsolute(candidate)
    || candidate.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new ReviewArtifactStoreError("ARTIFACT_UNSAFE");
  }
  return candidate;
}

function sourceRange(value: unknown): { path: string; start_line: number; end_line: number } {
  if (!isRecord(value)) throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
  exact(value, ["path", "start_line", "end_line"]);
  const start = count(value.start_line);
  const end = count(value.end_line);
  if (start < 1 || end < start) throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
  return { path: repoPath(value.path), start_line: start, end_line: end };
}

function analysis(value: unknown): RepositoryAnalysis {
  if (!isRecord(value)) throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
  exact(value, ["capabilities", "files", "chunks", "exclusions", "failures"]);
  if (!Array.isArray(value.capabilities) || !Array.isArray(value.files) || !Array.isArray(value.chunks)
    || !Array.isArray(value.exclusions) || !Array.isArray(value.failures)) throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
  const capabilities = value.capabilities.map((item) => {
    if (!isRecord(item)) throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
    exact(item, ["language", "tier", "extractor", "eligible_files", "analyzed_files", "failed_files"]);
    if (!["python", "typescript", "javascript", "text"].includes(text(item.language))
      || !["enhanced", "structured", "fallback"].includes(text(item.tier))) throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
    return { language: text(item.language) as RepositoryAnalysis["capabilities"][number]["language"], tier: text(item.tier) as "enhanced" | "structured" | "fallback", extractor: text(item.extractor), eligible_files: count(item.eligible_files), analyzed_files: count(item.analyzed_files), failed_files: count(item.failed_files) };
  });
  const files = value.files.map((item) => {
    if (!isRecord(item)) throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
    exact(item, ["path", "language", "tier", "range", "symbols", "imports"]);
    const relativePath = repoPath(item.path);
    if (!["python", "typescript", "javascript", "text"].includes(text(item.language))
      || !["enhanced", "structured", "fallback"].includes(text(item.tier)) || !Array.isArray(item.symbols) || !Array.isArray(item.imports)) {
      throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
    }
    const parsedRange = sourceRange(item.range);
    if (parsedRange.path !== relativePath) throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
    return {
      path: relativePath,
      language: text(item.language) as "python" | "typescript" | "javascript" | "text",
      tier: text(item.tier) as "enhanced" | "structured" | "fallback",
      range: parsedRange,
      symbols: item.symbols.map((symbol) => {
        if (!isRecord(symbol)) throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
        exact(symbol, ["name", "kind", "range"]);
        if (!["class", "function", "interface", "type"].includes(text(symbol.kind))) throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
        const symbolRange = sourceRange(symbol.range);
        if (symbolRange.path !== relativePath) throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
        return { name: text(symbol.name), kind: text(symbol.kind) as "class" | "function" | "interface" | "type", range: symbolRange };
      }),
      imports: item.imports.map((entry) => {
        if (!isRecord(entry)) throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
        exact(entry, ["specifier", "range"]);
        const importRange = sourceRange(entry.range);
        if (importRange.path !== relativePath) throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
        return { specifier: text(entry.specifier), range: importRange };
      }),
    };
  });
  const chunks = value.chunks.map((item) => {
    if (!isRecord(item)) throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
    exact(item, ["id", "range", "content"]);
    return { id: text(item.id), range: sourceRange(item.range), content: text(item.content) };
  });
  const exclusions = value.exclusions.map((item) => {
    if (!isRecord(item)) throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
    exact(item, ["path", "reason"]);
    return { path: repoPath(item.path), reason: text(item.reason) };
  });
  const failures = value.failures.map((item) => {
    if (!isRecord(item)) throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
    exact(item, ["path", "code"]);
    if (!["FILE_DRIFTED", "FILE_NOT_TEXT", "FILE_UNAVAILABLE", "INVENTORY_ENTRY_INVALID", "INVENTORY_PATH_INVALID"].includes(text(item.code))) {
      throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
    }
    return { path: repoPath(item.path), code: text(item.code) as RepositoryAnalysis["failures"][number]["code"] };
  });
  return { capabilities, files, chunks, exclusions, failures };
}

function strictReview(value: unknown, evidence: ReviewEvidence[]): ReviewBundle {
  if (!isRecord(value)) throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
  exact(value, ["schema_version", "review_id", "source_revision", "generated_at", "authority", "verification", "generation", "capability", "coverage", "concepts"]);
  if (!isRecord(value.generation) || !isRecord(value.capability) || !isRecord(value.coverage) || !Array.isArray(value.concepts)) {
    throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
  }
  exact(value.generation, ["generator", "model", "prompt_version"]);
  exact(value.capability, ["tiers"]);
  exact(value.coverage, ["eligible_files", "analyzed_files", "excluded_files"]);
  for (const concept of value.concepts) {
    if (!isRecord(concept)) throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
    exact(concept, ["id", "kind", "title", "summary", "claims"]);
    if (!Array.isArray(concept.claims)) throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
    for (const claim of concept.claims) {
      if (!isRecord(claim)) throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
      exact(claim, ["id", "text", "evidence_ids", "confidence"]);
    }
  }
  try {
    return validateReviewBundle(value, evidence);
  } catch {
    throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
  }
}

function strictEvidence(value: unknown): ReviewEvidence[] {
  if (!Array.isArray(value)) throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
  return value.map((item) => {
    if (!isRecord(item)) throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
    exact(item, ["id", "path", "start_line", "end_line", "sha256", "capability_tier", "evidence_kind", "symbol", "excerpt"]);
    const start = count(item.start_line);
    const end = count(item.end_line);
    if (text(item.id).trim().length === 0 || start < 1 || end < start || !SHA.test(text(item.sha256)) || !["enhanced", "structured", "fallback"].includes(text(item.capability_tier))
      || !["source", "documentation", "configuration", "test"].includes(text(item.evidence_kind))
      || !(typeof item.symbol === "string" || item.symbol === null) || text(item.excerpt).trim().length === 0) throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
    return { id: text(item.id), path: repoPath(item.path), start_line: start, end_line: end, sha256: text(item.sha256), capability_tier: text(item.capability_tier) as ReviewEvidence["capability_tier"], evidence_kind: text(item.evidence_kind) as ReviewEvidence["evidence_kind"], symbol: item.symbol, excerpt: text(item.excerpt) };
  });
}

function assertEvidenceMatchesAnalysis(review: Pick<LocalRepositoryReview, "analysis" | "evidence">): void {
  const chunks = new Map(review.analysis.chunks.map((chunk) => [chunk.id, chunk] as const));
  const files = new Map(review.analysis.files.map((file) => [file.path, file] as const));
  if (chunks.size !== review.evidence.length) throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
  for (const evidence of review.evidence) {
    const chunk = chunks.get(evidence.id);
    const file = files.get(evidence.path);
    if (!chunk || !file || chunk.content !== evidence.excerpt || chunk.range.path !== evidence.path
      || chunk.range.start_line !== evidence.start_line || chunk.range.end_line !== evidence.end_line || file.tier !== evidence.capability_tier) {
      throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
    }
  }
}

function documentsFor(review: Pick<LocalRepositoryReview, "review" | "evidence">): EvidenceDocument[] {
  const byId = new Map(review.evidence.map((item) => [item.id, item] as const));
  const primary: EvidenceDocument[] = review.evidence.map((item) => ({ id: `primary:${item.id}`, layer: "primary", content: item.excerpt, provenance: { repository_path: item.path, line_start: item.start_line, line_end: item.end_line } }));
  const derived = review.review.concepts.flatMap((concept) => concept.claims.map((claim) => {
    const source = byId.get(claim.evidence_ids[0]!);
    if (!source) throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
    return { id: `derived:${concept.id}:${claim.id}`, layer: "derived" as const, content: `${concept.title}\n${concept.summary}\n${claim.text}`, provenance: { repository_path: source.path, line_start: source.start_line, line_end: source.end_line } };
  }));
  return [...primary, ...derived];
}

function validateArtifact(value: unknown): CompletedReviewArtifact {
  if (!isRecord(value)) throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
  exact(value, ["schema_version", "id", "created_at", "expires_at", "analysis", "review", "evidence"]);
  if (value.schema_version !== 1) throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
  const artifact: CompletedReviewArtifact = { schema_version: 1, id: opaque(value.id), created_at: timestamp(value.created_at), expires_at: timestamp(value.expires_at), analysis: analysis(value.analysis), review: {} as ReviewBundle, evidence: strictEvidence(value.evidence) };
  if (Date.parse(artifact.expires_at) <= Date.parse(artifact.created_at)) throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
  artifact.review = strictReview(value.review, artifact.evidence);
  if (artifact.id !== artifact.review.review_id) throw new ReviewArtifactStoreError("ARTIFACT_ID_MISMATCH");
  assertEvidenceMatchesAnalysis(artifact);
  return artifact;
}

function envelope(artifact: CompletedReviewArtifact): { schema_version: 1; artifact: CompletedReviewArtifact; sha256: string } {
  return { schema_version: 1, artifact, sha256: createHash("sha256").update(JSON.stringify(artifact)).digest("hex") };
}

function parseEnvelope(data: Buffer): CompletedReviewArtifact {
  let value: unknown;
  try { value = JSON.parse(data.toString("utf8")); } catch { throw new ReviewArtifactStoreError("ARTIFACT_CORRUPT"); }
  if (!isRecord(value)) throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
  exact(value, ["schema_version", "artifact", "sha256"]);
  if (value.schema_version !== 1 || typeof value.sha256 !== "string" || !SHA.test(value.sha256)) throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
  const artifact = validateArtifact(value.artifact);
  if (createHash("sha256").update(JSON.stringify(value.artifact)).digest("hex") !== value.sha256) {
    throw new ReviewArtifactStoreError("ARTIFACT_INTEGRITY_INVALID");
  }
  return artifact;
}

function pause(): Promise<void> { return new Promise((resolve) => setTimeout(resolve, 5)); }

async function publishRename(source: string, target: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try { await rename(source, target); return; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 9 || !["EACCES", "EBUSY", "EPERM"].includes(code ?? "")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5 * (attempt + 1)));
    }
  }
}

export class FileSystemReviewArtifactStore implements ReviewArtifactStore {
  readonly root: string;
  private readonly now: () => Date;
  constructor(root: string, options: { now?: () => Date } = {}) { this.root = path.resolve(root); this.now = options.now ?? (() => new Date()); }
  private directory(): string { return path.join(this.root, "artifacts"); }
  private target(id: string): string { return path.join(this.directory(), `${opaque(id, "ARTIFACT_ID_INVALID")}.json`); }
  private lock(id: string): string { return path.join(this.directory(), `${opaque(id, "ARTIFACT_ID_INVALID")}.lock`); }
  private async withLock<T>(id: string, action: () => Promise<T>): Promise<T> {
    await mkdir(this.directory(), { recursive: true });
    const lock = this.lock(id);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { handle = await open(lock, "wx", 0o600); break; } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new ReviewArtifactStoreError("ARTIFACT_IO_FAILED");
        await pause();
      }
    }
    if (!handle) throw new ReviewArtifactStoreError("ARTIFACT_LOCK_TIMEOUT");
    try { return await action(); } finally { await handle.close().catch(() => undefined); await unlink(lock).catch(() => undefined); }
  }
  private async read(id: string): Promise<CompletedReviewArtifact> {
    try { return parseEnvelope(await readFile(this.target(id))); } catch (error) {
      if (error instanceof ReviewArtifactStoreError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ReviewArtifactStoreError("ARTIFACT_NOT_FOUND");
      throw new ReviewArtifactStoreError("ARTIFACT_IO_FAILED");
    }
  }
  private async publish(artifact: CompletedReviewArtifact): Promise<void> {
    const temporary = path.join(this.directory(), `.${artifact.id}.${randomUUID()}.tmp`);
    try { await writeFile(temporary, `${JSON.stringify(envelope(artifact))}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 }); await publishRename(temporary, this.target(artifact.id)); }
    catch { await rm(temporary, { force: true }).catch(() => undefined); throw new ReviewArtifactStoreError("ARTIFACT_IO_FAILED"); }
  }
  async save(input: SaveCompletedReviewArtifactInput): Promise<CompletedReviewArtifact> {
    if (!isRecord(input) || Object.keys(input).length !== 3 || Object.keys(input).some((key) => !["id", "expires_at", "review"].includes(key))) throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
    const id = opaque(input.id, "ARTIFACT_ID_INVALID");
    const expiresAt = timestamp(input.expires_at);
    if (!isRecord(input.review) || !("analysis" in input.review) || !("review" in input.review) || !("evidence" in input.review)) {
      throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
    }
    const clock = this.now();
    if (!(clock instanceof Date) || !Number.isFinite(clock.getTime())) throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
    const now = clock.toISOString();
    const candidate = validateArtifact({ schema_version: 1, id, created_at: now, expires_at: expiresAt, analysis: input.review.analysis, review: input.review.review, evidence: input.review.evidence });
    if (Date.parse(candidate.expires_at) <= Date.parse(candidate.created_at)) throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
    return this.withLock(id, async () => {
      try { await readFile(this.target(id)); throw new ReviewArtifactStoreError("ARTIFACT_EXISTS"); }
      catch (error) { if (error instanceof ReviewArtifactStoreError) throw error; if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new ReviewArtifactStoreError("ARTIFACT_IO_FAILED"); }
      await this.publish(candidate);
      return candidate;
    });
  }
  async get(id: string): Promise<LoadedCompletedReviewArtifact> {
    opaque(id, "ARTIFACT_ID_INVALID");
    const artifact = await this.read(id);
    const review = { analysis: artifact.analysis, review: artifact.review, evidence: artifact.evidence, evidenceIndex: buildLexicalEvidenceIndex(documentsFor(artifact)) };
    return { artifact, review };
  }
  async delete(id: string): Promise<void> {
    opaque(id, "ARTIFACT_ID_INVALID");
    await this.withLock(id, async () => { await unlink(this.target(id)).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw new ReviewArtifactStoreError("ARTIFACT_IO_FAILED"); }); });
  }
  async listExpired(asOf: Date): Promise<ReviewArtifactMetadata[]> {
    if (!(asOf instanceof Date) || !Number.isFinite(asOf.getTime())) throw new ReviewArtifactStoreError("ARTIFACT_SCHEMA_INVALID");
    await mkdir(this.directory(), { recursive: true });
    let names: string[];
    try { names = (await readdir(this.directory(), { withFileTypes: true })).filter((entry) => entry.isFile() && /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.json$/u.test(entry.name)).map((entry) => entry.name.slice(0, -5)).sort(); }
    catch { throw new ReviewArtifactStoreError("ARTIFACT_IO_FAILED"); }
    const result: ReviewArtifactMetadata[] = [];
    for (const id of names) { const artifact = await this.read(id); if (Date.parse(artifact.expires_at) <= asOf.getTime()) result.push({ id: artifact.id, expires_at: artifact.expires_at }); }
    return result;
  }
}
