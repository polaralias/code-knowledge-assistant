# Local container runtime

The root `Dockerfile` builds the actual upload/review API with Node 24, installs the workspace dependency graph from the frozen pnpm lockfile, and starts `buildUploadReviewServer` through `deploy/start.mjs` as the non-root `node` user. The API serves the `apps/web` assets and owns the ZIP upload, public GitHub intake, job polling, review, question, deletion, and expiry routes.

Build and run from the repository root:

```sh
docker build --tag code-atlas-local .
docker run --rm --publish 4173:4173 --env PORT=4173 --env DATA_ROOT=/var/lib/code-atlas --env 'REVIEW_ACCESS_CODES_JSON=["replace-with-a-secret-code"]' code-atlas-local
```

Check the runtime health endpoint:

```sh
curl --fail http://127.0.0.1:4173/healthz
```

The default port is `4173` and can be changed with `PORT`. The bind host defaults to `0.0.0.0` and can be changed with `HOST`. `DATA_ROOT` defaults to `/var/lib/code-atlas`; it is the only application-owned writable directory and contains incoming uploads, owned uploads, job metadata, source objects, access-control state, and rehydration workspaces. Mount a named volume there for a persistent local deployment. `REVIEW_ACCESS_CODES_JSON` is required and must be a non-empty JSON array supplied through the hosting secret store; startup fails closed when it is absent or malformed.

The image healthcheck calls the application `/healthz` route, exposes the default port, and stops cleanly on SIGTERM. The image bundles `demo/uptime-kuma-demo.json`; startup loads it by default and identifies the public view as the pinned Uptime Kuma snapshot. Set `DEMO_REVIEW_ARTIFACT_PATH` only when replacing the bundled artifact with another bounded local artifact; set it to an empty value to deliberately disable the demo. No external service, Railway project, credential, or deployment target is contacted by the image.

Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` as encrypted variables to enable the operator console at `/admin`; minted codes are stored as hashes under `DATA_ROOT` and shown in plaintext only once. Leave both unset to disable the console. Rotate the administrator password after the first deployment and keep it out of screenshots or shared demo links.

## Railway configuration

The root `railway.toml` selects the existing Dockerfile, starts `deploy/start.mjs`, uses `/healthz` for the service healthcheck, and limits this stateful service to one replica. Railway supplies `PORT`; leave `HOST=0.0.0.0` unless the service has a deliberate network-boundary requirement.

Railway volumes are attached to a service separately from this repository manifest. Create one persistent volume mounted at `/var/lib/code-atlas` and set `DATA_ROOT=/var/lib/code-atlas`. This directory is the only application-owned writable path and must persist across restarts because it contains upload objects, job metadata, access-control quotas, and review workspaces. Do not mount over `/app`.

The application exposes `/healthz` for liveness and `/readyz` for readiness checks. `/healthz` is the declarative Railway healthcheck because the API runtime is responsible for both routes. Set `REVIEW_ACCESS_CODES_JSON` through Railway's encrypted service variables and never place its values in repository files or logs. Operational events are emitted as body-safe JSONL to standard output. Provider secrets belong in Railway's encrypted service variables only after a model passes the evaluation gate. The current deployment is a single-replica filesystem reference service.

The hosted deterministic demo does not need an LLM key. For a live evaluation run, provide
`EVAL_PROVIDER_API_KEY` (or the compatibility alias `MODEL_PROVIDER_API_KEY`) only through a
local secret store or encrypted Railway variable, together with `EVAL_PROVIDER`,
`EVAL_PROVIDER_ENDPOINT`, `EVAL_PROVIDER_MODEL`, `EVAL_PROVIDER_REGION`, the bounded
`EVAL_MAX_*` values, and a positive `EVAL_USD_TO_GBP_RATE`. The approved private-source lane is
an Alibaba Cloud Model Studio Germany (Frankfurt) workspace key plus its workspace-specific
OpenAI-compatible endpoint. OpenRouter or direct DeepSeek keys are public-source comparison
options only; do not send private ZIP content through those routes. Embedding and reranking keys
are not needed because those components are not wired into the current runner.

Run deterministic policy checks without Docker or package installation:

```sh
node --test deploy/policy.test.mjs
```

## Integration notes

The coordinator should build from the repository root so `.dockerignore`, `apps/api`, `apps/web`, `packages`, `demo`, and `deploy/start.mjs` are in the build context. A hosting environment should set `PORT` to its assigned listener, leave `HOST=0.0.0.0` for container ingress, and mount `DATA_ROOT` for persistence. The API injects `/api` and `/api/reviews/demo` into the web app's existing HTML configuration when serving the root page.
