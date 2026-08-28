import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEMO_REVIEW } from '../src/fixtures.js';
import { DEFAULT_MAX_UPLOAD_BYTES, apiEndpointFromDocument, createUploadClient, isAcceptedJob, isGitHubJob, isJobStatus, validateGitHubRef, validateGitHubUrl, validateZipFile } from '../src/upload-client.js';

const file = (name = 'repo.zip', size = 128) => ({ name, size, type: 'application/zip' });
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('upload endpoint is opt-in and read from the dedicated API base meta tag', () => {
  assert.equal(apiEndpointFromDocument({ querySelector: (selector) => selector.includes('api-base') ? { content: '/api' } : null }), 'http://localhost/api');
  assert.equal(apiEndpointFromDocument({ querySelector: () => ({ content: '' }) }), null);
});

test('ZIP validation rejects wrong extension, empty files, and oversized files', () => {
  assert.equal(validateZipFile(file('repo.tar')).code, 'invalid-extension');
  assert.equal(validateZipFile(file('repo.zip', 0)).code, 'empty-file');
  assert.equal(validateZipFile(file('repo.zip', DEFAULT_MAX_UPLOAD_BYTES + 1)).code, 'too-large');
  assert.equal(validateZipFile(file('REPO.ZIP')).ok, true);
});

test('GitHub intake accepts public HTTPS repositories and rejects credential-bearing or ambiguous URLs', () => {
  assert.equal(validateGitHubUrl('https://github.com/octo-org/northstar.git').ok, true);
  assert.equal(validateGitHubUrl('https://GITHUB.com/octo-org/northstar').ok, true);
  for (const value of [
    'http://github.com/octo-org/northstar',
    'https://github.com',
    'https://github.com/octo-org',
    'https://github.com/octo-org/northstar?token=secret',
    'https://github.com/octo-org/northstar#main',
    'https://user:secret@github.com/octo-org/northstar',
    'git@github.com:octo-org/northstar.git',
    'https://evil.example/octo-org/northstar',
  ]) assert.equal(validateGitHubUrl(value).ok, false, value);
  assert.equal(validateGitHubRef('').ok, true);
  assert.equal(validateGitHubRef(' release/v2 ').value, 'release/v2');
  assert.equal(validateGitHubRef('main\nAuthorization: bearer secret').ok, false);
  assert.equal(isGitHubJob({ jobId: 'job_123', reviewId: 'review_123', state: 'queued' }), true);
  assert.equal(isGitHubJob({ jobId: 'job_123', reviewId: 'review_123', state: 'ready', source: 'repo.zip' }), false);
});

test('GitHub intake posts strict JSON, reuses job polling, and loads the cited review', async () => {
  const requests = [];
  const statuses = [
    { state: 'processing', jobId: 'job_456', reviewId: DEMO_REVIEW.reviewId },
    { state: 'ready', jobId: 'job_456', reviewId: DEMO_REVIEW.reviewId },
  ];
  const client = createUploadClient({ endpoint: 'https://review.example.test/api', fallback: DEMO_REVIEW, pollIntervalMs: 0, sleep: async () => {}, fetchImpl: async (url, init) => {
    requests.push({ url, init });
    if (requests.length === 1) return jsonResponse({ jobId: 'job_456', reviewId: DEMO_REVIEW.reviewId, state: 'queued' }, 202);
    if (requests.length <= 3) return jsonResponse(statuses[requests.length - 2]);
    return jsonResponse({ reviewId: DEMO_REVIEW.reviewId, state: 'ready', review: DEMO_REVIEW });
  } });
  const progress = [];
  let accepted = 0;
  const result = await client.createGitHubReview({ repositoryUrl: 'https://github.com/octo-org/northstar.git', ref: 'main', accessCode: 'git-secret' }, { onAccepted: () => { accepted += 1; }, onState: (state) => progress.push(state.state) });
  assert.equal(result.review.reviewId, DEMO_REVIEW.reviewId);
  assert.deepEqual(progress, ['uploading', 'processing', 'ready', 'processing', 'ready']);
  assert.equal(requests[0].url, 'https://review.example.test/api/git-reviews');
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(requests[0].init.headers['Content-Type'], 'application/json');
  assert.equal(requests[0].init.headers['x-review-access-code'], 'git-secret');
  assert.deepEqual(JSON.parse(requests[0].init.body), { repositoryUrl: 'https://github.com/octo-org/northstar.git', ref: 'main' });
  assert.equal(accepted, 1);
  assert.equal(requests[1].url, 'https://review.example.test/api/jobs/job_456');
  assert.equal(requests[3].url, `https://review.example.test/api/reviews/${DEMO_REVIEW.reviewId}`);
  for (const request of requests) assert.equal(request.url.includes('northstar'), false);
});

