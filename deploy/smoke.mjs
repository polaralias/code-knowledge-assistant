import process from 'node:process';

const DEFAULT_REPOSITORY_URL = 'https://github.com/louislam/uptime-kuma';
const DEFAULT_REPOSITORY_REF = 'fcc51ebf4666121d18adbf09523b3aefda3576c9';
const DEFAULT_QUESTION = 'Where does the application start?';
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_MAX_WAIT_MS = 10 * 60 * 1_000;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

export class SmokeError extends Error {
  constructor(step, code, status = undefined) {
    super(code);
    this.name = 'SmokeError';
    this.step = step;
    this.code = code;
    this.status = status;
  }
}

function invalid(step, code) {
  throw new SmokeError(step, code);
}

function validPositiveInteger(value, step, code) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(step, code);
  return value;
}

function normaliseOrigin(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 2_000) invalid('config', 'ORIGIN_INVALID');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    invalid('config', 'ORIGIN_INVALID');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash
    || (parsed.pathname !== '/' && parsed.pathname !== '')) {
    invalid('config', 'ORIGIN_INVALID');
  }
  return parsed.origin;
}

function normaliseConfig(config) {
  if (!config || typeof config !== 'object') invalid('config', 'CONFIG_INVALID');
  const origin = normaliseOrigin(config.origin);
  if (typeof config.accessCode !== 'string' || config.accessCode.length < 1 || config.accessCode.length > 256
    || /[\u0000-\u001f\u007f]/u.test(config.accessCode)) invalid('config', 'ACCESS_CODE_INVALID');
  const repositoryUrl = config.repositoryUrl ?? DEFAULT_REPOSITORY_URL;
  let repository;
  try { repository = new URL(repositoryUrl); } catch { invalid('config', 'REPOSITORY_INVALID'); }
  if (repository.protocol !== 'https:' || repository.username || repository.password || repository.search || repository.hash) {
    invalid('config', 'REPOSITORY_INVALID');
  }
  const repositoryRef = config.repositoryRef ?? DEFAULT_REPOSITORY_REF;
  if (repositoryRef !== undefined && (typeof repositoryRef !== 'string' || repositoryRef.length < 1 || repositoryRef.length > 255
    || repositoryRef.trim() !== repositoryRef || /[\u0000-\u0020~^:?*\\[\]]/u.test(repositoryRef))) {
    invalid('config', 'REPOSITORY_REF_INVALID');
  }
  const question = config.question ?? DEFAULT_QUESTION;
  if (typeof question !== 'string' || question.length < 1 || question.length > 2_000 || question.trim() !== question) {
    invalid('config', 'QUESTION_INVALID');
  }
  const pollIntervalMs = validPositiveInteger(config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS, 'config', 'POLL_INTERVAL_INVALID');
  const maxWaitMs = validPositiveInteger(config.maxWaitMs ?? DEFAULT_MAX_WAIT_MS, 'config', 'MAX_WAIT_INVALID');
  if (pollIntervalMs > maxWaitMs) invalid('config', 'POLL_INTERVAL_INVALID');
  return Object.freeze({ origin, accessCode: config.accessCode, repositoryUrl: repository.toString(), repositoryRef, question, pollIntervalMs, maxWaitMs });
}

