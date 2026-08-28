import { readFile } from "node:fs/promises";
import path from "node:path";

import { evaluateRun } from "../../packages/evaluation/src/evaluate-run.mjs";
import { loadScenarioCorpus } from "../../packages/evaluation/src/scenario-corpus.mjs";

const resultPath = process.argv[2];
if (!resultPath) {
  console.error("Usage: node eval/scripts/evaluate-result.mjs <result.json>");
  process.exitCode = 2;
} else {
  try {
    const result = JSON.parse(await readFile(path.resolve(resultPath), "utf8"));
    const corpus = await loadScenarioCorpus(process.cwd());
    if (!corpus.ok) throw new Error(`checked corpus is invalid: ${corpus.errors.join("; ")}`);
    const report = evaluateRun(result, { corpus: corpus.scenarios });
    console.log(JSON.stringify(report, null, 2));
    if (!report.valid || !report.passed) process.exitCode = 1;
  } catch (error) {
    console.error(`Cannot evaluate result: ${error.message}`);
    process.exitCode = 2;
  }
}
