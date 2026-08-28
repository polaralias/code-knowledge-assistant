import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_REVIEW, isReviewFixture, withReviewState } from '../src/fixtures.js';
import { getStateCopy } from '../src/state-view.js';

test('demo review satisfies the browser fixture boundary', () => {
  assert.equal(isReviewFixture(DEMO_REVIEW), true);
  assert.equal(DEMO_REVIEW.state, 'ready');
  assert.ok(DEMO_REVIEW.repository.name);
  assert.ok(DEMO_REVIEW.documents.length >= 3);
  assert.ok(DEMO_REVIEW.chatExamples.every((example) => example.citations.length > 0));
});

test('fixture states remain explicit and do not mutate the ready fixture', () => {
  for (const state of ['loading', 'empty', 'failure', 'network-error', 'invalid-response', 'expired', 'abuse-limit']) {
    const next = withReviewState(DEMO_REVIEW, state);
    assert.equal(next.state, state);
    assert.equal(DEMO_REVIEW.state, 'ready');
    assert.equal(next.reviewId, DEMO_REVIEW.reviewId);
  }
});

test('malformed fixture values are rejected', () => {
  assert.equal(isReviewFixture(null), false);
  assert.equal(isReviewFixture({ reviewId: 'bad', state: 'ready' }), false);
  assert.equal(isReviewFixture({ ...DEMO_REVIEW, state: 'unknown' }), false);
  assert.equal(isReviewFixture({ ...DEMO_REVIEW, documents: undefined }), false);
});

test('evidence spans contain enough provenance for inspection', () => {
  for (const answer of DEMO_REVIEW.chatExamples) {
    for (const citation of answer.citations) {
      assert.ok(citation.path.includes('/'));
      assert.ok(citation.lineStart > 0);
      assert.ok(citation.lineEnd >= citation.lineStart);
      assert.ok(citation.excerpt.length > 0);
      assert.ok(citation.reason.length > 0);
    }
  }
});

test('every non-ready state has deliberate user-facing copy', () => {
  for (const state of ['loading', 'empty', 'failure', 'network-error', 'invalid-response', 'expired', 'abuse-limit']) {
    const copy = getStateCopy(state);
    assert.ok(copy.title);
    assert.ok(copy.body);
    assert.ok(copy.icon);
    if (state !== 'loading' && state !== 'empty') assert.ok(copy.action);
  }
});
