/**
 * Akari discovery engine: lexical FTS, content scan, reciprocal rank fusion,
 * facets, sort/projection, and identity resolution.
 */
import { search as emdashSearch } from "emdash";
import type { ContentAccess, SearchOptions, SearchResponse } from "emdash";
import {
  getStringEqualityFilter,
  getStringSetFilter,
  matchesMetadataFilters,
  readMetadataField,
} from "./filter";
import { evaluatePathFilters, readAkariJsonPathValues } from "./paths";
import { reciprocalRankFusion, resultKey, type AkariRankedCandidate } from "./ranking";
import type {
  AkariFacet,
  AkariFacetResult,
  AkariQueryResponse,
  AkariResolveResponse,
  AkariResult,
  AkariValidatedQueryInput,
  AkariValidatedResolveInput,
} from "./types";

export type AkariLexicalSearchProvider = (
  query: string,
  options: SearchOptions,
) => Promise<SearchResponse>;

/** Engine wiring: content access, lexical provider, scan budget, and resolve margin. */
export type AkariEngineOptions = {
  content?: ContentAccess;
  lexicalSearch?: AkariLexicalSearchProvider;
  defaultCollections?: string[];
  fetchLimit?: number;
  ambiguityMargin?: number;
  url?: (path: string) => string;
};

type EngineCandidate = {
  result: AkariResult;
  source: string;
  rank?: number;
  score?: number;
  facetValues?: Record<string, string[]>;
};

type AkariContentItem = Awaited<ReturnType<ContentAccess["list"]>>["items"][number];

const defaultAmbiguityMargin = 0.02;
const contentScanFailurePrefix = "Content scan failed for ";

/** Run discover: fuse lexical and content layers, then sort, limit, facet, and project. */
export async function runAkariQuery(
  input: AkariValidatedQueryInput,
  options: AkariEngineOptions = {},
): Promise<AkariQueryResponse> {
  const warnings: string[] = [];
  const groups: AkariRankedCandidate[][] = [];
  const facetsByResult = new Map<string, Record<string, string[]>>();
  const collections = resolveCollections(input, options.defaultCollections);
  const lexicalSearch = options.lexicalSearch ?? emdashSearch;
  const queryInput = stripRedundantCollectionFilter(input, warnings);

  let lexicalNextCursor: string | undefined;
  let ranContentScan = false;

  if (usesLexical(queryInput)) {
    try {
      const lexical = await runLexicalSearch(
        queryInput,
        collections,
        lexicalSearch,
        options.content,
      );
      groups.push(toRankedGroup(lexical.candidates, "fts"));
      lexicalNextCursor = lexical.nextCursor;
    } catch (error) {
      warnings.push(`FTS search unavailable: ${getErrorMessage(error)}.`);
    }
  }

  if (shouldRunContentScan(queryInput, options, collections)) {
    ranContentScan = true;
    const scanned = await scanContent(queryInput, collections, options, warnings);
    groups.push(toRankedGroup(scanned, "content"));

    for (const candidate of scanned) {
      facetsByResult.set(resultKey(candidate.result), candidate.facetValues ?? {});
    }
  }

  if (groups.length === 0) {
    warnings.push(
      collections.length === 0
        ? "No collections were provided. Pass collections, filter.collection, or defaultCollections."
        : "No executable search layer was available for this request.",
    );
  }

  const fused = reciprocalRankFusion(groups);
  const ordered = input.sort?.length ? applySort(fused, input.sort) : fused;
  const limited = ordered.slice(0, input.limit);
  const facets = buildFacetResults(input.facets, limited, facetsByResult);
  const items = input.select?.length
    ? limited.map((item) => projectResult(item, input.select ?? []))
    : limited;

  // Fused multi-layer results have no single continuation token.
  const nextCursor = ranContentScan ? undefined : lexicalNextCursor;

  return {
    items,
    facets,
    nextCursor,
    warnings: warnings.length > 0 ? warnings : undefined,
    explain: input.explain
      ? {
          collections,
          executedLayers: groups.map((group) => group[0]?.source).filter(Boolean),
          skippedWarnings: warnings,
        }
      : undefined,
  };
}

