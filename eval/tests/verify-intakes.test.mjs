import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { fetchIntake, loadIntakeManifests, verifyCachedIntake } from "../scripts/verify-intakes.mjs";

const execFile = promisify(execFileCallback);

async function git(cwd, ...args) {
  const result = await execFile("git", args, { cwd, encoding: "utf8" });
  return result.stdout.trim();
}

test("immutable GitHub intake manifests load through the public interface", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cka-intake-"));
  try {
    const directory = path.join(root, "eval", "intakes");
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "sample.json"),
      JSON.stringify({
        schema_version: "1.0",
        intake: {
          id: "sample",
          upstream_url: "https://github.com/example/sample.git",
          commit: "0123456789abcdef0123456789abcdef01234567",
          tree: "89abcdef0123456789abcdef0123456789abcdef",
          capability_tier: "enhanced",
          license: {
            spdx: "MIT",
            path: "LICENSE",
            blob: "fedcba9876543210fedcba9876543210fedcba98",
          },
        },
        observed_inventory: { tracked_files: 1, documentation_like_files: 1 },
        scenario_file: "eval/scenarios/real-world/sample.json",
      }),
      "utf8",
    );

    const result = await loadIntakeManifests(root);

    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.manifests.map((manifest) => manifest.intake.id), ["sample"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cached source is verified against commit, tree, licence blob, and inventory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cka-cache-"));
  const cache = path.join(root, "eval", "cache", "temp", "intakes", "sample");
  try {
    await mkdir(path.join(cache, "src"), { recursive: true });
    await writeFile(path.join(cache, "LICENSE"), "MIT fixture licence\n", "utf8");
    await writeFile(path.join(cache, "README.md"), "# Sample\n", "utf8");
    await writeFile(path.join(cache, "src", "app.py"), "value = 1\n", "utf8");
    await git(cache, "init");
    await git(cache, "add", ".");
    await git(cache, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture");
    const commit = await git(cache, "rev-parse", "HEAD");
    const tree = await git(cache, "rev-parse", "HEAD^{tree}");
    const blob = await git(cache, "hash-object", "LICENSE");
    const manifest = {
      intake: {
        id: "sample",
        commit,
        tree,
        license: { path: "LICENSE", blob },
      },
      observed_inventory: { tracked_files: 3, documentation_like_files: 1 },
    };

    const report = await verifyCachedIntake(root, manifest);

    assert.equal(report.ok, true, report.errors.join("\n"));
    assert.deepEqual(report.inventory, { tracked_files: 3, documentation_like_files: 1 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cached source verifies six evidence-grounded scenarios and rejects stale anchors", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cka-scenarios-"));
  const cache = path.join(root, "eval", "cache", "temp", "intakes", "sample");
  try {
    await mkdir(path.join(cache, "src"), { recursive: true });
    await mkdir(path.join(root, "eval", "scenarios", "real-world"), { recursive: true });
    await writeFile(path.join(cache, "LICENSE"), "MIT fixture licence\n", "utf8");
    await writeFile(path.join(cache, "src", "app.py"), "def run():\n    return 'ready'\n", "utf8");
    await git(cache, "init");
    await git(cache, "add", ".");
    await git(cache, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture");
    const commit = await git(cache, "rev-parse", "HEAD");
    const tree = await git(cache, "rev-parse", "HEAD^{tree}");
    const blob = await git(cache, "hash-object", "LICENSE");
    const scenarios = Array.from({ length: 6 }, (_, index) => ({
      id: `sample-${index + 1}`,
      category: index === 1 ? "cross-file" : "orientation",
      question: `Question ${index + 1}?`,
      expected_behavior: "answer",
      answer_summary: "The run function returns the ready marker.",
      evidence: [
        { path: "src/app.py", start_line: 1, end_line: 2, contains: "return 'ready'" },
        ...(index === 1 ? [{ path: "LICENSE", start_line: 1, end_line: 1, contains: "MIT fixture" }] : []),
      ],
    }));
    await writeFile(
      path.join(root, "eval", "scenarios", "real-world", "sample.json"),
      JSON.stringify({ schema_version: "1.0", intake_id: "sample", source_commit: commit, scenarios }),
      "utf8",
    );
    const manifest = {
      intake: { id: "sample", commit, tree, capability_tier: "enhanced", license: { path: "LICENSE", blob } },
      observed_inventory: { tracked_files: 2, documentation_like_files: 0 },
      scenario_file: "eval/scenarios/real-world/sample.json",
    };

    const report = await verifyCachedIntake(root, manifest);

    assert.equal(report.ok, true, report.errors.join("\n"));
    assert.equal(report.scenarios.verified, 6);

    scenarios[0].evidence[0].contains = "return 'missing'";
    await writeFile(
      path.join(root, "eval", "scenarios", "real-world", "sample.json"),
      JSON.stringify({ schema_version: "1.0", intake_id: "sample", source_commit: commit, scenarios }),
      "utf8",
    );
    const staleReport = await verifyCachedIntake(root, manifest);
    assert.equal(staleReport.ok, false);
    assert.match(staleReport.errors.join("\n"), /evidence anchor not found/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an intake fetches only its pinned commit into the ignored cache", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cka-fetch-"));
  const source = path.join(root, "source");
  const origin = path.join(root, "origin.git");
  try {
    await git(root, "init");
    await mkdir(source, { recursive: true });
    await mkdir(origin, { recursive: true });
    await git(origin, "init", "--bare");
    await writeFile(path.join(source, "LICENSE"), "MIT fixture licence\n", "utf8");
    await writeFile(path.join(source, "README.md"), "# Sample\n", "utf8");
    await git(source, "init");
    await git(source, "add", ".");
    await git(source, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture");
    const commit = await git(source, "rev-parse", "HEAD");
    const tree = await git(source, "rev-parse", "HEAD^{tree}");
    const blob = await git(source, "hash-object", "LICENSE");
    await git(source, "remote", "add", "origin", origin);
    await git(source, "push", "origin", "HEAD:main");
    const manifest = {
      intake: { id: "sample", upstream_url: origin, commit, tree, license: { path: "LICENSE", blob } },
      observed_inventory: { tracked_files: 2, documentation_like_files: 1 },
    };

    const report = await fetchIntake(root, manifest);

    assert.equal(report.ok, true, report.errors.join("\n"));
    assert.equal(await git(path.join(root, "eval", "cache", "temp", "intakes", "sample"), "rev-parse", "HEAD"), commit);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
