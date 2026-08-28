import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { IntakePolicyError, inventoryRepository } from "../src/index.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("a materialized repository produces a stable content inventory without executing it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-intake-"));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "README.md"), "# Example\n");
  await writeFile(path.join(root, "src", "main.ts"), "export const answer = 42;\n");

  const result = await inventoryRepository(root);

  assert.deepEqual(result.entries.map((entry) => entry.path), ["README.md", "src/main.ts"]);
  assert.deepEqual(result.entries.map((entry) => entry.eligibility), ["eligible", "eligible"]);
  assert.deepEqual(result.entries.map((entry) => entry.line_count), [1, 1]);
  assert.ok(result.entries.every((entry) => entry.sha256 !== null && /^[a-f0-9]{64}$/.test(entry.sha256)));
  assert.equal(result.summary.discovered_files, 2);
  assert.equal(result.summary.eligible_files, 2);
  assert.equal(result.summary.excluded_files, 0);
});

test("dependency, build, binary, and sensitive content is reported as excluded", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-intake-"));
  await mkdir(path.join(root, "dist"));
  await mkdir(path.join(root, "node_modules", "example"), { recursive: true });
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, ".env"), "API_TOKEN=do-not-report\n");
  await writeFile(path.join(root, "dist", "bundle.js"), "generated\n");
  await writeFile(path.join(root, "node_modules", "example", "index.js"), "dependency\n");
  await writeFile(path.join(root, "src", "logo.png"), Buffer.from([0, 1, 2, 3]));
  await writeFile(path.join(root, "src", "main.ts"), "export const main = true;\n");

  const result = await inventoryRepository(root);

  assert.deepEqual(
    result.entries.map(({ path, eligibility, exclusion_reason }) => ({ path, eligibility, exclusion_reason })),
    [
      { path: ".env", eligibility: "excluded", exclusion_reason: "sensitive" },
      { path: "dist/bundle.js", eligibility: "excluded", exclusion_reason: "build-output" },
      { path: "node_modules/example/index.js", eligibility: "excluded", exclusion_reason: "dependency" },
      { path: "src/logo.png", eligibility: "excluded", exclusion_reason: "binary-media" },
      { path: "src/main.ts", eligibility: "eligible", exclusion_reason: null },
    ],
  );
  assert.equal(result.summary.eligible_files, 1);
  assert.equal(result.summary.excluded_files, 4);
  assert.equal(result.summary.excluded_directories, 2);
  assert.equal(result.entries.find((entry) => entry.path === ".env")?.sha256, null);
});

test("a repository containing a symbolic link is rejected with a stable policy error", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-intake-"));
  const outside = path.join(await mkdtemp(path.join(os.tmpdir(), "cka-outside-")), "secret.txt");
  await writeFile(outside, "must not be read\n");
  await symlink(outside, path.join(root, "linked.txt"), "file");

  await assert.rejects(
    inventoryRepository(root),
    (error: unknown) => error instanceof IntakePolicyError && error.code === "SYMLINK_NOT_ALLOWED" && error.path === "linked.txt",
  );
});

test("file-count, individual-file, and analyzed-byte limits fail closed", async (context) => {
  await context.test("file count", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cka-intake-"));
    await writeFile(path.join(root, "one.txt"), "one\n");
    await writeFile(path.join(root, "two.txt"), "two\n");
    await assert.rejects(
      inventoryRepository(root, { maxFiles: 1 }),
      (error: unknown) => error instanceof IntakePolicyError && error.code === "FILE_COUNT_LIMIT",
    );
  });

  await context.test("individual file bytes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cka-intake-"));
    await writeFile(path.join(root, "large.txt"), "12345");
    await assert.rejects(
      inventoryRepository(root, { maxAnalyzedFileBytes: 4 }),
      (error: unknown) => error instanceof IntakePolicyError && error.code === "FILE_SIZE_LIMIT" && error.path === "large.txt",
    );
  });

  await context.test("total analyzed bytes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cka-intake-"));
    await writeFile(path.join(root, "one.txt"), "123");
    await writeFile(path.join(root, "two.txt"), "456");
    await assert.rejects(
      inventoryRepository(root, { maxAnalyzedBytes: 5 }),
      (error: unknown) => error instanceof IntakePolicyError && error.code === "TOTAL_SIZE_LIMIT",
    );
  });
});

test("callers can add repository-relative sensitive paths without excluding safe examples", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-intake-"));
  await mkdir(path.join(root, "config"));
  await writeFile(path.join(root, ".env.example"), "API_TOKEN=replace-me\n");
  await writeFile(path.join(root, "config", "private.json"), "{\"token\":\"must-not-appear\"}\n");

  const result = await inventoryRepository(root, { sensitivePaths: ["config/private.json"] });

  assert.equal(result.entries.find((entry) => entry.path === ".env.example")?.eligibility, "eligible");
  assert.deepEqual(
    result.entries.find((entry) => entry.path === "config/private.json"),
    {
      kind: "file",
      path: "config/private.json",
      byte_size: 28,
      sha256: null,
      line_count: null,
      eligibility: "excluded",
      exclusion_reason: "sensitive",
    },
  );
});

test("the inventory root must be a real directory rather than a file or symbolic link", async (context) => {
  await context.test("file root", async () => {
    const root = path.join(await mkdtemp(path.join(os.tmpdir(), "cka-intake-")), "repository.txt");
    await writeFile(root, "not a directory\n");
    await assert.rejects(
      inventoryRepository(root),
      (error: unknown) => error instanceof IntakePolicyError && error.code === "ROOT_NOT_DIRECTORY" && error.path === null,
    );
  });

  await context.test("symbolic-link root", async () => {
    const target = await mkdtemp(path.join(os.tmpdir(), "cka-target-"));
    const root = path.join(await mkdtemp(path.join(os.tmpdir(), "cka-intake-")), "linked-root");
    await symlink(target, root, "junction");
    await assert.rejects(
      inventoryRepository(root),
      (error: unknown) => error instanceof IntakePolicyError && error.code === "SYMLINK_NOT_ALLOWED" && error.path === null,
    );
  });
});

test("the public inventory reproduces the checked fixture eligibility contract", async () => {
  for (const fixtureId of ["python-service", "typescript-service"]) {
    const groundTruth = JSON.parse(
      await readFile(path.join(repositoryRoot, "eval", "ground-truth", `${fixtureId}.json`), "utf8"),
    );
    const result = await inventoryRepository(path.join(repositoryRoot, groundTruth.fixture.root));

    assert.deepEqual(
      result.entries.filter((entry) => entry.eligibility === "eligible").map((entry) => entry.path),
      groundTruth.inventory.eligible,
      `${fixtureId} eligible inventory`,
    );
    assert.deepEqual(
      result.entries.filter((entry) => entry.eligibility === "excluded").map((entry) => entry.path),
      groundTruth.inventory.excluded.map((entry: { path: string }) => entry.path),
      `${fixtureId} excluded inventory`,
    );
  }
});
