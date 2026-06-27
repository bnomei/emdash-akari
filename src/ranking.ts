/**
 * Reciprocal rank fusion for merging lexical and content-scan candidate layers.
 */
import type { AkariIdentity, AkariResult } from "./types";

export type AkariRankedCandidate = {
  key: string;
  result: AkariResult;
  source: string;
  rank?: number;
  score?: number;
  weight?: number;
};

export type AkariRankFusionOptions = {
  k?: number;
  limit?: number;
};

type Accumulator = {
  result: AkariResult;
  score: number;
  sources: Set<string>;
};

/** Stable fusion key: `collection:id:locale`. */
export function resultKey(result: AkariResult): string {
  return `${result.identity.collection}:${result.identity.id}:${result.identity.locale ?? ""}`;
}

/** Fuse ranked groups by entry key; normalizes scores to [0, 1] within the result set. */
export function reciprocalRankFusion(
  groups: AkariRankedCandidate[][],
  options: AkariRankFusionOptions = {},
): AkariResult[] {
  const k = options.k ?? 60;
  const merged = new Map<string, Accumulator>();

  for (const group of groups) {
    group.forEach((candidate, index) => {
      const rank = candidate.rank ?? index + 1;
      const weight = candidate.weight ?? 1;
      const score = weight / (k + rank);
      const existing = merged.get(candidate.key);

      if (existing) {
        existing.score += score;
        existing.sources.add(candidate.source);
        existing.result = mergeResult(existing.result, candidate.result);
      } else {
        merged.set(candidate.key, {
          result: candidate.result,
          score,
          sources: new Set([candidate.source]),
        });
      }
    });
  }

  const ranked = [...merged.values()].sort((a, b) => b.score - a.score);
  const maxScore = ranked[0]?.score ?? 0;

  return ranked
    .map((item) => ({
      ...item.result,
      score: roundScore(maxScore > 0 ? item.score / maxScore : 0),
      matchedFields: mergeUnique(item.result.matchedFields, [...item.sources]),
    }))
    .slice(0, options.limit);
}

function mergeResult(left: AkariResult, right: AkariResult): AkariResult {
  return {
    identity: mergeIdentity(left.identity, right.identity),
    score: Math.max(left.score ?? 0, right.score ?? 0),
    snippet: left.snippet ?? right.snippet,
    matchedFields: mergeUnique(left.matchedFields, right.matchedFields),
    matchedPaths: mergeUnique(left.matchedPaths, right.matchedPaths),
    updatedAt: left.updatedAt ?? right.updatedAt,
    publishedAt: left.publishedAt ?? right.publishedAt,
  };
}

function mergeIdentity(left: AkariIdentity, right: AkariIdentity): AkariIdentity {
  // Defined right fields win; null/undefined must not erase an earlier layer's value.
  return {
    collection: right.collection ?? left.collection,
    id: right.id ?? left.id,
    slug: right.slug ?? left.slug,
    locale: right.locale ?? left.locale,
    status: right.status ?? left.status,
    title: right.title ?? left.title,
    url: right.url ?? left.url,
  };
}

function mergeUnique(
  left: string[] | undefined,
  right: string[] | undefined,
): string[] | undefined {
  const values = [...(left ?? []), ...(right ?? [])];
  return values.length > 0 ? [...new Set(values)].sort() : undefined;
}

function roundScore(score: number): number {
  return Math.round(score * 1_000_000) / 1_000_000;
}
