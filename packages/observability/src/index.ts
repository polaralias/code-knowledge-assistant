export type HttpMethod = "DELETE" | "GET" | "OTHER" | "POST";
export type RouteTemplate =
  | "/"
  | "/api/git-reviews"
  | "/api/jobs/:jobId"
  | "/api/reviews"
  | "/api/reviews/:reviewId"
  | "/api/reviews/:reviewId/questions"
  | "/api/reviews/demo"
  | "/api/reviews/demo/questions"
  | "/healthz"
  | "/readyz"
  | "/src/app.js"
  | "/src/fixtures.js"
  | "/src/live-client.js"
  | "/src/state-view.js"
  | "/src/upload-client.js"
  | "/styles.css"
  | "unmatched";

export type OperationalEvent =
  | {
      event: "http.request.completed";
      method: HttpMethod;
      route: RouteTemplate;
      status: number;
      durationMs: number;
    }
  | {
      event: "review.expiry.completed";
      outcome: "failure" | "success";
      expiredCount: number;
      durationMs: number;
    }
  | {
      event: "review.pipeline.progress";
      source: "git" | "zip";
      phase: "acquire" | "inventory" | "snapshot" | "analysis" | "generation";
      state: "started" | "completed" | "failed";
      files: number;
      excludedFiles: number;
      bytes: number;
      durationMs: number;
      errorCode: string | null;
    };

export type OperationalMetrics = Readonly<{
  httpRequests: number;
  httpErrors: number;
  httpDurationMs: number;
  expirySweeps: number;
  expirySweepFailures: number;
  expiredReviews: number;
}>;

export type OperationalTelemetry = {
  record(event: OperationalEvent): void;
  routeTemplate(rawPath: string): RouteTemplate;
  snapshot(): OperationalMetrics;
};

export class OperationalTelemetryError extends Error {
  readonly code: "TELEMETRY_CLOCK_INVALID" | "TELEMETRY_EVENT_INVALID";

  constructor(code: OperationalTelemetryError["code"]) {
    super(code);
    this.name = "OperationalTelemetryError";
    this.code = code;
  }
}

const SCHEMA = "code-knowledge-assistant.telemetry.v1";
const METHODS = new Set(["DELETE", "GET", "OTHER", "POST"]);
const STATIC_ROUTES = new Set<RouteTemplate>([
  "/", "/api/git-reviews", "/api/reviews", "/api/reviews/demo", "/api/reviews/demo/questions",
  "/healthz", "/readyz", "/src/app.js", "/src/fixtures.js", "/src/live-client.js",
  "/src/state-view.js", "/src/upload-client.js", "/styles.css",
]);
const ROUTE_TEMPLATES = new Set<RouteTemplate>([
  ...STATIC_ROUTES,
  "/api/jobs/:jobId",
  "/api/reviews/:reviewId",
  "/api/reviews/:reviewId/questions",
  "unmatched",
]);
const IDENTIFIER = "[A-Za-z0-9][A-Za-z0-9_-]{0,127}";
const JOB_ROUTE = new RegExp(`^/api/jobs/${IDENTIFIER}$`, "u");
const REVIEW_ROUTE = new RegExp(`^/api/reviews/${IDENTIFIER}$`, "u");
const QUESTION_ROUTE = new RegExp(`^/api/reviews/${IDENTIFIER}/questions$`, "u");

function isBoundedInteger(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum;
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}

export function classifyRoute(rawPath: string): RouteTemplate {
  let pathname: string;
  try {
    pathname = new URL(rawPath, "http://local.invalid").pathname;
  } catch {
    return "unmatched";
  }
  if (STATIC_ROUTES.has(pathname as RouteTemplate)) return pathname as RouteTemplate;
  if (JOB_ROUTE.test(pathname)) return "/api/jobs/:jobId";
  if (QUESTION_ROUTE.test(pathname)) return "/api/reviews/:reviewId/questions";
  if (REVIEW_ROUTE.test(pathname)) return "/api/reviews/:reviewId";
  return "unmatched";
}

