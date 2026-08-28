import { execFile as execFileCallback } from "node:child_process";
import { access, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const SHA1 = /^[0-9a-f]{40}$/;
const ALLOWED_TIERS = new Set(["enhanced", "structured", "fallback"]);
const ALLOWED_BEHAVIORS = new Set(["answer", "qualify", "refuse"]);
const execFile = promisify(execFileCallback);

async function git(cwd, ...args) {
  const result = await execFile("git", args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return result.stdout.trim();
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function isDocumentationLike(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  return (
    /(^|\/)(docs?|documentation)(\/|$)/i.test(normalized) ||
    /(^|\/)(README|ARCHITECTURE|CONTRIBUTING)(\.|$)/i.test(normalized)
  );
}

function validateManifest(manifest, filename) {
  const errors = [];
  const intake = manifest?.intake;
  if (manifest?.schema_version !== "1.0") errors.push(`${filename}: unsupported schema_version`);
  if (!intake?.id) errors.push(`${filename}: missing intake id`);
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(intake?.upstream_url ?? "")) {
    errors.push(`${filename}: upstream_url must be an HTTPS GitHub repository ending in .git`);
  }
  if (!SHA1.test(intake?.commit ?? "")) errors.push(`${filename}: commit must be an immutable 40-character SHA-1`);
  if (!SHA1.test(intake?.tree ?? "")) errors.push(`${filename}: tree must be a 40-character SHA-1`);
  if (!ALLOWED_TIERS.has(intake?.capability_tier)) errors.push(`${filename}: invalid capability_tier`);
  if (!intake?.license?.spdx || !intake?.license?.path || !SHA1.test(intake?.license?.blob ?? "")) {
    errors.push(`${filename}: incomplete immutable licence record`);
  }
  if (!Number.isInteger(manifest?.observed_inventory?.tracked_files)) {
    errors.push(`${filename}: observed tracked_files must be an integer`);
  }
  if (!manifest?.scenario_file) errors.push(`${filename}: missing scenario_file`);
  return errors;
}

export async function loadIntakeManifests(repositoryRoot) {
  const directory = path.join(repositoryRoot, "eval", "intakes");
  const manifests = [];
  const errors = [];
  let filenames = [];
  try {
    filenames = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    return { ok: false, manifests, errors: [`Cannot read ${directory}: ${error.message}`] };
  }
  for (const filename of filenames) {
    try {
      const manifest = JSON.parse(await readFile(path.join(directory, filename), "utf8"));
      const manifestErrors = validateManifest(manifest, filename);
      errors.push(...manifestErrors);
      if (manifestErrors.length === 0) manifests.push(manifest);
    } catch (error) {
      errors.push(`${filename}: ${error.message}`);
    }
  }
  return { ok: errors.length === 0, manifests, errors };
}

export async function verifyCachedIntake(repositoryRoot, manifest) {
  const intake = manifest.intake;
  const cache = path.join(repositoryRoot, "eval", "cache", "temp", "intakes", intake.id);
  const errors = [];
  let inventory = { tracked_files: 0, documentation_like_files: 0 };
  let scenarios = { verified: 0 };
  try {
    const commit = await git(cache, "rev-parse", "HEAD");
    if (commit !== intake.commit) errors.push(`${intake.id}: cached commit mismatch`);
    const tree = await git(cache, "rev-parse", "HEAD^{tree}");
    if (tree !== intake.tree) errors.push(`${intake.id}: cached tree mismatch`);
    const licenceBlob = await git(cache, "hash-object", intake.license.path);
    if (licenceBlob !== intake.license.blob) errors.push(`${intake.id}: licence blob mismatch`);
    const status = await git(cache, "status", "--porcelain");
    if (status) errors.push(`${intake.id}: cached checkout is dirty`);
    const tracked = (await git(cache, "ls-tree", "-r", "--name-only", "HEAD"))
      .split(/\r?\n/)
      .filter(Boolean);
    inventory = {
      tracked_files: tracked.length,
      documentation_like_files: tracked.filter(isDocumentationLike).length,
    };
    if (inventory.tracked_files !== manifest.observed_inventory.tracked_files) {
      errors.push(`${intake.id}: tracked file count mismatch`);
    }
    if (inventory.documentation_like_files !== manifest.observed_inventory.documentation_like_files) {
      errors.push(`${intake.id}: documentation-like file count mismatch`);
    }
    if (manifest.scenario_file) {
      scenarios = await verifyScenarioSet(repositoryRoot, manifest, cache, new Set(tracked));
      errors.push(...scenarios.errors);
    }
  } catch (error) {
    errors.push(`${intake.id}: cannot verify cached source: ${error.message}`);
  }
  return { ok: errors.length === 0, errors, inventory, scenarios };
}

async function verifyScenarioSet(repositoryRoot, manifest, cache, trackedPaths) {
  const intake = manifest.intake;
  const errors = [];
  const scenarioPath = path.resolve(repositoryRoot, manifest.scenario_file ?? "");
  const scenarioRoot = path.resolve(repositoryRoot, "eval", "scenarios", "real-world");
  if (scenarioPath !== scenarioRoot && !scenarioPath.startsWith(`${scenarioRoot}${path.sep}`)) {
    return { verified: 0, errors: [`${intake.id}: scenario_file escapes the real-world scenario directory`] };
  }

  let set;
  try {
    set = JSON.parse(await readFile(scenarioPath, "utf8"));
  } catch (error) {
    return { verified: 0, errors: [`${intake.id}: cannot read scenario set: ${error.message}`] };
  }
  if (set.schema_version !== "1.0") errors.push(`${intake.id}: unsupported scenario schema_version`);
  if (set.intake_id !== intake.id) errors.push(`${intake.id}: scenario intake_id mismatch`);
  if (set.source_commit !== intake.commit) errors.push(`${intake.id}: scenario source_commit mismatch`);
  if (!Array.isArray(set.scenarios) || set.scenarios.length !== 6) {
    errors.push(`${intake.id}: scenario set must contain exactly six questions`);
    return { verified: 0, errors };
  }

  const identifiers = new Set();
  for (const scenario of set.scenarios) {
    const prefix = `${intake.id}/${scenario?.id ?? "unknown"}`;
    if (!scenario?.id || identifiers.has(scenario.id)) errors.push(`${prefix}: missing or duplicate scenario id`);
    identifiers.add(scenario?.id);
    if (!scenario?.category || !scenario?.question || !scenario?.answer_summary) {
      errors.push(`${prefix}: incomplete scenario description`);
    }
    if (!ALLOWED_BEHAVIORS.has(scenario?.expected_behavior)) {
      errors.push(`${prefix}: invalid expected_behavior`);
    }
    if (!Array.isArray(scenario?.evidence) || scenario.evidence.length === 0) {
      errors.push(`${prefix}: at least one evidence citation is required`);
      continue;
    }
    for (const citation of scenario.evidence) {
      const normalized = String(citation?.path ?? "").replaceAll("\\", "/");
      const absolute = path.resolve(cache, normalized);
      if (!normalized || path.isAbsolute(normalized) || normalized.startsWith("../") || !absolute.startsWith(`${cache}${path.sep}`)) {
        errors.push(`${prefix}: invalid evidence path`);
        continue;
      }
      if (!trackedPaths.has(normalized)) {
        errors.push(`${prefix}: evidence path is not tracked at the pinned commit: ${normalized}`);
        continue;
      }
      const start = citation?.start_line;
      const end = citation?.end_line;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
        errors.push(`${prefix}: invalid evidence line range for ${normalized}`);
        continue;
      }
      const lines = (await readFile(absolute, "utf8")).split(/\r?\n/);
      if (end > lines.length) {
        errors.push(`${prefix}: evidence line range exceeds ${normalized}`);
        continue;
      }
      const excerpt = lines.slice(start - 1, end).join("\n");
      if (!citation?.contains || !excerpt.includes(citation.contains)) {
        errors.push(`${prefix}: evidence anchor not found in ${normalized}:${start}-${end}`);
      }
    }
  }

  const crossFile = set.scenarios.some(
    (scenario) => scenario.category === "cross-file" && new Set(scenario.evidence?.map((item) => item.path)).size >= 2,
  );
  if (intake.capability_tier === "enhanced" && !crossFile) {
    errors.push(`${intake.id}: enhanced intake requires a cross-file scenario with at least two evidence paths`);
  }
  if (
    intake.capability_tier === "structured" &&
    !set.scenarios.some((scenario) => scenario.category === "limitation" && scenario.expected_behavior === "qualify")
  ) {
    errors.push(`${intake.id}: structured intake requires a limitation scenario with qualify behavior`);
  }

  return { verified: errors.length === 0 ? set.scenarios.length : 0, errors };
}

export async function fetchIntake(repositoryRoot, manifest) {
  const intake = manifest.intake;
  const cache = path.join(repositoryRoot, "eval", "cache", "temp", "intakes", intake.id);
  const errors = [];
  try {
    await mkdir(cache, { recursive: true });
    if (await exists(path.join(cache, ".git"))) {
      const status = await git(cache, "status", "--porcelain");
      if (status) return { ok: false, errors: [`${intake.id}: refusing to update a dirty cache`] };
    } else {
      await git(cache, "init");
    }
    try {
      const currentOrigin = await git(cache, "remote", "get-url", "origin");
      if (currentOrigin !== intake.upstream_url) {
        return { ok: false, errors: [`${intake.id}: cache origin mismatch`] };
      }
    } catch {
      await git(cache, "remote", "add", "origin", intake.upstream_url);
    }
    await git(cache, "fetch", "--depth=1", "origin", intake.commit);
    await git(cache, "-c", "advice.detachedHead=false", "checkout", "--detach", "FETCH_HEAD");
  } catch (error) {
    errors.push(`${intake.id}: fetch failed: ${error.message}`);
    return { ok: false, errors };
  }
  return verifyCachedIntake(repositoryRoot, manifest);
}

async function main() {
  const arguments_ = process.argv.slice(2);
  const shouldFetch = arguments_.includes("--fetch");
  const rootArgument = arguments_.find((argument) => !argument.startsWith("--"));
  const repositoryRoot = path.resolve(rootArgument ?? process.cwd());
  const result = await loadIntakeManifests(repositoryRoot);
  if (!result.ok) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
    return;
  }
  for (const manifest of result.manifests) {
    const report = shouldFetch
      ? await fetchIntake(repositoryRoot, manifest)
      : await verifyCachedIntake(repositoryRoot, manifest);
    if (!report.ok) {
      for (const error of report.errors) console.error(error);
      process.exitCode = 1;
    } else {
      console.log(`Verified ${manifest.intake.id} at ${manifest.intake.commit}.`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
