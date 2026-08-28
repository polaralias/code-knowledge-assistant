# Review API

The dependency-free local server builds a real review from a materialized repository, serves the browser workspace from the same localhost origin, and exposes the validated review and cited-question routes.

```text
node apps/api/src/start.ts eval/fixtures/typescript-service 4174
```

Open `http://127.0.0.1:4174/`. The default repository is the checked TypeScript evaluation fixture. A different materialized repository path may be supplied as the first argument; content is inventoried and analyzed but never executed.

Current routes:

- `GET /api/reviews/demo`
- `POST /api/reviews/demo/questions`
- `POST /api/reviews` (bounded ZIP upload)
- `POST /api/git-reviews` (public GitHub URL plus optional ref)
- `GET /api/jobs/:jobId`
- `GET /api/reviews/:reviewId`
- `POST /api/reviews/:reviewId/questions`
- `DELETE /api/reviews/:reviewId`

The upload and Git routes persist body-free job state and completed review artifacts under the configured data root. The service never executes submitted repository content, and the public Git route only accepts credential-free GitHub HTTPS URLs. Authentication/access-code gating, persistent abuse controls, provider-backed generation, and hosted object/database adapters remain outside the current deployment-shaped boundary.
