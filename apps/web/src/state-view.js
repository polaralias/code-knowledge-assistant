/** @typedef {'loading'|'empty'|'failure'|'network-error'|'invalid-response'|'expired'|'abuse-limit'} NonReadyState */

/** @type {Record<NonReadyState, { icon: string, title: string, body: string, action?: string }>} */
export const STATE_COPY = {
  loading: { icon: '...', title: 'Preparing the review', body: 'The snapshot is being inspected and its generated documents will appear here shortly.' },
  empty: { icon: '∅', title: 'No review is ready yet', body: 'Upload a repository snapshot or choose a pre-indexed fixture to begin. Nothing is hidden when there is no source to inspect.' },
  failure: { icon: '!', title: 'The review could not load', body: 'The retained snapshot is available, but its review documents could not be read. Try again, or inspect the source snapshot directly.', action: 'Try again' },
  'network-error': { icon: '!', title: 'The review service is unreachable', body: 'The live endpoint did not respond. Check the service and try again. The local fixture remains available when no endpoint is configured.', action: 'Try again' },
  'invalid-response': { icon: '{}', title: 'The review response is invalid', body: 'The live endpoint responded, but its envelope did not match the review contract. No partial answer was shown.', action: 'Try again' },
  expired: { icon: '↻', title: 'This review has expired', body: 'The source snapshot passed its retention window. Start a new review to ask questions against current source.', action: 'Start a new review' },
  'abuse-limit': { icon: '7', title: 'Question limit reached', body: 'This review has reached its question allowance. The review documents and cited evidence remain available while the allowance resets.', action: 'View documents' },
};

/** @param {NonReadyState} state */
export function getStateCopy(state) {
  return STATE_COPY[state];
}
