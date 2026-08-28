export type EvidenceLayer = "primary" | "derived";

export type EvidenceProvenance = {
  repository_path: string;
  line_start: number;
  line_end: number;
};

/** A citation-ready repository record, independent of its producing adapter. */
export type EvidenceDocument = {
  id: string;
  layer: EvidenceLayer;
  content: string;
  provenance: EvidenceProvenance;
};

export type LexicalQueryOptions = {
  resultLimit?: number;
  contextByteLimit?: number;
};

export type LexicalEvidenceResult = EvidenceDocument & { score: number };

export type LexicalQueryResult =
  | { status: "ok"; results: LexicalEvidenceResult[] }
  | { status: "insufficient-evidence"; reason: "empty-question" | "no-search-terms" | "no-matches"; results: [] };

export type LexicalEvidenceIndex = {
  query(question: string, options?: LexicalQueryOptions): LexicalQueryResult;
};

export class LexicalEvidenceValidationError extends Error {
  readonly code: string;
  readonly documentId: string | null;

  constructor(code: string, documentId: string | null = null) {
    super(documentId === null ? code : `${code}: ${documentId}`);
    this.name = "LexicalEvidenceValidationError";
    this.code = code;
    this.documentId = documentId;
  }
}

const DEFAULT_QUERY_OPTIONS: Required<LexicalQueryOptions> = Object.freeze({ resultLimit: 10, contextByteLimit: 12_000 });
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how", "in", "is", "it", "of", "on", "or", "that", "the", "to", "was", "what", "when", "where", "which", "who", "why", "with",
]);
const encoder = new TextEncoder();

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function terms(text: string): string[] {
  return Array.from(text.toLowerCase().matchAll(/[\p{L}\p{N}_]+/gu), (match) => match[0]);
}

function score(content: string, queryTerms: string[]): number {
  const counts = new Map<string, number>();
  for (const term of terms(content)) counts.set(term, (counts.get(term) ?? 0) + 1);
  return queryTerms.reduce((total, term) => total + (counts.get(term) ?? 0), 0);
}

function truncateUtf8(content: string, byteLimit: number): string {
  let usedBytes = 0;
  let result = "";
  for (const character of content) {
    const bytes = encoder.encode(character).byteLength;
    if (usedBytes + bytes > byteLimit) break;
    result += character;
    usedBytes += bytes;
  }
  return result;
}

function copyDocument(document: EvidenceDocument): EvidenceDocument {
  return { id: document.id, layer: document.layer, content: document.content, provenance: { ...document.provenance } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0;
}

function validateDocument(value: unknown): asserts value is EvidenceDocument {
  if (!isRecord(value) || !validNonBlankString(value.id)) throw new LexicalEvidenceValidationError("EVIDENCE_DOCUMENT_INVALID");
  const id = value.id;
  if (value.layer !== "primary" && value.layer !== "derived") throw new LexicalEvidenceValidationError("EVIDENCE_LAYER_INVALID", id);
  if (typeof value.content !== "string" || value.content.trim().length === 0) {
    throw new LexicalEvidenceValidationError("EVIDENCE_CONTENT_INVALID", id);
  }
  if (!isRecord(value.provenance) || !validNonBlankString(value.provenance.repository_path)) {
    throw new LexicalEvidenceValidationError("EVIDENCE_PROVENANCE_INVALID", id);
  }
  const { line_start: lineStart, line_end: lineEnd } = value.provenance;
  if (
    typeof lineStart !== "number" || !Number.isSafeInteger(lineStart) || lineStart < 1 ||
    typeof lineEnd !== "number" || !Number.isSafeInteger(lineEnd) || lineEnd < lineStart
  ) {
    throw new LexicalEvidenceValidationError("EVIDENCE_PROVENANCE_INVALID", id);
  }
}

function resolveQueryOptions(overrides: LexicalQueryOptions | undefined): Required<LexicalQueryOptions> {
  const options = { ...DEFAULT_QUERY_OPTIONS, ...overrides };
  for (const [name, value] of Object.entries(options)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new LexicalEvidenceValidationError("QUERY_LIMIT_INVALID", name);
  }
  return options;
}

export function buildLexicalEvidenceIndex(documents: readonly EvidenceDocument[]): LexicalEvidenceIndex {
  if (!Array.isArray(documents)) throw new LexicalEvidenceValidationError("EVIDENCE_DOCUMENTS_INVALID");
  const identifiers = new Set<string>();
  const storedDocuments = documents.map((document) => {
    validateDocument(document);
    if (identifiers.has(document.id)) throw new LexicalEvidenceValidationError("EVIDENCE_ID_DUPLICATE", document.id);
    identifiers.add(document.id);
    return Object.freeze(copyDocument(document));
  });

  return Object.freeze({
    query(question: string, overrides: LexicalQueryOptions = {}): LexicalQueryResult {
      if (typeof question !== "string") throw new LexicalEvidenceValidationError("QUERY_INVALID");
      const options = resolveQueryOptions(overrides);
      if (question.trim() === "") return { status: "insufficient-evidence", reason: "empty-question", results: [] };
      const queryTerms = [...new Set(terms(question).filter((term) => !STOP_WORDS.has(term)))];
      if (queryTerms.length === 0) return { status: "insufficient-evidence", reason: "no-search-terms", results: [] };
      const ranked = storedDocuments
        .map((document) => ({ document, score: score(document.content, queryTerms) }))
        .filter((result) => result.score > 0)
        .sort((left, right) => right.score - left.score || compareText(left.document.id, right.document.id));
      if (ranked.length === 0) return { status: "insufficient-evidence", reason: "no-matches", results: [] };

      let remainingBytes = options.contextByteLimit;
      const results: LexicalEvidenceResult[] = [];
      for (const rankedResult of ranked.slice(0, options.resultLimit)) {
        const content = truncateUtf8(rankedResult.document.content, remainingBytes);
        if (content.length === 0) break;
        remainingBytes -= encoder.encode(content).byteLength;
        results.push({ ...copyDocument(rankedResult.document), content, score: rankedResult.score });
      }
      return { status: "ok", results };
    },
  });
}
