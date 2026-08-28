import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import type { RepositoryInventory } from "@code-knowledge-assistant/intake";

export type CapabilityTier = "enhanced" | "fallback" | "structured";
export type AnalysisLanguage = "javascript" | "python" | "text" | "typescript";

export type SourceRange = {
  path: string;
  start_line: number;
  end_line: number;
};

export type AnalysisSymbol = {
  name: string;
  kind: "class" | "function" | "interface" | "type";
  range: SourceRange;
};

export type AnalysisImport = {
  specifier: string;
  range: SourceRange;
};

export type EvidenceChunk = {
  id: string;
  range: SourceRange;
  content: string;
};

export type AnalyzedFile = {
  path: string;
  language: AnalysisLanguage;
  tier: CapabilityTier;
  range: SourceRange;
  symbols: AnalysisSymbol[];
  imports: AnalysisImport[];
};

export type CapabilityDisclosure = {
  language: AnalysisLanguage;
  tier: CapabilityTier;
  extractor: string;
  eligible_files: number;
  analyzed_files: number;
  failed_files: number;
};

export type AnalysisExclusion = {
  path: string;
  reason: string;
};

export type AnalysisFailure = {
  path: string;
  code: "FILE_DRIFTED" | "FILE_NOT_TEXT" | "FILE_UNAVAILABLE" | "INVENTORY_ENTRY_INVALID" | "INVENTORY_PATH_INVALID";
};

export type RepositoryAnalysis = {
  capabilities: CapabilityDisclosure[];
  files: AnalyzedFile[];
  chunks: EvidenceChunk[];
  exclusions: AnalysisExclusion[];
  failures: AnalysisFailure[];
};

export type RepositoryAnalysisInput = {
  root: string;
  inventory: RepositoryInventory;
  maxChunkCharacters?: number;
};

type Declaration = {
  name: string;
  kind: AnalysisSymbol["kind"];
  start: number;
  end: number;
  indentation?: number;
};

const DEFAULT_MAX_CHUNK_CHARACTERS = 4_000;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function languageForPath(relativePath: string): AnalysisLanguage {
  const extension = path.posix.extname(relativePath).toLowerCase();
  if (extension === ".py") return "python";
  if ([".ts", ".tsx", ".mts", ".cts"].includes(extension)) return "typescript";
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(extension)) return "javascript";
  return "text";
}

function tierForLanguage(language: AnalysisLanguage): CapabilityTier {
  return language === "text" ? "fallback" : "structured";
}

function extractorForLanguage(language: AnalysisLanguage): string {
  if (language === "python") return "deterministic-python-lexical-v1";
  if (language === "typescript" || language === "javascript") return "deterministic-typescript-javascript-lexical-v1";
  return "bounded-text-v1";
}

function validInventoryPath(relativePath: string): boolean {
  if (!relativePath || relativePath.includes("\\") || path.posix.isAbsolute(relativePath)) return false;
  const normalized = path.posix.normalize(relativePath);
  return normalized === relativePath && !normalized.startsWith("../") && normalized !== ".." && !normalized.startsWith("./");
}

function range(relativePath: string, start: number, end: number): SourceRange {
  return { path: relativePath, start_line: start, end_line: end };
}

function lineEnd(lines: string[], declaration: Declaration): number {
  for (let index = declaration.start; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*$/u.test(line)) continue;
    const indentation = line.match(/^\s*/u)?.[0].length ?? 0;
    if (indentation <= (declaration.indentation ?? 0)) return index;
  }
  return lines.length;
}

function extractPython(relativePath: string, lines: string[]): Pick<AnalyzedFile, "symbols" | "imports"> {
  const declarations: Declaration[] = [];
  const imports: AnalysisImport[] = [];
  for (const [index, line] of lines.entries()) {
    const declaration = line.match(/^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/u);
    const classDeclaration = line.match(/^(\s*)class\s+([A-Za-z_]\w*)\b/u);
    const importDeclaration = line.match(/^\s*import\s+([A-Za-z_][\w.]*)/u);
    const fromImportDeclaration = line.match(/^\s*from\s+([A-Za-z_][\w.]*)\s+import\s+/u);
    if (declaration) declarations.push({ name: declaration[2], kind: "function", start: index + 1, end: index + 1, indentation: declaration[1].length });
    if (classDeclaration) declarations.push({ name: classDeclaration[2], kind: "class", start: index + 1, end: index + 1, indentation: classDeclaration[1].length });
    const specifier = importDeclaration?.[1] ?? fromImportDeclaration?.[1];
    if (specifier) imports.push({ specifier, range: range(relativePath, index + 1, index + 1) });
  }
  for (const declaration of declarations) declaration.end = lineEnd(lines, declaration);
  return {
    symbols: declarations.map((declaration) => ({ name: declaration.name, kind: declaration.kind, range: range(relativePath, declaration.start, declaration.end) })),
    imports,
  };
}

