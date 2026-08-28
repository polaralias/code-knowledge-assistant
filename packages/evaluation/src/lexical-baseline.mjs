import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".next",
  ".nuxt",
  ".venv",
  "build",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "target",
  "vendor",
]);

const BINARY_EXTENSIONS = new Set([
  ".7z", ".a", ".avi", ".bin", ".bmp", ".class", ".dll", ".dylib", ".eot", ".exe",
  ".gif", ".gz", ".ico", ".jar", ".jpeg", ".jpg", ".lockb", ".mov", ".mp3", ".mp4",
  ".o", ".otf", ".pdf", ".png", ".pyc", ".so", ".tar", ".ttf", ".wav", ".webm",
  ".webp", ".woff", ".woff2", ".xz", ".zip",
]);

function normalizePath(value) {
  return value.split(path.sep).join("/");
}

export function tokenize(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLocaleLowerCase("en")
    .match(/[\p{L}\p{N}_]+/gu) ?? [];
}

export async function collectTextFiles(sourceRoot, options = {}) {
  const maxBytes = options.maxBytes ?? 512 * 1024;
  const maxFiles = options.maxFiles ?? Number.POSITIVE_INFINITY;
  const maxTotalBytes = options.maxTotalBytes ?? Number.POSITIVE_INFINITY;
  const files = [];
  let totalBytes = 0;

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name)) await visit(absolute);
        continue;
      }
      if (!entry.isFile() || BINARY_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      const metadata = await stat(absolute);
      if (metadata.size > maxBytes || files.length >= maxFiles || totalBytes + metadata.size > maxTotalBytes) continue;
      const bytes = await readFile(absolute);
      if (bytes.includes(0)) continue;
      const text = bytes.toString("utf8");
      const byteLength = Buffer.byteLength(text, "utf8");
      if (totalBytes + byteLength > maxTotalBytes) continue;
      files.push({ path: normalizePath(path.relative(sourceRoot, absolute)), text });
      totalBytes += byteLength;
    }
  }

  await visit(sourceRoot);
  return files.sort((left, right) => left.path.localeCompare(right.path, "en"));
}

export function buildLexicalIndex(files, options = {}) {
  const windowLines = options.windowLines ?? 40;
  const overlapLines = options.overlapLines ?? 10;
  const maxChunks = options.maxChunks ?? Number.POSITIVE_INFINITY;
  if (!Number.isInteger(windowLines) || windowLines < 1) throw new Error("windowLines must be a positive integer");
  if (!Number.isInteger(overlapLines) || overlapLines < 0 || overlapLines >= windowLines) {
    throw new Error("overlapLines must be a non-negative integer smaller than windowLines");
  }
  if (options.maxChunks !== undefined && (!Number.isSafeInteger(maxChunks) || maxChunks < 1)) {
    throw new Error("maxChunks must be a positive integer");
  }
  const chunks = [];
  const documentFrequency = new Map();
  const step = windowLines - overlapLines;
  outer: for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path, "en"))) {
    const lines = file.text.split(/\r?\n/);
    for (let offset = 0; offset < lines.length; offset += step) {
      if (chunks.length >= maxChunks) break outer;
      const selected = lines.slice(offset, offset + windowLines);
      if (selected.every((line) => line.trim() === "")) continue;
      const terms = tokenize(`${file.path}\n${selected.join("\n")}`);
      const frequencies = new Map();
      for (const term of terms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
      for (const term of frequencies.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
      chunks.push({
        path: file.path,
        start_line: offset + 1,
        end_line: offset + selected.length,
        terms,
        frequencies,
      });
      if (offset + windowLines >= lines.length) break;
    }
  }
  const averageLength = chunks.length === 0 ? 0 : chunks.reduce((sum, chunk) => sum + chunk.terms.length, 0) / chunks.length;
  return { chunks, documentFrequency, averageLength, windowLines, overlapLines };
}

export function retrieveLexically(index, query, limit = 10) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("retrieval limit must be a positive integer");
  const queryTerms = [...new Set(tokenize(query))];
  const count = index.chunks.length;
  const k1 = 1.2;
  const b = 0.75;
  return index.chunks
    .map((chunk) => {
      let score = 0;
      for (const term of queryTerms) {
        const frequency = chunk.frequencies.get(term) ?? 0;
        if (frequency === 0) continue;
        const documentFrequency = index.documentFrequency.get(term) ?? 0;
        const inverseDocumentFrequency = Math.log(1 + (count - documentFrequency + 0.5) / (documentFrequency + 0.5));
        const lengthNormalization = index.averageLength === 0 ? 1 : 1 - b + b * (chunk.terms.length / index.averageLength);
        score += inverseDocumentFrequency * ((frequency * (k1 + 1)) / (frequency + k1 * lengthNormalization));
      }
      return {
        path: chunk.path,
        start_line: chunk.start_line,
        end_line: chunk.end_line,
        score,
      };
    })
    .filter((chunk) => chunk.score > 0)
    .sort((left, right) =>
      right.score - left.score ||
      left.path.localeCompare(right.path, "en") ||
      left.start_line - right.start_line,
    )
    .slice(0, limit)
    .map((chunk, position) => ({ ...chunk, score: Number(chunk.score.toFixed(8)), rank: position + 1 }));
}

