import { isReviewFixture } from './fixtures.js';
import { isQuestionResponse, normaliseEndpoint } from './live-client.js';

/** @typedef {'fixture'|'live'} UploadClientMode */
/** @typedef {'queued'|'uploading'|'processing'|'ready'|'failed'|'expired'|'deleted'|'rate-limited'|'unauthorized'|'conflict'|'network-error'|'invalid-response'} UploadState */
/** @typedef {{ state: UploadState, attempt?: number, maxAttempts?: number, jobId?: string, reviewId?: string, review?: import('./fixtures.js').ReviewFixture }} UploadProgress */

export const DEFAULT_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const DEFAULT_POLL_INTERVAL_MS = 1500;
export const DEFAULT_MAX_POLL_ATTEMPTS = 20;

/** @param {Response} response @returns {Promise<unknown>} */
async function readJson(response) {
  try { return await response.json(); } catch { return null; }
}

/** @param {unknown} file @param {number} [maxBytes] @returns {{ ok: true, file: File }|{ ok: false, code: string, message: string }} */
export function validateZipFile(file, maxBytes = DEFAULT_MAX_UPLOAD_BYTES) {
  if (!file || typeof file !== 'object') return { ok: false, code: 'empty-file', message: 'Choose a ZIP file before uploading.' };
  const candidate = /** @type {{ name?: unknown, size?: unknown }} */ (file);
  if (typeof candidate.name !== 'string' || !candidate.name.toLowerCase().endsWith('.zip')) return { ok: false, code: 'invalid-extension', message: 'The repository must be a .zip file.' };
  if (typeof candidate.size !== 'number' || candidate.size <= 0) return { ok: false, code: 'empty-file', message: 'The selected ZIP is empty.' };
  if (candidate.size > maxBytes) return { ok: false, code: 'too-large', message: `The selected ZIP is larger than ${Math.round(maxBytes / (1024 * 1024))} MB.` };
  return { ok: true, file: /** @type {File} */ (file) };
}

const GITHUB_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** @param {unknown} value @returns {{ ok: true, value: string }|{ ok: false, code: string, message: string }} */
export function validateGitHubUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return { ok: false, code: 'invalid-github-url', message: 'Enter a public GitHub HTTPS URL.' };
  let parsed;
  try { parsed = new URL(value.trim()); } catch { return { ok: false, code: 'invalid-github-url', message: 'Enter a public GitHub HTTPS URL.' }; }
  const segments = parsed.pathname.split('/').filter(Boolean);
  const repository = segments[1]?.endsWith('.git') ? segments[1].slice(0, -4) : segments[1];
  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com' || parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash || segments.length !== 2 || !GITHUB_SEGMENT.test(segments[0] ?? '') || !GITHUB_SEGMENT.test(repository ?? '')) {
    return { ok: false, code: 'invalid-github-url', message: 'Use a public GitHub URL such as https://github.com/org/repository, without credentials, query parameters, or fragments.' };
  }
  return { ok: true, value: `https://github.com/${segments[0]}/${repository}${segments[1].endsWith('.git') ? '.git' : ''}` };
}

/** @param {unknown} value @returns {{ ok: true, value: string }|{ ok: false, code: string, message: string }} */
export function validateGitHubRef(value) {
  if (value == null || value === '') return { ok: true, value: '' };
  if (typeof value !== 'string') return { ok: false, code: 'invalid-github-ref', message: 'The GitHub ref must be plain text.' };
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 256 || /[\u0000-\u001f\u007f]/u.test(trimmed)) return { ok: false, code: 'invalid-github-ref', message: 'Enter a short branch, tag, or commit ref without control characters.' };
  return { ok: true, value: trimmed };
}

/** @param {{ querySelector?: (selector: string) => { content?: string }|null }|null|undefined} documentLike */
export function apiEndpointFromDocument(documentLike) {
  return normaliseEndpoint(documentLike?.querySelector?.('meta[name="code-atlas-api-base"]')?.content);
}

/** @param {unknown} value @returns {value is { jobId: string }} */
export function isAcceptedJob(value) {
  if (!value || typeof value !== 'object') return false;
  const candidate = /** @type {{ jobId?: unknown }} */ (value);
  return typeof candidate.jobId === 'string' && /^[A-Za-z0-9._~-]+$/.test(candidate.jobId);
}

const JOB_STATES = ['queued', 'processing', 'ready', 'failed', 'expired', 'deleted'];

