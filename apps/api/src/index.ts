import { createReadStream, createWriteStream } from "node:fs";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { HttpMethod, OperationalTelemetry } from "@code-knowledge-assistant/observability";

export type ReviewApiDependencies = {
  loadReview(): Promise<unknown>;
  answerQuestion(question: string, reviewId: string): Promise<unknown>;
};

export type ReviewJobState = "queued" | "processing" | "ready" | "failed" | "expired" | "deleted";

export type ReviewJobSnapshot = {
  jobId: string;
  reviewId: string;
  state: ReviewJobState;
};

export type ReviewUpload = {
  uploadPath: string;
  byteSize: number;
};

export type ReviewJobController = {
  createReview(upload: ReviewUpload): Promise<ReviewJobSnapshot>;
  createGitReview?(input: { repositoryUrl: string; ref?: string }): Promise<ReviewJobSnapshot>;
  getJob(jobId: string): Promise<ReviewJobSnapshot | null>;
  getReview(reviewId: string): Promise<{ state: ReviewJobState; review?: unknown } | null>;
  answerQuestion(reviewId: string, question: string): Promise<{ state: "answered"; answer: unknown } | { state: "rate-limited" } | { state: ReviewJobState } | null>;
  deleteReview(reviewId: string): Promise<{ state: "deleted" } | { state: "expired" } | { state: "failed" } | null>;
};

export type ReviewApiOptions = {
  webRoot?: string;
  maxRequestBytes?: number;
  reviewEndpoint?: string;
  reviewJobs?: ReviewJobController;
  maxUploadBytes?: number;
  uploadDirectory?: string;
  apiBaseEndpoint?: string;
  readiness?: () => Promise<boolean>;
  telemetry?: Pick<OperationalTelemetry, "record" | "routeTemplate">;
  monotonicNow?: () => number;
  accessControl?: {
    startReview(input: { accessCode: string }): Promise<{ leaseId: string }>;
    completeReview(leaseId: string): Promise<unknown>;
    releaseReview(leaseId: string): Promise<unknown>;
    recordQuestion(input: { clientSubject: string }): Promise<unknown>;
  };
  clientSubject?: (request: IncomingMessage) => string;
  admin?: { username: string; password: string; accessControl: {
    mintAccessCode(): Promise<{ id: string; code: string }>;
    revokeAccessCode(id: string): Promise<{ id: string; revoked: boolean }>;
    listAccessCodes(): Promise<readonly { id: string; createdAt: string; revoked: boolean }[]>;
  } };
};

export class ReviewApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "ReviewApiError";
    this.code = code;
    this.status = status;
  }
}

const STATIC_ROUTES = new Map<string, readonly [string, string]>([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/src/app.js", ["src/app.js", "text/javascript; charset=utf-8"]],
  ["/src/fixtures.js", ["src/fixtures.js", "text/javascript; charset=utf-8"]],
  ["/src/state-view.js", ["src/state-view.js", "text/javascript; charset=utf-8"]],
  ["/src/live-client.js", ["src/live-client.js", "text/javascript; charset=utf-8"]],
  ["/src/upload-client.js", ["src/upload-client.js", "text/javascript; charset=utf-8"]],
  ["/admin", ["admin.html", "text/html; charset=utf-8"]],
  ["/src/admin.js", ["src/admin.js", "text/javascript; charset=utf-8"]],
]);
const REVIEW_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && REVIEW_IDENTIFIER.test(value);
}

function pathIdentifier(route: string, prefix: string, suffix = ""): string | null {
  if (!route.startsWith(prefix) || !route.endsWith(suffix)) return null;
  const raw = route.slice(prefix.length, route.length - suffix.length);
  return validIdentifier(raw) ? raw : null;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const encoded = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(encoded),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(encoded);
}