test('GitHub intake reports malformed acceptance and rate limits without leaking URL data', async () => {
  const malformed = createUploadClient({ endpoint: 'https://review.example.test/api', fallback: DEMO_REVIEW, fetchImpl: async () => jsonResponse({ jobId: 'job_456', reviewId: DEMO_REVIEW.reviewId }) });
  await assert.rejects(() => malformed.createGitHubReview({ repositoryUrl: 'https://github.com/octo-org/northstar.git' }), (error) => error.code === 'invalid-response');
  const limited = createUploadClient({ endpoint: 'https://review.example.test/api', fallback: DEMO_REVIEW, fetchImpl: async () => new Response(null, { status: 429 }) });
  await assert.rejects(() => limited.createGitHubReview({ repositoryUrl: 'https://github.com/octo-org/northstar.git' }), (error) => error.code === 'rate-limited');
});

test('the re-rendered upload form delegates file presence validation to retained application state', async () => {
  const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(source, /id="upload-form" novalidate/u);
  assert.doesNotMatch(source, /id="zip-file"[^>]*\srequired(?:\s|\/?>)/u);
});

test('review access code is rendered as an in-memory-only field', async () => {
  const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(source, /id="review-access-code"[^>]*type="password"[^>]*autocomplete="off"/u);
  assert.match(source, /onAccepted: \(\) => \{ reviewAccessCode = ''; \}/u);
  assert.match(source, /unauthorized.*conflict.*network-error/su);
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie/u);
});

test('live demo questions stay on the demo review client when upload API wiring is also present', async () => {
  const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(source, /activeReviewMode = reviewClient\.mode === 'live' \? 'demo' : 'fixture'/u);
  assert.match(source, /const questionClient = activeReviewMode === 'upload' \? uploadClient : reviewClient/u);
  assert.match(source, /activeReviewMode === 'upload' \? uploadClient\.askQuestion\(fixture\.reviewId, question\) : reviewClient\.askQuestion\(question\)/u);
});

test('job response validators require opaque IDs and ready review IDs', () => {
  assert.equal(isAcceptedJob({ jobId: 'job_123' }), true);
  assert.equal(isAcceptedJob({ jobId: '../source.zip' }), false);
  assert.equal(isJobStatus({ state: 'processing', jobId: 'job_123', reviewId: 'review_123' }), true);
  assert.equal(isJobStatus({ state: 'ready' }), false);
  assert.equal(isJobStatus({ state: 'ready', jobId: 'job_123', reviewId: 'review_123' }), true);
  assert.equal(isJobStatus({ state: 'ready', jobId: 'job_123', reviewId: '../source.zip' }), false);
});

test('fixture mode validates the ZIP but never sends repository contents', async () => {
  let called = false;
  const client = createUploadClient({ fallback: DEMO_REVIEW, fetchImpl: async () => { called = true; }, sleep: async () => {} });
  const progress = [];
  const result = await client.uploadAndPoll(file(), { onState: (state) => progress.push(state.state) });
  assert.equal(client.mode, 'fixture');
  assert.equal(result.review.reviewId, DEMO_REVIEW.reviewId);
  assert.deepEqual(progress, ['ready']);
  assert.equal(called, false);
});

