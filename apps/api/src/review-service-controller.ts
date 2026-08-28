import type { ReviewJobController } from "./index.ts";
import { createLocalReviewApiDependencies, type LocalReviewViewMetadata } from "./local-review.ts";
import type { ReviewService } from "@code-knowledge-assistant/review-service";

export function createReviewServiceController(
  service: ReviewService,
  metadata: LocalReviewViewMetadata = { name: "uploaded-repository" },
): ReviewJobController {
  return Object.freeze({
    async createReview(upload) { return service.createReview(upload); },

    async createGitReview(input) { return service.createGitReview({ url: input.repositoryUrl, ...(input.ref === undefined ? {} : { ref: input.ref }) }); },

    async getJob(jobId) { return service.getJobSnapshot(jobId); },

    async getReview(reviewId) {
      const job = await service.getReviewJob(reviewId);
      if (!job) return null;
      if (job.state !== "ready") return { state: job.state };
      const review = await service.getReview(reviewId);
      if (!review) return { state: "failed" };
      const sourceMetadata = await service.getReviewMetadata(reviewId);
      const browser = createLocalReviewApiDependencies(review, sourceMetadata ?? metadata);
      return { state: "ready", review: await browser.loadReview() };
    },

    async answerQuestion(reviewId, question) {
      const job = await service.getReviewJob(reviewId);
      if (!job) return null;
      if (job.state !== "ready") return { state: job.state };
      const review = await service.getReview(reviewId);
      if (!review) return { state: "failed" };
      const browser = createLocalReviewApiDependencies(review, metadata, {
        answer: (providerQuestion) => service.answerQuestion(reviewId, providerQuestion),
      });
      return { state: "answered", answer: await browser.answerQuestion(question, reviewId) };
    },

    async deleteReview(reviewId) {
      const job = await service.getReviewJob(reviewId);
      if (!job) return null;
      if (job.state === "expired") return { state: "expired" };
      if (job.state === "failed") return { state: "failed" };
      await service.deleteReview(reviewId);
      return { state: "deleted" };
    },
  });
}
