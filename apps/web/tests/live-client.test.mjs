import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_REVIEW } from '../src/fixtures.js';
import { createReviewClient, endpointFromDocument, isQuestionResponse, normaliseEndpoint } from '../src/live-client.js';

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('endpoint configuration accepts query-free URLs and rejects credential-bearing URLs', () => {
  assert.equal(normaliseEndpoint('https://review.example.test/api/reviews/demo'), 'https://review.example.test/api/reviews/demo');
  assert.equal(normaliseEndpoint('/api/reviews/demo'), 'http://localhost/api/reviews/demo');
  assert.equal(normaliseEndpoint('https://user:secret@review.example.test/api'), null);
  assert.equal(normaliseEndpoint('https://review.example.test/api?token=secret'), null);
  assert.equal(endpointFromDocument({ querySelector: () => ({ content: 'https://review.example.test/api/reviews/demo' }) }), 'https://review.example.test/api/reviews/demo');
  assert.equal(endpointFromDocument({ querySelector: () => ({ content: 'https://review.example.test/api?source=/private/repo' }) }), null);
});

test('client explicitly falls back to the local fixture without an endpoint', async () => {
  let called = false;
  const client = createReviewClient(DEMO_REVIEW, { fetchImpl: async () => { called = true; } });
  assert.equal(client.mode, 'fixture');
  assert.equal((await client.load()).reviewId, DEMO_REVIEW.reviewId);
  assert.equal(called, false);
});

test('live load requests the configured endpoint and validates the review envelope', async () => {
  const requests = [];
  const client = createReviewClient(DEMO_REVIEW, {
    endpoint: 'https://review.example.test/api/reviews/demo',
    fetchImpl: async (url, init) => { requests.push({ url, init }); return jsonResponse(DEMO_REVIEW); },
  });
  const result = await client.load();
  assert.equal(client.mode, 'live');
  assert.equal(result.state, 'ready');
  assert.equal(requests[0].url, 'https://review.example.test/api/reviews/demo');
  assert.equal(requests[0].init.method, 'GET');
  assert.equal(requests[0].init.headers.Accept, 'application/json');
});

test('live load maps deliberate HTTP and parsing states', async () => {
  for (const [status, expected] of [[404, 'empty'], [410, 'expired'], [429, 'abuse-limit'], [503, 'failure']]) {
    const client = createReviewClient(DEMO_REVIEW, { endpoint: 'https://review.example.test/api/reviews/demo', fetchImpl: async () => new Response(null, { status }) });
    assert.equal((await client.load()).state, expected);
  }
  const invalid = createReviewClient(DEMO_REVIEW, { endpoint: 'https://review.example.test/api/reviews/demo', fetchImpl: async () => jsonResponse({ reviewId: 'not-enough' }) });
  assert.equal((await invalid.load()).state, 'invalid-response');
  const missingCitationLanguage = structuredClone(DEMO_REVIEW);
  delete missingCitationLanguage.chatExamples[0].citations[0].language;
  const invalidCitation = createReviewClient(DEMO_REVIEW, { endpoint: 'https://review.example.test/api/reviews/demo', fetchImpl: async () => jsonResponse(missingCitationLanguage) });
  assert.equal((await invalidCitation.load()).state, 'invalid-response');
  const network = createReviewClient(DEMO_REVIEW, { endpoint: 'https://review.example.test/api/reviews/demo', fetchImpl: async () => { throw new TypeError('offline'); } });
  assert.equal((await network.load()).state, 'network-error');
});

test('question POST sends only review identity and question, then validates cited response', async () => {
  const requests = [];
  const liveReview = { ...DEMO_REVIEW, reviewId: 'live-review-2' };
  const answer = { id: 'answer-1', question: 'Where is retry policy?', answer: 'In the worker.', confidence: 'high', citations: [{ path: 'worker.ts', language: 'TypeScript', lineStart: 3, lineEnd: 9, excerpt: 'retry()', reason: 'Retry call.' }] };
  const client = createReviewClient(DEMO_REVIEW, { endpoint: 'https://review.example.test/api/reviews/demo', fetchImpl: async (url, init) => { requests.push({ url, init }); return jsonResponse(init?.method === 'POST' ? answer : liveReview); } });
  assert.equal(isQuestionResponse(answer), true);
  assert.equal((await client.load()).reviewId, 'live-review-2');
  assert.deepEqual(await client.askQuestion('  Where is retry policy?  '), answer);
  assert.equal(requests[1].url, 'https://review.example.test/api/reviews/demo/questions');
  assert.equal(requests[1].init.method, 'POST');
  assert.deepEqual(JSON.parse(requests[1].init.body), { reviewId: 'live-review-2', question: 'Where is retry policy?' });
  assert.equal(Object.hasOwn(requests[1].init.headers, 'Authorization'), false);
});

test('question POST exposes expired, abuse-limit, network, and invalid response errors', async () => {
  for (const [status, code] of [[410, 'expired'], [429, 'abuse-limit'], [503, 'network-error']]) {
    const client = createReviewClient(DEMO_REVIEW, { endpoint: 'https://review.example.test/api/reviews/demo', fetchImpl: async () => new Response(null, { status }) });
    await assert.rejects(() => client.askQuestion('What changed?'), (error) => error.code === code);
  }
  const invalid = createReviewClient(DEMO_REVIEW, { endpoint: 'https://review.example.test/api/reviews/demo', fetchImpl: async () => jsonResponse({ answer: 'un-cited' }) });
  await assert.rejects(() => invalid.askQuestion('What changed?'), (error) => error.code === 'invalid-response');
  const offline = createReviewClient(DEMO_REVIEW, { endpoint: 'https://review.example.test/api/reviews/demo', fetchImpl: async () => { throw new TypeError('offline'); } });
  await assert.rejects(() => offline.askQuestion('What changed?'), (error) => error.code === 'network-error');
});