test('fixture-mode demo exploration never sends an access code or starts a live review', async () => {
  let called = false;
  const client = createUploadClient({ fallback: DEMO_REVIEW, fetchImpl: async () => { called = true; } });
  const result = await client.createGitHubReview({ repositoryUrl: 'https://github.com/octo-org/northstar', accessCode: 'demo-secret' });
  assert.equal(result.mode, 'fixture');
  assert.equal(called, false);
});

test('live upload sends raw ZIP bytes, polls only the opaque job URL, then loads the review', async () => {
  const requests = [];
  const statuses = [
    { state: 'queued', jobId: 'job_123', reviewId: DEMO_REVIEW.reviewId },
    { state: 'processing', jobId: 'job_123', reviewId: DEMO_REVIEW.reviewId },
    { state: 'ready', jobId: 'job_123', reviewId: DEMO_REVIEW.reviewId },
  ];
  const client = createUploadClient({ endpoint: 'https://review.example.test/api', fallback: DEMO_REVIEW, pollIntervalMs: 0, sleep: async () => {}, fetchImpl: async (url, init) => {
    requests.push({ url, init });
    if (requests.length === 1) return jsonResponse({ jobId: 'job_123' }, 202);
    if (requests.length <= 4) return jsonResponse(statuses[requests.length - 2]);
    return jsonResponse({ reviewId: DEMO_REVIEW.reviewId, state: 'ready', review: DEMO_REVIEW });
  } });
  const progress = [];
  let accepted = 0;
  const result = await client.uploadAndPoll(file(), { accessCode: 'zip-secret', onAccepted: () => { accepted += 1; }, onState: (state) => progress.push(state.state) });
  assert.equal(result.review.reviewId, DEMO_REVIEW.reviewId);
  assert.deepEqual(progress, ['uploading', 'queued', 'processing', 'ready', 'processing', 'ready']);
  assert.equal(requests[0].url, 'https://review.example.test/api/reviews');
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(requests[0].init.headers['Content-Type'], 'application/zip');
  assert.equal(requests[0].init.headers['x-review-access-code'], 'zip-secret');
  assert.equal(requests[0].init.body.name, 'repo.zip');
  assert.equal(accepted, 1);
  assert.equal(requests[1].url, 'https://review.example.test/api/jobs/job_123');
  assert.equal(requests[2].url, 'https://review.example.test/api/jobs/job_123');
  assert.equal(requests[3].url, 'https://review.example.test/api/jobs/job_123');
  assert.equal(requests[4].url, `https://review.example.test/api/reviews/${DEMO_REVIEW.reviewId}`);
  for (const request of requests) assert.equal(request.url.includes('source.zip'), false);
});

test('live ZIP and Git intake map access failures without exposing response bodies', async () => {
  for (const [status, code] of [[401, 'unauthorized'], [409, 'conflict'], [429, 'rate-limited']]) {
    const zipClient = createUploadClient({ endpoint: 'https://review.example.test/api', fallback: DEMO_REVIEW, fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'private backend detail' } }), { status }) });
    await assert.rejects(() => zipClient.uploadAndPoll(file(), { accessCode: 'secret' }), (error) => error.code === code && !error.message.includes('private backend detail'));
    const gitClient = createUploadClient({ endpoint: 'https://review.example.test/api', fallback: DEMO_REVIEW, fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'private backend detail' } }), { status }) });
    await assert.rejects(() => gitClient.createGitHubReview({ repositoryUrl: 'https://github.com/octo-org/northstar', accessCode: 'secret' }), (error) => error.code === code && !error.message.includes('private backend detail'));
  }
});

