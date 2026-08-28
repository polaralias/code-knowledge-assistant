import path from 'node:path';

import { createAccessController } from '@code-knowledge-assistant/access-control';
import { createOperationalTelemetry } from '@code-knowledge-assistant/observability';
import { parseHostedAccessCodes } from '../apps/api/src/hosted-config.ts';
import { buildUploadReviewServer } from '../apps/api/src/runtime.ts';

const dataRoot = path.resolve(process.env.DATA_ROOT || '/var/lib/code-atlas');
const webRoot = path.resolve('apps/web');
const host = process.env.HOST || '0.0.0.0';
const requestedPort = Number(process.env.PORT || 4173);
const accessCodes = parseHostedAccessCodes(process.env.REVIEW_ACCESS_CODES_JSON);
const demoReviewArtifactPath = process.env.DEMO_REVIEW_ARTIFACT_PATH === ''
  ? undefined
  : path.resolve(process.env.DEMO_REVIEW_ARTIFACT_PATH || 'demo/uptime-kuma-demo.json');

if (!Number.isSafeInteger(requestedPort) || requestedPort < 1 || requestedPort > 65_535) {
  throw new Error('PORT_INVALID');
}

const telemetry = createOperationalTelemetry({ write: (record) => process.stdout.write(`${record}\n`) });
const accessControl = createAccessController({ root: path.join(dataRoot, 'access-control'), accessCodes });
const server = await buildUploadReviewServer({
  dataRoot,
  webRoot,
  telemetry,
  accessControl,
  demoReviewArtifactPath,
  demoReviewMetadata: {
    name: 'uptime-kuma',
    owner: 'louislam',
    branch: 'pinned snapshot',
    displayRevision: 'fcc51ebf4666',
  },
});
server.listen(requestedPort, host, () => {
  process.stdout.write(`Code Atlas upload review listening on ${host}:${requestedPort}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
