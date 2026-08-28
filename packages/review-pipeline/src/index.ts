import path from "node:path";

import { analyzeRepository, type RepositoryAnalysis } from "@code-knowledge-assistant/analysis";
import type { RepositoryInventory } from "@code-knowledge-assistant/intake";
import {
  buildLexicalEvidenceIndex,
  type EvidenceDocument,
  type LexicalEvidenceIndex,
} from "@code-knowledge-assistant/retrieval";
import {
  buildDeterministicReviewBundle,
  type EvidenceKind,
  type ReviewBundle,
  type ReviewEvidence,
} from "@code-knowledge-assistant/review-generation";

export type BuildLocalRepositoryReviewInput = {
  root: string;
  inventory: RepositoryInventory;
  reviewId: string;
  sourceRevision: string;
  generatedAt: string;
};

export type LocalRepositoryReview = {
  analysis: RepositoryAnalysis;
  review: ReviewBundle;
  evidence: ReviewEvidence[];
  evidenceIndex: LexicalEvidenceIndex;
};

export class ReviewPipelineError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "ReviewPipelineError";
    this.code = code;
  }
}

function evidenceKind(relativePath: string): EvidenceKind {
  const basename = path.posix.basename(relativePath).toLowerCase();
  const extension = path.posix.extname(relativePath).toLowerCase();
  if (/(?:^|[._-])(test|spec)(?:[._-]|$)/u.test(basename)) return "test";
  if ([".md", ".mdx", ".rst", ".txt"].includes(extension)) return "documentation";
  if ([".json", ".yaml", ".yml", ".toml", ".ini"].includes(extension)
    || /(?:^|[._-])config(?:[._-]|$)/u.test(basename)) return "configuration";
  return "source";
}

export async function buildLocalRepositoryReview(
  input: BuildLocalRepositoryReviewInput,
): Promise<LocalRepositoryReview> {
  const analysis = await analyzeRepository({ root: input.root, inventory: input.inventory });
  if (analysis.chunks.length === 0) throw new ReviewPipelineError("REVIEW_EVIDENCE_EMPTY");

  const inventoryByPath = new Map(
    input.inventory.entries
      .filter((entry) => entry.kind === "file" && entry.eligibility === "eligible")
      .map((entry) => [entry.path, entry] as const),
  );
  const symbolByPathAndLine = new Map<string, string>();
  for (const file of analysis.files) {
    for (const symbol of file.symbols) {
      symbolByPathAndLine.set(`${file.path}:${symbol.range.start_line}`, symbol.name);
    }
  }

  const evidence: ReviewEvidence[] = analysis.chunks.map((chunk) => {
    const inventoryEntry = inventoryByPath.get(chunk.range.path);
    const analyzedFile = analysis.files.find((file) => file.path === chunk.range.path);
    if (!inventoryEntry?.sha256 || !analyzedFile) throw new ReviewPipelineError("REVIEW_EVIDENCE_INVALID");
    return {
      id: chunk.id,
      path: chunk.range.path,
      start_line: chunk.range.start_line,
      end_line: chunk.range.end_line,
      sha256: inventoryEntry.sha256,
      capability_tier: analyzedFile.tier,
      evidence_kind: evidenceKind(chunk.range.path),
      symbol: symbolByPathAndLine.get(`${chunk.range.path}:${chunk.range.start_line}`) ?? null,
      excerpt: chunk.content,
    };
  });

  const review = buildDeterministicReviewBundle({
    review_id: input.reviewId,
    source_revision: input.sourceRevision,
    generated_at: input.generatedAt,
    evidence,
    coverage: {
      eligible_files: input.inventory.summary.eligible_files,
      analyzed_files: analysis.files.length,
      excluded_files: input.inventory.summary.excluded_files,
    },
  });
  const evidenceById = new Map(evidence.map((item) => [item.id, item] as const));
  const primaryDocuments: EvidenceDocument[] = evidence.map((item) => ({
    id: `primary:${item.id}`,
    layer: "primary",
    content: item.excerpt,
    provenance: {
      repository_path: item.path,
      line_start: item.start_line,
      line_end: item.end_line,
    },
  }));
  const derivedDocuments: EvidenceDocument[] = review.concepts.flatMap((concept) =>
    concept.claims.map((claim) => {
      const source = evidenceById.get(claim.evidence_ids[0]!);
      if (!source) throw new ReviewPipelineError("REVIEW_CLAIM_EVIDENCE_INVALID");
      return {
        id: `derived:${concept.id}:${claim.id}`,
        layer: "derived" as const,
        content: `${concept.title}\n${concept.summary}\n${claim.text}`,
        provenance: {
          repository_path: source.path,
          line_start: source.start_line,
          line_end: source.end_line,
        },
      };
    }),
  );
  const evidenceIndex = buildLexicalEvidenceIndex([...primaryDocuments, ...derivedDocuments]);
  return { analysis, review, evidence, evidenceIndex };
}
