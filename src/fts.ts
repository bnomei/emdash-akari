/**
 * EmDash FTS5 SQL plan builders and row mapping for D1/SQLite lexical search.
 */
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
// FTS5 boolean operators are uppercase-only; lowercase words stay prefix-normalized terms.
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

/** Normalize a user query into an FTS5 MATCH expression; returns `""` when unusable. */
export function escapeFts5Query(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return "";
    return `"${inner.replace(doubleQuotePattern, '""')}"`;
  }

  const escaped = trimmed.replace(doubleQuotePattern, '""');
  if (ftsOperatorsPattern.test(trimmed)) return escaped;

  const terms = trimmed
    .split(whitespaceSplitPattern)
    .filter((term) => term.replaceAll('"', "").length > 0);
  if (terms.length === 0) return "";
  return terms.map((term) => `"${term.replace(doubleQuotePattern, '""')}"*`).join(" ");
}

/**
 * Build a parameterized FTS5 search plan against EmDash `_emdash_fts_*` tables.
 * Omits status filtering when `status` is undefined; returns null for empty queries.
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

/** Map raw FTS query rows into Akari results with escaped snippets. */
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

function escapeFtsSnippet(snippet: string): string {
  // Escape indexed text, then restore only the intended <mark> highlight wrappers.
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