function defaultClientSubject(request: IncomingMessage): string {
  const forwarded = request.headers["x-forwarded-for"];
  const real = request.headers["x-real-ip"];
  const candidate = typeof forwarded === "string" ? forwarded.split(",").at(-1)?.trim()
    : typeof real === "string" ? real.trim() : request.socket.remoteAddress;
  return candidate && isIP(candidate) ? candidate : "unknown-client";
}

function accessApiError(error: unknown): ReviewApiError | null {
  const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
  if (code === "ACCESS_CODE_INVALID") return new ReviewApiError("ACCESS_CODE_INVALID", 401);
  if (code === "REVIEW_ALREADY_ACTIVE") return new ReviewApiError("REVIEW_ALREADY_ACTIVE", 409);
  if (code === "REVIEW_START_LIMIT_EXCEEDED") return new ReviewApiError("REVIEW_START_LIMIT_EXCEEDED", 429);
  if (code === "QUESTION_LIMIT_EXCEEDED") return new ReviewApiError("QUESTION_RATE_LIMITED", 429);
  if (typeof code === "string" && (code.startsWith("ACCESS_") || code === "REVIEW_LEASE_INVALID")) {
    return new ReviewApiError("ACCESS_CONTROL_UNAVAILABLE", 503);
  }
  return null;
}

async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
  if (!(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
    throw new ReviewApiError("CONTENT_TYPE_UNSUPPORTED", 415);
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > maxBytes) throw new ReviewApiError("REQUEST_TOO_LARGE", 413);
    chunks.push(buffer);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("object required");
    return value as Record<string, unknown>;
  } catch {
    throw new ReviewApiError("JSON_INVALID", 400);
  }
}

type UploadedZip = ReviewUpload & { directory: string };

