import assert from "node:assert/strict";
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createGitCliTransport, GitIntakeError, GitTransportError, intakePublicGitRepository, parsePublicGitHubRepository, type GitCommandRunner, type GitTransport } from "../src/index.ts";

test("resolves a GitHub HTTPS repository to an immutable commit in a unique, bounded workspace", async () => {
  const calls: string[] = [];
  const transport: GitTransport = {
    async resolveCommit(input) {
      calls.push(`resolve:${input.repository.cloneUrl}:${input.requestedRef ?? "default"}`);
      return "0123456789abcdef0123456789abcdef01234567";
    },
    async fetchCommit(input) {
      calls.push(`fetch:${input.commit}:${input.depth}:${input.disableHooks}`);
      await writeFile(path.join(input.workspacePath, "README.md"), "safe static content\n");
    },
    async readHead(input) {
      calls.push(`head:${path.basename(input.workspacePath)}`);
      return "0123456789abcdef0123456789abcdef01234567";
    },
  };

  const result = await intakePublicGitRepository({ url: "https://github.com/openai/example.git", ref: "release-1" }, transport, {
    workspaceRoot: tmpdir(),
    maxRepositoryBytes: 1_024,
  });

  assert.deepEqual(result.repository, { host: "github.com", owner: "openai", name: "example", cloneUrl: "https://github.com/openai/example.git" });
  assert.equal(result.revision, "0123456789abcdef0123456789abcdef01234567");
  assert.equal(await readFile(path.join(result.workspacePath, "README.md"), "utf8"), "safe static content\n");
  assert.deepEqual(calls.slice(0, 2), [
    "resolve:https://github.com/openai/example.git:release-1",
    "fetch:0123456789abcdef0123456789abcdef01234567:1:true",
  ]);
  await result.cleanup();
  await result.cleanup();
  await assert.rejects(access(result.workspacePath));
});

test("accepts only unambiguous credential-free HTTPS GitHub repository URLs", () => {
  assert.deepEqual(parsePublicGitHubRepository("https://github.com/openai/example"), {
    host: "github.com", owner: "openai", name: "example", cloneUrl: "https://github.com/openai/example.git",
  });
  for (const url of [
    "https://user:token@github.com/openai/example.git",
    "http://github.com/openai/example.git",
    "ssh://git@github.com/openai/example.git",
    "git@github.com:openai/example.git",
    "https://github.com/openai/example.git?ref=main",
    "https://github.com/openai/example.git#readme",
    "https://github.com/openai/example.git/",
    "https://github.com/openai/example/extra",
    "https://github.com/openai/example%2Fextra",
    "C:\\repositories\\example",
  ]) {
    assert.throws(() => parsePublicGitHubRepository(url), (error: unknown) => error instanceof GitIntakeError && error.code === "GIT_URL_INVALID", url);
  }
});

