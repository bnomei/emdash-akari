/**
 * Akari JSON path parsing and in-memory evaluation for nested content filters.
 */
import { isRecord } from "./input";
import type { AkariPathFilter, AkariScalar } from "./types";

export type AkariPathToken =
  | { type: "property"; key: string }
  | { type: "index"; index: number }
  | { type: "wildcard" };

export type AkariParsedJsonPath = {
  source: string;
  tokens: AkariPathToken[];
  hasWildcard: boolean;
};

export type AkariPathValue = {
  path: string;
  value: unknown;
};

type AkariWildcardFilterGroup = {
  beforeWildcard: AkariPathToken[];
  filters: Array<{
    filter: AkariPathFilter;
    afterWildcard: AkariPathToken[];
  }>;
};

const identifierPattern = /[A-Za-z_][A-Za-z0-9_]*/y;

/** Parse an Akari JSON path (`$.blocks[*].type`) into traversal tokens. */
export function parseAkariJsonPath(path: string): AkariParsedJsonPath {
  if (!path.startsWith("$")) throw new Error(`Invalid Akari JSON path: ${path}`);

  const tokens: AkariPathToken[] = [];
  let index = 1;

  while (index < path.length) {
    const char = path[index];

    if (char === ".") {
      identifierPattern.lastIndex = index + 1;
      const match = identifierPattern.exec(path);
      if (!match) throw new Error(`Invalid Akari JSON path: ${path}`);
      tokens.push({ type: "property", key: match[0] });
      index = identifierPattern.lastIndex;
      continue;
    }

    if (char === "[") {
      const end = path.indexOf("]", index);
      if (end === -1) throw new Error(`Invalid Akari JSON path: ${path}`);

      const segment = path.slice(index + 1, end);
      if (segment === "*") {
        tokens.push({ type: "wildcard" });
      } else if (/^\d+$/.test(segment)) {
        tokens.push({ type: "index", index: Number(segment) });
      } else {
        throw new Error(`Invalid Akari JSON path: ${path}`);
      }

      index = end + 1;
      continue;
    }

    throw new Error(`Invalid Akari JSON path: ${path}`);
  }

  return {
    source: path,
    tokens,
    hasWildcard: tokens.some((token) => token.type === "wildcard"),
  };
}

export function toSqliteJsonPath(path: string | AkariParsedJsonPath): string | null {
  const parsed = typeof path === "string" ? parseAkariJsonPath(path) : path;
  return parsed.hasWildcard ? null : parsed.source;
}

/** Read all values at a path, expanding `[*]` wildcards into concrete evidence paths. */
export function readAkariJsonPathValues(value: unknown, path: string): AkariPathValue[] {
  return readPathValues(value, parseAkariJsonPath(path).tokens, "$");
}

/**
 * Evaluate structural path filters against entry JSON; returns concrete evidence paths.
 * Wildcard filters sharing a parent array are evaluated on the same element.
 */
export function evaluatePathFilters(
  data: unknown,
  filters: AkariPathFilter[] | undefined,
): { matched: boolean; matchedPaths: string[] } {
  if (!filters || filters.length === 0) return { matched: true, matchedPaths: [] };

  const matchedPaths = new Set<string>();
  const wildcardGroups = new Map<string, AkariWildcardFilterGroup>();

  for (const filter of filters) {
    const parsed = parseAkariJsonPath(filter.path);
    const wildcardIndex = parsed.tokens.findIndex((token) => token.type === "wildcard");
    if (wildcardIndex !== -1) {
      const beforeWildcard = parsed.tokens.slice(0, wildcardIndex);
      const groupKey = tokensToAkariPath(beforeWildcard);
      const group = wildcardGroups.get(groupKey) ?? {
        beforeWildcard,
        filters: [],
      };

      group.filters.push({
        filter,
        afterWildcard: parsed.tokens.slice(wildcardIndex + 1),
      });
      wildcardGroups.set(groupKey, group);
      continue;
    }

    const values = readPathValues(data, parsed.tokens, "$");
    if (!pathValuesMatch(values, filter)) return { matched: false, matchedPaths: [] };

    for (const item of values) {
      if (pathValueMatches(item.value, filter)) matchedPaths.add(item.path);
    }
  }

  for (const group of wildcardGroups.values()) {
    const groupResult = evaluateWildcardFilterGroup(data, group);
    if (!groupResult.matched) return { matched: false, matchedPaths: [] };
    for (const path of groupResult.matchedPaths) matchedPaths.add(path);
  }

  return { matched: true, matchedPaths: [...matchedPaths].sort() };
}