/**
 * Resolve one identity: compare top fused scores and return resolved, ambiguous, or not_found.
 * Uses a widened candidate pool so client `limit` cannot hide ambiguity.
 */
export async function resolveAkariQuery(
  input: AkariValidatedResolveInput,
  options: AkariEngineOptions = {},
): Promise<AkariResolveResponse> {
  const maxAlternatives = input.maxAlternatives ?? 3;
  const resolveLimit = Math.max(input.limit, maxAlternatives + 1, 2);
  const response = await runAkariQuery(
    { ...input, limit: resolveLimit, sort: undefined, select: undefined },
    options,
  );
  const [first, second] = response.items;
  const project = (item: AkariResult): AkariResult =>
    input.select?.length ? projectResult(item, input.select) : item;
  const degraded = (response.warnings ?? []).some((warning) =>
    warning.startsWith(contentScanFailurePrefix),
  );

  if (!first) {
    return {
      status: "not_found",
      alternatives: [],
      warnings: response.warnings ?? ["No candidate matched the requested identity constraints."],
      degraded: degraded || undefined,
    };
  }

  const margin = options.ambiguityMargin ?? defaultAmbiguityMargin;
  const firstScore = first.score ?? 0;
  const secondScore = second?.score ?? 0;

  if (degraded || (second && firstScore - secondScore <= margin)) {
    return {
      status: "ambiguous",
      alternatives: response.items.slice(0, maxAlternatives).map(project),
      warnings: [
        ...(response.warnings ?? []),
        degraded
          ? "Resolution corpus was incomplete: one or more collections failed to scan."
          : "Top candidates are too close to resolve automatically.",
      ],
      degraded: degraded || undefined,
    };
  }

  return {
    status: "resolved",
    item: project(first),
    alternatives: response.items.slice(1, 1 + maxAlternatives).map(project),
    warnings: response.warnings,
  };
}

function usesLexical(input: AkariValidatedQueryInput): boolean {
  return Boolean(input.q) && input.mode === "lexical";
}

function shouldRunContentScan(
  input: AkariValidatedQueryInput,
  options: AkariEngineOptions,
  collections: string[],
): boolean {
  if (!options.content || collections.length === 0) return false;
  return true;
}

async function runLexicalSearch(
  input: AkariValidatedQueryInput,
  collections: string[],
  searchProvider: AkariLexicalSearchProvider,
  content: ContentAccess | undefined,
): Promise<{ candidates: EngineCandidate[]; nextCursor?: string }> {
  if (!input.q) return { candidates: [] };

  const indexedStatus = getStringEqualityFilter(input.filter, "status");
  const response = await searchProvider(input.q, {
    collections: collections.length > 0 ? collections : undefined,
    status: indexedStatus,
    locale: getStringEqualityFilter(input.filter, "locale"),
    limit: Math.max(input.limit * 2, input.limit),
    cursor: input.after ?? undefined,
  });

  const hasPathFilters = (input.paths?.length ?? 0) > 0;
  const out: EngineCandidate[] = [];
  for (const item of response.items) {
    const full = await fetchLexicalEntry(item, content);
    const metadata = full
      ? buildContentMetadata(item.collection, full)
      : lexicalHitMetadata(item, { status: indexedStatus });
    if (!matchesMetadataFilters(metadata, input.filter)) continue;

    let matchedPaths: string[] = [];
    if (hasPathFilters) {
      // Path evidence requires the entry body; without content access the hit is dropped.
      if (!full) continue;
      const pathResult = evaluatePathFilters(full.data, input.paths);
      if (!pathResult.matched) continue;
      matchedPaths = pathResult.matchedPaths;
    }

    out.push({
      source: "fts",
      score: item.score,
      result: {
        identity: {
          collection: item.collection,
          id: item.id,
          slug: item.slug,
          locale: item.locale,
          title: item.title,
          url: buildFallbackUrl(item.collection, item.slug ?? item.id),
        },
        score: item.score,
        snippet: item.snippet,
        matchedFields: ["fts"],
        matchedPaths,
      },
    });
  }

  return { candidates: out, nextCursor: response.nextCursor };
}

