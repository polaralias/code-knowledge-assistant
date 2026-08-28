/**
 * The browser consumes this object as the contract for the future review API.
 * Keep this shape stable when replacing `DEMO_REVIEW` with a fetch adapter.
 *
 * @typedef {'ready'|'loading'|'empty'|'failure'|'network-error'|'invalid-response'|'expired'|'abuse-limit'} ReviewState
 * @typedef {{ path: string, language: string, lineStart: number, lineEnd: number, excerpt: string, reason: string }} Evidence
 * @typedef {{ id: string, title: string, summary: string, sections: Array<{ heading: string, body: string, bullets?: string[] }> }} ReviewDocument
 * @typedef {{ id: string, label: string, question: string }} Prompt
 * @typedef {{ id: string, question: string, answer: string, confidence: 'high'|'medium'|'low', citations: Evidence[] }} ChatExample
 * @typedef {{ reviewId: string, state: ReviewState, repository: { name: string, owner: string, branch: string, commit: string, capturedAt: string, size: string }, status: { label: string, detail: string, tone: 'good'|'warn'|'bad' }, capability: { label: string, detail: string, supported: string[], partial: string[], excluded: string[] }, coverage: { indexedFiles: number, totalFiles: number, indexedLines: number, totalLines: number, languages: Array<{ name: string, files: number, percentage: number }> }, documents: ReviewDocument[], uncertainty: Array<{ title: string, detail: string, severity: 'low'|'medium'|'high' }>, prompts: Prompt[], chatExamples: ChatExample[], limits: { remainingQuestions: number, resetAt: string } }} ReviewFixture

/** @type {ReviewFixture} */
export const DEMO_REVIEW = {
  reviewId: 'rev_7f3c2a',
  state: 'ready',
  repository: {
    name: 'northstar-console',
    owner: 'horizon-labs',
    branch: 'main',
    commit: 'a84c1f2',
    capturedAt: '26 Aug 2026, 09:42 UTC',
    size: '18.4 MB',
  },
  status: { label: 'Review ready', detail: 'Indexed from a retained snapshot', tone: 'good' },
  capability: {
    label: 'Strong Python and TypeScript coverage',
    detail: 'The review is useful for the primary application paths, with explicit gaps called out below.',
    supported: ['Python', 'TypeScript', 'TSX', 'SQL'],
    partial: ['YAML configuration', 'Generated client code'],
    excluded: ['Binary assets', 'node_modules', 'Git history', 'Secrets and environment files'],
  },
  coverage: {
    indexedFiles: 214,
    totalFiles: 238,
    indexedLines: 42780,
    totalLines: 46320,
    languages: [
      { name: 'TypeScript', files: 106, percentage: 49 },
      { name: 'Python', files: 74, percentage: 35 },
      { name: 'SQL', files: 22, percentage: 10 },
      { name: 'Other', files: 12, percentage: 6 },
    ],
  },
  documents: [
    {
      id: 'architecture',
      title: 'Architecture overview',
      summary: 'How the web console, worker boundary, and persistence layer fit together.',
      sections: [
        { heading: 'A request has two paths', body: 'The console owns request shaping and optimistic status. The worker owns provider calls, retry policy, and durable result writes.', bullets: ['Web app: apps/console', 'Worker: services/review-worker', 'Persistence: packages/review-store'] },
        { heading: 'The boundary to protect', body: 'Review jobs cross the boundary as a small command and return a versioned result. This keeps the UI independent of provider-specific response formats.' },
      ],
    },
    {
      id: 'getting-started',
      title: 'Getting started',
      summary: 'Run the console locally and load the pre-indexed Northstar fixture.',
      sections: [
        { heading: 'Start the workspace', body: 'Install the workspace dependencies, then run the console and worker in separate terminals.', bullets: ['pnpm install', 'pnpm dev --filter console', 'pnpm dev --filter review-worker'] },
        { heading: 'Use the fixture', body: 'The pre-indexed snapshot is safe to inspect without credentials. It is intentionally representative, not a production export.' },
      ],
    },
    {
      id: 'data-model',
      title: 'Data model',
      summary: 'The entities behind a review, its evidence, and follow-up questions.',
      sections: [
        { heading: 'Review is a retained snapshot', body: 'A review references a source snapshot and immutable evidence spans. A follow-up answer must cite those spans or clearly say it cannot answer.' },
        { heading: 'Uncertainty is first-class', body: 'Coverage and extraction notes travel with the review so a reader can judge what the output does not know.' },
      ],
    },
    {
      id: 'operations',
      title: 'Operations notes',
      summary: 'Expiry, deletion, and provider limits that affect this review.',
      sections: [
        { heading: 'Snapshot lifecycle', body: 'Source snapshots expire after the configured retention window. Expiry blocks new questions while keeping the review record available for audit.' },
        { heading: 'Question limits', body: 'Questions are rate-limited per review. The remaining allowance is shown beside the chat composer.' },
      ],
    },
  ],
  uncertainty: [
    { title: 'Generated clients are partial', detail: 'Calls through generated API clients are represented as dependencies, but their generated internals were excluded.', severity: 'medium' },
    { title: 'Runtime wiring is inferred', detail: 'The worker entrypoint is clear, but deployment-specific queue bindings were not present in the snapshot.', severity: 'low' },
    { title: 'History is unavailable', detail: 'This review describes the captured tree only. It cannot explain why a change was introduced.', severity: 'high' },
  ],
  prompts: [
    { id: 'flow', label: 'Trace a request', question: 'Trace a request from the console to the worker.' },
    { id: 'risk', label: 'Find a risk', question: 'What should I verify before changing the queue consumer?' },
    { id: 'module', label: 'Explain a module', question: 'Explain the persistence boundary in plain language.' },
  ],
  chatExamples: [
    {
      id: 'request-flow',
      question: 'Trace a request from the console to the worker.',
      answer: 'The console creates a review command in `apps/console/src/reviews/create.ts`. The API hands that command to the queue producer, and `services/review-worker/src/consume.ts` validates it before calling the provider adapter. The result is written through the review store before the job is marked complete.',
      confidence: 'high',
      citations: [
        { path: 'apps/console/src/reviews/create.ts', language: 'TypeScript', lineStart: 18, lineEnd: 52, excerpt: 'return reviewApi.create({ repositoryId, snapshotId })', reason: 'Creates the review command.' },
        { path: 'services/review-worker/src/consume.ts', language: 'TypeScript', lineStart: 41, lineEnd: 88, excerpt: 'const command = ReviewCommand.parse(message.body)', reason: 'Validates and dispatches the command.' },
      ],
    },
    {
      id: 'queue-risk',
      question: 'What should I verify before changing the queue consumer?',
      answer: 'Preserve idempotency on the review ID. The consumer can receive a delivery more than once, so writing the result must be safe to repeat. Also keep the validation before provider work so malformed commands are acknowledged without spending a provider request.',
      confidence: 'medium',
      citations: [{ path: 'services/review-worker/src/consume.ts', language: 'TypeScript', lineStart: 24, lineEnd: 40, excerpt: 'if (await store.hasResult(command.reviewId)) return ack(message)', reason: 'Existing duplicate-delivery guard.' }],
    },
  ],
  limits: { remainingQuestions: 7, resetAt: 'in 18 minutes' },
};

