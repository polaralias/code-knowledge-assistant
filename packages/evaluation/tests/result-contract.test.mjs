import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateEvaluationResult } from "../src/validate-result.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("the published JSON Schema and empty template expose the complete result boundary", async () => {
  const [schema, template] = await Promise.all([
    readFile(path.join(repositoryRoot, "eval/schema/evaluation-result.schema.json"), "utf8").then(JSON.parse),
    readFile(path.join(repositoryRoot, "eval/schema/evaluation-result.template.json"), "utf8").then(JSON.parse),
  ]);

  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.deepEqual(schema.required, ["schema_version", "run", "inventory", "extraction", "scenarios"]);
  assert.ok(schema.$defs.run.required.includes("generation"));
  assert.ok(schema.$defs.run.required.includes("retrieval"));
  assert.ok(schema.$defs.scenario.required.includes("security"));
  assert.ok(schema.$defs.scenario.required.includes("usage"));

  const validation = validateEvaluationResult(template);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /run\.id/);
  assert.match(validation.errors.join("\n"), /scenarios must be a non-empty array/);
});
