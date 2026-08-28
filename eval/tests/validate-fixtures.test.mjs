import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { validateFixtures } from "../scripts/validate-fixtures.mjs";

async function withFixture(manifest, files, run) {
  const root = await mkdtemp(path.join(tmpdir(), "cka-fixture-"));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const target = path.join(root, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }
    await mkdir(path.join(root, "eval", "ground-truth"), { recursive: true });
    await writeFile(
      path.join(root, "eval", "ground-truth", "sample.json"),
      JSON.stringify(manifest),
      "utf8",
    );
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("a complete fixture manifest validates through the public interface", async () => {
  await withFixture(
    {
      schema_version: "1.0",
      fixture: {
        id: "sample",
        language: "Python",
        root: "eval/fixtures/sample",
        license: "MIT",
      },
      inventory: {
        eligible: ["src/app.py"],
        excluded: [],
      },
      symbols: [],
      imports: [],
      relationships: [],
      questions: [],
    },
    { "eval/fixtures/sample/src/app.py": "def run():\n    return True\n" },
    async (root) => {
      const report = await validateFixtures(root);

      assert.equal(report.ok, true);
      assert.deepEqual(report.fixtures, ["sample"]);
      assert.deepEqual(report.errors, []);
    },
  );
});

test("fixture paths cannot escape their declared root", async () => {
  await withFixture(
    {
      schema_version: "1.0",
      fixture: {
        id: "sample",
        language: "Python",
        root: "eval/fixtures/sample",
        license: "MIT",
      },
      inventory: { eligible: ["../outside.py"], excluded: [] },
      symbols: [],
      imports: [],
      relationships: [],
      questions: [],
    },
    { "eval/fixtures/outside.py": "print('outside')\n" },
    async (root) => {
      const report = await validateFixtures(root);

      assert.equal(report.ok, false);
      assert.match(report.errors.join("\n"), /unsafe fixture path: \.\.\/outside\.py/);
    },
  );
});

test("question evidence must resolve to the declared source lines", async () => {
  await withFixture(
    {
      schema_version: "1.0",
      fixture: {
        id: "sample",
        language: "Python",
        root: "eval/fixtures/sample",
        license: "MIT",
      },
      inventory: { eligible: ["src/app.py"], excluded: [] },
      symbols: [],
      imports: [],
      relationships: [],
      questions: [
        {
          id: "sample.question",
          question: "What does run return?",
          expected_behavior: "answer",
          answer_summary: "It returns true.",
          evidence: [
            { path: "src/app.py", start_line: 2, end_line: 2, contains: "return False" },
          ],
        },
      ],
    },
    { "eval/fixtures/sample/src/app.py": "def run():\n    return True\n" },
    async (root) => {
      const report = await validateFixtures(root);

      assert.equal(report.ok, false);
      assert.match(report.errors.join("\n"), /evidence text was not found/);
    },
  );
});

test("every fixture file must be classified as eligible or excluded", async () => {
  await withFixture(
    {
      schema_version: "1.0",
      fixture: {
        id: "sample",
        language: "TypeScript",
        root: "eval/fixtures/sample",
        license: "MIT",
      },
      inventory: { eligible: ["src/index.ts"], excluded: [] },
      symbols: [],
      imports: [],
      relationships: [],
      questions: [],
    },
    {
      "eval/fixtures/sample/src/index.ts": "export const value = 1;\n",
      "eval/fixtures/sample/generated/client.ts": "export const generated = true;\n",
    },
    async (root) => {
      const report = await validateFixtures(root);

      assert.equal(report.ok, false);
      assert.match(report.errors.join("\n"), /unclassified fixture file: generated\/client\.ts/);
    },
  );
});

test("fixture integrity records detect line or content drift", async () => {
  await withFixture(
    {
      schema_version: "1.0",
      fixture: {
        id: "sample",
        language: "Python",
        root: "eval/fixtures/sample",
        license: "MIT",
      },
      inventory: { eligible: ["src/app.py"], excluded: [] },
      integrity: [
        { path: "src/app.py", lines: 1, sha256: "not-the-real-digest" },
      ],
      symbols: [],
      imports: [],
      relationships: [],
      questions: [],
    },
    { "eval/fixtures/sample/src/app.py": "def run():\n    return True\n" },
    async (root) => {
      const report = await validateFixtures(root);

      assert.equal(report.ok, false);
      assert.match(report.errors.join("\n"), /integrity mismatch for src\/app\.py/);
    },
  );
});

test("repository-owned evaluation fixtures and answer keys remain aligned", async () => {
  const repositoryRoot = path.resolve(import.meta.dirname, "..", "..");

  const report = await validateFixtures(repositoryRoot);

  assert.equal(report.ok, true, report.errors.join("\n"));
  assert.deepEqual(report.fixtures, ["python-service", "typescript-service"]);
});

test("static relationships must reference declared symbols", async () => {
  await withFixture(
    {
      schema_version: "1.0",
      fixture: {
        id: "sample",
        language: "Python",
        root: "eval/fixtures/sample",
        license: "MIT",
      },
      inventory: { eligible: ["src/app.py"], excluded: [] },
      symbols: [
        { id: "sample.run", kind: "function", name: "run", path: "src/app.py", start_line: 1, end_line: 2 },
      ],
      imports: [],
      relationships: [
        { id: "sample.missing", from: "sample.run", to: "sample.unknown", kind: "calls", verification: "deterministic" },
      ],
      questions: [],
    },
    { "eval/fixtures/sample/src/app.py": "def run():\n    return True\n" },
    async (root) => {
      const report = await validateFixtures(root);

      assert.equal(report.ok, false);
      assert.match(report.errors.join("\n"), /unknown relationship target: sample\.unknown/);
    },
  );
});

test("declared symbols must resolve to source containing their name", async () => {
  await withFixture(
    {
      schema_version: "1.0",
      fixture: {
        id: "sample",
        language: "TypeScript",
        root: "eval/fixtures/sample",
        license: "MIT",
      },
      inventory: { eligible: ["src/index.ts"], excluded: [] },
      symbols: [
        { id: "sample.missing", kind: "function", name: "missing", path: "src/index.ts", start_line: 1, end_line: 1 },
      ],
      imports: [],
      relationships: [],
      questions: [],
    },
    { "eval/fixtures/sample/src/index.ts": "export const value = 1;\n" },
    async (root) => {
      const report = await validateFixtures(root);

      assert.equal(report.ok, false);
      assert.match(report.errors.join("\n"), /symbol name was not found/);
    },
  );
});

test("an integrity-enabled manifest must cover every fixture file", async () => {
  await withFixture(
    {
      schema_version: "1.0",
      fixture: {
        id: "sample",
        language: "Python",
        root: "eval/fixtures/sample",
        license: "MIT",
      },
      inventory: { eligible: ["README.md", "src/app.py"], excluded: [] },
      integrity: [
        { path: "src/app.py", lines: 2, sha256: "unused-in-this-assertion" },
      ],
      symbols: [],
      imports: [],
      relationships: [],
      questions: [],
    },
    {
      "eval/fixtures/sample/README.md": "# Sample\n",
      "eval/fixtures/sample/src/app.py": "def run():\n    return True\n",
    },
    async (root) => {
      const report = await validateFixtures(root);

      assert.equal(report.ok, false);
      assert.match(report.errors.join("\n"), /missing integrity record: README\.md/);
    },
  );
});
