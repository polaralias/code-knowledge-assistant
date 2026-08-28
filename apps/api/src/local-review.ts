import { createHash } from "node:crypto";
import path from "node:path";

import { createDeterministicAnswerer, type AnswerCitation, type GroundedAnswer } from "@code-knowledge-assistant/answering";
import type { LocalRepositoryReview } from "@code-knowledge-assistant/review-pipeline";

import { ReviewApiError, type ReviewApiDependencies } from "./index.ts";

export type LocalReviewViewMetadata = {
  name: string;
  owner?: string;
  branch?: string;
  displayRevision?: string;
};

export type ReviewQuestionAnswerer = Pick<{ answer(question: string): GroundedAnswer }, "answer">;

function languageForPath(repositoryPath: string): string {
  const extension = path.posix.extname(repositoryPath).toLowerCase();
  if (extension === ".py") return "Python";
  if ([".ts", ".tsx", ".mts", ".cts"].includes(extension)) return "TypeScript";
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(extension)) return "JavaScript";
  if ([".md", ".mdx"].includes(extension)) return "Markdown";
  return extension.slice(1).toUpperCase() || "Text";
}

function evidenceIdForCitation(citation: AnswerCitation, review: LocalRepositoryReview): string | null {
  if (citation.evidence_id.startsWith("primary:")) return citation.evidence_id.slice("primary:".length);
  if (!citation.evidence_id.startsWith("derived:")) return null;
  const derivedId = citation.evidence_id.slice("derived:".length);
  for (const concept of review.review.concepts) {
    for (const claim of concept.claims) {
      if (`${concept.id}:${claim.id}` === derivedId) return claim.evidence_ids[0] ?? null;
    }
  }
  return null;
}

function mapCitation(citation: AnswerCitation, review: LocalRepositoryReview) {
  const evidenceId = evidenceIdForCitation(citation, review);
  const evidence = review.evidence.find((item) => item.id === evidenceId);
  if (!evidence) throw new ReviewApiError("ANSWER_CITATION_INVALID", 500);
  return {
    path: citation.repository_path,
    language: languageForPath(citation.repository_path),
    lineStart: citation.line_start,
    lineEnd: citation.line_end,
    excerpt: evidence.excerpt,
    reason: "Repository evidence used by the answer.",
  };
}

function createReviewFixture(review: LocalRepositoryReview, metadata: LocalReviewViewMetadata) {
  const capabilities = review.analysis.capabilities;
  const supported = capabilities.filter((item) => item.tier !== "fallback").map((item) => languageForPath(`x.${item.language === "python" ? "py" : item.language === "typescript" ? "ts" : "js"}`));
  const partial = capabilities.filter((item) => item.tier === "fallback").map(() => "Other text");
  const totalFiles = review.review.coverage.eligible_files + review.review.coverage.excluded_files;
  const indexedLines = review.analysis.files.reduce((sum, file) => sum + file.range.end_line, 0);
  const languageCounts = new Map<string, number>();
  for (const file of review.analysis.files) {
    const language = languageForPath(file.path);
    languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1);
  }
  const languages = [...languageCounts.entries()].map(([name, files]) => ({
    name,
    files,
    percentage: review.analysis.files.length === 0 ? 0 : Math.round((files / review.analysis.files.length) * 100),
  }));

  return {
    reviewId: review.review.review_id,
    state: "ready",
    repository: {
      name: metadata.name,
      owner: metadata.owner ?? "local",
      branch: metadata.branch ?? "snapshot",
      commit: metadata.displayRevision ?? review.review.source_revision.slice(0, 12),
      capturedAt: review.review.generated_at,
      size: `${review.review.coverage.eligible_files} eligible files`,
    },
    status: { label: "Review ready", detail: "Generated from verified repository evidence", tone: "good" },
    capability: {
      label: `${review.review.capability.tiers.join(" + ")} analysis`,
      detail: "Capability and coverage are disclosed from the completed extraction pass.",
      supported: [...new Set(supported)],
      partial: [...new Set(partial)],
      excluded: review.analysis.exclusions.slice(0, 8).map((item) => `${item.path}: ${item.reason}`),
    },
    coverage: {
      indexedFiles: review.analysis.files.length,
      totalFiles,
      indexedLines,
      totalLines: indexedLines,
      languages,
    },
    documents: review.review.concepts.map((concept) => ({
      id: concept.id,
      title: concept.title,
      summary: concept.summary,
      sections: [{
        heading: concept.kind,
        body: concept.summary,
        bullets: concept.claims.map((claim) => claim.text),
      }],
    })),
    uncertainty: review.review.concepts
      .filter((concept) => concept.kind === "uncertainty")
      .flatMap((concept) => concept.claims.map((claim) => ({
        title: concept.title,
        detail: claim.text,
        severity: claim.confidence === "low" ? "high" : claim.confidence === "medium" ? "medium" : "low",
      }))),
    prompts: [
      { id: "components", label: "Find components", question: "Which components are present?" },
      { id: "startup", label: "Trace startup", question: "Where does startup happen?" },
      { id: "uncertainty", label: "Check uncertainty", question: "What is not established by the evidence?" },
    ],
    chatExamples: [],
    limits: { remainingQuestions: 20, resetAt: "for this local process" },
  };
}

export function createLocalReviewApiDependencies(
  review: LocalRepositoryReview,
  metadata: LocalReviewViewMetadata,
  questionAnswerer?: ReviewQuestionAnswerer,
): ReviewApiDependencies {
  const fixture = createReviewFixture(review, metadata);
  const answerer = questionAnswerer ?? createDeterministicAnswerer(review.evidenceIndex);
  return {
    async loadReview() { return fixture; },
    async answerQuestion(question, reviewId) {
      if (reviewId !== review.review.review_id) throw new ReviewApiError("REVIEW_NOT_FOUND", 404);
      const result = answerer.answer(question);
      return {
        id: `answer-${createHash("sha256").update(question).digest("hex").slice(0, 12)}`,
        question,
        answer: result.status === "answered" ? result.answer : result.qualification,
        confidence: result.status === "answered" ? (result.qualification ? "medium" : "high") : "low",
        citations: result.status === "answered" ? result.citations.map((citation) => mapCitation(citation, review)) : [],
      };
    },
  };
}
