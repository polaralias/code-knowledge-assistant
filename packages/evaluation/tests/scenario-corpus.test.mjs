import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadScenarioCorpus, validateScenarioSources } from "../src/scenario-corpus.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("the checked corpus contains exactly 42 uniquely tagged scenarios", async () => {
  const result = await loadScenarioCorpus(repositoryRoot);

  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.scenarios.length, 42);
  assert.equal(new Set(result.scenarios.map((scenario) => scenario.id)).size, 42);
  for (const scenario of result.scenarios) {
    assert.ok(scenario.repository_id);
    assert.ok(["enhanced", "structured", "fallback"].includes(scenario.capability_tier));
    assert.ok(["factual", "cross-file", "boundary", "adversarial"].includes(scenario.difficulty));
    assert.ok(scenario.evidence_type);
    assert.ok(scenario.scoring.mode);
    assert.ok(scenario.evidence.length > 0);
  }
  assert.equal(result.summary.deterministic_fixture, 16);
  assert.equal(result.summary.real_world, 18);
  assert.equal(result.summary.unsupported_or_ambiguous, 4);
  assert.equal(result.summary.adversarial, 4);
});

test("all corpus evidence resolves to its pinned or fixture source range", async () => {
  const corpus = await loadScenarioCorpus(repositoryRoot);
  const result = await validateScenarioSources(repositoryRoot, corpus.scenarios);

  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.verified_citations, corpus.scenarios.reduce((total, scenario) => total + scenario.evidence.length, 0));
});
