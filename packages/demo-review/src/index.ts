import { createHash } from "node:crypto";
import { readFile as fsReadFile, stat as fsStat } from "node:fs/promises";
import path from "node:path";

import { createDeterministicAnswerer, type GroundedAnswer } from "@code-knowledge-assistant/answering";
import { buildLexicalEvidenceIndex, type EvidenceDocument, type LexicalEvidenceIndex } from "@code-knowledge-assistant/retrieval";
import { validateReviewBundle, type ReviewBundle, type ReviewEvidence } from "@code-knowledge-assistant/review-generation";

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
const MAX_ALLOWED_BYTES = 100 * 1024 * 1024;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const SHA = /^[a-f0-9]{64}$/u;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAX_STRING_BYTES = 64 * 1024;

export type DemoReviewErrorCode =
  | "DEMO_CONFIG_INVALID"
  | "DEMO_ARTIFACT_IO_FAILED"
  | "DEMO_ARTIFACT_TOO_LARGE"
  | "DEMO_ARTIFACT_CORRUPT"
  | "DEMO_ARTIFACT_SCHEMA_INVALID"
  | "DEMO_ARTIFACT_INTEGRITY_INVALID"
  | "DEMO_ARTIFACT_UNSAFE"
  | "DEMO_ARTIFACT_EXPIRED"
  | "DEMO_QUESTION_INVALID";

export class DemoReviewError extends Error {
  readonly code: DemoReviewErrorCode;

  constructor(code: DemoReviewErrorCode) {
    super(code);
    this.name = "DemoReviewError";
    this.code = code;
  }
}

export type DemoReviewLoaderOptions = {
  artifactPath?: string;
  path?: string;
  maxBytes?: number;
  maxFileBytes?: number;
  now?: () => Date;
  readFile?: (filePath: string) => Promise<Buffer | string>;
};

export type DemoAnalysis = {
  capabilities: Array<{
    language: "python" | "typescript" | "javascript" | "text";
    tier: "enhanced" | "structured" | "fallback";
    extractor: string;
    eligible_files: number;
    analyzed_files: number;
    failed_files: number;
  }>;
  files: Array<{
    path: string;
    language: "python" | "typescript" | "javascript" | "text";
    tier: "enhanced" | "structured" | "fallback";
    range: { path: string; start_line: number; end_line: number };
    symbols: Array<{ name: string; kind: "class" | "function" | "interface" | "type"; range: { path: string; start_line: number; end_line: number } }>;
    imports: Array<{ specifier: string; range: { path: string; start_line: number; end_line: number } }>;
  }>;
  chunks: Array<{ id: string; range: { path: string; start_line: number; end_line: number }; content: string }>;
  exclusions: Array<{ path: string; reason: string }>;
  failures: Array<{ path: string; code: "FILE_DRIFTED" | "FILE_NOT_TEXT" | "FILE_UNAVAILABLE" | "INVENTORY_ENTRY_INVALID" | "INVENTORY_PATH_INVALID" }>;
};

export type DemoArtifact = {
  schema_version: 1;
  id: string;
  created_at: string;
  expires_at: string;
  analysis: DemoAnalysis;
  review: ReviewBundle;
  evidence: ReviewEvidence[];
};

export type DemoReview = {
  state: "ready";
  artifact: DemoArtifact;
  analysis: DemoAnalysis;
  review: ReviewBundle;
  evidence: ReviewEvidence[];
  evidenceIndex: LexicalEvidenceIndex;
};

export type AnonymousQuestionAdapter = {
  answer(question: string): GroundedAnswer;
  answerQuestion(question: string): GroundedAnswer;
};

export type LoadedDemoReview = {
  state: "ready";
  review: DemoReview;
  questionAdapter: AnonymousQuestionAdapter;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[], code: DemoReviewErrorCode = "DEMO_ARTIFACT_SCHEMA_INVALID"): void {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) throw new DemoReviewError(code);
}

