import assert from "node:assert/strict";
import test from "node:test";

import { buildLexicalEvidenceIndex, LexicalEvidenceValidationError } from "../src/index.ts";

test("a lexical evidence index ranks matching primary evidence and preserves citation provenance", () => {
  const index = buildLexicalEvidenceIndex([
    {
      id: "chunk:src/server.ts:10",
      layer: "primary",
      content: "The server validates signed webhook events before dispatching handlers.",
      provenance: { repository_path: "src/server.ts", line_start: 10, line_end: 14 },
    },
    {
      id: "chunk:src/other.ts:1",
      layer: "primary",
      content: "A background job sends metrics.",
      provenance: { repository_path: "src/other.ts", line_start: 1, line_end: 2 },
    },
  ]);

  assert.deepEqual(index.query("How are webhook events validated?"), {
    status: "ok",
    results: [
      {
        id: "chunk:src/server.ts:10",
        layer: "primary",
        score: 2,
        content: "The server validates signed webhook events before dispatching handlers.",
        provenance: { repository_path: "src/server.ts", line_start: 10, line_end: 14 },
      },
    ],
  });
});

test("query limits bound ranked results and UTF-8 evidence context", () => {
  const index = buildLexicalEvidenceIndex([
    {
      id: "a",
      layer: "primary",
      content: "deploy 🚀 deploy rollout",
      provenance: { repository_path: "src/a.ts", line_start: 1, line_end: 1 },
    },
    {
      id: "b",
      layer: "derived",
      content: "deploy release notes",
      provenance: { repository_path: "docs/review.md", line_start: 3, line_end: 3 },
    },
  ]);

  assert.deepEqual(index.query("deploy", { resultLimit: 2, contextByteLimit: 11 }), {
    status: "ok",
    results: [
      {
        id: "a",
        layer: "primary",
        score: 2,
        content: "deploy 🚀",
        provenance: { repository_path: "src/a.ts", line_start: 1, line_end: 1 },
      },
    ],
  });
});

test("mixed primary and derived evidence is searched with stable identifier tie-breaking", () => {
  const index = buildLexicalEvidenceIndex([
    {
      id: "derived:auth",
      layer: "derived",
      content: "Authentication uses a signed session cookie.",
      provenance: { repository_path: "review/auth.md", line_start: 7, line_end: 7 },
    },
    {
      id: "primary:middleware",
      layer: "primary",
      content: "The middleware reads the session cookie.",
      provenance: { repository_path: "src/middleware.ts", line_start: 9, line_end: 12 },
    },
    {
      id: "primary:cookie",
      layer: "primary",
      content: "Cookie options use secure defaults.",
      provenance: { repository_path: "src/cookie.ts", line_start: 2, line_end: 4 },
    },
  ]);

  const response = index.query("cookie");

  assert.equal(response.status, "ok");
  if (response.status === "ok") {
    assert.deepEqual(response.results.map(({ id, layer, score, provenance }) => ({ id, layer, score, provenance })), [
      { id: "derived:auth", layer: "derived", score: 1, provenance: { repository_path: "review/auth.md", line_start: 7, line_end: 7 } },
      { id: "primary:cookie", layer: "primary", score: 1, provenance: { repository_path: "src/cookie.ts", line_start: 2, line_end: 4 } },
      { id: "primary:middleware", layer: "primary", score: 1, provenance: { repository_path: "src/middleware.ts", line_start: 9, line_end: 12 } },
    ]);
  }
});

test("malformed or duplicate documents fail closed instead of replacing indexed evidence", () => {
  const primary = {
    id: "primary:one",
    layer: "primary" as const,
    content: "Deployment uses a migration.",
    provenance: { repository_path: "src/deploy.ts", line_start: 1, line_end: 2 },
  };

  assert.throws(
    () => buildLexicalEvidenceIndex([primary, { ...primary, content: "A replacement must not win." }]),
    (error: unknown) => error instanceof LexicalEvidenceValidationError && error.code === "EVIDENCE_ID_DUPLICATE" && error.documentId === "primary:one",
  );
  assert.throws(
    () => buildLexicalEvidenceIndex([{ ...primary, provenance: { ...primary.provenance, line_end: 0 } }]),
    (error: unknown) => error instanceof LexicalEvidenceValidationError && error.code === "EVIDENCE_PROVENANCE_INVALID" && error.documentId === "primary:one",
  );
});

test("empty, stop-word-only, and non-matching questions explicitly report insufficient evidence", () => {
  const index = buildLexicalEvidenceIndex([{
    id: "primary:deploy",
    layer: "primary",
    content: "Deploy through the release pipeline.",
    provenance: { repository_path: "src/deploy.ts", line_start: 1, line_end: 1 },
  }]);

  assert.deepEqual(index.query("  "), { status: "insufficient-evidence", reason: "empty-question", results: [] });
  assert.deepEqual(index.query("the and with"), { status: "insufficient-evidence", reason: "no-search-terms", results: [] });
  assert.deepEqual(index.query("database replica"), { status: "insufficient-evidence", reason: "no-matches", results: [] });
});

test("an index snapshots its input and returns independent query results", () => {
  const document = {
    id: "primary:config",
    layer: "primary" as const,
    content: "Configuration enables caching.",
    provenance: { repository_path: "src/config.ts", line_start: 5, line_end: 5 },
  };
  const index = buildLexicalEvidenceIndex([document]);
  document.content = "Configuration changed after indexing.";
  document.provenance.repository_path = "src/changed.ts";

  const first = index.query("caching");
  assert.equal(first.status, "ok");
  if (first.status === "ok") first.results[0].content = "caller mutation";
  const second = index.query("caching");

  assert.deepEqual(second, {
    status: "ok",
    results: [{
      id: "primary:config",
      layer: "primary",
      score: 1,
      content: "Configuration enables caching.",
      provenance: { repository_path: "src/config.ts", line_start: 5, line_end: 5 },
    }],
  });
});