async function streamZipUpload(request: IncomingMessage, maxBytes: number, uploadRoot: string): Promise<UploadedZip> {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/zip")) throw new ReviewApiError("CONTENT_TYPE_UNSUPPORTED", 415);
  const contentLength = request.headers["content-length"];
  if (contentLength !== undefined && (!/^\d+$/u.test(contentLength) || Number(contentLength) > maxBytes)) {
    throw new ReviewApiError("UPLOAD_TOO_LARGE", 413);
  }
  const directory = await mkdtemp(path.join(uploadRoot, "code-atlas-upload-"));
  const uploadPath = path.join(directory, "upload.zip");
  let byteSize = 0;
  const limiter = new Transform({
    transform(chunk: Buffer | string, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      byteSize += buffer.byteLength;
      if (byteSize > maxBytes) {
        callback(new ReviewApiError("UPLOAD_TOO_LARGE", 413));
        return;
      }
      callback(null, buffer);
    },
  });
  try {
    await pipeline(request, limiter, createWriteStream(uploadPath, { flags: "wx", mode: 0o600 }));
    return { directory, uploadPath, byteSize };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

function validateSnapshot(value: unknown): asserts value is ReviewJobSnapshot {
  if (typeof value !== "object" || value === null || !validIdentifier((value as ReviewJobSnapshot).jobId)
    || !validIdentifier((value as ReviewJobSnapshot).reviewId)
    || !(["queued", "processing", "ready", "failed", "expired", "deleted"] as unknown[]).includes((value as ReviewJobSnapshot).state)) {
    throw new ReviewApiError("CONTROLLER_RESPONSE_INVALID", 500);
  }
}

function stateError(state: Exclude<ReviewJobState, "ready">): ReviewApiError {
  const mapping: Record<Exclude<ReviewJobState, "ready">, readonly [string, number]> = {
    queued: ["REVIEW_NOT_READY", 409],
    processing: ["REVIEW_NOT_READY", 409],
    failed: ["REVIEW_FAILED", 422],
    expired: ["REVIEW_EXPIRED", 410],
    deleted: ["REVIEW_DELETED", 410],
  };
  const [code, status] = mapping[state];
  return new ReviewApiError(code, status);
}

async function serveStatic(
  response: ServerResponse,
  webRoot: string,
  route: string,
  reviewEndpoint: string | undefined,
  apiBaseEndpoint: string | undefined,
): Promise<boolean> {
  const target = STATIC_ROUTES.get(route);
  if (!target) return false;
  const filePath = path.resolve(webRoot, target[0]);
  const rootPath = `${path.resolve(webRoot)}${path.sep}`;
  if (!filePath.startsWith(rootPath)) throw new ReviewApiError("STATIC_PATH_INVALID", 500);
  const info = await stat(filePath);
  if (!info.isFile()) throw new ReviewApiError("STATIC_FILE_INVALID", 500);
  if (route === "/" && (reviewEndpoint || apiBaseEndpoint)) {
    let html = await readFile(filePath, "utf8");
    if (reviewEndpoint) html = html.replace('name="code-atlas-review-endpoint" content=""', `name="code-atlas-review-endpoint" content="${reviewEndpoint}"`);
    if (apiBaseEndpoint) html = html.replace('name="code-atlas-api-base" content=""', `name="code-atlas-api-base" content="${apiBaseEndpoint}"`);
    response.writeHead(200, {
      "content-type": target[1],
      "content-length": Buffer.byteLength(html),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    response.end(html);
    return true;
  }
  response.writeHead(200, {
    "content-type": target[1],
    "content-length": info.size,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  createReadStream(filePath).pipe(response);
  return true;
}

export function createReviewApiServer(
  dependencies: ReviewApiDependencies,
  options: ReviewApiOptions = {},
): Server {
  const maxRequestBytes = options.maxRequestBytes ?? 16_384;
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 256) {
    throw new ReviewApiError("REQUEST_LIMIT_INVALID", 500);
  }
  const maxUploadBytes = options.maxUploadBytes ?? 50 * 1024 * 1024;
  if (!Number.isSafeInteger(maxUploadBytes) || maxUploadBytes < 1) {
    throw new ReviewApiError("UPLOAD_LIMIT_INVALID", 500);
  }
  const uploadRoot = path.resolve(options.uploadDirectory ?? tmpdir());
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const leasesByJob = new Map<string, string>();
  const leasesByReview = new Map<string, string>();
  const adminSessions = new Map<string, { csrf: string; expiresAt: number }>();
  const adminCookie = "__Host-code-atlas-admin";
  const adminToken = (request: IncomingMessage): string | null => {
    const raw = request.headers.cookie ?? "";
    const match = raw.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${adminCookie}=`));
    return match?.slice(adminCookie.length + 1) ?? null;
  };
  const authorisedAdmin = (request: IncomingMessage): boolean => {
    if (!options.admin) return false;
    const token = adminToken(request); const session = token ? adminSessions.get(token) : undefined;
    if (!session || session.expiresAt <= Date.now()) { if (token) adminSessions.delete(token); return false; }
    const supplied = request.headers["x-admin-csrf"];
    if (typeof supplied !== "string") return false;
    const suppliedBytes = Buffer.from(supplied); const expectedBytes = Buffer.from(session.csrf);
    return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
  };

  async function startLease(request: IncomingMessage): Promise<string | null> {
    if (!options.accessControl) return null;
    const header = request.headers["x-review-access-code"];
    try {
      return (await options.accessControl.startReview({ accessCode: typeof header === "string" ? header : "" })).leaseId;
    } catch (error) {
      throw accessApiError(error) ?? error;
    }
  }

  async function releaseLease(leaseId: string | null): Promise<void> {
    if (!leaseId || !options.accessControl) return;
    try { await options.accessControl.releaseReview(leaseId); } catch { /* A bounded lease expires even if cleanup reporting fails. */ }
  }

  async function settleLease(job: ReviewJobSnapshot): Promise<void> {
    const leaseId = leasesByJob.get(job.jobId);
    if (!leaseId || !options.accessControl || job.state === "queued" || job.state === "processing") return;
    try {
      if (job.state === "ready") await options.accessControl.completeReview(leaseId);
      else await options.accessControl.releaseReview(leaseId);
      leasesByJob.delete(job.jobId);
      leasesByReview.delete(job.reviewId);
    } catch (error) {
      throw accessApiError(error) ?? error;
    }
  }

  return createServer(async (request, response) => {
    const startedAt = monotonicNow();
    const rawMethod = request.method ?? "GET";
    const method: HttpMethod = rawMethod === "DELETE" || rawMethod === "GET" || rawMethod === "POST" ? rawMethod : "OTHER";
    response.once("finish", () => {
      try {
        options.telemetry?.record({
          event: "http.request.completed",
          method,
          route: options.telemetry.routeTemplate(request.url ?? "/"),
          status: response.statusCode,
          durationMs: Math.max(0, Math.round(monotonicNow() - startedAt)),
        });
      } catch {
        // Observability cannot change request behavior.
      }
    });
    try {
      const method = rawMethod;
      const url = new URL(request.url ?? "/", "http://localhost");
      if (method === "GET" && url.pathname === "/healthz") {
        sendJson(response, 200, { status: "ok" });
        return;
      }
      if (options.admin && method === "POST" && url.pathname === "/api/admin/login") {
        const body = await readJsonBody(request, maxRequestBytes);
        if (Object.keys(body).some((key) => !["username", "password"].includes(key)) || typeof body.username !== "string" || typeof body.password !== "string") throw new ReviewApiError("ADMIN_LOGIN_INVALID", 400);
        const expectedUser = Buffer.from(options.admin.username); const suppliedUser = Buffer.from(body.username);
        const expectedPassword = Buffer.from(options.admin.password); const suppliedPassword = Buffer.from(body.password);
        const valid = expectedUser.length === suppliedUser.length && expectedPassword.length === suppliedPassword.length && timingSafeEqual(expectedUser, suppliedUser) && timingSafeEqual(expectedPassword, suppliedPassword);
        if (!valid) throw new ReviewApiError("ADMIN_UNAUTHORIZED", 401);
        const token = randomBytes(32).toString("base64url"); const csrf = randomBytes(24).toString("base64url");
        adminSessions.set(token, { csrf, expiresAt: Date.now() + 8 * 60 * 60 * 1_000 });
        response.setHeader("set-cookie", `${adminCookie}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`);
        sendJson(response, 200, { authenticated: true, csrf }); return;
      }
      if (options.admin && url.pathname.startsWith("/api/admin/")) {
        if (!authorisedAdmin(request)) throw new ReviewApiError("ADMIN_UNAUTHORIZED", 401);
        if (method === "GET" && url.pathname === "/api/admin/access-codes") { sendJson(response, 200, { codes: await options.admin.accessControl.listAccessCodes() }); return; }
        if (method === "POST" && url.pathname === "/api/admin/access-codes") { sendJson(response, 201, await options.admin.accessControl.mintAccessCode()); return; }
        const revokeId = pathIdentifier(url.pathname, "/api/admin/access-codes/");
        if (method === "DELETE" && revokeId !== null) { sendJson(response, 200, await options.admin.accessControl.revokeAccessCode(revokeId)); return; }
      }
      if (method === "GET" && url.pathname === "/readyz") {
        let ready = true;
        try { ready = options.readiness ? await options.readiness() : true; } catch { ready = false; }
        sendJson(response, ready ? 200 : 503, { status: ready ? "ready" : "not-ready" });
        return;
      }
      if (method === "GET" && url.pathname === "/api/reviews/demo") {
        sendJson(response, 200, await dependencies.loadReview());
        return;
      }
      if (method === "POST" && url.pathname === "/api/reviews/demo/questions") {
        const body = await readJsonBody(request, maxRequestBytes);
        if (typeof body.reviewId !== "string" || body.reviewId.trim() !== body.reviewId || body.reviewId.length < 1 || body.reviewId.length > 200) {
          throw new ReviewApiError("REVIEW_ID_INVALID", 400);
        }
        if (typeof body.question !== "string" || body.question.trim() !== body.question || body.question.length < 1 || body.question.length > 2_000) {
          throw new ReviewApiError("QUESTION_INVALID", 400);
        }
        if (options.accessControl) {
          try { await options.accessControl.recordQuestion({ clientSubject: (options.clientSubject ?? defaultClientSubject)(request) }); }
          catch (error) { throw accessApiError(error) ?? error; }
        }
        sendJson(response, 200, await dependencies.answerQuestion(body.question, body.reviewId));
        return;
      }
      const controller = options.reviewJobs;
      if (controller && method === "POST" && url.pathname === "/api/git-reviews") {
        const body = await readJsonBody(request, maxRequestBytes);
        const allowed = new Set(["repositoryUrl", "ref"]);
        if (Object.keys(body).some((key) => !allowed.has(key)) || typeof body.repositoryUrl !== "string"
          || body.repositoryUrl.trim() !== body.repositoryUrl || body.repositoryUrl.length < 1 || body.repositoryUrl.length > 2_000
          || (body.ref !== undefined && (typeof body.ref !== "string" || body.ref.trim() !== body.ref || body.ref.length < 1 || body.ref.length > 255))) {
          throw new ReviewApiError("GIT_REQUEST_INVALID", 400);
        }
        if (!controller.createGitReview) throw new ReviewApiError("GIT_INTAKE_UNAVAILABLE", 503);
        const leaseId = await startLease(request);
        let created: ReviewJobSnapshot;
        try {
          created = await controller.createGitReview({ repositoryUrl: body.repositoryUrl, ...(body.ref === undefined ? {} : { ref: body.ref }) });
        } catch (error) {
          await releaseLease(leaseId);
          const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
          if (code === "GIT_REVIEW_INVALID") throw new ReviewApiError("GIT_REQUEST_INVALID", 400);
          if (code === "GIT_REVIEW_UNAVAILABLE") throw new ReviewApiError("GIT_INTAKE_UNAVAILABLE", 503);
          throw error;
        }
        try { validateSnapshot(created); }
        catch (error) { await releaseLease(leaseId); throw error; }
        if (leaseId) {
          leasesByJob.set(created.jobId, leaseId);
          leasesByReview.set(created.reviewId, leaseId);
          await settleLease(created);
        }
        sendJson(response, created.state === "ready" ? 201 : 202, { jobId: created.jobId, reviewId: created.reviewId, state: created.state });
        return;
      }
      if (controller && method === "POST" && url.pathname === "/api/reviews") {
        const leaseId = await startLease(request);
        await mkdir(uploadRoot, { recursive: true });
        let upload: UploadedZip;
        try { upload = await streamZipUpload(request, maxUploadBytes, uploadRoot); }
        catch (error) { await releaseLease(leaseId); throw error; }
        try {
          const created = await controller.createReview({ uploadPath: upload.uploadPath, byteSize: upload.byteSize });
          validateSnapshot(created);
          if (leaseId) {
            leasesByJob.set(created.jobId, leaseId);
            leasesByReview.set(created.reviewId, leaseId);
            await settleLease(created);
          }
          sendJson(response, created.state === "ready" ? 201 : 202, {
            jobId: created.jobId,
            reviewId: created.reviewId,
            state: created.state,
          });
        } catch (error) {
          await releaseLease(leaseId);
          throw error;
        } finally {
          await rm(upload.directory, { recursive: true, force: true });
        }
        return;
      }
      const jobId = pathIdentifier(url.pathname, "/api/jobs/");
      if (controller && method === "GET" && url.pathname.startsWith("/api/jobs/") && jobId === null) {
        throw new ReviewApiError("IDENTIFIER_INVALID", 400);
      }
      if (controller && method === "GET" && jobId !== null) {
        const job = await controller.getJob(jobId);
        if (job === null) throw new ReviewApiError("JOB_NOT_FOUND", 404);
        validateSnapshot(job);
        await settleLease(job);
        if (job.state === "failed" || job.state === "expired" || job.state === "deleted") throw stateError(job.state);
        sendJson(response, 200, { jobId: job.jobId, reviewId: job.reviewId, state: job.state });
        return;
      }
      const reviewQuestionId = pathIdentifier(url.pathname, "/api/reviews/", "/questions");
      if (controller && method === "POST" && url.pathname.startsWith("/api/reviews/") && url.pathname.endsWith("/questions") && reviewQuestionId === null) {
        throw new ReviewApiError("IDENTIFIER_INVALID", 400);
      }
      if (controller && method === "POST" && reviewQuestionId !== null) {
        const body = await readJsonBody(request, maxRequestBytes);
        if (typeof body.question !== "string" || body.question.trim() !== body.question || body.question.length < 1 || body.question.length > 2_000) {
          throw new ReviewApiError("QUESTION_INVALID", 400);
        }
        const result = await controller.answerQuestion(reviewQuestionId, body.question);
        if (result === null) throw new ReviewApiError("REVIEW_NOT_FOUND", 404);
        if (result.state === "rate-limited") throw new ReviewApiError("QUESTION_RATE_LIMITED", 429);
        if (result.state !== "answered") {
          if (result.state === "ready") throw new ReviewApiError("CONTROLLER_RESPONSE_INVALID", 500);
          throw stateError(result.state);
        }
        sendJson(response, 200, { reviewId: reviewQuestionId, answer: result.answer });
        return;
      }
      const reviewId = pathIdentifier(url.pathname, "/api/reviews/");
      if (controller && ["GET", "DELETE"].includes(method) && url.pathname.startsWith("/api/reviews/") && reviewId === null) {
        throw new ReviewApiError("IDENTIFIER_INVALID", 400);
      }
      if (controller && method === "GET" && reviewId !== null) {
        const result = await controller.getReview(reviewId);
        if (result === null) throw new ReviewApiError("REVIEW_NOT_FOUND", 404);
        if (result.state !== "ready") throw stateError(result.state);
        sendJson(response, 200, { reviewId, state: "ready", review: result.review });
        return;
      }
      if (controller && method === "DELETE" && reviewId !== null) {
        const result = await controller.deleteReview(reviewId);
        if (result === null) throw new ReviewApiError("REVIEW_NOT_FOUND", 404);
        if (result.state !== "deleted") throw stateError(result.state);
        const leaseId = leasesByReview.get(reviewId) ?? null;
        await releaseLease(leaseId);
        if (leaseId) {
          leasesByReview.delete(reviewId);
          for (const [jobId, candidate] of leasesByJob) if (candidate === leaseId) leasesByJob.delete(jobId);
        }
        sendJson(response, 200, { reviewId, state: "deleted" });
        return;
      }
      if (method === "GET" && options.webRoot && await serveStatic(response, options.webRoot, url.pathname, options.reviewEndpoint, options.apiBaseEndpoint)) return;
      if ((url.pathname === "/api/reviews/demo" || url.pathname === "/api/reviews/demo/questions") && !["GET", "POST"].includes(method)) {
        response.setHeader("allow", url.pathname === "/api/reviews/demo" ? "GET" : "POST");
        throw new ReviewApiError("METHOD_NOT_ALLOWED", 405);
      }
      if (controller && ["/api/reviews", "/api/git-reviews", "/api/jobs/"].some((prefix) => url.pathname.startsWith(prefix))) {
        const allow = url.pathname === "/api/reviews" || url.pathname === "/api/git-reviews" ? "POST" : url.pathname.startsWith("/api/jobs/") ? "GET" : "GET, POST, DELETE";
        response.setHeader("allow", allow);
        throw new ReviewApiError("METHOD_NOT_ALLOWED", 405);
      }
      throw new ReviewApiError("ROUTE_NOT_FOUND", 404);
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const known = error instanceof ReviewApiError ? error : new ReviewApiError("INTERNAL_ERROR", 500);
      sendJson(response, known.status, { error: { code: known.code } });
    }
  });
}
