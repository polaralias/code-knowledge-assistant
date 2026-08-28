# Railway operator runbook

## Purpose and scope

This runbook covers the single-replica Railway reference deployment of Code Atlas. It assumes the repository Dockerfile and `railway.toml` are the release inputs and that the service is deployed behind an HTTPS Railway domain. The service accepts bounded ZIP uploads and public GitHub review requests; access-code and abuse controls must be enabled before a public demonstration.

## Required service configuration

Set these Railway variables:

- `HOST=0.0.0.0`
- `PORT` supplied by Railway (do not hard-code a competing listener)
- `DATA_ROOT=/var/lib/code-atlas`
- `REVIEW_ACCESS_CODES_JSON` as a JSON array of operator-issued codes, stored as an encrypted Railway variable, for example `["replace-me"]`

Attach one persistent Railway volume at `/var/lib/code-atlas`. Do not mount over `/app`. The volume contains the body-free lifecycle metadata, source objects, completed artifacts, workspaces, owned uploads, and access-control ledger. Keep the service at one replica while it uses filesystem-backed coordination.

Do not put access codes in the repository, Dockerfile, command-line arguments, smoke URL, or telemetry. Rotate the encrypted variable when an operator-issued code is retired.

## Deploy and verify

1. Confirm the target service, volume mount, encrypted variables, and intended image revision in the Railway deployment view.
2. Deploy through the approved Railway pipeline using the repository Dockerfile. Wait for the service health check to become healthy.
3. Verify liveness and readiness:

   ```sh
   curl --fail --silent https://SERVICE_DOMAIN/healthz
   curl --fail --silent https://SERVICE_DOMAIN/readyz
   ```

4. Run the bounded post-deploy smoke. Supply the access code only through the environment; it must not appear in shell history or command arguments:

   ```sh
   SMOKE_ACCESS_CODE="$REVIEW_CODE" \
   SMOKE_REPOSITORY_URL="https://github.com/louislam/uptime-kuma" \
   SMOKE_REPOSITORY_REF="fcc51ebf4666121d18adbf09523b3aefda3576c9" \
   node deploy/smoke.mjs https://SERVICE_DOMAIN
   ```

   The command verifies health, readiness, a Git review start, bounded polling to `ready`, review retrieval, a cited question when the route is supported, deletion, and a terminal `404`/`410` response. It prints only step names and stable result codes.

5. Remove the smoke access code from the invoking environment after the run. Treat any `SMOKE_FAILED step=... code=...` result as a failed deployment gate; investigate with service telemetry and status metadata, not source or response-body logging.

## Restart and persistence verification

Run the smoke once, record only its pass/fail result and deployment revision, restart the Railway service, then repeat the health/readiness checks and smoke with a newly issued or still-authorised operator code. Confirm that the restarted service can create, poll, retrieve, and delete a review. A restart must not require rebuilding or replacing the volume. If metadata disappears, stop public access and roll back to the last verified revision while preserving the volume for investigation.

## Deletion and expiry checks

The smoke verifies explicit deletion and the expected terminal response. For a controlled expiry check, use a non-public staging deployment with a deliberately short, approved lease/retention configuration, create one review, wait for the configured expiry under the staging procedure, and verify the terminal API state and removal of owned objects. Do not shorten production retention as an ad hoc test. Review expiry telemetry should show a completed sweep and no body content.

## Telemetry and incident handling

Inspect structured service telemetry for route templates, status, duration, review lifecycle, and expiry-sweep outcomes. Telemetry and incident notes must contain stable codes and opaque identifiers only; never copy access codes, repository URLs containing credentials, response bodies, uploaded source, or local paths. A readiness failure, repeated access-control failure, persistence loss, or unexpected expiry is a release blocker.

## Rollback

1. Stop or restrict public traffic if the smoke or readiness check fails.
2. Record the failed revision and stable smoke step/code.
3. Redeploy the last verified image through the approved Railway rollback path, retaining the `/var/lib/code-atlas` volume.
4. Re-run `/healthz`, `/readyz`, and the exact smoke command with an operator-issued code.
5. If state corruption or data loss is suspected, keep the service restricted and preserve the volume for operator investigation; do not delete it as a recovery shortcut.