/** @param {unknown} value @returns {value is ReviewFixture} */
export function isReviewFixture(value) {
  if (!value || typeof value !== 'object') return false;
  const candidate = /** @type {Partial<ReviewFixture>} */ (value);
  if (typeof candidate.reviewId !== 'string'
    || !['ready', 'loading', 'empty', 'failure', 'network-error', 'invalid-response', 'expired', 'abuse-limit'].includes(candidate.state)
    || !candidate.repository || typeof candidate.repository.name !== 'string'
    || !Array.isArray(candidate.documents)
    || !Array.isArray(candidate.prompts)
    || !Array.isArray(candidate.chatExamples)
    || !candidate.coverage || typeof candidate.coverage.indexedFiles !== 'number') return false;
  if (!candidate.documents.every((document) => typeof document?.id === 'string' && typeof document.title === 'string' && Array.isArray(document.sections))) return false;
  if (!candidate.chatExamples.every((example) => typeof example?.id === 'string' && typeof example.question === 'string' && typeof example.answer === 'string' && ['high', 'medium', 'low'].includes(example.confidence) && Array.isArray(example.citations))) return false;
  return candidate.chatExamples.every((example) => example.citations.every((citation) => typeof citation?.path === 'string' && citation.path.length > 0 && typeof citation.language === 'string' && citation.language.length > 0 && typeof citation.lineStart === 'number' && citation.lineStart > 0 && typeof citation.lineEnd === 'number' && citation.lineEnd >= citation.lineStart && typeof citation.excerpt === 'string' && citation.excerpt.length > 0 && typeof citation.reason === 'string' && citation.reason.length > 0));
}

/** @param {ReviewFixture} fixture @param {ReviewState} state @returns {ReviewFixture} */
export function withReviewState(fixture, state) {
  return { ...fixture, state };
}
