import { access, readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function isSafeRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || path.isAbsolute(value)) return false;
  const normalized = value.replaceAll("\\", "/");
  return !normalized.split("/").includes("..");
}

async function listFiles(root, relativeDirectory = "") {
  const directory = path.join(root, relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory.replaceAll("\\", "/"), entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(root, relativePath)));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files;
}

export async function validateFixtures(repositoryRoot) {
  const manifestRoot = path.join(repositoryRoot, "eval", "ground-truth");
  const errors = [];
  const fixtures = [];
  let manifestNames = [];

  try {
    manifestNames = (await readdir(manifestRoot)).filter((name) => name.endsWith(".json"));
  } catch (error) {
    return { ok: false, fixtures, errors: [`Cannot read ${manifestRoot}: ${error.message}`] };
  }

  for (const manifestName of manifestNames.sort()) {
    const manifestPath = path.join(manifestRoot, manifestName);
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      const fixtureId = manifest?.fixture?.id;
      const fixtureRoot = manifest?.fixture?.root;
      if (manifest.schema_version !== "1.0" || !fixtureId || !fixtureRoot) {
        errors.push(`${manifestName}: missing required fixture metadata`);
        continue;
      }

      fixtures.push(fixtureId);
      const fixtureDirectory = path.join(repositoryRoot, fixtureRoot);
      const eligible = manifest.inventory?.eligible ?? [];
      const excluded = (manifest.inventory?.excluded ?? []).map((entry) => entry.path);
      const classified = new Set([...eligible, ...excluded]);
      if (await exists(fixtureDirectory)) {
        for (const relativePath of await listFiles(fixtureDirectory)) {
          if (!classified.has(relativePath)) {
            errors.push(`${fixtureId}: unclassified fixture file: ${relativePath}`);
          }
        }
      } else {
        errors.push(`${fixtureId}: fixture root does not exist: ${fixtureRoot}`);
      }
      for (const relativePath of eligible) {
        if (!isSafeRelativePath(relativePath)) {
          errors.push(`${fixtureId}: unsafe fixture path: ${relativePath}`);
          continue;
        }
        const target = path.join(repositoryRoot, fixtureRoot, relativePath);
        if (!(await exists(target))) {
          errors.push(`${fixtureId}: eligible file does not exist: ${relativePath}`);
        }
      }

      const integrityEntries = manifest.integrity ?? [];
      if (integrityEntries.length > 0) {
        const integrityPaths = new Set(integrityEntries.map((entry) => entry.path));
        for (const relativePath of classified) {
          if (!integrityPaths.has(relativePath)) {
            errors.push(`${fixtureId}: missing integrity record: ${relativePath}`);
          }
        }
      }
      for (const integrity of integrityEntries) {
        if (!isSafeRelativePath(integrity.path)) {
          errors.push(`${fixtureId}: unsafe integrity path: ${integrity.path}`);
          continue;
        }
        const target = path.join(repositoryRoot, fixtureRoot, integrity.path);
        if (!(await exists(target))) {
          errors.push(`${fixtureId}: integrity file does not exist: ${integrity.path}`);
          continue;
        }
        const content = await readFile(target, "utf8");
        const normalized = content.replaceAll("\r\n", "\n").replace(/\n$/, "");
        const lines = normalized.length === 0 ? 0 : normalized.split("\n").length;
        const sha256 = createHash("sha256").update(content, "utf8").digest("hex");
        if (integrity.lines !== lines || integrity.sha256 !== sha256) {
          errors.push(`${fixtureId}: integrity mismatch for ${integrity.path}`);
        }
      }

      const symbolIds = new Set();
      for (const symbol of manifest.symbols ?? []) {
        if (symbolIds.has(symbol.id)) errors.push(`${fixtureId}: duplicate symbol id: ${symbol.id}`);
        symbolIds.add(symbol.id);
        if (!isSafeRelativePath(symbol.path)) {
          errors.push(`${fixtureId}: unsafe symbol path: ${symbol.path}`);
          continue;
        }
        const target = path.join(repositoryRoot, fixtureRoot, symbol.path);
        if (!(await exists(target))) {
          errors.push(`${fixtureId}: symbol file does not exist: ${symbol.path}`);
          continue;
        }
        const lines = (await readFile(target, "utf8")).split(/\r?\n/);
        if (
          !Number.isInteger(symbol.start_line) ||
          !Number.isInteger(symbol.end_line) ||
          symbol.start_line < 1 ||
          symbol.end_line < symbol.start_line ||
          symbol.end_line > lines.length
        ) {
          errors.push(`${fixtureId}: invalid symbol range for ${symbol.id}`);
          continue;
        }
        const excerpt = lines.slice(symbol.start_line - 1, symbol.end_line).join("\n");
        if (!excerpt.includes(symbol.name)) {
          errors.push(`${fixtureId}: symbol name was not found for ${symbol.id}`);
        }
      }
      const relationshipIds = new Set();
      for (const relationship of manifest.relationships ?? []) {
        if (relationshipIds.has(relationship.id)) {
          errors.push(`${fixtureId}: duplicate relationship id: ${relationship.id}`);
        }
        relationshipIds.add(relationship.id);
        if (!symbolIds.has(relationship.from) && !relationship.from?.startsWith("external:")) {
          errors.push(`${fixtureId}: unknown relationship source: ${relationship.from}`);
        }
        if (!symbolIds.has(relationship.to) && !relationship.to?.startsWith("external:")) {
          errors.push(`${fixtureId}: unknown relationship target: ${relationship.to}`);
        }
      }

      for (const question of manifest.questions ?? []) {
        for (const evidence of question.evidence ?? []) {
          if (!isSafeRelativePath(evidence.path)) {
            errors.push(`${fixtureId}: unsafe evidence path: ${evidence.path}`);
            continue;
          }
          const target = path.join(repositoryRoot, fixtureRoot, evidence.path);
          if (!(await exists(target))) {
            errors.push(`${fixtureId}: evidence file does not exist: ${evidence.path}`);
            continue;
          }
          const lines = (await readFile(target, "utf8")).split(/\r?\n/);
          const start = evidence.start_line;
          const end = evidence.end_line;
          if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > lines.length) {
            errors.push(`${fixtureId}: invalid evidence range for ${evidence.path}:${start}-${end}`);
            continue;
          }
          const excerpt = lines.slice(start - 1, end).join("\n");
          if (evidence.contains && !excerpt.includes(evidence.contains)) {
            errors.push(`${fixtureId}: evidence text was not found at ${evidence.path}:${start}-${end}`);
          }
        }
      }
    } catch (error) {
      errors.push(`${manifestName}: ${error.message}`);
    }
  }

  return { ok: errors.length === 0, fixtures, errors };
}

async function main() {
  const repositoryRoot = path.resolve(process.argv[2] ?? process.cwd());
  const report = await validateFixtures(repositoryRoot);
  if (report.ok) {
    console.log(`Validated ${report.fixtures.length} fixture(s): ${report.fixtures.join(", ")}`);
    return;
  }
  for (const error of report.errors) console.error(error);
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
