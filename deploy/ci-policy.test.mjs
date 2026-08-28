import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("CI is read-only, bounded, reproducible, and exercises release policy", async () => {
  const workflow = await read(".github/workflows/ci.yml");
  for (const required of [
    "permissions:\n  contents: read", "timeout-minutes:", "cancel-in-progress: true", "node-version: 24",
    "corepack prepare pnpm@11.24.0 --activate", "pnpm install --frozen-lockfile", "pnpm typecheck", "pnpm test",
    "pnpm audit --prod --audit-level high", "node --test deploy/*.test.mjs", "docker build",
    "actions/dependency-review-action@v4", "gitleaks/gitleaks-action@v3",
  ]) assert.ok(workflow.includes(required), `missing CI policy: ${required}`);
  assert.doesNotMatch(workflow, /pull_request_target/u);
});

test("release automation uses a valid version and keeps write permissions out of source verification", async () => {
  assert.match((await read("VERSION")).trim(), /^0\.[1-9]\d*\.\d+$/u);
  const release = await read(".github/workflows/release.yml");
  assert.match(release, /workflow_dispatch:/u);
  assert.match(release, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(release, /verify:[\s\S]+permissions:\n      contents: read/u);
  assert.match(release, /publish:[\s\S]+needs: verify[\s\S]+permissions:\n      contents: write/u);
  const publish = release.slice(release.indexOf("  publish:"));
  assert.doesNotMatch(publish, /actions\/checkout|pnpm |npm |node --test|docker build/u);
});

test("release drafting never grants write permission to pull-request code", async () => {
  const workflow = await read(".github/workflows/release-drafter.yml");
  assert.doesNotMatch(workflow, /pull_request:/u);
  assert.match(workflow, /push:\n    branches: \[main\]/u);
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /timeout-minutes:/u);
});