async function fetchLexicalEntry(
  item: SearchResponse["items"][number],
  content: ContentAccess | undefined,
): Promise<AkariContentItem | null> {
  if (!content) return null;
  try {
    return await content.get(item.collection, item.id);
  } catch {
    return null;
  }
}

function lexicalHitMetadata(
  item: SearchResponse["items"][number],
  indexedFilters: { status?: string } = {},
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    collection: item.collection,
    id: item.id,
    entry_id: item.id,
    slug: item.slug,
    locale: item.locale,
    title: item.title,
  };
  if (indexedFilters.status !== undefined) metadata.status = indexedFilters.status;
  return metadata;
}

async function scanContent(
  input: AkariValidatedQueryInput,
  collections: string[],
  options: AkariEngineOptions,
  warnings: string[],
): Promise<EngineCandidate[]> {
  const content = options.content;
  if (!content) return [];

  const out: EngineCandidate[] = [];
  const fetchLimit = options.fetchLimit ?? Math.max(input.limit * 5, 50);
  const where = {
    status: getStringEqualityFilter(input.filter, "status"),
    locale: getStringEqualityFilter(input.filter, "locale"),
  };

  for (const collection of collections) {
    try {
      let cursor: string | undefined;
      let scanned = 0;
      let truncated = false;

      do {
        const remaining = fetchLimit - scanned;
        const response = await content.list(collection, {
          cursor,
          limit: Math.min(remaining, 100),
          where,
          orderBy: { updatedAt: "desc" },
        });

        for (const item of response.items) {
          if (scanned >= fetchLimit) {
            truncated = true;
            break;
          }
          scanned += 1;
          const candidate = evaluateContentItem(collection, item, input, options);
          if (candidate) out.push(candidate);
        }

        cursor = response.hasMore ? response.cursor : undefined;
      } while (cursor && scanned < fetchLimit);

      if (cursor || truncated) {
        warnings.push(`Content scan reached fetchLimit for ${collection}.`);
      }
    } catch (error) {
      warnings.push(`${contentScanFailurePrefix}${collection}: ${getErrorMessage(error)}.`);
    }
  }

  return out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

function evaluateContentItem(
  collection: string,
  item: AkariContentItem,
  input: AkariValidatedQueryInput,
  options: AkariEngineOptions,
): EngineCandidate | null {
  const identity = {
    collection,
    id: item.id,
    slug: item.slug,
    locale: item.locale ?? undefined,
    status: item.status,
    title: getTitle(item),
    url:
      options.url?.(buildFallbackUrl(collection, item.slug ?? item.id)) ??
      buildFallbackUrl(collection, item.slug ?? item.id),
  };
  const metadata = buildContentMetadata(collection, item);

  if (!matchesMetadataFilters(metadata, input.filter)) return null;

  const pathResult = evaluatePathFilters(item.data, input.paths);
  if (!pathResult.matched) return null;

  const textScore = input.q ? scoreText(input.q, item) : { score: 1 };
  if (input.q && textScore.score <= 0) return null;

  const score = input.q ? textScore.score : 1;

  return {
    source: "content",
    score,
    result: {
      identity,
      score,
      snippet: textScore.snippet,
      matchedFields: textScore.matchedFields,
      matchedPaths: pathResult.matchedPaths,
      updatedAt: item.updatedAt,
      publishedAt: item.publishedAt,
    },
    facetValues: buildFacetValues(input.facets, item, collection),
  };
}

function scoreText(
  query: string,
  item: AkariContentItem,
): { score: number; snippet?: string; matchedFields?: string[] } {
  const terms = tokenize(query);
  const title = getTitle(item) ?? "";
  const body = extractText(item.data);
  const titleLower = title.toLowerCase();
  const bodyLower = body.toLowerCase();
  let score = 0;
  const matchedFields = new Set<string>();

  for (const term of terms) {
    if (titleLower.includes(term)) {
      score += 4;
      matchedFields.add("title");
    }
    const count = countOccurrences(bodyLower, term);
    if (count > 0) {
      score += count;
      matchedFields.add("content");
    }
  }

  return {
    score,
    snippet: score > 0 ? buildSnippet(body || title, terms) : undefined,
    matchedFields: matchedFields.size > 0 ? [...matchedFields].sort() : undefined,
  };
}

function toRankedGroup(candidates: EngineCandidate[], source: string): AkariRankedCandidate[] {
  return candidates.map((candidate, index) => ({
    key: resultKey(candidate.result),
    result: candidate.result,
    source,
    rank: candidate.rank ?? index + 1,
    score: candidate.score,
  }));
}

const RESULT_LEVEL_SELECT_FIELDS = [
  "score",
  "snippet",
  "matchedFields",
  "matchedPaths",
  "updatedAt",
  "publishedAt",
] as const;

const IDENTITY_SELECT_FIELDS = [
  "collection",
  "id",
  "slug",
  "locale",
  "status",
  "title",
  "url",
] as const;

function projectResult(item: AkariResult, select: string[]): AkariResult {
  const selected = new Set(select);
  const out: Record<string, unknown> = {};

  if (selected.has("identity")) {
    out.identity = item.identity;
  } else {
    const identityFields = IDENTITY_SELECT_FIELDS.filter((field) => selected.has(field));
    if (identityFields.length > 0) {
      const identity: Record<string, unknown> = {};
      for (const field of identityFields) identity[field] = item.identity[field];
      out.identity = identity;
    }
  }

  for (const field of RESULT_LEVEL_SELECT_FIELDS) {
    if (selected.has(field)) out[field] = item[field];
  }

  return out as AkariResult;
}

function applySort(items: AkariResult[], sort: string[]): AkariResult[] {
  const specs = sort.map((key) =>
    key.startsWith("-") ? { field: key.slice(1), dir: -1 } : { field: key, dir: 1 },
  );

  return [...items].sort((a, b) => {
    for (const { field, dir } of specs) {
      const av = sortValue(a, field);
      const bv = sortValue(b, field);
      if (av === undefined && bv === undefined) continue;
      if (av === undefined) return 1;
      if (bv === undefined) return -1;
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      if (cmp !== 0) return cmp * dir;
    }
    return 0;
  });
}

function sortValue(item: AkariResult, field: string): string | number | undefined {
  switch (field) {
    case "score":
      return item.score;
    case "updatedAt":
      return item.updatedAt;
    case "publishedAt":
      return item.publishedAt ?? undefined;
    case "title":
      return item.identity.title;
    case "collection":
      return item.identity.collection;
    case "status":
      return item.identity.status;
    case "locale":
      return item.identity.locale;
    default:
      return undefined;
  }
}

function buildFacetResults(
  facets: AkariFacet[] | undefined,
  items: AkariResult[],
  valuesByKey: Map<string, Record<string, string[]>>,
): AkariFacetResult[] | undefined {
  if (!facets || facets.length === 0) return undefined;

  const results: AkariFacetResult[] = [];

  for (const facet of facets) {
    const key = typeof facet === "string" ? facet : "field" in facet ? facet.field : facet.path;
    const limit = typeof facet === "string" ? 10 : (facet.limit ?? 10);
    const buckets = new Map<string, number>();

    for (const item of items) {
      const values = valuesByKey.get(resultKey(item))?.[key] ?? fallbackFacetValues(item, key);
      for (const value of values) buckets.set(value, (buckets.get(value) ?? 0) + 1);
    }

    results.push({
      key,
      buckets: [...buckets.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
        .slice(0, limit),
    });
  }

  return results;
}

function buildFacetValues(
  facets: AkariFacet[] | undefined,
  item: AkariContentItem,
  collection: string,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!facets) return out;

  for (const facet of facets) {
    const key = typeof facet === "string" ? facet : "field" in facet ? facet.field : facet.path;

    if (key === "collection") out[key] = [collection];
    else if (key === "status") out[key] = [item.status];
    else if (key === "locale" && item.locale) out[key] = [item.locale];
    else if (key.startsWith("$")) {
      out[key] = readAkariJsonPathValues(item.data, key)
        .map((value) => stringifyFacetValue(value.value))
        .filter((value): value is string => typeof value === "string");
    } else {
      const values = toFacetValueStrings(
        readMetadataField(buildContentMetadata(collection, item), key),
      );
      if (values.length > 0) out[key] = values;
    }
  }

  return out;
}

function toFacetValueStrings(value: unknown): string[] {
  const source = Array.isArray(value) ? value : [value];
  return source
    .map((entry) => stringifyFacetValue(entry))
    .filter((entry): entry is string => typeof entry === "string");
}

function fallbackFacetValues(item: AkariResult, key: string): string[] {
  const value = item.identity[key as keyof typeof item.identity];
  return typeof value === "string" ? [value] : [];
}

function resolveCollections(
  input: AkariValidatedQueryInput,
  defaults: string[] | undefined,
): string[] {
  const fromFilter = getStringSetFilter(input.filter, "collection");
  const selected = input.collections ?? fromFilter ?? defaults ?? [];
  return [...new Set(selected)];
}

function stripRedundantCollectionFilter<T extends AkariValidatedQueryInput>(
  input: T,
  warnings: string[],
): T {
  if (!input.collections || !input.filter || !("collection" in input.filter)) return input;

  const { collection: _collection, ...rest } = input.filter;
  // Top-level `collections` is the scope selector; `filter.collection` is fallback-only.
  warnings.push(
    "filter.collection was ignored because top-level collections was provided; collections is the authoritative scope.",
  );
  return { ...input, filter: Object.keys(rest).length > 0 ? rest : undefined };
}

function buildContentMetadata(collection: string, item: AkariContentItem): Record<string, unknown> {
  return {
    ...item.data,
    collection,
    id: item.id,
    entry_id: item.id,
    slug: item.slug,
    locale: item.locale,
    status: item.status,
    updatedAt: item.updatedAt,
    publishedAt: item.publishedAt,
    seo: item.seo,
  };
}

function getTitle(item: AkariContentItem): string | undefined {
  const title = item.data.title ?? item.data.name ?? item.seo?.title;
  if (typeof title === "string" && title.trim()) return title;
  return item.slug ?? item.id;
}

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(extractText).filter(Boolean).join(" ");
  if (value && typeof value === "object")
    return Object.values(value).map(extractText).filter(Boolean).join(" ");
  return "";
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.replace(/[^\p{L}\p{N}_-]/gu, ""))
    .filter(Boolean);
}

function countOccurrences(value: string, term: string): number {
  let count = 0;
  let index = value.indexOf(term);

  while (index !== -1) {
    count += 1;
    index = value.indexOf(term, index + term.length);
  }

  return count;
}

function buildSnippet(text: string, terms: string[]): string | undefined {
  const lower = text.toLowerCase();
  const firstIndex = terms
    .map((term) => lower.indexOf(term))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  if (firstIndex === undefined) return undefined;

  const start = Math.max(0, firstIndex - 48);
  const end = Math.min(text.length, firstIndex + 96);
  let snippet = escapeHtml(text.slice(start, end));

  for (const term of terms) {
    snippet = snippet.replace(
      new RegExp(escapeRegExp(term), "gi"),
      (match) => `<mark>${match}</mark>`,
    );
  }

  return `${start > 0 ? "..." : ""}${snippet}${end < text.length ? "..." : ""}`;
}

function buildFallbackUrl(collection: string, slugOrId: string): string {
  return `/${collection}/${slugOrId}`;
}

function stringifyFacetValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  return undefined;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
