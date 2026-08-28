import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const deployRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(deployRoot, '..');
const read = (name) => readFile(resolve(repositoryRoot, name), 'utf8');

test('dockerignore excludes secrets, caches, and local data', async () => {
  const ignore = await read('.dockerignore');
  for (const pattern of ['.env', '.env.*', '**/.env.*', 'node_modules', '**/node_modules', '.cache', '**/.cache', 'coverage', '**/coverage', 'data', '**/data', 'local-data', '**/local-data']) {
    assert.match(ignore, new RegExp(`^${pattern.replaceAll('*', '\\*')}\\s*$`, 'm'), `missing ignore pattern: ${pattern}`);
  }
});

test('dockerfile declares a reproducible non-root runtime contract', async () => {
  const dockerfile = await read('Dockerfile');
  assert.match(dockerfile, /FROM node:24-bookworm-slim AS build/);
  assert.match(dockerfile, /corepack prepare pnpm@11\.24\.0 --activate/);
  assert.match(dockerfile, /FROM node:24-bookworm-slim AS runtime/);
  assert.match(dockerfile, /ENV NODE_ENV=production/);
  assert.match(dockerfile, /PORT=4173/);
  assert.match(dockerfile, /DATA_ROOT=\/var\/lib\/code-atlas/);
  assert.match(dockerfile, /HOST=0\.0\.0\.0/);
  assert.match(dockerfile, /chown node:node "\$DATA_ROOT"/);
  assert.doesNotMatch(dockerfile, /chown[^\n]*\/app/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /EXPOSE 4173/);
  assert.match(dockerfile, /HEALTHCHECK[\s\S]+\/healthz/);
  assert.match(dockerfile, /CMD \["node", "deploy\/start\.mjs"\]/);
  assert.match(dockerfile, /COPY demo \.\/demo/);
  assert.match(dockerfile, /COPY --from=build \/app\/demo \/app\/demo/);
});

test('production runtime includes the Git transport required by public repository intake', async () => {
  const dockerfile = await read('Dockerfile');
  assert.match(dockerfile, /apt-get install[^\n]*git/);
});

test('startup policy launches the application runtime and delegates health to the API', async () => {
  const startup = await read('deploy/start.mjs');
  assert.match(startup, /buildUploadReviewServer/);
  assert.match(startup, /\.\.\/apps\/api\/src\/runtime\.ts/);
  assert.match(startup, /process\.env\.DATA_ROOT/);
  assert.match(startup, /process\.env\.PORT/);
  assert.match(startup, /process\.env\.HOST/);
  assert.match(startup, /process\.env\.REVIEW_ACCESS_CODES_JSON/);
  assert.match(startup, /createAccessController/);
  assert.match(startup, /createOperationalTelemetry/);
  assert.match(startup, /buildUploadReviewServer\(\{/);
  assert.match(startup, /DEMO_REVIEW_ARTIFACT_PATH/);
  assert.match(startup, /uptime-kuma-demo\.json/);
  assert.match(startup, /name: 'uptime-kuma'/);
  assert.match(startup, /server\.listen\(requestedPort, host/);
  assert.match(startup, /SIGTERM/);
  const dockerfile = await read('Dockerfile');
  assert.match(dockerfile, /\/healthz/);
  assert.doesNotMatch(dockerfile, /deploy\/server\.mjs/);
});

test('Railway config is declarative, Dockerfile-backed, singleton, and volume-documented', async () => {
  const railway = await read('railway.toml');
  assert.match(railway, /builder = "DOCKERFILE"/);
  assert.match(railway, /dockerfilePath = "Dockerfile"/);
  assert.match(railway, /startCommand = "node deploy\/start\.mjs"/);
  assert.match(railway, /healthcheckPath = "\/healthz"/);
  assert.match(railway, /restartPolicyType = "ON_FAILURE"/);
  assert.match(railway, /restartPolicyMaxRetries = 3/);
  assert.match(railway, /numReplicas = 1/);
  assert.doesNotMatch(railway, /(TOKEN|PASSWORD|SECRET|API_KEY)\s*=/i);
  const docs = await read('deploy/README.md');
  assert.match(docs, /persistent volume mounted at `\/var\/lib\/code-atlas`/);
  assert.match(docs, /DATA_ROOT=\/var\/lib\/code-atlas/);
  assert.match(docs, /`\/readyz`/);
});