/** @param {unknown} value @returns {value is { state: string, jobId: string, reviewId: string }} */
export function isJobStatus(value) {
  if (!value || typeof value !== 'object') return false;
  if (Object.keys(value).length !== 3 || !Object.keys(value).every((key) => ['state', 'jobId', 'reviewId'].includes(key))) return false;
  const candidate = /** @type {{ state?: unknown, jobId?: unknown, reviewId?: unknown }} */ (value);
  return typeof candidate.state === 'string' && JOB_STATES.includes(candidate.state)
    && typeof candidate.jobId === 'string' && /^[A-Za-z0-9._~-]+$/.test(candidate.jobId)
    && typeof candidate.reviewId === 'string' && /^[A-Za-z0-9._~-]+$/.test(candidate.reviewId);
}

/** @param {unknown} value @returns {value is { state: string, jobId: string, reviewId: string }} */
export function isGitHubJob(value) {
  return isJobStatus(value);
}

/** @param {Response} response @returns {Promise<UploadState|null>} */
async function terminalState(response) {
  const body = await readJson(response);
  const code = body && typeof body === 'object' && 'error' in body && body.error && typeof body.error === 'object' && 'code' in body.error ? body.error.code : null;
  if (code === 'REVIEW_FAILED') return 'failed';
  if (code === 'REVIEW_EXPIRED') return 'expired';
  if (code === 'REVIEW_DELETED') return 'deleted';
  return null;
}

/** @param {unknown} error @param {UploadState} fallback */
function clientError(error, fallback = 'network-error') {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error;
  return Object.assign(new Error('Upload request failed'), { code: fallback });
}

/** @param {number} status @param {string} resource @returns {Error} */
function httpError(status, resource) {
  if (status === 401) return Object.assign(new Error('The review access code was not accepted. Check the code and try again.'), { code: 'unauthorized' });
  if (status === 409) return Object.assign(new Error(`A ${resource} is already in progress. Wait for it to finish or use the existing review.`), { code: 'conflict' });
  if (status === 429) return Object.assign(new Error(`The review service is rate-limiting ${resource}s. Wait and try again.`), { code: 'rate-limited' });
  return Object.assign(new Error(`${resource[0].toUpperCase()}${resource.slice(1)} request failed`), { code: 'network-error' });
}

/** @param {string|undefined} accessCode @param {string} contentType @returns {Record<string, string>} */
function requestHeaders(accessCode, contentType) {
  const headers = { Accept: 'application/json', 'Content-Type': contentType };
  if (typeof accessCode === 'string' && accessCode.trim()) headers['x-review-access-code'] = accessCode.trim();
  return headers;
}

