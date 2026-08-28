# Code Atlas review workspace

This is a dependency-free browser workspace for the pre-indexed and live repository review journeys. Open `index.html` from a static server, or run any local server from `apps/web`:

```sh
python -m http.server 4173
```

Then visit `http://localhost:4173`.

## Fixture-to-live API seam

`src/fixtures.js` is the typed (JSDoc) boundary consumed by the UI. The live adapter returns the same `ReviewFixture` shape:

```js
{
  reviewId,
  state: 'ready' | 'loading' | 'empty' | 'failure' | 'network-error' | 'invalid-response' | 'expired' | 'abuse-limit',
  repository,
  status,
  capability,
  coverage,
  documents,
  uncertainty,
  prompts,
  chatExamples,
  limits
}
```

The view does not know how a review was produced. The live adapter fetches the review envelope and maps question responses into the same `answer` and `citations` fields. Evidence citations require `path`, `lineStart`, `lineEnd`, `excerpt`, and `reason` so inspection remains possible without provider-specific data.

### HTTP contract

When the endpoint meta tag is non-empty, the browser performs:

```http
GET /api/reviews/demo
Accept: application/json
```

The configured endpoint is used verbatim as the review resource URL after validation. It must be an `http` or `https` URL with no query, hash, username, or password. The server returns a JSON `ReviewFixture` envelope. `404` maps to `empty`, `410` to `expired`, `429` to `abuse-limit`, non-2xx responses to `failure`, a network failure to `network-error`, and a JSON body that fails validation to `invalid-response`.

Questions use the same endpoint plus `/questions` and never put source paths or credentials in the URL:

```http
POST /api/reviews/demo/questions
Accept: application/json
Content-Type: application/json

{"reviewId":"rev_7f3c2a","question":"Where is retry policy defined?"}
```

The response must be a `ChatExample` object containing `id`, `question`, `answer`, `confidence` (`high`, `medium`, or `low`), and a `citations` array. Every citation must contain `path`, `language`, positive `lineStart`, `lineEnd` greater than or equal to `lineStart`, `excerpt`, and `reason`. Invalid responses are rejected before they reach the UI. `410`, `429`, and failed requests return explicit error codes for the expired, abuse-limit, and network-error states.

### ZIP and Git upload/progress contract

Set `meta[name="code-atlas-api-base"]` to a query-free API base such as `/api`. The upload client sends raw bytes and performs no repository-content read, persistence, or URL encoding:

```http
POST /api/reviews
Accept: application/json
Content-Type: application/zip

<raw ZIP bytes>
```

The server returns `{ "jobId": "opaque-job-id", "reviewId": "opaque-review-id", "state": "queued" }`. The client polls only the opaque job endpoint, at most 20 times by default:

```http
GET /api/jobs/:jobId
Accept: application/json
```

The response must be `{ "jobId": "opaque-job-id", "reviewId": "opaque-review-id", "state": "queued" | "processing" | "ready" | "failed" | "expired" | "deleted" }`. A ready response must include `reviewId`. The client stops polling at every terminal status and, for ready, loads `GET /api/reviews/:reviewId` using the existing `ReviewFixture` contract. `DELETE /api/reviews/:reviewId` is available for terminal cleanup. Job and review IDs are restricted to opaque URL-safe IDs; source paths and credentials are never placed in URLs, logs, or browser storage.

Public Git intake uses the same polling and review contract:

```http
POST /api/git-reviews
Accept: application/json
Content-Type: application/json

{"repositoryUrl":"https://github.com/org/repository","ref":"main"}
```

Only `repositoryUrl` and optional `ref` are accepted. The server remains authoritative for credential-free GitHub URL, ref, transport, revision, and repository-size validation. The UI does not persist the URL, ref, source content, or credentials.

Client-side checks reject non-`.zip`, empty, and over-limit files before upload. The server remains authoritative. Progress states are queued, uploading, processing, ready, failed, expired, deleted, and rate-limited, with network and invalid-response recovery states. When the API base meta tag is empty, valid ZIP submissions open the retained fixture and never issue a request.

The state selector is a development affordance for checking loading, empty, failure, expired, and abuse-limit UI. It is not a product control. The upload dialog is available from the `New review` action and exposes ZIP/Git client preflight and polling states.

## Checks

No install is required for the local contract checks:

```sh
node --test tests/*.test.mjs
```
