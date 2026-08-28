import path from "node:path";

import {
  loadScenarioCorpus,
  validateScenarioSources,
} from "../../packages/evaluation/src/scenario-corpus.mjs";

const repositoryRoot = path.resolve(process.argv[2] ?? process.cwd());
const corpus = await loadScenarioCorpus(repositoryRoot);
if (!corpus.ok) {
  for (const error of corpus.errors) console.error(error);
  process.exitCode = 1;
} else {
  const sources = await validateScenarioSources(repositoryRoot, corpus.scenarios);
  if (!sources.ok) {
    for (const error of sources.errors) console.error(error);
    process.exitCode = 1;
  } else {
    console.log(
      `Validated ${corpus.scenarios.length} scenarios and ${sources.verified_citations} source citations: ` +
        `${corpus.summary.deterministic_fixture} deterministic, ${corpus.summary.real_world} real-world, ` +
        `${corpus.summary.unsupported_or_ambiguous} unsupported/ambiguous, ${corpus.summary.adversarial} adversarial.`,
    );
  }
}