test("cleans failed workspaces and exposes only stable transport, HEAD, and size errors", async (context) => {
  const revision = "0123456789abcdef0123456789abcdef01234567";
  const root = await mkdtemp(path.join(tmpdir(), "git-intake-test-"));
  const baseTransport = (): GitTransport => ({
    async resolveCommit() { return revision; },
    async fetchCommit(input) { await writeFile(path.join(input.workspacePath, "source.txt"), "bounded source\n"); },
    async readHead() { return revision; },
  });
  try {
    await context.test("transport failure", async () => {
      const transport = baseTransport();
      transport.fetchCommit = async (input) => {
        await writeFile(path.join(input.workspacePath, "partial.txt"), "partial\n");
        throw new Error("C:\\private\\repository\\source.ts");
      };
      await assert.rejects(
        intakePublicGitRepository({ url: "https://github.com/openai/example" }, transport, { workspaceRoot: root }),
        (error: unknown) => error instanceof GitIntakeError && error.code === "GIT_TRANSPORT_FAILED" && error.message === "GIT_TRANSPORT_FAILED",
      );
      assert.deepEqual(await readdir(root), []);
    });
    await context.test("HEAD mismatch", async () => {
      const transport = baseTransport();
      transport.readHead = async () => "ffffffffffffffffffffffffffffffffffffffff";
      await assert.rejects(
        intakePublicGitRepository({ url: "https://github.com/openai/example" }, transport, { workspaceRoot: root }),
        (error: unknown) => error instanceof GitIntakeError && error.code === "GIT_HEAD_MISMATCH",
      );
      assert.deepEqual(await readdir(root), []);
    });
    await context.test("repository-size limit", async () => {
      const transport = baseTransport();
      transport.fetchCommit = async (input) => {
        await writeFile(path.join(input.workspacePath, "large.txt"), "x".repeat(12));
      };
      await assert.rejects(
        intakePublicGitRepository({ url: "https://github.com/openai/example" }, transport, { workspaceRoot: root, maxRepositoryBytes: 8 }),
        (error: unknown) => error instanceof GitIntakeError && error.code === "REPOSITORY_SIZE_LIMIT",
      );
      assert.deepEqual(await readdir(root), []);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects unsafe refs before transport work and propagates stable timeout/output limits", async () => {
  let resolves = 0;
  const transport: GitTransport = {
    async resolveCommit(input) {
      resolves += 1;
      assert.deepEqual(input.limits, { timeoutMs: 7, outputByteLimit: 11 });
      throw new GitTransportError("GIT_TIMEOUT");
    },
    async fetchCommit() { throw new Error("not reached"); },
    async readHead() { throw new Error("not reached"); },
  };
  await assert.rejects(
    intakePublicGitRepository({ url: "https://github.com/openai/example", ref: "--upload-pack=evil" }, transport),
    (error: unknown) => error instanceof GitIntakeError && error.code === "GIT_REF_INVALID",
  );
  await assert.rejects(
    intakePublicGitRepository({ url: "https://github.com/openai/example" }, transport, { timeoutMs: 7, outputByteLimit: 11 }),
    (error: unknown) => error instanceof GitIntakeError && error.code === "GIT_TIMEOUT" && error.message === "GIT_TIMEOUT",
  );
  assert.equal(resolves, 1);
});

test("the Git CLI transport resolves immutable revisions and fetches a detached shallow checkout without prompts or hooks", async () => {
  const commands: Parameters<GitCommandRunner["run"]>[0][] = [];
  const runner: GitCommandRunner = {
    async run(command) {
      commands.push(command);
      if (command.args.includes("ls-remote")) return { stdout: "ref: refs/heads/main\tHEAD\n0123456789abcdef0123456789abcdef01234567\tHEAD\n", stderr: "" };
      if (command.args.includes("rev-parse")) return { stdout: "0123456789abcdef0123456789abcdef01234567\n", stderr: "" };
      return { stdout: "", stderr: "" };
    },
  };
  const transport = createGitCliTransport({ runner });
  const repository = parsePublicGitHubRepository("https://github.com/openai/example");
  const revision = await transport.resolveCommit({ repository, requestedRef: null, limits: { timeoutMs: 9, outputByteLimit: 17 } });
  await transport.fetchCommit({ repository, commit: revision, workspacePath: "C:/isolated/workspace", depth: 1, disableHooks: true, limits: { timeoutMs: 9, outputByteLimit: 17, maxRepositoryBytes: 99 } });
  assert.equal(await transport.readHead({ workspacePath: "C:/isolated/workspace", limits: { timeoutMs: 9, outputByteLimit: 17 } }), revision);

  assert.ok(commands.every((command) => command.shell === false && command.timeoutMs === 9 && command.outputByteLimit === 17));
  assert.ok(commands.every((command) => command.environment.GIT_TERMINAL_PROMPT === "0" && command.environment.GIT_OPTIONAL_LOCKS === "0"));
  assert.ok(commands.every((command) => command.environment.GCM_INTERACTIVE === "Never" && command.environment.GIT_CONFIG_NOSYSTEM === "1"));
  assert.ok(commands.every((command) => command.args.includes("core.hooksPath=") && command.args.includes("credential.helper=") && command.args.includes("http.extraHeader=")));
  assert.deepEqual(commands.map((command) => command.args.filter((argument) => ["ls-remote", "init", "remote", "fetch", "checkout", "rev-parse"].includes(argument))[0]), ["ls-remote", "init", "remote", "fetch", "checkout", "rev-parse"]);
  const fetch = commands.find((command) => command.args.includes("fetch"));
  assert(fetch);
  assert.ok(fetch.args.includes("--depth=1"));
  assert.ok(fetch.args.includes("--no-recurse-submodules"));
  const checkout = commands.find((command) => command.args.includes("checkout"));
  assert(checkout);
  assert.ok(checkout.args.includes("--detach"));
  assert.ok(checkout.args.includes("--no-recurse-submodules"));
});

test("the CLI transport normalizes runner failures to stable body-free errors", async () => {
  const repository = parsePublicGitHubRepository("https://github.com/openai/example");
  const limits = { timeoutMs: 1, outputByteLimit: 1 };
  const leaking = createGitCliTransport({ runner: { async run() { throw new Error("C:\\private\\token"); } } });
  await assert.rejects(
    leaking.resolveCommit({ repository, requestedRef: null, limits }),
    (error: unknown) => error instanceof GitTransportError && error.code === "GIT_TRANSPORT_FAILED" && error.message === "GIT_TRANSPORT_FAILED",
  );
  const bounded = createGitCliTransport({ runner: { async run() { throw new GitTransportError("GIT_OUTPUT_LIMIT"); } } });
  await assert.rejects(
    bounded.resolveCommit({ repository, requestedRef: null, limits }),
    (error: unknown) => error instanceof GitTransportError && error.code === "GIT_OUTPUT_LIMIT",
  );
});
