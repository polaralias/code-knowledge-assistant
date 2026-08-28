import { lstat, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import path from "node:path";

export type PublicGitRepository = {
  host: "github.com";
  owner: string;
  name: string;
  cloneUrl: string;
};

export type GitTransportLimits = {
  timeoutMs: number;
  outputByteLimit: number;
  maxRepositoryBytes: number;
};

export type GitTransport = {
  resolveCommit(input: {
    repository: PublicGitRepository;
    requestedRef: string | null;
    limits: Pick<GitTransportLimits, "timeoutMs" | "outputByteLimit">;
  }): Promise<string>;
  fetchCommit(input: {
    repository: PublicGitRepository;
    commit: string;
    workspacePath: string;
    depth: 1;
    disableHooks: true;
    limits: GitTransportLimits;
  }): Promise<void>;
  readHead(input: { workspacePath: string; limits: Pick<GitTransportLimits, "timeoutMs" | "outputByteLimit"> }): Promise<string>;
};

export type PublicGitIntakeInput = {
  url: string;
  ref?: string;
};

export type PublicGitIntakeOptions = Partial<GitTransportLimits> & {
  workspaceRoot?: string;
};

export type PublicGitIntakeResult = {
  repository: PublicGitRepository;
  revision: string;
  workspacePath: string;
  cleanup(): Promise<void>;
};

export class GitIntakeError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "GitIntakeError";
    this.code = code;
  }
}

/** A transport implementation throws this to expose a stable, body-free process failure. */
export class GitTransportError extends Error {
  readonly code: "GIT_TIMEOUT" | "GIT_OUTPUT_LIMIT" | "GIT_TRANSPORT_FAILED";

  constructor(code: GitTransportError["code"]) {
    super(code);
    this.name = "GitTransportError";
    this.code = code;
  }
}

export type GitCommand = {
  binary: string;
  args: string[];
  cwd?: string;
  environment: NodeJS.ProcessEnv;
  timeoutMs: number;
  outputByteLimit: number;
  shell: false;
};

export type GitCommandRunner = {
  run(command: GitCommand): Promise<{ stdout: string; stderr: string }>;
};

export type GitCliTransportOptions = {
  gitBinary?: string;
  runner?: GitCommandRunner;
};

const DEFAULT_LIMITS: GitTransportLimits = Object.freeze({
  timeoutMs: 30_000,
  outputByteLimit: 1_048_576,
  maxRepositoryBytes: 100 * 1024 * 1024,
});
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;

function securedGitEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const name of ["GIT_ASKPASS", "SSH_ASKPASS", "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM"]) {
    delete environment[name];
  }
  for (const name of Object.keys(environment)) {
    if (name === "GIT_CONFIG_COUNT" || name.startsWith("GIT_CONFIG_KEY_") || name.startsWith("GIT_CONFIG_VALUE_")) delete environment[name];
  }
  return {
    ...environment,
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    GCM_INTERACTIVE: "Never",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
  };
}

