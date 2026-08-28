#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadScenarioCorpus, runLexicalBaseline, validateScenarioSources } from "../../packages/evaluation/src/index.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputArgument = process.argv[2] ?? "eval/results/lexical/baseline-v1.json";
const outputPath = path.resolve(repositoryRoot, outputArgument);
if (outputPath !== repositoryRoot && !outputPath.startsWith(`${repositoryRoot}${path.sep}`)) {
  throw new Error("output path must remain inside the repository");
}

const corpus = await loadScenarioCorpus(repositoryRoot);
if (!corpus.ok) throw new Error(corpus.errors.join("\n"));
const evidence = await validateScenarioSources(repositoryRoot, corpus.scenarios);
if (!evidence.ok) throw new Error(evidence.errors.join("\n"));

const result = await runLexicalBaseline(repositoryRoot, corpus.scenarios);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

console.log(`Wrote ${path.relative(repositoryRoot, outputPath)}`);
console.log(`Scenarios: ${result.summary.scenario_count}`);
console.log(`Retrieval recall@10: ${result.summary.retrieval_recall_at_10}`);
console.log("Provider calls: 0; cost: $0.00");