/** @param {{ endpoint?: string|null, fallback: import('./fixtures.js').ReviewFixture, fetchImpl?: typeof fetch, maxBytes?: number, pollIntervalMs?: number, maxPollAttempts?: number, sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void> }} options */
export function createUploadClient(options) {
  const endpoint = normaliseEndpoint(options.endpoint);
  const fallback = options.fallback;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxPollAttempts = options.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;
  const sleep = options.sleep ?? ((milliseconds, signal) => new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const onAbort = () => { clearTimeout(timer); cleanup(); reject(Object.assign(new Error('Upload cancelled'), { code: 'aborted' })); };
    timer = setTimeout(() => { cleanup(); resolve(); }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  }));
  const mode = endpoint && typeof fetchImpl === 'function' ? 'live' : 'fixture';

  /** @param {UploadProgress} progress @param {{ onState?: (state: UploadProgress) => void }} controls */
  function emit(progress, controls) { controls.onState?.(progress); }

  /** @param {string} jobId @param {{ onState?: (state: UploadProgress) => void, signal?: AbortSignal }} controls */
  async function pollJob(jobId, controls) {
    for (let attempt = 1; attempt <= maxPollAttempts; attempt += 1) {
      if (controls.signal?.aborted) throw Object.assign(new Error('Upload cancelled'), { code: 'aborted' });
      let response;
      try {
        response = await fetchImpl(`${endpoint}/jobs/${encodeURIComponent(jobId)}`, { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'same-origin', signal: controls.signal });
      } catch (error) {
        if (controls.signal?.aborted) throw Object.assign(new Error('Upload cancelled'), { code: 'aborted' });
        throw clientError(error);
      }
      if ([401, 409, 429].includes(response.status)) throw httpError(response.status, 'upload job');
      if (response.status === 410 || response.status === 422) {
        const state = await terminalState(response);
        throw Object.assign(new Error(`Upload job ${state ?? 'failed'}`), { code: state ?? 'failed' });
      }
      if (response.status === 404) throw Object.assign(new Error('Upload job was deleted'), { code: 'deleted' });
      if (!response.ok) throw Object.assign(new Error('Upload job failed'), { code: 'network-error' });
      let body;
      try { body = await response.json(); } catch { throw Object.assign(new Error('Upload job response was invalid'), { code: 'invalid-response' }); }
      if (!isJobStatus(body)) throw Object.assign(new Error('Upload job response was invalid'), { code: 'invalid-response' });
      const progress = { state: body.state, attempt, maxAttempts: maxPollAttempts, jobId, reviewId: body.reviewId };
      emit(progress, controls);
      if (body.state === 'ready') return body;
      if (['failed', 'expired', 'deleted'].includes(body.state)) throw Object.assign(new Error(`Upload job ${body.state}`), { code: body.state });
      if (attempt < maxPollAttempts) await sleep(pollIntervalMs, controls.signal);
    }
    throw Object.assign(new Error('Upload job polling timed out'), { code: 'network-error' });
  }

  /** @param {string} reviewId @param {{ signal?: AbortSignal }} [controls] */
  async function loadCompletedReview(reviewId, controls = {}) {
    if (!/^[A-Za-z0-9._~-]+$/.test(reviewId)) throw Object.assign(new Error('Review ID was invalid'), { code: 'invalid-response' });
    let response;
    try { response = await fetchImpl(`${endpoint}/reviews/${encodeURIComponent(reviewId)}`, { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'same-origin', signal: controls.signal }); } catch (error) {
      if (controls.signal?.aborted) throw Object.assign(new Error('Upload cancelled'), { code: 'aborted' });
      throw clientError(error);
    }
    if ([401, 409, 429].includes(response.status)) throw httpError(response.status, 'review');
    if (response.status === 400) throw Object.assign(new Error('The GitHub repository request was invalid'), { code: 'invalid-github-url' });
    if (response.status === 410) throw Object.assign(new Error('Review expired'), { code: 'expired' });
    if (response.status === 404) throw Object.assign(new Error('Review was deleted'), { code: 'deleted' });
    if (!response.ok) throw Object.assign(new Error('Review could not load'), { code: 'network-error' });
    let body;
    try { body = await response.json(); } catch { throw Object.assign(new Error('Review response was invalid'), { code: 'invalid-response' }); }
    const wrapped = body && typeof body === 'object' && 'state' in body && body.state === 'ready' && 'review' in body ? body.review : null;
    if (!isReviewFixture(wrapped)) throw Object.assign(new Error('Review response was invalid'), { code: 'invalid-response' });
    return wrapped;
  }

  /** @param {File} file @param {{ accessCode?: string, onAccepted?: () => void, onState?: (state: UploadProgress) => void, signal?: AbortSignal }} [controls] */
  async function uploadAndPoll(file, controls = {}) {
    const validation = validateZipFile(file, maxBytes);
    if (!validation.ok) throw Object.assign(new Error(validation.message), { code: validation.code });
    if (mode === 'fixture') {
      emit({ state: 'ready', review: fallback, reviewId: fallback.reviewId }, controls);
      return { review: fallback, reviewId: fallback.reviewId, mode };
    }
    emit({ state: 'uploading' }, controls);
    let response;
    try {
      response = await fetchImpl(`${endpoint}/reviews`, { method: 'POST', headers: requestHeaders(controls.accessCode, 'application/zip'), credentials: 'same-origin', body: file, signal: controls.signal });
    } catch (error) {
      if (controls.signal?.aborted) throw Object.assign(new Error('Upload cancelled'), { code: 'aborted' });
      throw clientError(error);
    }
    if ([401, 409, 429].includes(response.status)) throw httpError(response.status, 'upload');
    if (!response.ok) throw Object.assign(new Error('Upload failed'), { code: 'network-error' });
    let accepted;
    try { accepted = await response.json(); } catch { throw Object.assign(new Error('Upload response was invalid'), { code: 'invalid-response' }); }
    if (!isAcceptedJob(accepted)) throw Object.assign(new Error('Upload response was invalid'), { code: 'invalid-response' });
    controls.onAccepted?.();
    const status = await pollJob(accepted.jobId, controls);
    if (!status.reviewId) throw Object.assign(new Error('Ready upload had no review ID'), { code: 'invalid-response' });
    emit({ state: 'processing', jobId: accepted.jobId, reviewId: status.reviewId }, controls);
    const review = await loadCompletedReview(status.reviewId, controls);
    emit({ state: 'ready', jobId: accepted.jobId, reviewId: review.reviewId, review }, controls);
    return { review, reviewId: review.reviewId, jobId: accepted.jobId, mode };
  }

  /** @param {{ repositoryUrl: string, ref?: string, accessCode?: string }} input @param {{ onAccepted?: () => void, onState?: (state: UploadProgress) => void, signal?: AbortSignal }} [controls] */
  async function createGitHubReview(input, controls = {}) {
    const urlValidation = validateGitHubUrl(input?.repositoryUrl);
    if (!urlValidation.ok) throw Object.assign(new Error(urlValidation.message), { code: urlValidation.code });
    const refValidation = validateGitHubRef(input?.ref);
    if (!refValidation.ok) throw Object.assign(new Error(refValidation.message), { code: refValidation.code });
    if (mode === 'fixture') {
      emit({ state: 'ready', review: fallback, reviewId: fallback.reviewId }, controls);
      return { review: fallback, reviewId: fallback.reviewId, mode };
    }
    emit({ state: 'uploading' }, controls);
    let response;
    try {
      const body = { repositoryUrl: urlValidation.value, ...(refValidation.value ? { ref: refValidation.value } : {}) };
      response = await fetchImpl(`${endpoint}/git-reviews`, { method: 'POST', headers: requestHeaders(input?.accessCode, 'application/json'), credentials: 'same-origin', body: JSON.stringify(body), signal: controls.signal });
    } catch (error) {
      if (controls.signal?.aborted) throw Object.assign(new Error('Review cancelled'), { code: 'aborted' });
      throw clientError(error);
    }
    if ([401, 409, 429].includes(response.status)) throw httpError(response.status, 'GitHub review');
    if (!response.ok) throw Object.assign(new Error('GitHub review request failed'), { code: 'network-error' });
    let accepted;
    try { accepted = await response.json(); } catch { throw Object.assign(new Error('GitHub review response was invalid'), { code: 'invalid-response' }); }
    if (!isGitHubJob(accepted)) throw Object.assign(new Error('GitHub review response was invalid'), { code: 'invalid-response' });
    controls.onAccepted?.();
    const status = await pollJob(accepted.jobId, controls);
    if (!status.reviewId) throw Object.assign(new Error('Ready GitHub review had no review ID'), { code: 'invalid-response' });
    emit({ state: 'processing', jobId: accepted.jobId, reviewId: status.reviewId }, controls);
    const review = await loadCompletedReview(status.reviewId, controls);
    emit({ state: 'ready', jobId: accepted.jobId, reviewId: review.reviewId, review }, controls);
    return { review, reviewId: review.reviewId, jobId: accepted.jobId, mode };
  }

  /** @param {string} reviewId @param {{ signal?: AbortSignal }} [controls] */
  async function deleteReview(reviewId, controls = {}) {
    if (!/^[A-Za-z0-9._~-]+$/.test(reviewId)) throw Object.assign(new Error('Review ID was invalid'), { code: 'invalid-response' });
    if (mode === 'fixture') return { deleted: false, mode };
    let response;
    try { response = await fetchImpl(`${endpoint}/reviews/${encodeURIComponent(reviewId)}`, { method: 'DELETE', headers: { Accept: 'application/json' }, credentials: 'same-origin', signal: controls.signal }); } catch (error) { throw clientError(error); }
    if (response.status === 404 || response.status === 410) return { deleted: true, mode };
    if (!response.ok) throw Object.assign(new Error('Review could not be deleted'), { code: 'network-error' });
    return { deleted: true, mode };
  }

  /** @param {string} reviewId @param {string} question @param {{ signal?: AbortSignal }} [controls] */
  async function askQuestion(reviewId, question, controls = {}) {
    if (mode !== 'live') throw new Error('Question service is not configured');
    if (!/^[A-Za-z0-9._~-]+$/.test(reviewId)) throw Object.assign(new Error('Review ID was invalid'), { code: 'invalid-response' });
    const trimmed = question.trim();
    if (!trimmed) throw new Error('Question is required');
    let response;
    try {
      response = await fetchImpl(`${endpoint}/reviews/${encodeURIComponent(reviewId)}/questions`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ reviewId, question: trimmed }), signal: controls.signal });
    } catch (error) {
      if (controls.signal?.aborted) throw Object.assign(new Error('Question cancelled'), { code: 'aborted' });
      throw clientError(error);
    }
    if (response.status === 410) throw Object.assign(new Error('Review expired'), { code: 'expired' });
    if (response.status === 429) throw Object.assign(new Error('Question limit reached'), { code: 'rate-limited' });
    if (!response.ok) throw Object.assign(new Error('Question request failed'), { code: 'network-error' });
    const body = await readJson(response);
    const wrapped = body && typeof body === 'object' && 'answer' in body ? body.answer : null;
    if (!isQuestionResponse(wrapped)) throw Object.assign(new Error('Question response did not match the review contract'), { code: 'invalid-response' });
    return wrapped;
  }

  return { mode, endpoint, maxBytes, maxPollAttempts, uploadAndPoll, createGitHubReview, loadCompletedReview, deleteReview, askQuestion };
}