function overlaps(expected, observed) {
  return expected.path === observed.path && expected.start_line <= observed.end_line && observed.start_line <= expected.end_line;
}

export function evidenceRecall(expectedEvidence, retrieved) {
  if (expectedEvidence.length === 0) return 1;
  return expectedEvidence.filter((expected) => retrieved.some((observed) => overlaps(expected, observed))).length / expectedEvidence.length;
}

function mean(values) {
  return values.length === 0 ? 1 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value, places = 6) {
  return Number(value.toFixed(places));
}

export async function runLexicalBaseline(repositoryRoot, scenarios, options = {}) {
  const createdAt = options.createdAt ?? new Date().toISOString();
  const retrievalLimit = options.retrievalLimit ?? 10;
  const chunking = {
    window_lines: options.windowLines ?? 40,
    overlap_lines: options.overlapLines ?? 10,
    max_file_bytes: options.maxBytes ?? 512 * 1024,
  };
  const sourceGroups = new Map();
  for (const scenario of scenarios) {
    const key = `${scenario.repository_id}\0${scenario.source_revision}\0${scenario.source_root}`;
    if (!sourceGroups.has(key)) sourceGroups.set(key, []);
    sourceGroups.get(key).push(scenario);
  }

  const results = [];
  const sources = [];
  for (const groupScenarios of sourceGroups.values()) {
    const source = groupScenarios[0];
    const absoluteSourceRoot = path.resolve(repositoryRoot, source.source_root);
    const resolvedRepositoryRoot = path.resolve(repositoryRoot);
    if (absoluteSourceRoot !== resolvedRepositoryRoot && !absoluteSourceRoot.startsWith(`${resolvedRepositoryRoot}${path.sep}`)) {
      throw new Error(`${source.repository_id}: source root escapes the repository`);
    }
    const indexingStarted = performance.now();
    const files = await collectTextFiles(absoluteSourceRoot, { maxBytes: chunking.max_file_bytes });
    const index = buildLexicalIndex(files, {
      windowLines: chunking.window_lines,
      overlapLines: chunking.overlap_lines,
    });
    const indexingMs = performance.now() - indexingStarted;
    sources.push({
      id: source.repository_id,
      revision: source.source_revision,
      root: source.source_root,
      file_count: files.length,
      chunk_count: index.chunks.length,
      indexed_bytes: files.reduce((sum, file) => sum + Buffer.byteLength(file.text, "utf8"), 0),
      indexing_ms: round(indexingMs, 3),
    });
    for (const scenario of groupScenarios) {
      const retrievalStarted = performance.now();
      const retrieved = retrieveLexically(index, scenario.question, retrievalLimit);
      const retrievalMs = performance.now() - retrievalStarted;
      results.push({
        id: scenario.id,
        repository_id: scenario.repository_id,
        expected_evidence: scenario.evidence.map(({ path, start_line, end_line }) => ({ path, start_line, end_line })),
        retrieved_evidence: retrieved,
        retrieval_recall_at_10: round(evidenceRecall(scenario.evidence, retrieved)),
        retrieval_ms: round(retrievalMs, 3),
      });
    }
  }

  const byRepository = Object.fromEntries(
    [...new Set(results.map((result) => result.repository_id))].sort().map((repositoryId) => {
      const repositoryResults = results.filter((result) => result.repository_id === repositoryId);
      return [repositoryId, {
        scenario_count: repositoryResults.length,
        retrieval_recall_at_10: round(mean(repositoryResults.map((result) => result.retrieval_recall_at_10))),
      }];
    }),
  );
  return {
    schema_version: "1.0",
    run: {
      id: `lexical-bm25-${createdAt.replace(/[^0-9]/g, "").slice(0, 14)}`,
      created_at: createdAt,
      retriever: { name: "bm25", version: "1.0", top_k: retrievalLimit },
      chunking,
      provider_calls: 0,
      cost_usd: 0,
      content_execution: false,
    },
    sources,
    scenarios: results,
    summary: {
      scenario_count: results.length,
      retrieval_recall_at_10: round(mean(results.map((result) => result.retrieval_recall_at_10))),
      by_repository: byRepository,
    },
  };
}
