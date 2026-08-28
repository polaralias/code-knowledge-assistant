import path from "node:path";

import { createAccessController } from "@code-knowledge-assistant/access-control";
import { createOperationalTelemetry } from "@code-knowledge-assistant/observability";

import { parseHostedAccessCodes } from "./hosted-config.ts";
import { buildUploadReviewServer } from "./runtime.ts";

const dataRoot = path.resolve(process.argv[2] ?? process.env.DATA_ROOT ?? ".local-data");
const requestedPort = Number(process.argv[3] ?? process.env.PORT ?? 4174);
const requestedHost = process.env.HOST ?? "127.0.0.1";
const accessCodes = parseHostedAccessCodes(process.env.REVIEW_ACCESS_CODES_JSON);
if (!Number.isSafeInteger(requestedPort) || requestedPort < 1 || requestedPort > 65_535) {
  throw new Error("PORT_INVALID");
}
if (!["127.0.0.1", "0.0.0.0", "::1"].includes(requestedHost)) throw new Error("HOST_INVALID");

const server = await buildUploadReviewServer({
  dataRoot,
  webRoot: path.resolve("apps/web"),
  telemetry: createOperationalTelemetry({ write: (record) => process.stdout.write(`${record}\n`) }),
  accessControl: createAccessController({ root: path.join(dataRoot, "access-control"), accessCodes }),
});
server.listen(requestedPort, requestedHost, () => {
  process.stdout.write(`Code Atlas upload review listening on ${requestedHost}:${requestedPort}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
