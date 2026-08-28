import path from "node:path";

export type CapabilityTier = "enhanced" | "structured" | "fallback";
export type EvidenceKind = "source" | "documentation" | "configuration" | "test";
export type ReviewConceptKind = "overview" | "component" | "flow" | "integration" | "coverage" | "uncertainty";

export type ReviewEvidence = {
  id: string;
  path: string;
  start_line: number;
  end_line: number;
  sha256: string;
  capability_tier: CapabilityTier;
  evidence_kind: EvidenceKind;
  symbol: string | null;
  excerpt: string;
};

export type ReviewClaim = {
  id: string;
  text: string;
  evidence_ids: string[];
  confidence: "high" | "medium" | "low";
};

export type ReviewConcept = {
  id: string;
  kind: ReviewConceptKind;
  title: string;
  summary: string;
  claims: ReviewClaim[];
};

export type ReviewBundle = {
  schema_version: 1;
  review_id: string;
  source_revision: string;
  generated_at: string;
  authority: "derived";
  verification: "verified-limited";
  generation: {
    generator: string;
    model: string | null;
    prompt_version: string;
  };
  capability: {
    tiers: CapabilityTier[];
  };
  coverage: {
    eligible_files: number;
    analyzed_files: number;
    excluded_files: number;
  };
  concepts: ReviewConcept[];
};

export type BuildDeterministicReviewBundleInput = {
  review_id: string;
  source_revision: string;
  generated_at: string;
  evidence: ReviewEvidence[];
  coverage: ReviewBundle["coverage"];
};

export class ReviewValidationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "ReviewValidationError";
    this.code = code;
  }
}

