import { readFile } from "node:fs/promises";
import path from "node:path";

async function readJson(repositoryRoot, relativePath) {
  return JSON.parse(await readFile(path.join(repositoryRoot, relativePath), "utf8"));
}

function difficultyFor(scenario) {
  if (scenario.group === "adversarial" || scenario.category === "adversarial") return "adversarial";
  if (scenario.expected_behavior !== "answer" || scenario.category === "limitation") return "boundary";
  if (scenario.category === "cross-file" || new Set(scenario.evidence.map((item) => item.path)).size > 1) {
    return "cross-file";
  }
  return "factual";
}

function scoringFor(scenario) {
  if (scenario.group === "adversarial") return { mode: "security-invariant" };
  if (scenario.expected_behavior !== "answer") return { mode: "boundary-behavior" };
  return { mode: "evidence-and-behavior" };
}

function normalize(scenario, source) {
  return {
    ...scenario,
    repository_id: source.repository_id,
    source_root: source.source_root,
    source_revision: source.source_revision,
    capability_tier: source.capability_tier,
    group: scenario.group ?? source.group,
    difficulty: scenario.difficulty ?? difficultyFor(scenario),
    evidence_type: scenario.evidence_type ?? "line-range",
    scoring: scenario.scoring ?? scoringFor(scenario),
  };
}

function validateCorpus(scenarios) {
  const errors = [];
  const identifiers = new Set();
  const allowedTiers = new Set(["enhanced", "structured", "fallback"]);
  const allowedDifficulty = new Set(["factual", "cross-file", "boundary", "adversarial"]);
  for (const scenario of scenarios) {
    const prefix = scenario.id ?? "unknown";
    if (!scenario.id || identifiers.has(scenario.id)) errors.push(`${prefix}: missing or duplicate id`);
    identifiers.add(scenario.id);
    if (!scenario.repository_id || !scenario.source_root || !scenario.source_revision) errors.push(`${prefix}: missing source metadata`);
    if (!allowedTiers.has(scenario.capability_tier)) errors.push(`${prefix}: invalid capability tier`);
    if (!allowedDifficulty.has(scenario.difficulty)) errors.push(`${prefix}: invalid difficulty`);
    if (!scenario.evidence_type || !scenario.scoring?.mode) errors.push(`${prefix}: missing scoring metadata`);
    if (!Array.isArray(scenario.evidence) || scenario.evidence.length === 0) errors.push(`${prefix}: missing evidence`);
  }
  if (scenarios.length !== 42) errors.push(`corpus must contain exactly 42 scenarios; found ${scenarios.length}`);
  return errors;
}

export async function loadScenarioCorpus(repositoryRoot) {
  const errors = [];
  const scenarios = [];
  try {
    for (const id of ["python-service", "typescript-service"]) {
      const document = await readJson(repositoryRoot, `eval/ground-truth/${id}.json`);
      const source = {
        repository_id: document.fixture.id,
        source_root: document.fixture.root,
        source_revision: "fixture-v1",
        capability_tier: "enhanced",
        group: "deterministic_fixture",
      };
      scenarios.push(...document.questions.map((scenario) => normalize(scenario, source)));
    }
    for (const id of ["poetry", "uptime-kuma", "pocketbase"]) {
      const [set, manifest] = await Promise.all([
        readJson(repositoryRoot, `eval/scenarios/real-world/${id}.json`),
        readJson(repositoryRoot, `eval/intakes/${id}.json`),
      ]);
      const source = {
        repository_id: id,
        source_root: `eval/cache/temp/intakes/${id}`,
        source_revision: manifest.intake.commit,
        capability_tier: manifest.intake.capability_tier,
        group: "real_world",
      };
      scenarios.push(...set.scenarios.map((scenario) => normalize(scenario, source)));
    }
    const safety = await readJson(repositoryRoot, "eval/scenarios/safety.json");
    scenarios.push(
      ...safety.scenarios.map((scenario) =>
        normalize(scenario, {
          repository_id: safety.repository_id,
          source_root: safety.source_root,
          source_revision: safety.source_revision,
          capability_tier: safety.capability_tier,
        }),
      ),
    );
    errors.push(...validateCorpus(scenarios));
  } catch (error) {
    errors.push(error.message);
  }
  const groups = ["deterministic_fixture", "real_world", "unsupported_or_ambiguous", "adversarial"];
  return {
    ok: errors.length === 0,
    errors,
    scenarios,
    summary: Object.fromEntries(groups.map((group) => [group, scenarios.filter((item) => item.group === group).length])),
  };
}

export async function validateScenarioSources(repositoryRoot, scenarios) {
  const errors = [];
  let verifiedCitations = 0;
  const root = path.resolve(repositoryRoot);
  for (const scenario of scenarios) {
    const sourceRoot = path.resolve(root, scenario.source_root);
    if (sourceRoot !== root && !sourceRoot.startsWith(`${root}${path.sep}`)) {
      errors.push(`${scenario.id}: source root escapes the repository`);
      continue;
    }
    for (const citation of scenario.evidence) {
      const normalized = String(citation.path ?? "").replaceAll("\\", "/");
      const sourcePath = path.resolve(sourceRoot, normalized);
      if (
        !normalized ||
        path.isAbsolute(normalized) ||
        normalized.startsWith("../") ||
        !sourcePath.startsWith(`${sourceRoot}${path.sep}`)
      ) {
        errors.push(`${scenario.id}: invalid evidence path ${normalized}`);
        continue;
      }
      try {
        const lines = (await readFile(sourcePath, "utf8")).split(/\r?\n/);
        if (
          !Number.isInteger(citation.start_line) ||
          !Number.isInteger(citation.end_line) ||
          citation.start_line < 1 ||
          citation.end_line < citation.start_line ||
          citation.end_line > lines.length
        ) {
          errors.push(`${scenario.id}: invalid evidence range ${normalized}:${citation.start_line}-${citation.end_line}`);
          continue;
        }
        const excerpt = lines.slice(citation.start_line - 1, citation.end_line).join("\n");
        if (!citation.contains || !excerpt.includes(citation.contains)) {
          errors.push(`${scenario.id}: evidence anchor not found in ${normalized}:${citation.start_line}-${citation.end_line}`);
          continue;
        }
        verifiedCitations += 1;
      } catch (error) {
        errors.push(`${scenario.id}: cannot read ${normalized}: ${error.message}`);
      }
    }
  }
  return { ok: errors.length === 0, errors, verified_citations: verifiedCitations };
}