async function jsonResponse(response, step, expectedStatus) {
  if (!response || response.status !== expectedStatus) throw new SmokeError(step, 'HTTP_STATUS_UNEXPECTED', response?.status);
  try {
    return await response.json();
  } catch {
    throw new SmokeError(step, 'RESPONSE_JSON_INVALID', response.status);
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateHealth(value) {
  if (!isRecord(value) || value.status !== 'ok') invalid('healthz', 'HEALTH_RESPONSE_INVALID');
}

function validateReady(value) {
  if (!isRecord(value) || value.status !== 'ready') invalid('readyz', 'READY_RESPONSE_INVALID');
}

function validateReviewStart(value) {
  if (!isRecord(value) || !IDENTIFIER.test(value.jobId) || !IDENTIFIER.test(value.reviewId)
    || !['queued', 'processing', 'ready'].includes(value.state)) invalid('review-start', 'START_RESPONSE_INVALID');
  return { jobId: value.jobId, reviewId: value.reviewId, state: value.state };
}

function validateJob(value, expectedJobId, expectedReviewId) {
  if (!isRecord(value) || value.jobId !== expectedJobId || value.reviewId !== expectedReviewId
    || !['queued', 'processing', 'ready', 'failed', 'expired', 'deleted'].includes(value.state)) {
    invalid('review-poll', 'JOB_RESPONSE_INVALID');
  }
  return value.state;
}

function validateReview(value, expectedReviewId) {
  if (!isRecord(value) || value.reviewId !== expectedReviewId || value.state !== 'ready' || !('review' in value)) {
    invalid('review-fetch', 'REVIEW_RESPONSE_INVALID');
  }
}

function validateQuestion(value, expectedReviewId) {
  if (!isRecord(value) || value.reviewId !== expectedReviewId || !isRecord(value.answer)
    || !Array.isArray(value.answer.citations)) invalid('question', 'QUESTION_RESPONSE_INVALID');
}

function validateDelete(value, expectedReviewId) {
  if (!isRecord(value) || value.reviewId !== expectedReviewId || value.state !== 'deleted') {
    invalid('delete', 'DELETE_RESPONSE_INVALID');
  }
}

async function request(fetchImpl, url, init, step) {
  try {
    const response = await fetchImpl(url, init);
    if (!response || typeof response.status !== 'number') throw new SmokeError(step, 'RESPONSE_INVALID');
    return response;
  } catch (error) {
    if (error instanceof SmokeError) throw error;
    throw new SmokeError(step, 'NETWORK_FAILED');
  }
}

/**
 * Runs a post-deploy smoke against an HTTPS origin. No response body, URL,
 * access code, source content, or identifier is included in a thrown error.
 * The dependencies are injectable so tests never need a live network or a
 * wall-clock wait.
 */
export async function runSmoke(input) {
  const config = normaliseConfig(input);
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const now = input.now ?? (() => Date.now());
  const sleep = input.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  if (typeof fetchImpl !== 'function' || typeof now !== 'function' || typeof sleep !== 'function') invalid('config', 'DEPENDENCY_INVALID');
  const base = config.origin;

  validateHealth(await jsonResponse(await request(fetchImpl, `${base}/healthz`, { method: 'GET' }, 'healthz'), 'healthz', 200));
  validateReady(await jsonResponse(await request(fetchImpl, `${base}/readyz`, { method: 'GET' }, 'readyz'), 'readyz', 200));

  const startResponse = await request(fetchImpl, `${base}/api/git-reviews`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-review-access-code': config.accessCode },
    body: JSON.stringify({ repositoryUrl: config.repositoryUrl, ...(config.repositoryRef === undefined ? {} : { ref: config.repositoryRef }) }),
  }, 'review-start');
  if (![201, 202].includes(startResponse.status)) throw new SmokeError('review-start', 'HTTP_STATUS_UNEXPECTED', startResponse.status);
  const started = validateReviewStart(await jsonResponse(startResponse, 'review-start', startResponse.status));

  const startedAt = now();
  if (!Number.isFinite(startedAt)) invalid('review-poll', 'CLOCK_INVALID');
  let jobState = started.state;
  while (jobState !== 'ready') {
    if (now() - startedAt > config.maxWaitMs) invalid('review-poll', 'POLL_TIMEOUT');
    await sleep(config.pollIntervalMs);
    const response = await request(fetchImpl, `${base}/api/jobs/${started.jobId}`, { method: 'GET' }, 'review-poll');
    if (response.status !== 200) throw new SmokeError('review-poll', 'HTTP_STATUS_UNEXPECTED', response.status);
    jobState = validateJob(await jsonResponse(response, 'review-poll', 200), started.jobId, started.reviewId);
    if (['failed', 'expired', 'deleted'].includes(jobState)) invalid('review-poll', 'REVIEW_TERMINAL_UNEXPECTED');
  }

  validateReview(await jsonResponse(await request(fetchImpl, `${base}/api/reviews/${started.reviewId}`, { method: 'GET' }, 'review-fetch'), 'review-fetch', 200), started.reviewId);

  let question = 'skipped';
  const questionResponse = await request(fetchImpl, `${base}/api/reviews/${started.reviewId}/questions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: config.question }),
  }, 'question');
  if (questionResponse.status === 200) {
    validateQuestion(await jsonResponse(questionResponse, 'question', 200), started.reviewId);
    question = 'verified';
  } else if (![404, 405].includes(questionResponse.status)) {
    throw new SmokeError('question', 'HTTP_STATUS_UNEXPECTED', questionResponse.status);
  }

  const deleted = await request(fetchImpl, `${base}/api/reviews/${started.reviewId}`, { method: 'DELETE' }, 'delete');
  validateDelete(await jsonResponse(deleted, 'delete', 200), started.reviewId);
  const terminal = await request(fetchImpl, `${base}/api/reviews/${started.reviewId}`, { method: 'GET' }, 'terminal-state');
  if (![404, 410].includes(terminal.status)) throw new SmokeError('terminal-state', 'TERMINAL_STATE_UNEXPECTED', terminal.status);
  return Object.freeze({ state: 'passed', question });
}

function environmentConfig(origin) {
  return {
    origin,
    accessCode: process.env.SMOKE_ACCESS_CODE ?? process.env.REVIEW_ACCESS_CODE,
    repositoryUrl: process.env.SMOKE_REPOSITORY_URL,
    repositoryRef: process.env.SMOKE_REPOSITORY_REF,
    question: process.env.SMOKE_QUESTION,
    pollIntervalMs: process.env.SMOKE_POLL_INTERVAL_MS === undefined ? undefined : Number(process.env.SMOKE_POLL_INTERVAL_MS),
    maxWaitMs: process.env.SMOKE_MAX_WAIT_MS === undefined ? undefined : Number(process.env.SMOKE_MAX_WAIT_MS),
  };
}

if (import.meta.main) {
  const origin = process.argv[2] ?? process.env.SMOKE_ORIGIN;
  try {
    const result = await runSmoke(environmentConfig(origin));
    process.stdout.write(`SMOKE_PASSED question=${result.question}\n`);
  } catch (error) {
    const step = error instanceof SmokeError ? error.step : 'unknown';
    const code = error instanceof SmokeError ? error.code : 'SMOKE_FAILED';
    process.stderr.write(`SMOKE_FAILED step=${step} code=${code}\n`);
    process.exitCode = 1;
  }
}