function stringValue(value: unknown, maximum = MAX_STRING_BYTES): string {
  if (typeof value !== "string" || value.length === 0 || new TextEncoder().encode(value).byteLength > maximum) {
    throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
  }
  return value;
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !ISO.test(value)) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
  return value;
}

function safePath(value: unknown): string {
  const candidate = stringValue(value, MAX_STRING_BYTES);
  if (candidate.includes("\\") || candidate.includes("\0") || path.posix.isAbsolute(candidate)
    || candidate.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new DemoReviewError("DEMO_ARTIFACT_UNSAFE");
  }
  return candidate;
}

function opaqueId(value: unknown): string {
  if (typeof value !== "string" || !ID.test(value)) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
  return value;
}

function range(value: unknown): { path: string; start_line: number; end_line: number } {
  if (!isRecord(value)) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
  exact(value, ["path", "start_line", "end_line"]);
  const relativePath = safePath(value.path);
  const start = count(value.start_line);
  const end = count(value.end_line);
  if (start < 1 || end < start) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
  return { path: relativePath, start_line: start, end_line: end };
}

function parseAnalysis(value: unknown): DemoAnalysis {
  if (!isRecord(value)) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
  exact(value, ["capabilities", "files", "chunks", "exclusions", "failures"]);
  if (!Array.isArray(value.capabilities) || !Array.isArray(value.files) || !Array.isArray(value.chunks)
    || !Array.isArray(value.exclusions) || !Array.isArray(value.failures)) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");

  const capabilities = value.capabilities.map((candidate) => {
    if (!isRecord(candidate)) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
    exact(candidate, ["language", "tier", "extractor", "eligible_files", "analyzed_files", "failed_files"]);
    if (!["python", "typescript", "javascript", "text"].includes(candidate.language as string)
      || !["enhanced", "structured", "fallback"].includes(candidate.tier as string)) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
    return {
      language: candidate.language as DemoAnalysis["capabilities"][number]["language"],
      tier: candidate.tier as DemoAnalysis["capabilities"][number]["tier"],
      extractor: stringValue(candidate.extractor),
      eligible_files: count(candidate.eligible_files),
      analyzed_files: count(candidate.analyzed_files),
      failed_files: count(candidate.failed_files),
    };
  });

  const filesSeen = new Set<string>();
  const files = value.files.map((candidate) => {
    if (!isRecord(candidate)) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
    exact(candidate, ["path", "language", "tier", "range", "symbols", "imports"]);
    const filePath = safePath(candidate.path);
    if (filesSeen.has(filePath)) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
    filesSeen.add(filePath);
    if (!["python", "typescript", "javascript", "text"].includes(candidate.language as string)
      || !["enhanced", "structured", "fallback"].includes(candidate.tier as string)
      || !Array.isArray(candidate.symbols) || !Array.isArray(candidate.imports)) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
    const fileRange = range(candidate.range);
    if (fileRange.path !== filePath) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
    const symbols = candidate.symbols.map((symbol) => {
      if (!isRecord(symbol)) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
      exact(symbol, ["name", "kind", "range"]);
      if (!["class", "function", "interface", "type"].includes(symbol.kind as string)) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
      const symbolRange = range(symbol.range);
      if (symbolRange.path !== filePath) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
      return { name: stringValue(symbol.name), kind: symbol.kind as "class" | "function" | "interface" | "type", range: symbolRange };
    });
    const imports = candidate.imports.map((entry) => {
      if (!isRecord(entry)) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
      exact(entry, ["specifier", "range"]);
      const importRange = range(entry.range);
      if (importRange.path !== filePath) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
      return { specifier: stringValue(entry.specifier), range: importRange };
    });
    return {
      path: filePath,
      language: candidate.language as DemoAnalysis["files"][number]["language"],
      tier: candidate.tier as DemoAnalysis["files"][number]["tier"],
      range: fileRange,
      symbols,
      imports,
    };
  });

  const chunks = value.chunks.map((candidate) => {
    if (!isRecord(candidate)) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
    exact(candidate, ["id", "range", "content"]);
    return { id: stringValue(candidate.id), range: range(candidate.range), content: stringValue(candidate.content, 16_384) };
  });
  const exclusions = value.exclusions.map((candidate) => {
    if (!isRecord(candidate)) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
    exact(candidate, ["path", "reason"]);
    return { path: safePath(candidate.path), reason: stringValue(candidate.reason) };
  });
  const failures = value.failures.map((candidate) => {
    if (!isRecord(candidate)) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
    exact(candidate, ["path", "code"]);
    const code = stringValue(candidate.code);
    if (!["FILE_DRIFTED", "FILE_NOT_TEXT", "FILE_UNAVAILABLE", "INVENTORY_ENTRY_INVALID", "INVENTORY_PATH_INVALID"].includes(code)) {
      throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
    }
    return { path: safePath(candidate.path), code: code as DemoAnalysis["failures"][number]["code"] };
  });
  return { capabilities, files, chunks, exclusions, failures };
}

