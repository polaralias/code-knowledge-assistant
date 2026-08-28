import assert from "node:assert/strict";
import { access } from "node:fs/promises";
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

test("all repository-tracked corpus evidence resolves to its fixture source range", async () => {
  const corpus = await loadScenarioCorpus(repositoryRoot);
  const tracked = corpus.scenarios.filter((scenario) => !scenario.source_root.startsWith("eval/cache/"));
  const result = await validateScenarioSources(repositoryRoot, tracked);

  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.verified_citations, tracked.reduce((total, scenario) => total + scenario.evidence.length, 0));
});

test("qualified real-world evidence resolves when immutable intake caches are available", async (context) => {
  const corpus = await loadScenarioCorpus(repositoryRoot);
  const realWorld = corpus.scenarios.filter((scenario) => scenario.source_root.startsWith("eval/cache/"));
  const roots = [...new Set(realWorld.map((scenario) => path.resolve(repositoryRoot, scenario.source_root)))];
  const available = await Promise.all(roots.map((root) => access(root).then(() => true, () => false)));
  if (available.some((value) => !value)) {
    context.skip("immutable intake caches are deliberately ignored and must be qualified separately");
    return;
  }

  const result = await validateScenarioSources(repositoryRoot, realWorld);
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.verified_citations, realWorld.reduce((total, scenario) => total + scenario.evidence.length, 0));
});
