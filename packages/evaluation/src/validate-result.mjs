const BEHAVIORS = new Set(["answer", "qualify", "refuse"]);
const TIERS = new Set(["enhanced", "structured", "fallback"]);
const GROUPS = new Set(["deterministic_fixture", "real_world", "unsupported_or_ambiguous", "adversarial"]);

function get(value, dottedPath) {
  return dottedPath.split(".").reduce((current, key) => current?.[key], value);
}

function requireString(result, dottedPath, errors) {
  if (typeof get(result, dottedPath) !== "string" || get(result, dottedPath).trim() === "") {
    errors.push(`${dottedPath} must be a non-empty string`);
  }
}

function requireObject(result, dottedPath, errors) {
  const value = get(result, dottedPath);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${dottedPath} must be an object`);
  }
}

function requireStringArray(result, dottedPath, errors) {
  const value = get(result, dottedPath);
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    errors.push(`${dottedPath} must be an array of strings`);
  }
}

function requireNonNegativeNumber(value, dottedPath, errors) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    errors.push(`${dottedPath} must be a non-negative finite number`);
  }
}

function validateEvidence(items, dottedPath, errors, { rank = false, resolved = false } = {}) {
  if (!Array.isArray(items)) {
    errors.push(`${dottedPath} must be an array`);
    return;
  }
  for (const [index, item] of items.entries()) {
    const prefix = `${dottedPath}.${index}`;
    if (!item || typeof item !== "object") {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    if (typeof item.path !== "string" || item.path === "") errors.push(`${prefix}.path must be a non-empty string`);
    if (!Number.isInteger(item.start_line) || item.start_line < 1) errors.push(`${prefix}.start_line must be a positive integer`);
    if (!Number.isInteger(item.end_line) || item.end_line < item.start_line) errors.push(`${prefix}.end_line must not precede start_line`);
    if (rank && (!Number.isInteger(item.rank) || item.rank < 1)) errors.push(`${prefix}.rank must be a positive integer`);
    if (resolved && typeof item.resolved !== "boolean") errors.push(`${prefix}.resolved must be boolean`);
  }
}

export function validateEvaluationResult(result) {
  const errors = [];
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { valid: false, errors: ["result must be an object"] };
  }
  if (result.schema_version !== "1.0") errors.push("schema_version must equal 1.0");
  for (const field of [
    "run.id",
    "run.started_at",
    "run.evaluator_version",
    "run.source.id",
    "run.source.revision",
    "run.extractor.name",
    "run.extractor.version",
    "run.chunking.strategy",
    "run.chunking.version",
    "run.prompt.id",
    "run.prompt.digest",
    "run.output_schema.id",
    "run.output_schema.digest",
    "run.generation.provider",
    "run.generation.region",
    "run.generation.model_id",
    "run.retrieval.lexical.name",
    "run.retrieval.lexical.version",
  ]) {
    requireString(result, field, errors);
  }
  for (const field of ["run.chunking.parameters", "run.generation.parameters"]) {
    requireObject(result, field, errors);
  }
  for (const component of ["embedding", "reranking"]) {
    const value = result.run?.retrieval?.[component];
    if (!Object.hasOwn(result.run?.retrieval ?? {}, component)) {
      errors.push(`run.retrieval.${component} must be present as null or a versioned component`);
      continue;
    }
    if (value !== null && value !== undefined) {
      for (const field of ["provider", "model_id", "version"]) {
        requireString(result, `run.retrieval.${component}.${field}`, errors);
      }
      requireObject(result, `run.retrieval.${component}.parameters`, errors);
    }
  }
  if (!TIERS.has(result.run?.capability_tier)) errors.push("run.capability_tier is invalid");
  if (Number.isNaN(Date.parse(result.run?.started_at))) errors.push("run.started_at must be an RFC 3339 timestamp");
  for (const field of [
    "inventory.expected_eligible",
    "inventory.observed_eligible",
    "inventory.expected_excluded",
    "inventory.observed_excluded",
    "extraction.expected_symbols",
    "extraction.observed_symbols",
    "extraction.expected_imports",
    "extraction.observed_imports",
  ]) {
    requireStringArray(result, field, errors);
  }
  if (!Array.isArray(result.scenarios) || result.scenarios.length === 0) {
    errors.push("scenarios must be a non-empty array");
  } else {
    const identifiers = new Set();
    for (const [index, scenario] of result.scenarios.entries()) {
      const prefix = `scenarios.${index}`;
      if (typeof scenario?.id !== "string" || scenario.id === "" || identifiers.has(scenario.id)) {
        errors.push(`${prefix}.id must be a unique non-empty string`);
      }
      identifiers.add(scenario?.id);
      if (!GROUPS.has(scenario?.group)) errors.push(`${prefix}.group is invalid`);
      if (!BEHAVIORS.has(scenario?.expected_behavior)) errors.push(`${prefix}.expected_behavior is invalid`);
      if (!BEHAVIORS.has(scenario?.observed_behavior)) errors.push(`${prefix}.observed_behavior is invalid`);
      validateEvidence(scenario?.expected_evidence, `${prefix}.expected_evidence`, errors);
      if (Array.isArray(scenario?.expected_evidence) && scenario.expected_evidence.length === 0) {
        errors.push(`${prefix}.expected_evidence must contain at least one citation`);
      }
      validateEvidence(scenario?.retrieved_evidence, `${prefix}.retrieved_evidence`, errors, { rank: true });
      validateEvidence(scenario?.citations, `${prefix}.citations`, errors, { resolved: true });
      if (!Array.isArray(scenario?.material_claims)) {
        errors.push(`${prefix}.material_claims must be an array`);
      } else {
        for (const [claimIndex, claim] of scenario.material_claims.entries()) {
          if (typeof claim?.text !== "string" || claim.text === "") {
            errors.push(`${prefix}.material_claims.${claimIndex}.text must be a non-empty string`);
          }
          validateEvidence(claim?.evidence, `${prefix}.material_claims.${claimIndex}.evidence`, errors);
        }
      }
      const security = scenario?.security;
      for (const field of ["followed_repository_instruction", "executed_source", "expanded_authority", "disclosed_secret"]) {
        if (typeof security?.[field] !== "boolean") errors.push(`${prefix}.security.${field} must be boolean`);
      }
      if (typeof scenario?.capability_disclosed !== "boolean") errors.push(`${prefix}.capability_disclosed must be boolean`);
      requireNonNegativeNumber(scenario?.latency_ms, `${prefix}.latency_ms`, errors);
      for (const field of ["input_tokens", "output_tokens", "cached_tokens", "retries", "cost_usd"]) {
        requireNonNegativeNumber(scenario?.usage?.[field], `${prefix}.usage.${field}`, errors);
      }
      if (scenario?.human_review !== null && scenario?.human_review !== undefined) {
        const review = scenario.human_review;
        if (!new Set(["human", "judge-assisted"]).has(review?.reviewer_type)) {
          errors.push(`${prefix}.human_review.reviewer_type is invalid`);
        }
        for (const field of ["orientation", "clarity", "actionability"]) {
          if (!Number.isInteger(review?.[field]) || review[field] < 1 || review[field] > 5) {
            errors.push(`${prefix}.human_review.${field} must be an integer from 1 to 5`);
          }
        }
        if (review?.notes !== undefined && typeof review.notes !== "string") {
          errors.push(`${prefix}.human_review.notes must be a string`);
        }
        if (review?.reviewer_type === "judge-assisted") {
          if (typeof review.model_id !== "string" || review.model_id === "") {
            errors.push(`${prefix}.human_review.model_id is required for judge-assisted review`);
          }
          if (typeof review.prompt_digest !== "string" || review.prompt_digest === "") {
            errors.push(`${prefix}.human_review.prompt_digest is required for judge-assisted review`);
          }
        }
      }
    }
  }
  return { valid: errors.length === 0, errors };
}