function parseEvidence(value: unknown): ReviewEvidence[] {
  if (!Array.isArray(value) || value.length === 0) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
  const ids = new Set<string>();
  return value.map((candidate) => {
    if (!isRecord(candidate)) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
    exact(candidate, ["id", "path", "start_line", "end_line", "sha256", "capability_tier", "evidence_kind", "symbol", "excerpt"]);
    const id = stringValue(candidate.id);
    if (ids.has(id)) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
    ids.add(id);
    const start = count(candidate.start_line);
    const end = count(candidate.end_line);
    if (start < 1 || end < start || typeof candidate.sha256 !== "string" || !SHA.test(candidate.sha256)
      || !["enhanced", "structured", "fallback"].includes(candidate.capability_tier as string)
      || !["source", "documentation", "configuration", "test"].includes(candidate.evidence_kind as string)
      || !(typeof candidate.symbol === "string" || candidate.symbol === null)) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
    return {
      id,
      path: safePath(candidate.path),
      start_line: start,
      end_line: end,
      sha256: candidate.sha256,
      capability_tier: candidate.capability_tier as ReviewEvidence["capability_tier"],
      evidence_kind: candidate.evidence_kind as ReviewEvidence["evidence_kind"],
      symbol: candidate.symbol,
      excerpt: stringValue(candidate.excerpt, 16_384),
    };
  });
}

function parseReview(value: unknown, evidence: ReviewEvidence[]): ReviewBundle {
  if (!isRecord(value)) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
  exact(value, ["schema_version", "review_id", "source_revision", "generated_at", "authority", "verification", "generation", "capability", "coverage", "concepts"]);
  if (value.schema_version !== 1 || typeof value.review_id !== "string" || !ID.test(value.review_id)
    || typeof value.source_revision !== "string" || value.source_revision.length === 0 || value.source_revision.length > 512) {
    throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
  }
  timestamp(value.generated_at);
  if (!isRecord(value.generation) || !isRecord(value.capability) || !isRecord(value.coverage) || !Array.isArray(value.concepts)) {
    throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
  }
  const concepts = value.concepts;
  exact(value.generation, ["generator", "model", "prompt_version"]);
  exact(value.capability, ["tiers"]);
  exact(value.coverage, ["eligible_files", "analyzed_files", "excluded_files"]);
  if (!Array.isArray(value.capability.tiers) || value.capability.tiers.some((tier) => !["enhanced", "structured", "fallback"].includes(tier as string))
    || !Number.isSafeInteger(value.coverage.eligible_files) || !Number.isSafeInteger(value.coverage.analyzed_files)
    || !Number.isSafeInteger(value.coverage.excluded_files) || [value.coverage.eligible_files, value.coverage.analyzed_files, value.coverage.excluded_files].some((item) => (item as number) < 0)
    || (value.coverage.analyzed_files as number) > (value.coverage.eligible_files as number)) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
  stringValue(value.generation.generator);
  if (value.generation.model !== null) stringValue(value.generation.model);
  stringValue(value.generation.prompt_version);
  const conceptIds = new Set<string>();
  for (const concept of concepts) {
    if (!isRecord(concept)) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
    exact(concept, ["id", "kind", "title", "summary", "claims"]);
    const conceptId = opaqueId(concept.id);
    if (conceptIds.has(conceptId) || !["overview", "component", "flow", "integration", "coverage", "uncertainty"].includes(concept.kind as string)
      || !Array.isArray(concept.claims) || concept.claims.length === 0) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
    conceptIds.add(conceptId);
    stringValue(concept.title);
    stringValue(concept.summary);
    const claimIds = new Set<string>();
    for (const claim of concept.claims) {
      if (!isRecord(claim)) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
      exact(claim, ["id", "text", "evidence_ids", "confidence"]);
      const claimId = stringValue(claim.id);
      if (claimIds.has(claimId) || !["high", "medium", "low"].includes(claim.confidence as string) || !Array.isArray(claim.evidence_ids) || claim.evidence_ids.length === 0) {
        throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
      }
      claimIds.add(claimId);
      stringValue(claim.text);
      for (const evidenceId of claim.evidence_ids) stringValue(evidenceId);
    }
  }
  if (["overview", "component", "flow", "integration", "coverage", "uncertainty"].some((kind) => !concepts.some((concept) => isRecord(concept) && concept.kind === kind))) {
    throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
  }
  try {
    return validateReviewBundle(value, evidence);
  } catch {
    throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
  }
}