function braceEnd(lines: string[], start: number): number {
  let balance = 0;
  let sawBrace = false;
  for (let index = start - 1; index < lines.length; index += 1) {
    for (const character of lines[index]) {
      if (character === "{") {
        balance += 1;
        sawBrace = true;
      } else if (character === "}" && sawBrace) {
        balance -= 1;
        if (balance <= 0) return index + 1;
      }
    }
    if (sawBrace && balance <= 0) return index + 1;
  }
  return sawBrace ? lines.length : start;
}

function extractJavaScript(relativePath: string, lines: string[]): Pick<AnalyzedFile, "symbols" | "imports"> {
  const declarations: Declaration[] = [];
  const imports: AnalysisImport[] = [];
  for (const [index, line] of lines.entries()) {
    const declaration = line.match(/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/u);
    const classDeclaration = line.match(/^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)\b/u);
    const interfaceDeclaration = line.match(/^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)\b/u);
    const typeDeclaration = line.match(/^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\b/u);
    const importDeclaration = line.match(/^\s*import(?:[\s\S]*?\s+from)?\s*["']([^"']+)["']/u);
    const requireDeclaration = line.match(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/u);
    if (declaration) declarations.push({ name: declaration[1], kind: "function", start: index + 1, end: braceEnd(lines, index + 1) });
    if (classDeclaration) declarations.push({ name: classDeclaration[1], kind: "class", start: index + 1, end: braceEnd(lines, index + 1) });
    if (interfaceDeclaration) declarations.push({ name: interfaceDeclaration[1], kind: "interface", start: index + 1, end: braceEnd(lines, index + 1) });
    if (typeDeclaration) declarations.push({ name: typeDeclaration[1], kind: "type", start: index + 1, end: index + 1 });
    const specifier = importDeclaration?.[1] ?? requireDeclaration?.[1];
    if (specifier) imports.push({ specifier, range: range(relativePath, index + 1, index + 1) });
  }
  return {
    symbols: declarations.map((declaration) => ({ name: declaration.name, kind: declaration.kind, range: range(relativePath, declaration.start, declaration.end) })),
    imports,
  };
}

function createChunks(
  relativePath: string,
  lines: string[],
  symbols: AnalysisSymbol[],
  maxCharacters: number,
  sourceEndsWithNewline: boolean,
): EvidenceChunk[] {
  const ranges = symbols.length === 0
    ? (lines.length === 0 ? [] : [range(relativePath, 1, lines.length)])
    : symbols.map((symbol) => symbol.range);
  const chunks: EvidenceChunk[] = [];
  for (const sourceRange of ranges) {
    let start = sourceRange.start_line;
    let content = "";
    for (let lineNumber = sourceRange.start_line; lineNumber <= sourceRange.end_line; lineNumber += 1) {
      const value = `${lines[lineNumber - 1]}${lineNumber < lines.length || (lineNumber === lines.length && sourceEndsWithNewline) ? "\n" : ""}`;
      if (content.length > 0 && content.length + value.length > maxCharacters) {
        chunks.push({ id: `${relativePath}:${start}-${lineNumber - 1}`, range: range(relativePath, start, lineNumber - 1), content });
        start = lineNumber;
        content = "";
      }
      if (value.length > maxCharacters) {
        if (content.length > 0) {
          chunks.push({ id: `${relativePath}:${start}-${lineNumber - 1}`, range: range(relativePath, start, lineNumber - 1), content });
          content = "";
        }
        for (let offset = 0; offset < value.length; offset += maxCharacters) {
          chunks.push({ id: `${relativePath}:${lineNumber}-${lineNumber}:${offset}`, range: range(relativePath, lineNumber, lineNumber), content: value.slice(offset, offset + maxCharacters) });
        }
        start = lineNumber + 1;
      } else {
        content += value;
      }
    }
    if (content.length > 0) chunks.push({ id: `${relativePath}:${start}-${sourceRange.end_line}`, range: range(relativePath, start, sourceRange.end_line), content });
  }
  return chunks;
}

