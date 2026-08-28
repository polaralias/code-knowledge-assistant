import { isReviewFixture, withReviewState } from './fixtures.js';

/**
 * Browser adapter for the review API. It deliberately has no storage, logging,
 * auth header, or source-bearing URL construction. The caller decides whether
 * to use the returned fixture or render its state.
 */

/** @typedef {'fixture'|'live'} ClientMode */
/** @typedef {{ mode: ClientMode, endpoint: string|null, load: () => Promise<import('./fixtures.js').ReviewFixture>, askQuestion: (question: string) => Promise<import('./fixtures.js').ChatExample> }} ReviewClient */

const LIVE_STATES = ['ready', 'loading', 'empty', 'failure', 'network-error', 'invalid-response', 'expired', 'abuse-limit'];

/** @param {string|null|undefined} configured */
export function normaliseEndpoint(configured) {
  if (!configured || typeof configured !== 'string') return null;
  let url;
  try { url = new URL(configured, globalThis.location?.origin ?? 'http://localhost'); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
  return url.href.replace(/\/$/, '');
}

/** @param {{ querySelector?: (selector: string) => { content?: string }|null }|null|undefined} documentLike */
export function endpointFromDocument(documentLike) {
  return normaliseEndpoint(documentLike?.querySelector?.('meta[name="code-atlas-review-endpoint"]')?.content);
}

/** @param {unknown} value @returns {value is import('./fixtures.js').ChatExample} */
export function isQuestionResponse(value) {
  if (!value || typeof value !== 'object') return false;
  const response = /** @type {Partial<import('./fixtures.js').ChatExample>} */ (value);
  return typeof response.id === 'string'
    && typeof response.question === 'string'
    && typeof response.answer === 'string'
    && ['high', 'medium', 'low'].includes(response.confidence)
    && Array.isArray(response.citations)
    && response.citations.every((citation) => typeof citation?.path === 'string' && citation.path.length > 0 && typeof citation.language === 'string' && citation.language.length > 0 && typeof citation.lineStart === 'number' && citation.lineStart > 0 && typeof citation.lineEnd === 'number' && citation.lineEnd >= citation.lineStart && typeof citation.excerpt === 'string' && citation.excerpt.length > 0 && typeof citation.reason === 'string' && citation.reason.length > 0);
}

/** @param {Response} response @returns {Promise<unknown>} */
async function readJson(response) {
  try { return await response.json(); } catch { return null; }
}

/** @param {import('./fixtures.js').ReviewFixture} fallback @param {{ endpoint?: string|null, fetchImpl?: typeof fetch }} [options] @returns {ReviewClient} */
export function createReviewClient(fallback, options = {}) {
  const endpoint = normaliseEndpoint(options.endpoint);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const mode = endpoint && typeof fetchImpl === 'function' ? 'live' : 'fixture';
  let activeReviewId = fallback.reviewId;

  /** @returns {Promise<import('./fixtures.js').ReviewFixture>} */
  async function load() {
    if (mode === 'fixture') return fallback;
    try {
      const response = await fetchImpl(endpoint, { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'same-origin' });
      if (response.status === 404) return withReviewState(fallback, 'empty');
      if (response.status === 410) return withReviewState(fallback, 'expired');
      if (response.status === 429) return withReviewState(fallback, 'abuse-limit');
      if (!response.ok) return withReviewState(fallback, 'failure');
      const body = await readJson(response);
      if (!isReviewFixture(body)) return withReviewState(fallback, 'invalid-response');
      activeReviewId = body.reviewId;
      return body;
    } catch {
      return withReviewState(fallback, 'network-error');
    }
  }

  /** @param {string} question @returns {Promise<import('./fixtures.js').ChatExample>} */
  async function askQuestion(question) {
    if (mode !== 'live') throw new Error('Question service is not configured');
    const trimmed = question.trim();
    if (!trimmed) throw new Error('Question is required');
    let response;
    try {
      response = await fetchImpl(`${endpoint}/questions`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ reviewId: activeReviewId, question: trimmed }),
      });
    } catch {
      throw Object.assign(new Error('Question request failed'), { code: 'network-error' });
    }
    if (response.status === 410) throw Object.assign(new Error('Review expired'), { code: 'expired' });
    if (response.status === 429) throw Object.assign(new Error('Question limit reached'), { code: 'abuse-limit' });
    if (!response.ok) throw Object.assign(new Error('Question request failed'), { code: 'network-error' });
    const body = await readJson(response);
    if (!isQuestionResponse(body)) throw Object.assign(new Error('Question response did not match the review contract'), { code: 'invalid-response' });
    return body;
  }

  return { mode, endpoint, load, askQuestion };
}

/** @param {string} state */
export function isKnownReviewState(state) {
  return LIVE_STATES.includes(state);
}