const REQUIRED_KINDS: ReviewConceptKind[] = [
  "overview",
  "component",
  "flow",
  "integration",
  "coverage",
  "uncertainty",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isSafeRelativePath(value: string): boolean {
  if (!value || value.includes("\\") || value.includes("\0") || path.posix.isAbsolute(value)) return false;
  return !value.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
}

function compareCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateEvidence(evidence: ReviewEvidence[]): Map<string, ReviewEvidence> {
  const byId = new Map<string, ReviewEvidence>();
  for (const item of evidence) {
    if (!item.id || byId.has(item.id)) throw new ReviewValidationError("EVIDENCE_ID_DUPLICATE");
    if (!isSafeRelativePath(item.path)) throw new ReviewValidationError("EVIDENCE_PATH_INVALID");
    if (!Number.isSafeInteger(item.start_line) || !Number.isSafeInteger(item.end_line)
      || item.start_line < 1 || item.end_line < item.start_line) {
      throw new ReviewValidationError("EVIDENCE_RANGE_INVALID");
    }
    if (!/^[a-f0-9]{64}$/u.test(item.sha256)) throw new ReviewValidationError("EVIDENCE_DIGEST_INVALID");
    if (!(["enhanced", "structured", "fallback"] as string[]).includes(item.capability_tier)
      || !(["source", "documentation", "configuration", "test"] as string[]).includes(item.evidence_kind)) {
      throw new ReviewValidationError("EVIDENCE_CLASSIFICATION_INVALID");
    }
    if (typeof item.excerpt !== "string" || item.excerpt.length === 0 || item.excerpt.length > 16_384) {
      throw new ReviewValidationError("EVIDENCE_EXCERPT_INVALID");
    }
    byId.set(item.id, item);
  }
  if (byId.size === 0) throw new ReviewValidationError("EVIDENCE_EMPTY");
  return byId;
}

function claim(id: string, text: string, evidenceIds: string[], confidence: ReviewClaim["confidence"]): ReviewClaim {
  return { id, text, evidence_ids: [...evidenceIds].sort(compareCodePoint), confidence };
}

export function buildDeterministicReviewBundle(input: BuildDeterministicReviewBundleInput): ReviewBundle {
  const evidenceById = validateEvidence(input.evidence);
  const ordered = [...evidenceById.values()].sort((left, right) =>
    compareCodePoint(left.path, right.path) || left.start_line - right.start_line || compareCodePoint(left.id, right.id));
  const allIds = ordered.map((item) => item.id);
  const symbolEvidence = ordered.find((item) => item.symbol !== null) ?? ordered[0]!;
  const integrationEvidence = ordered.find((item) => item.evidence_kind === "configuration") ?? ordered[0]!;
  const tierSet = [...new Set(ordered.map((item) => item.capability_tier))].sort(compareCodePoint) as CapabilityTier[];

  const concepts: ReviewConcept[] = [
    {
      id: "overview",
      kind: "overview",
      title: "Repository overview",
      summary: `Deterministic review of ${input.coverage.analyzed_files} analyzed files.`,
      claims: [claim("overview-evidence", `The review is grounded in ${ordered.length} bounded evidence records.`, allIds, "high")],
    },
    {
      id: "component-primary",
      kind: "component",
      title: symbolEvidence.symbol ?? symbolEvidence.path,
      summary: `A source landmark identified in ${symbolEvidence.path}.`,
      claims: [claim("component-location", `The landmark is declared in ${symbolEvidence.path}.`, [symbolEvidence.id], "high")],
    },
    {
      id: "flow-evidence-path",
      kind: "flow",
      title: "Evidence path",
      summary: "A conservative cross-file orientation derived from inspected source evidence.",
      claims: [claim("flow-scope", `The inspected evidence spans ${ordered.length} source locations; runtime order is not claimed.`, allIds, "medium")],
    },
    {
      id: "integration-configuration",
      kind: "integration",
      title: "Configuration and integration surface",
      summary: `An inspectable integration landmark from ${integrationEvidence.path}.`,
      claims: [claim("integration-landmark", `Configuration or source evidence is present in ${integrationEvidence.path}.`, [integrationEvidence.id], "medium")],
    },
    {
      id: "coverage",
      kind: "coverage",
      title: "Review coverage",
      summary: `${input.coverage.analyzed_files} of ${input.coverage.eligible_files} eligible files were analyzed; ${input.coverage.excluded_files} files were excluded.`,
      claims: [claim("coverage-evidence", "Coverage is derived from the supplied inventory-backed evidence set.", allIds, "high")],
    },
    {
      id: "uncertainty",
      kind: "uncertainty",
      title: "Uncertainty and limitations",
      summary: "This static review does not establish runtime execution order or dynamic behaviour.",
      claims: [claim("uncertainty-static", "Claims are limited to the supplied static evidence and capability tiers.", allIds, "high")],
    },
  ];

  const bundle: ReviewBundle = {
    schema_version: 1,
    review_id: input.review_id,
    source_revision: input.source_revision,
    generated_at: input.generated_at,
    authority: "derived",
    verification: "verified-limited",
    generation: { generator: "deterministic-baseline", model: null, prompt_version: "deterministic-v1" },
    capability: { tiers: tierSet },
    coverage: { ...input.coverage },
    concepts,
  };
  return validateReviewBundle(bundle, ordered);
}

export function validateReviewBundle(value: unknown, evidence: ReviewEvidence[]): ReviewBundle {
  const evidenceById = validateEvidence(evidence);
  if (!isRecord(value) || value.schema_version !== 1 || value.authority !== "derived"
    || value.verification !== "verified-limited" || typeof value.review_id !== "string"
    || !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(value.review_id)
    || typeof value.source_revision !== "string" || value.source_revision.length === 0
    || typeof value.generated_at !== "string" || !Number.isFinite(Date.parse(value.generated_at))) {
    throw new ReviewValidationError("REVIEW_BUNDLE_INVALID");
  }
  if (!isRecord(value.generation) || typeof value.generation.generator !== "string"
    || !(typeof value.generation.model === "string" || value.generation.model === null)
    || typeof value.generation.prompt_version !== "string") {
    throw new ReviewValidationError("GENERATION_METADATA_INVALID");
  }
  if (!isRecord(value.capability) || !Array.isArray(value.capability.tiers)
    || value.capability.tiers.some((tier) => !(["enhanced", "structured", "fallback"] as unknown[]).includes(tier))) {
    throw new ReviewValidationError("CAPABILITY_DISCLOSURE_INVALID");
  }
  if (!isRecord(value.coverage)
    || ![value.coverage.eligible_files, value.coverage.analyzed_files, value.coverage.excluded_files]
      .every((count) => typeof count === "number" && Number.isSafeInteger(count) && count >= 0)
    || (value.coverage.analyzed_files as number) > (value.coverage.eligible_files as number)) {
    throw new ReviewValidationError("COVERAGE_INVALID");
  }
  if (!Array.isArray(value.concepts)) throw new ReviewValidationError("CONCEPTS_INVALID");

  const conceptIds = new Set<string>();
  const foundKinds = new Set<ReviewConceptKind>();
  for (const candidate of value.concepts) {
    if (isRecord(candidate) && !hasOnlyKeys(candidate, ["id", "kind", "title", "summary", "claims"])) {
      throw new ReviewValidationError("CONCEPT_UNKNOWN_FIELD");
    }
    if (!isRecord(candidate) || typeof candidate.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(candidate.id)
      || typeof candidate.kind !== "string" || !REQUIRED_KINDS.includes(candidate.kind as ReviewConceptKind)
      || typeof candidate.title !== "string" || candidate.title.length === 0
      || typeof candidate.summary !== "string" || candidate.summary.length === 0
      || !Array.isArray(candidate.claims) || candidate.claims.length === 0) {
      throw new ReviewValidationError("CONCEPT_INVALID");
    }
    if (conceptIds.has(candidate.id)) throw new ReviewValidationError("CONCEPT_ID_DUPLICATE");
    conceptIds.add(candidate.id);
    foundKinds.add(candidate.kind as ReviewConceptKind);
    const claimIds = new Set<string>();
    for (const candidateClaim of candidate.claims) {
      if (!isRecord(candidateClaim) || typeof candidateClaim.id !== "string" || candidateClaim.id.length === 0
        || typeof candidateClaim.text !== "string" || candidateClaim.text.length === 0
        || !Array.isArray(candidateClaim.evidence_ids) || candidateClaim.evidence_ids.length === 0
        || !(["high", "medium", "low"] as unknown[]).includes(candidateClaim.confidence)) {
        throw new ReviewValidationError("CLAIM_INVALID");
      }
      if (claimIds.has(candidateClaim.id)) throw new ReviewValidationError("CLAIM_ID_DUPLICATE");
      claimIds.add(candidateClaim.id);
      for (const evidenceId of candidateClaim.evidence_ids) {
        if (typeof evidenceId !== "string" || !evidenceById.has(evidenceId)) {
          throw new ReviewValidationError("CLAIM_EVIDENCE_UNKNOWN");
        }
      }
    }
  }
  if (REQUIRED_KINDS.some((kind) => !foundKinds.has(kind))) throw new ReviewValidationError("CONCEPT_KIND_MISSING");
  return value as ReviewBundle;
}