function assertCrossLinks(analysis: DemoAnalysis, review: ReviewBundle, evidence: ReviewEvidence[]): void {
  const chunks = new Map(analysis.chunks.map((chunk) => [chunk.id, chunk] as const));
  const files = new Map(analysis.files.map((file) => [file.path, file] as const));
  if (chunks.size !== evidence.length || analysis.files.length === 0) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
  for (const item of evidence) {
    const chunk = chunks.get(item.id);
    const file = files.get(item.path);
    if (!chunk || !file || chunk.content !== item.excerpt || chunk.range.path !== item.path || chunk.range.start_line !== item.start_line
      || chunk.range.end_line !== item.end_line || file.tier !== item.capability_tier) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
  }
  const analysisTiers = new Set(analysis.capabilities.map((item) => item.tier));
  const reviewTiers = review.capability.tiers;
  if (new Set(reviewTiers).size !== reviewTiers.length || reviewTiers.some((tier) => !analysisTiers.has(tier))) {
    throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
  }
}

function parseArtifact(value: unknown): DemoArtifact {
  if (!isRecord(value)) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
  exact(value, ["schema_version", "id", "created_at", "expires_at", "analysis", "review", "evidence"]);
  if (value.schema_version !== 1) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
  const artifactId = opaqueId(value.id);
  const created = timestamp(value.created_at);
  const expires = timestamp(value.expires_at);
  if (Date.parse(expires) <= Date.parse(created)) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
  const analysis = parseAnalysis(value.analysis);
  const evidence = parseEvidence(value.evidence);
  const review = parseReview(value.review, evidence);
  if (review.review_id !== artifactId) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
  assertCrossLinks(analysis, review, evidence);
  return { schema_version: 1, id: artifactId, created_at: created, expires_at: expires, analysis, review, evidence };
}

function parseEnvelope(data: string): DemoArtifact {
  let value: unknown;
  try { value = JSON.parse(data); } catch { throw new DemoReviewError("DEMO_ARTIFACT_CORRUPT"); }
  if (!isRecord(value)) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
  exact(value, ["schema_version", "artifact", "sha256"]);
  if (value.schema_version !== 1 || typeof value.sha256 !== "string" || !SHA.test(value.sha256)) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
  const artifact = parseArtifact(value.artifact);
  const digest = createHash("sha256").update(JSON.stringify(value.artifact)).digest("hex");
  if (digest !== value.sha256) throw new DemoReviewError("DEMO_ARTIFACT_INTEGRITY_INVALID");
  return artifact;
}