function runGitCommand(command: GitCommand): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let timedOut = false;
    let outputExceeded = false;
    let completed = false;
    const complete = (result: (() => void)) => {
      if (completed) return;
      completed = true;
      clearTimeout(timeout);
      result();
    };
    let child;
    try {
      child = spawn(command.binary, command.args, {
        cwd: command.cwd,
        env: command.environment,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch {
      reject(new GitTransportError("GIT_TRANSPORT_FAILED"));
      return;
    }
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, command.timeoutMs);
    const collect = (target: Buffer[]) => (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      outputBytes += buffer.byteLength;
      const remaining = command.outputByteLimit - (outputBytes - buffer.byteLength);
      if (remaining > 0) target.push(buffer.subarray(0, remaining));
      if (outputBytes > command.outputByteLimit && !outputExceeded) {
        outputExceeded = true;
        child.kill();
      }
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.once("error", () => complete(() => reject(new GitTransportError("GIT_TRANSPORT_FAILED"))));
    child.once("close", (code) => complete(() => {
      if (timedOut) reject(new GitTransportError("GIT_TIMEOUT"));
      else if (outputExceeded) reject(new GitTransportError("GIT_OUTPUT_LIMIT"));
      else if (code !== 0) reject(new GitTransportError("GIT_TRANSPORT_FAILED"));
      else resolve({ stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    }));
  });
}

function commitFromOutput(output: string): string {
  const revisions = new Set(
    output.split(/\r?\n/u).map((line) => line.split(/\s+/u)[0] ?? "").filter((candidate) => COMMIT_PATTERN.test(candidate)),
  );
  if (revisions.size !== 1) throw new GitTransportError("GIT_TRANSPORT_FAILED");
  return revisions.values().next().value!;
}

function gitArguments(args: string[]): string[] {
  return [
    "-c", "credential.helper=",
    "-c", "http.extraHeader=",
    "-c", "core.hooksPath=",
    "-c", "submodule.recurse=false",
    "--no-pager",
    ...args,
  ];
}

/** Creates the production no-shell Git transport; callers inject it into public intake orchestration. */
export function createGitCliTransport(options: GitCliTransportOptions = {}): GitTransport {
  const runner = options.runner ?? { run: runGitCommand };
  const binary = options.gitBinary ?? "git";
  const run = async (args: string[], limits: Pick<GitTransportLimits, "timeoutMs" | "outputByteLimit">) => {
    try {
      return await runner.run({
        binary,
        args: gitArguments(args),
        environment: securedGitEnvironment(),
        timeoutMs: limits.timeoutMs,
        outputByteLimit: limits.outputByteLimit,
        shell: false,
      });
    } catch (error) {
      if (error instanceof GitTransportError) throw error;
      throw new GitTransportError("GIT_TRANSPORT_FAILED");
    }
  };
  return Object.freeze({
    async resolveCommit(input) {
      if (input.requestedRef !== null && COMMIT_PATTERN.test(input.requestedRef)) return input.requestedRef;
      const result = input.requestedRef === null
        ? await run(["ls-remote", "--symref", "--exit-code", input.repository.cloneUrl, "HEAD"], input.limits)
        : await run(["ls-remote", "--exit-code", input.repository.cloneUrl, input.requestedRef], input.limits);
      return commitFromOutput(result.stdout);
    },
    async fetchCommit(input) {
      await run(["init", "--quiet", "--template=", input.workspacePath], input.limits);
      await run(["-C", input.workspacePath, "remote", "add", "origin", input.repository.cloneUrl], input.limits);
      await run([
        "-C", input.workspacePath, "fetch", "--quiet", "--depth=1", "--no-tags", "--no-recurse-submodules", "origin", input.commit,
      ], input.limits);
      await run([
        "-C", input.workspacePath, "checkout", "--quiet", "--detach", "--force", "--no-recurse-submodules", input.commit,
      ], input.limits);
    },
    async readHead(input) {
      const result = await run(["-C", input.workspacePath, "rev-parse", "--verify", "HEAD^{commit}"], input.limits);
      return commitFromOutput(result.stdout);
    },
  });
}

function normalizeTransportError(error: unknown): GitIntakeError {
  if (error instanceof GitIntakeError) return error;
  if (error instanceof GitTransportError) return new GitIntakeError(error.code);
  return new GitIntakeError("GIT_TRANSPORT_FAILED");
}

function validRef(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 255 && value.trim() === value
    && !value.startsWith("-") && !value.startsWith("/") && !value.endsWith("/") && !value.endsWith(".")
    && !value.includes("..") && !value.includes("//") && !value.includes("@{") && !/[\u0000-\u0020~^:?*\\[\]]/u.test(value);
}

function resolveLimits(overrides: PublicGitIntakeOptions): GitTransportLimits {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  for (const value of [limits.timeoutMs, limits.outputByteLimit, limits.maxRepositoryBytes]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new GitIntakeError("GIT_LIMIT_INVALID");
  }
  return { timeoutMs: limits.timeoutMs, outputByteLimit: limits.outputByteLimit, maxRepositoryBytes: limits.maxRepositoryBytes };
}

export function parsePublicGitHubRepository(url: string): PublicGitRepository {
  if (typeof url !== "string" || url.length === 0 || url.trim() !== url) throw new GitIntakeError("GIT_URL_INVALID");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new GitIntakeError("GIT_URL_INVALID");
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" || parsed.port !== "" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new GitIntakeError("GIT_URL_INVALID");
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length !== 2 || parsed.pathname.endsWith("/")) throw new GitIntakeError("GIT_URL_INVALID");
  const [owner, repositorySegment] = segments;
  const name = repositorySegment.endsWith(".git") ? repositorySegment.slice(0, -4) : repositorySegment;
  if (!OWNER_PATTERN.test(owner) || !REPOSITORY_PATTERN.test(name)) throw new GitIntakeError("GIT_URL_INVALID");
  return { host: "github.com", owner, name, cloneUrl: `https://github.com/${owner}/${name}.git` };
}

async function workspaceBytes(root: string, maxBytes: number): Promise<number> {
  let total = 0;
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      const metadata = await lstat(entryPath);
      if (metadata.isDirectory()) {
        await visit(entryPath);
      } else if (metadata.isFile() || metadata.isSymbolicLink()) {
        total += metadata.size;
        if (total > maxBytes) throw new GitIntakeError("REPOSITORY_SIZE_LIMIT");
      } else {
        throw new GitIntakeError("WORKSPACE_ENTRY_INVALID");
      }
    }
  }
  await visit(root);
  return total;
}

