import type { AkariIdentity, AkariResult } from "./types";

export type AkariFtsPlanInput = {
  collection: string;
  query: string;
  searchableFields: string[];
  weights?: Record<string, number>;
  status?: string;
  locale?: string;
  limit?: number;
};

export type AkariSqlPlan = {
  sql: string;
  params: Array<number | string>;
};

export type AkariFtsRow = {
  id: string;
  slug: string | null;
  locale: string | null;
  title: string | null;
  snippet: string | null;
  score: number;
};

const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const whitespaceSplitPattern = /\s+/;
// FTS5 boolean/proximity operators are case-sensitive (uppercase only). No `/i`
// flag, so ordinary lowercase words like "and"/"or"/"not"/"near" stay plain
// terms and keep prefix-term normalization instead of being treated as operators.
const ftsOperatorsPattern = /\b(AND|OR|NOT|NEAR)\b/;
const doubleQuotePattern = /"/g;

export function getEmDashFtsTableName(collection: string): string {
  assertIdentifier(collection, "collection");
  return `_emdash_fts_${collection}`;
}

export function getEmDashContentTableName(collection: string): string {
  assertIdentifier(collection, "collection");
  return `ec_${collection}`;
}

export function escapeFts5Query(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    // An empty (or whitespace-only) phrase is not a valid MATCH expression;
    // treat it as no query so buildEmDashFts5Plan short-circuits to null.
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return "";
    return `"${inner.replace(doubleQuotePattern, '""')}"`;
  }

  const escaped = trimmed.replace(doubleQuotePattern, '""');
  if (ftsOperatorsPattern.test(trimmed)) return escaped;

  // Build prefix-term phrases from the raw words, dropping any term that has no
  // characters other than quotes (e.g. a lone `"`), which would otherwise emit a
  // malformed phrase like `""""*`. If nothing survives, treat as an empty query.
  const terms = trimmed
    .split(whitespaceSplitPattern)
    .filter((term) => term.replaceAll('"', "").length > 0);
  if (terms.length === 0) return "";
  return terms.map((term) => `"${term.replace(doubleQuotePattern, '""')}"*`).join(" ");
}

/**
 * Build an EmDash-compatible FTS5 SQL plan. When `status` is omitted, the plan
 * does not add a status predicate; pass an explicit status to constrain rows.
 */
export function buildEmDashFts5Plan(input: AkariFtsPlanInput): AkariSqlPlan | null {
  const ftsQuery = escapeFts5Query(input.query);
  if (!ftsQuery) return null;

  assertIdentifier(input.collection, "collection");
  for (const field of input.searchableFields) assertIdentifier(field, "searchable field");

  const ftsTable = getEmDashFtsTableName(input.collection);
  const contentTable = getEmDashContentTableName(input.collection);
  const limit = input.limit ?? 20;
  const weights = buildBm25Weights(input.searchableFields, input.weights);
  const bm25 =
    weights.length > 0 ? `bm25("${ftsTable}", ${weights.join(", ")})` : `bm25("${ftsTable}")`;
  const params: Array<number | string> = [ftsQuery];
  const statusClause = input.status !== undefined ? "AND c.status = ?" : "";
  if (input.status !== undefined) params.push(input.status);
  const localeClause = input.locale ? "AND c.locale = ?" : "";
  if (input.locale) params.push(input.locale);
  params.push(limit);

  return {
    sql: `
SELECT
  c.id,
  c.slug,
  c.locale,
  c.title,
  snippet("${ftsTable}", 2, '<mark>', '</mark>', '...', 32) AS snippet,
  ${bm25} AS score
FROM "${ftsTable}" f
JOIN "${contentTable}" c ON f.id = c.id AND f.locale IS c.locale
WHERE "${ftsTable}" MATCH ?
  ${statusClause}
  AND c.deleted_at IS NULL
  ${localeClause}
ORDER BY score
LIMIT ?`.trim(),
    params,
  };
}

export function mapFtsRows(collection: string, rows: AkariFtsRow[]): AkariResult[] {
  return rows.map((row) => ({
    identity: {
      collection,
      id: row.id,
      slug: row.slug,
      locale: row.locale ?? undefined,
      status: undefined,
      title: row.title ?? undefined,
      url: buildFallbackUrl({ collection, id: row.id, slug: row.slug }),
    },
    score: Math.abs(row.score),
    snippet: row.snippet != null ? escapeFtsSnippet(row.snippet) : undefined,
    matchedFields: ["fts"],
    matchedPaths: [],
  }));
}

/**
 * SQLite `snippet()` wraps raw indexed document text in `<mark>`/`</mark>`
 * markers without escaping the surrounding text. Escape all HTML metacharacters
 * and then restore the literal highlight markers, so the only markup that
 * survives is the intended `<mark>` wrapper (mirrors the content-scan snippet
 * path, which escapes before adding marks). Prevents stored XSS when callers
 * render snippets as HTML.
 */
function escapeFtsSnippet(snippet: string): string {
  return snippet
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replaceAll("&lt;mark&gt;", "<mark>")
    .replaceAll("&lt;/mark&gt;", "</mark>");
}

function buildBm25Weights(fields: string[], weights: Record<string, number> | undefined): number[] {
  if (!weights || fields.length === 0) return [];
  return [
    0,
    0,
    ...fields.map((field) => {
      const weight = weights[field] ?? 1;
      if (typeof weight !== "number" || !Number.isFinite(weight))
        throw new Error(`Invalid BM25 weight for field ${field}: ${String(weight)}`);
      return weight;
    }),
  ];
}

function buildFallbackUrl(identity: Pick<AkariIdentity, "collection" | "id" | "slug">): string {
  return `/${identity.collection}/${identity.slug ?? identity.id}`;
}

function assertIdentifier(value: string, label: string): void {
  if (!identifierPattern.test(value)) throw new Error(`Invalid ${label}: ${value}`);
}