export function pathValuesMatch(values: AkariPathValue[], filter: AkariPathFilter): boolean {
  if (filter.op === "exists") return values.length > 0;
  return values.some((item) => pathValueMatches(item.value, filter));
}

export function pathValueMatches(value: unknown, filter: AkariPathFilter): boolean {
  switch (filter.op) {
    case "eq":
      return sameScalar(value, filter.value);
    case "ne":
      return isAkariScalar(value) && !sameScalar(value, filter.value);
    case "in":
      return filter.value.some((expected) => sameScalar(value, expected));
    case "nin":
      return isAkariScalar(value) && filter.value.every((expected) => !sameScalar(value, expected));
    case "contains":
      return containsValue(value, filter.value);
    case "match":
      return typeof value === "string" && value.toLowerCase().includes(filter.value.toLowerCase());
    case "gt":
      return compare(value, filter.value) > 0;
    case "gte":
      return compare(value, filter.value) >= 0;
    case "lt":
      return compare(value, filter.value) < 0;
    case "lte":
      return compare(value, filter.value) <= 0;
    case "exists":
      return true;
  }
}

function evaluateWildcardFilterGroup(
  data: unknown,
  group: AkariWildcardFilterGroup,
): { matched: boolean; matchedPaths: string[] } {
  const parentValues = readPathValues(data, group.beforeWildcard, "$");
  const matchedPaths = new Set<string>();

  for (const parent of parentValues) {
    if (!Array.isArray(parent.value)) continue;

    for (const [index, item] of parent.value.entries()) {
      const itemBasePath = `${parent.path}[${index}]`;
      const itemMatchedPaths = new Set<string>();
      let itemMatched = true;

      for (const { filter, afterWildcard } of group.filters) {
        const values = readPathValues(item, afterWildcard, itemBasePath);
        if (!pathValuesMatch(values, filter)) {
          itemMatched = false;
          break;
        }

        for (const value of values) {
          if (pathValueMatches(value.value, filter)) itemMatchedPaths.add(value.path);
        }
      }

      if (itemMatched) {
        for (const path of itemMatchedPaths) matchedPaths.add(path);
      }
    }
  }

  return {
    matched: matchedPaths.size > 0,
    matchedPaths: [...matchedPaths].sort(),
  };
}

function readPathValues(
  value: unknown,
  tokens: AkariPathToken[],
  concretePath: string,
): AkariPathValue[] {
  if (tokens.length === 0) return [{ path: concretePath, value }];

  const [token, ...rest] = tokens;

  if (token.type === "property") {
    if (!isRecord(value) || !(token.key in value)) return [];
    return readPathValues(value[token.key], rest, `${concretePath}.${token.key}`);
  }

  if (token.type === "index") {
    if (!Array.isArray(value) || token.index >= value.length) return [];
    return readPathValues(value[token.index], rest, `${concretePath}[${token.index}]`);
  }

  if (!Array.isArray(value)) return [];

  return value.flatMap((item, index) => readPathValues(item, rest, `${concretePath}[${index}]`));
}

function tokensToAkariPath(tokens: AkariPathToken[]): string {
  return tokens.reduce((path, token) => {
    if (token.type === "property") return `${path}.${token.key}`;
    if (token.type === "index") return `${path}[${token.index}]`;
    throw new Error("Nested wildcard path grouping is not supported");
  }, "$");
}

function containsValue(value: unknown, expected: string): boolean {
  if (typeof value === "string") return value.includes(expected);
  if (Array.isArray(value)) return value.some((item) => sameScalar(item, expected));
  return false;
}

function sameScalar(value: unknown, expected: AkariScalar): boolean {
  return isAkariScalar(value) && value === expected;
}

function compare(value: unknown, expected: string | number): number {
  if (typeof value === "number" && typeof expected === "number") return value - expected;
  if (typeof value === "string" && typeof expected === "string") {
    // Codepoint order matches SQLite BINARY collation used by the structural compiler.
    if (value < expected) return -1;
    if (value > expected) return 1;
    return 0;
  }
  return Number.NaN;
}

function isAkariScalar(value: unknown): value is AkariScalar {
  return value === null || ["boolean", "number", "string"].includes(typeof value);
}