function documentsFor(artifact: DemoArtifact): EvidenceDocument[] {
  const byId = new Map(artifact.evidence.map((item) => [item.id, item] as const));
  const primary = artifact.evidence.map((item) => ({
    id: `primary:${item.id}`,
    layer: "primary" as const,
    content: item.excerpt,
    provenance: { repository_path: item.path, line_start: item.start_line, line_end: item.end_line },
  }));
  const derived = artifact.review.concepts.flatMap((concept) => concept.claims.map((claim) => {
    const source = byId.get(claim.evidence_ids[0]!);
    if (!source) throw new DemoReviewError("DEMO_ARTIFACT_SCHEMA_INVALID");
    return {
      id: `derived:${concept.id}:${claim.id}`,
      layer: "derived" as const,
      content: `${concept.title}\n${concept.summary}\n${claim.text}`,
      provenance: { repository_path: source.path, line_start: source.start_line, line_end: source.end_line },
    };
  }));
  return [...primary, ...derived];
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function loadedReview(artifact: DemoArtifact): LoadedDemoReview {
  const evidenceIndex = buildLexicalEvidenceIndex(documentsFor(artifact));
  const review = deepFreeze({ state: "ready" as const, artifact, analysis: artifact.analysis, review: artifact.review, evidence: artifact.evidence, evidenceIndex });
  const answerer = createDeterministicAnswerer(review.evidenceIndex);
  const answer = (question: string): GroundedAnswer => {
      if (typeof question !== "string") throw new DemoReviewError("DEMO_QUESTION_INVALID");
      try { return answerer.answer(question); } catch { throw new DemoReviewError("DEMO_QUESTION_INVALID"); }
    };
  const questionAdapter = Object.freeze({ answer, answerQuestion: answer });
  return deepFreeze({ state: "ready" as const, review, questionAdapter });
}

export async function loadDemoReview(options: DemoReviewLoaderOptions): Promise<LoadedDemoReview> {
  if (!isRecord(options)) {
    throw new DemoReviewError("DEMO_CONFIG_INVALID");
  }
  const configuredPath = options.artifactPath ?? options.path;
  if (typeof configuredPath !== "string" || configuredPath.length === 0) throw new DemoReviewError("DEMO_CONFIG_INVALID");
  const maxBytes = options.maxBytes ?? options.maxFileBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_ALLOWED_BYTES) throw new DemoReviewError("DEMO_CONFIG_INVALID");
  const clock = options.now ?? (() => new Date());
  if (typeof clock !== "function") throw new DemoReviewError("DEMO_CONFIG_INVALID");
  const filePath = path.resolve(configuredPath);
  const read = options.readFile ?? (async (candidate) => fsReadFile(candidate));
  if (options.readFile === undefined) {
    try {
      const information = await fsStat(filePath);
      if (!information.isFile()) throw new DemoReviewError("DEMO_ARTIFACT_IO_FAILED");
      if (information.size > maxBytes) throw new DemoReviewError("DEMO_ARTIFACT_TOO_LARGE");
    } catch (error) {
      if (error instanceof DemoReviewError) throw error;
      throw new DemoReviewError("DEMO_ARTIFACT_IO_FAILED");
    }
  }
  let raw: Buffer | string;
  try { raw = await read(filePath); } catch { throw new DemoReviewError("DEMO_ARTIFACT_IO_FAILED"); }
  if (!(typeof raw === "string" || Buffer.isBuffer(raw))) throw new DemoReviewError("DEMO_ARTIFACT_IO_FAILED");
  const bytes = Buffer.byteLength(raw);
  if (bytes > maxBytes) throw new DemoReviewError("DEMO_ARTIFACT_TOO_LARGE");
  const artifact = parseEnvelope(typeof raw === "string" ? raw : raw.toString("utf8"));
  let now: Date;
  try { now = clock(); } catch { throw new DemoReviewError("DEMO_CONFIG_INVALID"); }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new DemoReviewError("DEMO_CONFIG_INVALID");
  if (Date.parse(artifact.expires_at) <= now.getTime()) throw new DemoReviewError("DEMO_ARTIFACT_EXPIRED");
  return loadedReview(deepFreeze(artifact));
}

export const loadPreIndexedDemoReview = loadDemoReview;
export const createDemoReviewLoader = loadDemoReview;