function failureSort(left: AnalysisFailure, right: AnalysisFailure): number {
  return compareText(left.path, right.path) || compareText(left.code, right.code);
}

/**
 * Performs read-only, deterministic lexical extraction from the exact eligible
 * inventory entries. It does not claim AST, type, or runtime semantics; repository
 * content is treated solely as data and is never executed.
 */
export async function analyzeRepository(input: RepositoryAnalysisInput): Promise<RepositoryAnalysis> {
  const maxCharacters = input.maxChunkCharacters ?? DEFAULT_MAX_CHUNK_CHARACTERS;
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1) throw new TypeError("maxChunkCharacters must be a positive integer");
  const root = path.resolve(input.root);
  const files: AnalyzedFile[] = [];
  const chunks: EvidenceChunk[] = [];
  const exclusions: AnalysisExclusion[] = [];
  const failures: AnalysisFailure[] = [];
  const coverage = new Map<AnalysisLanguage, { eligible: number; analyzed: number; failed: number }>();
  const eligibleEntries = input.inventory.entries
    .filter((entry) => entry.kind === "file" && entry.eligibility === "eligible")
    .sort((left, right) => compareText(left.path, right.path));

  for (const entry of input.inventory.entries) {
    if (entry.kind === "file" && entry.eligibility === "excluded") {
      exclusions.push({ path: entry.path, reason: entry.exclusion_reason ?? "inventory-excluded" });
    }
  }

  for (const entry of eligibleEntries) {
    if (!validInventoryPath(entry.path)) {
      failures.push({ path: entry.path, code: "INVENTORY_PATH_INVALID" });
      continue;
    }
    const language = languageForPath(entry.path);
    const counters = coverage.get(language) ?? { eligible: 0, analyzed: 0, failed: 0 };
    counters.eligible += 1;
    coverage.set(language, counters);
    if (entry.byte_size === null || entry.sha256 === null) {
      failures.push({ path: entry.path, code: "INVENTORY_ENTRY_INVALID" });
      counters.failed += 1;
      continue;
    }
    const absolutePath = path.resolve(root, ...entry.path.split("/"));
    if (path.relative(root, absolutePath).startsWith("..") || path.isAbsolute(path.relative(root, absolutePath))) {
      failures.push({ path: entry.path, code: "INVENTORY_PATH_INVALID" });
      counters.failed += 1;
      continue;
    }
    let bytes: Buffer;
    try {
      const metadata = await lstat(absolutePath);
      if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error("unavailable");
      bytes = await readFile(absolutePath);
    } catch {
      failures.push({ path: entry.path, code: "FILE_UNAVAILABLE" });
      counters.failed += 1;
      continue;
    }
    if (bytes.byteLength !== entry.byte_size || createHash("sha256").update(bytes).digest("hex") !== entry.sha256) {
      failures.push({ path: entry.path, code: "FILE_DRIFTED" });
      counters.failed += 1;
      continue;
    }
    if (bytes.includes(0)) {
      failures.push({ path: entry.path, code: "FILE_NOT_TEXT" });
      counters.failed += 1;
      continue;
    }
    const source = bytes.toString("utf8");
    const lines = source.split(/\r\n|\n|\r/u);
    if (lines.at(-1) === "") lines.pop();
    const extracted = language === "python"
      ? extractPython(entry.path, lines)
      : language === "typescript" || language === "javascript"
        ? extractJavaScript(entry.path, lines)
        : { symbols: [], imports: [] };
    const sourceRange = range(entry.path, 1, Math.max(lines.length, 1));
    files.push({ path: entry.path, language, tier: tierForLanguage(language), range: sourceRange, ...extracted });
    chunks.push(...createChunks(entry.path, lines, extracted.symbols, maxCharacters, /(?:\r\n|\n|\r)$/u.test(source)));
    counters.analyzed += 1;
  }

  files.sort((left, right) => compareText(left.path, right.path));
  chunks.sort((left, right) => compareText(left.range.path, right.range.path) || left.range.start_line - right.range.start_line || compareText(left.id, right.id));
  exclusions.sort((left, right) => compareText(left.path, right.path));
  failures.sort(failureSort);
  const capabilities = [...coverage.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([language, counters]) => ({
      language,
      tier: tierForLanguage(language),
      extractor: extractorForLanguage(language),
      eligible_files: counters.eligible,
      analyzed_files: counters.analyzed,
      failed_files: counters.failed,
    }));
  return { capabilities, files, chunks, exclusions, failures };
}