function cleanupWorkspace(workspacePath: string): () => Promise<void> {
  let cleanup: Promise<void> | null = null;
  return () => {
    cleanup ??= rm(workspacePath, { recursive: true, force: true }).catch(() => {
      throw new GitIntakeError("WORKSPACE_CLEANUP_FAILED");
    });
    return cleanup;
  };
}

export async function intakePublicGitRepository(
  input: PublicGitIntakeInput,
  transport: GitTransport,
  options: PublicGitIntakeOptions = {},
): Promise<PublicGitIntakeResult> {
  const repository = parsePublicGitHubRepository(input?.url);
  if (input.ref !== undefined && !validRef(input.ref)) throw new GitIntakeError("GIT_REF_INVALID");
  const limits = resolveLimits(options);
  const commandLimits = { timeoutMs: limits.timeoutMs, outputByteLimit: limits.outputByteLimit };
  let revision: string;
  try {
    revision = await transport.resolveCommit({ repository, requestedRef: input.ref ?? null, limits: commandLimits });
  } catch (error) {
    throw normalizeTransportError(error);
  }
  if (typeof revision !== "string" || !COMMIT_PATTERN.test(revision)) throw new GitIntakeError("GIT_REVISION_INVALID");

  let workspacePath: string;
  try {
    const workspaceRoot = path.resolve(options.workspaceRoot ?? tmpdir());
    await mkdir(workspaceRoot, { recursive: true });
    workspacePath = await mkdtemp(path.join(workspaceRoot, "code-atlas-git-"));
  } catch {
    throw new GitIntakeError("WORKSPACE_CREATE_FAILED");
  }
  const cleanup = cleanupWorkspace(workspacePath);
  try {
    await transport.fetchCommit({ repository, commit: revision, workspacePath, depth: 1, disableHooks: true, limits });
    const head = await transport.readHead({ workspacePath, limits: commandLimits });
    if (typeof head !== "string" || head !== revision) throw new GitIntakeError("GIT_HEAD_MISMATCH");
    await workspaceBytes(workspacePath, limits.maxRepositoryBytes);
    return Object.freeze({ repository: Object.freeze({ ...repository }), revision, workspacePath, cleanup });
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw normalizeTransportError(cleanupError);
    }
    throw normalizeTransportError(error);
  }
}
