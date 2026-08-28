import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { inventoryRepository } from "@code-knowledge-assistant/intake";
import { analyzeRepository } from "../src/index.ts";

async function withRepository(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "analysis-test-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("analyzes eligible Python and TypeScript files with stable provenance", async () => {
  await withRepository(async (root) => {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "tasks.py"), [
      "import os",
      "from app.store import Store",
      "",
      "class TaskService:",
      "    def create(self, title: str):",
      "        return title",
    ].join("\n"));
    await writeFile(path.join(root, "src", "api.ts"), [
      "import { TaskService } from './tasks';",
      "export interface CreateTask { title: string }",
      "export async function createTask(input: CreateTask) {",
      "  return input.title;",
      "}",
    ].join("\n"));
    const inventory = await inventoryRepository(root);

    const result = await analyzeRepository({ root, inventory });

    assert.deepEqual(result.capabilities, [
      { language: "python", tier: "structured", extractor: "deterministic-python-lexical-v1", eligible_files: 1, analyzed_files: 1, failed_files: 0 },
      { language: "typescript", tier: "structured", extractor: "deterministic-typescript-javascript-lexical-v1", eligible_files: 1, analyzed_files: 1, failed_files: 0 },
    ]);
    assert.deepEqual(result.files.flatMap((file) => file.symbols.map((symbol) => [symbol.name, symbol.kind, symbol.range])), [
      ["CreateTask", "interface", { path: "src/api.ts", start_line: 2, end_line: 2 }],
      ["createTask", "function", { path: "src/api.ts", start_line: 3, end_line: 5 }],
      ["TaskService", "class", { path: "src/tasks.py", start_line: 4, end_line: 6 }],
      ["create", "function", { path: "src/tasks.py", start_line: 5, end_line: 6 }],
    ]);
    assert.deepEqual(result.files.flatMap((file) => file.imports.map((item) => item.specifier)), ["./tasks", "os", "app.store"]);
    assert.equal(result.chunks.every((chunk) => chunk.range.path.startsWith("src/")), true);
    assert.equal(result.chunks.every((chunk) => chunk.range.start_line >= 1), true);
  });
});

test("uses fallback only for eligible unknown text and records inventory exclusions", async () => {
  await withRepository(async (root) => {
    await writeFile(path.join(root, "notes.rb"), "class Note\n  end\n");
    await writeFile(path.join(root, ".env"), "TOKEN=secret");
    const inventory = await inventoryRepository(root);

    const result = await analyzeRepository({ root, inventory });

    assert.deepEqual(result.capabilities, [
      { language: "text", tier: "fallback", extractor: "bounded-text-v1", eligible_files: 1, analyzed_files: 1, failed_files: 0 },
    ]);
    assert.deepEqual(result.files[0]?.symbols, []);
    assert.deepEqual(result.exclusions, [{ path: ".env", reason: "sensitive" }]);
    assert.equal(result.chunks[0]?.content, "class Note\n  end\n");
  });
});

test("extracts JavaScript ESM and CommonJS facts while keeping chunks bounded", async () => {
  await withRepository(async (root) => {
    await writeFile(path.join(root, "worker.js"), [
      "const store = require('./store');",
      "import logger from './logger';",
      "export class Worker {",
      "  run() { return store.run(); }",
      "}",
    ].join("\n"));
    const inventory = await inventoryRepository(root);

    const result = await analyzeRepository({ root, inventory, maxChunkCharacters: 20 });

    assert.deepEqual(result.files[0]?.symbols, [{
      name: "Worker", kind: "class", range: { path: "worker.js", start_line: 3, end_line: 5 },
    }]);
    assert.deepEqual(result.files[0]?.imports.map((item) => item.specifier), ["./store", "./logger"]);
    assert.equal(result.chunks.every((chunk) => chunk.content.length <= 20), true);
  });
});

test("fails closed on drifting or invalid inventory paths without placing source in failures", async () => {
  await withRepository(async (root) => {
    await writeFile(path.join(root, "stable.py"), "def stable():\n    return 1\n");
    const inventory = await inventoryRepository(root);
    await writeFile(path.join(root, "stable.py"), "def changed():\n    return 2\n");
    const altered = structuredClone(inventory);
    altered.entries.push({
      kind: "file", path: "../outside.py", byte_size: 1, sha256: "x", line_count: 1,
      eligibility: "eligible", exclusion_reason: null,
    });

    const result = await analyzeRepository({ root, inventory: altered });

    assert.deepEqual(result.files, []);
    assert.deepEqual(result.failures, [
      { path: "../outside.py", code: "INVENTORY_PATH_INVALID" },
      { path: "stable.py", code: "FILE_DRIFTED" },
    ]);
    assert.equal(JSON.stringify(result.failures).includes("changed"), false);
  });
});