export function createOperationalTelemetry(input: {
  write(record: string): void;
  now?: () => Date;
}): OperationalTelemetry {
  const now = input.now ?? (() => new Date());
  const metrics = {
    httpRequests: 0,
    httpErrors: 0,
    httpDurationMs: 0,
    expirySweeps: 0,
    expirySweepFailures: 0,
    expiredReviews: 0,
  };

  function timestamp(): string {
    const value = now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new OperationalTelemetryError("TELEMETRY_CLOCK_INVALID");
    return value.toISOString();
  }

  function record(event: OperationalEvent): void {
    let output: Record<string, string | number | null>;
    if (typeof event !== "object" || event === null) throw new OperationalTelemetryError("TELEMETRY_EVENT_INVALID");
    if (event.event === "http.request.completed") {
      if (!exactKeys(event, ["durationMs", "event", "method", "route", "status"])
        || !METHODS.has(event.method) || !ROUTE_TEMPLATES.has(event.route)
        || !isBoundedInteger(event.status, 599) || event.status < 100
        || !isBoundedInteger(event.durationMs, 86_400_000)) {
        throw new OperationalTelemetryError("TELEMETRY_EVENT_INVALID");
      }
      const recordedAt = timestamp();
      metrics.httpRequests += 1;
      metrics.httpErrors += event.status >= 400 ? 1 : 0;
      metrics.httpDurationMs += event.durationMs;
      output = {
        schema: SCHEMA,
        timestamp: recordedAt,
        event: event.event,
        method: event.method,
        route: event.route,
        status: event.status,
        outcome: event.status >= 400 ? "failure" : "success",
        duration_ms: event.durationMs,
      };
    } else if (event.event === "review.expiry.completed") {
      if (!exactKeys(event, ["durationMs", "event", "expiredCount", "outcome"])
        || !["failure", "success"].includes(event.outcome)
        || !isBoundedInteger(event.expiredCount, 1_000_000)
        || !isBoundedInteger(event.durationMs, 86_400_000)) {
        throw new OperationalTelemetryError("TELEMETRY_EVENT_INVALID");
      }
      const recordedAt = timestamp();
      metrics.expirySweeps += 1;
      metrics.expirySweepFailures += event.outcome === "failure" ? 1 : 0;
      metrics.expiredReviews += event.expiredCount;
      output = {
        schema: SCHEMA,
        timestamp: recordedAt,
        event: event.event,
        outcome: event.outcome,
        expired_count: event.expiredCount,
        duration_ms: event.durationMs,
      };
    } else if (event.event === "review.pipeline.progress") {
      if (!exactKeys(event, ["bytes", "durationMs", "errorCode", "event", "excludedFiles", "files", "phase", "source", "state"])
        || !["git", "zip"].includes(event.source) || !["acquire", "inventory", "snapshot", "analysis", "generation"].includes(event.phase)
        || !["started", "completed", "failed"].includes(event.state)
        || !isBoundedInteger(event.files, 1_000_000) || !isBoundedInteger(event.excludedFiles, 1_000_000)
        || !isBoundedInteger(event.bytes, 1_000_000_000_000) || !isBoundedInteger(event.durationMs, 86_400_000)
        || (event.errorCode !== null && (typeof event.errorCode !== "string" || !/^[A-Z][A-Z0-9_]{0,79}$/u.test(event.errorCode)))) {
        throw new OperationalTelemetryError("TELEMETRY_EVENT_INVALID");
      }
      const recordedAt = timestamp();
      output = {
        schema: SCHEMA,
        timestamp: recordedAt,
        event: event.event,
        source: event.source,
        phase: event.phase,
        state: event.state,
        files: event.files,
        excluded_files: event.excludedFiles,
        bytes: event.bytes,
        duration_ms: event.durationMs,
        error_code: event.errorCode,
      };
    } else {
      throw new OperationalTelemetryError("TELEMETRY_EVENT_INVALID");
    }
    try {
      input.write(JSON.stringify(output));
    } catch {
      // Telemetry is deliberately best-effort and cannot alter application behavior.
    }
  }

  return Object.freeze({
    record,
    routeTemplate: classifyRoute,
    snapshot: () => Object.freeze({ ...metrics }),
  });
}
