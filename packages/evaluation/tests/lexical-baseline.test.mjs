import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildLexicalIndex,
  collectTextFiles,
  evidenceRecall,
  runLexicalBaseline,
  retrieveLexically,
} from "../src/lexical-baseline.mjs";

test("lexical retrieval ranks the matching source chunk and reports evidence recall", () => {
  const files = [
    { path: "src/api.py", text: "def create_ticket(title):\n    return service.persist(title)\n" },
    { path: "src/config.py", text: "PORT = 8080\n" },
  ];
  const index = buildLexicalIndex(files, { windowLines: 2, overlapLines: 0 });
  const retrieved = retrieveLexically(index, "Where does create_ticket persist a title?", 10);

  assert.equal(retrieved[0].path, "src/api.py");
  assert.equal(retrieved[0].start_line, 1);
  assert.equal(evidenceRecall([{ path: "src/api.py", start_line: 1, end_line: 2 }], retrieved), 1);
});

test("file collection excludes repository metadata, generated output, binaries, and oversized files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-lexical-"));
  await mkdir(path.join(root, ".git"));
  await mkdir(path.join(root, "dist"));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, ".git", "config"), "secret metadata");
  await writeFile(path.join(root, "dist", "bundle.js"), "generated output");
  await writeFile(path.join(root, "src", "main.ts"), "export function main() {}\n");
  await writeFile(path.join(root, "src", "image.bin"), Buffer.from([0, 1, 2, 3]));
  await writeFile(path.join(root, "large.txt"), "x".repeat(101));

  const files = await collectTextFiles(root, { maxBytes: 100 });

  assert.deepEqual(files.map((file) => file.path), ["src/main.ts"]);
});

test("lexical ordering is stable when scores tie", () => {
  const index = buildLexicalIndex([
    { path: "b.txt", text: "shared token\n" },
    { path: "a.txt", text: "shared token\n" },
  ]);

  assert.deepEqual(
    retrieveLexically(index, "shared", 10).map((item) => item.path),
    ["a.txt", "b.txt"],
  );
});

test("a baseline run reports source and aggregate recall without provider usage", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cka-baseline-"));
  await mkdir(path.join(root, "fixture"));
  await writeFile(path.join(root, "fixture", "service.py"), "def save_ticket():\n    repository.add(ticket)\n");
  const scenarios = [{
    id: "save-flow",
    repository_id: "fixture",
    source_root: "fixture",
    source_revision: "fixture-v1",
    question: "Where is a ticket saved to the repository?",
    evidence: [{ path: "service.py", start_line: 1, end_line: 2 }],
  }];

  const result = await runLexicalBaseline(root, scenarios, { createdAt: "2026-08-26T00:00:00Z" });

  assert.equal(result.schema_version, "1.0");
  assert.equal(result.run.retriever.name, "bm25");
  assert.equal(result.run.provider_calls, 0);
  assert.equal(result.run.cost_usd, 0);
  assert.equal(result.summary.scenario_count, 1);
  assert.equal(result.summary.retrieval_recall_at_10, 1);
  assert.equal(result.sources[0].file_count, 1);
});
