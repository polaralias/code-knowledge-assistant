import type { EvidenceLayer, LexicalEvidenceIndex, LexicalEvidenceResult } from "@code-knowledge-assistant/retrieval";

export type AnswerCitation = {
  evidence_id: string;
  layer: EvidenceLayer;
  repository_path: string;
  line_start: number;
  line_end: number;
};

export type AnsweringOptions = {
  queryByteLimit?: number;
  resultLimit?: number;
  contextByteLimit?: number;
  answerByteLimit?: number;
};

export type GroundedAnswer =
  | {
    status: "answered";
    answer: string;
    citations: AnswerCitation[];
    qualification: string | null;
  }
  | {
    status: "insufficient-evidence";
    reason: "empty-question" | "no-search-terms" | "no-matches" | "query-too-large";
    answer: null;
    citations: [];
    qualification: string;
  };

/** Provider-neutral boundary: callers can supply the deterministic baseline or a later model-backed implementation. */
export type GroundedAnswerer = {
  answer(question: string, options?: AnsweringOptions): GroundedAnswer;
};

export class AnsweringValidationError extends Error {
  readonly code: string;
  readonly field: string | null;

  constructor(code: string, field: string | null = null) {
    super(field === null ? code : `${code}: ${field}`);
    this.name = "AnsweringValidationError";
    this.code = code;
    this.field = field;
  }
}

const DEFAULT_OPTIONS: Required<AnsweringOptions> = Object.freeze({
  queryByteLimit: 1_024,
  resultLimit: 3,
  contextByteLimit: 4_096,
  answerByteLimit: 1_024,
});
const encoder = new TextEncoder();

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

function resolveOptions(overrides: AnsweringOptions | undefined): Required<AnsweringOptions> {
  const options = { ...DEFAULT_OPTIONS, ...overrides };
  for (const [field, value] of Object.entries(options)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new AnsweringValidationError("ANSWERING_LIMIT_INVALID", field);
  }
  return options;
}

function citation(result: LexicalEvidenceResult): AnswerCitation {
  return {
    evidence_id: result.id,
    layer: result.layer,
    repository_path: result.provenance.repository_path,
    line_start: result.provenance.line_start,
    line_end: result.provenance.line_end,
  };
}

function insufficient(reason: Extract<GroundedAnswer, { status: "insufficient-evidence" }> ["reason"]): GroundedAnswer {
  const explanations = {
    "empty-question": "No question was supplied, so no repository evidence can be cited.",
    "no-search-terms": "The question contains no searchable terms, so no repository evidence can be cited.",
    "no-matches": "No matching repository evidence was found for this question.",
    "query-too-large": "The question exceeds the configured query limit and was not searched.",
  } as const;
  return { status: "insufficient-evidence", reason, answer: null, citations: [], qualification: explanations[reason] };
}

export function createDeterministicAnswerer(index: Pick<LexicalEvidenceIndex, "query">, defaults: AnsweringOptions = {}): GroundedAnswerer {
  const resolvedDefaults = resolveOptions(defaults);
  return Object.freeze({
    answer(question: string, overrides: AnsweringOptions = {}): GroundedAnswer {
      if (typeof question !== "string") throw new AnsweringValidationError("QUESTION_INVALID");
      const options = resolveOptions({ ...resolvedDefaults, ...overrides });
      if (encoder.encode(question).byteLength > options.queryByteLimit) return insufficient("query-too-large");

      const retrieval = index.query(question, {
        resultLimit: options.resultLimit,
        contextByteLimit: options.contextByteLimit,
      });
      if (retrieval.status === "insufficient-evidence") return insufficient(retrieval.reason);

      const citations = retrieval.results.map(citation);
      if (retrieval.results.length > 1) {
        return {
          status: "answered",
          answer: truncateUtf8("Multiple repository evidence records match the question; inspect the cited locations.", options.answerByteLimit),
          citations,
          qualification: "The deterministic baseline does not reconcile multiple matching records; they may be incomplete or contradictory.",
        };
      }

      const evidence = retrieval.results[0]!;
      return {
        status: "answered",
        answer: truncateUtf8(`Repository evidence: “${evidence.content}”`, options.answerByteLimit),
        citations,
        qualification: null,
      };
    },
  });
}
