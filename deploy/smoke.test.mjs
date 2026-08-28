import assert from 'node:assert/strict';
import test from 'node:test';

import { SmokeError, runSmoke } from './smoke.mjs';

function response(status, body) {
  return { status, async json() { return body; } };
}

function scenario({ questionStatus = 200, terminalStatus = 404 } = {}) {
  const calls = [];
  const responses = [
    response(200, { status: 'ok' }),
    response(200, { status: 'ready' }),
    response(202, { jobId: 'job-smoke', reviewId: 'review-smoke', state: 'queued' }),
    response(200, { jobId: 'job-smoke', reviewId: 'review-smoke', state: 'ready' }),
    response(200, { reviewId: 'review-smoke', state: 'ready', review: { review_id: 'review-smoke' } }),
    response(questionStatus, questionStatus === 200 ? {
      reviewId: 'review-smoke', answer: { status: 'answered', citations: [{ repository_path: 'README.md', line_start: 1, line_end: 1 }] },
    } : {}),
    response(200, { reviewId: 'review-smoke', state: 'deleted' }),
    response(terminalStatus, {}),
  ];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return responses.shift();
    },
  };
}

function config(overrides = {}) {
  return {
    origin: 'https://demo.example.test',
    accessCode: 'operator-only-secret',
    repositoryUrl: 'https://github.com/example/public-repository',
    repositoryRef: 'main',
    pollIntervalMs: 1,
    maxWaitMs: 100,
    now: (() => { let value = 0; return () => value++; })(),
    sleep: async () => {},
    ...overrides,
  };
}

test('runs the bounded HTTPS lifecycle with injected fetch, clock, and sleep', async () => {
  const scenarioState = scenario();
  const result = await runSmoke({ ...config(), fetch: scenarioState.fetch });
  assert.deepEqual(result, { state: 'passed', question: 'verified' });
  assert.deepEqual(scenarioState.calls.map((call) => new URL(call.url).pathname), [
    '/healthz', '/readyz', '/api/git-reviews', '/api/jobs/job-smoke', '/api/reviews/review-smoke',
    '/api/reviews/review-smoke/questions', '/api/reviews/review-smoke', '/api/reviews/review-smoke',
  ]);
  const start = scenarioState.calls[2];
  assert.equal(start.init.headers['x-review-access-code'], 'operator-only-secret');
  assert.match(start.init.body, /public-repository/u);
});

test('defaults the public smoke to the immutable qualified Uptime Kuma intake', async () => {
  const scenarioState = scenario();
  const input = config({ repositoryUrl: undefined, repositoryRef: undefined, fetch: scenarioState.fetch });
  await runSmoke(input);
  const submitted = JSON.parse(scenarioState.calls[2].init.body);
  assert.deepEqual(submitted, {
    repositoryUrl: 'https://github.com/louislam/uptime-kuma',
    ref: 'fcc51ebf4666121d18adbf09523b3aefda3576c9',
  });
});

test('allows an older hosted contract without the question endpoint', async () => {
  const scenarioState = scenario({ questionStatus: 404 });
  assert.deepEqual(await runSmoke({ ...config(), fetch: scenarioState.fetch }), { state: 'passed', question: 'skipped' });
});

test('reports only stable step and code on failure, never URL, code, body, or identifiers', async () => {
  const secret = 'operator-only-secret';
  const scenarioState = scenario();
  scenarioState.fetch = async () => { throw new Error(`https://demo.example.test/private?code=${secret} source body`); };
  await assert.rejects(runSmoke({ ...config({ accessCode: secret }), fetch: scenarioState.fetch }), (error) => {
    assert.ok(error instanceof SmokeError);
    assert.equal(error.step, 'healthz');
    assert.equal(error.code, 'NETWORK_FAILED');
    assert.equal(error.message, 'NETWORK_FAILED');
    assert.doesNotMatch(JSON.stringify(error), /demo\.example|operator-only-secret|source body|review-smoke/u);
    return true;
  });
});

test('fails closed on unsafe origins, invalid limits, unexpected terminal states, and malformed responses', async () => {
  await assert.rejects(runSmoke({ ...config({ origin: 'http://demo.example.test' }), fetch: async () => response(200, {}) }), (error) => error.code === 'ORIGIN_INVALID');
  await assert.rejects(runSmoke({ ...config({ maxWaitMs: 0 }), fetch: async () => response(200, {}) }), (error) => error.code === 'MAX_WAIT_INVALID');
  const failed = scenario();
  failed.fetch = async () => response(200, { status: 'not-ready' });
  await assert.rejects(runSmoke({ ...config(), fetch: failed.fetch }), (error) => error.code === 'HEALTH_RESPONSE_INVALID');
  const terminal = scenario();
  terminal.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/api/jobs/job-smoke') return response(200, { jobId: 'job-smoke', reviewId: 'review-smoke', state: 'failed' });
    return path === '/healthz' ? response(200, { status: 'ok' }) : path === '/readyz' ? response(200, { status: 'ready' }) : response(202, { jobId: 'job-smoke', reviewId: 'review-smoke', state: 'queued' });
  };
  await assert.rejects(runSmoke({ ...config(), fetch: terminal.fetch }), (error) => error.code === 'REVIEW_TERMINAL_UNEXPECTED');
});