test('polling is bounded and stops on failed, expired, deleted, and malformed jobs', async () => {
  for (const [status, code] of [['failed', 'failed'], ['expired', 'expired'], ['deleted', 'deleted']]) {
    const terminalCode = status === 'failed' ? 'REVIEW_FAILED' : status === 'expired' ? 'REVIEW_EXPIRED' : 'REVIEW_DELETED';
    const terminalStatus = status === 'failed' ? 422 : 410;
    const client = createUploadClient({ endpoint: 'https://review.example.test/api', fallback: DEMO_REVIEW, maxPollAttempts: 3, sleep: async () => {}, fetchImpl: async (url, init) => url.endsWith('/api/reviews') ? jsonResponse({ jobId: 'job_123' }, 202) : jsonResponse({ error: { code: terminalCode } }, terminalStatus) });
    await assert.rejects(() => client.uploadAndPoll(file()), (error) => error.code === code);
  }
  const rateLimited = createUploadClient({ endpoint: 'https://review.example.test/api', fallback: DEMO_REVIEW, fetchImpl: async () => new Response(null, { status: 429 }) });
  await assert.rejects(() => rateLimited.uploadAndPoll(file()), (error) => error.code === 'rate-limited');
  let polls = 0;
  const bounded = createUploadClient({ endpoint: 'https://review.example.test/api', fallback: DEMO_REVIEW, maxPollAttempts: 2, sleep: async () => {}, fetchImpl: async (url) => { if (url.endsWith('/api/reviews')) return jsonResponse({ jobId: 'job_123' }, 202); polls += 1; return jsonResponse({ state: 'processing', jobId: 'job_123', reviewId: 'review_123' }); } });
  await assert.rejects(() => bounded.uploadAndPoll(file()), (error) => error.code === 'poll-timeout');
  assert.equal(polls, 2);
  const malformed = createUploadClient({ endpoint: 'https://review.example.test/api', fallback: DEMO_REVIEW, fetchImpl: async (url) => url.endsWith('/api/reviews') ? jsonResponse({ jobId: 'job_123' }, 202) : jsonResponse({ state: 'ready' }) });
  await assert.rejects(() => malformed.uploadAndPoll(file()), (error) => error.code === 'invalid-response');
});

test('completed review deletion uses DELETE and fixture deletion is a no-op', async () => {
  const requests = [];
  const client = createUploadClient({ endpoint: 'https://review.example.test/api', fallback: DEMO_REVIEW, fetchImpl: async (url, init) => { requests.push({ url, init }); return new Response(null, { status: 204 }); } });
  assert.deepEqual(await client.deleteReview('review_123'), { deleted: true, mode: 'live' });
  assert.equal(requests[0].url, 'https://review.example.test/api/reviews/review_123');
  assert.equal(requests[0].init.method, 'DELETE');
  const fixtureClient = createUploadClient({ fallback: DEMO_REVIEW });
  assert.deepEqual(await fixtureClient.deleteReview(DEMO_REVIEW.reviewId), { deleted: false, mode: 'fixture' });
});

test('upload client keeps questions on the review URL after an uploaded review is ready', async () => {
  const requests = [];
  const answer = { id: 'answer-2', question: 'Where?', answer: 'Here.', confidence: 'medium', citations: [{ path: 'src/main.ts', language: 'TypeScript', lineStart: 1, lineEnd: 2, excerpt: 'export {}', reason: 'Entry point.' }] };
  const client = createUploadClient({ endpoint: 'https://review.example.test/api', fallback: DEMO_REVIEW, fetchImpl: async (url, init) => { requests.push({ url, init }); return jsonResponse({ reviewId: 'review_123', answer }); } });
  assert.deepEqual(await client.askQuestion('review_123', 'Where?'), answer);
  assert.equal(requests[0].url, 'https://review.example.test/api/reviews/review_123/questions');
  assert.deepEqual(JSON.parse(requests[0].init.body), { reviewId: 'review_123', question: 'Where?' });
});

test('aborting a live poll exits without another request', async () => {
  const controller = new AbortController();
  let polls = 0;
  const client = createUploadClient({ endpoint: 'https://review.example.test/api', fallback: DEMO_REVIEW, pollIntervalMs: 0, sleep: async () => { controller.abort(); }, fetchImpl: async (url) => { polls += 1; return url.endsWith('/api/reviews') ? jsonResponse({ jobId: 'job_123' }, 202) : jsonResponse({ state: 'processing', jobId: 'job_123', reviewId: 'review_123' }); } });
  await assert.rejects(() => client.uploadAndPoll(file(), { signal: controller.signal }), (error) => error.code === 'aborted');
  assert.equal(polls, 2);
});
