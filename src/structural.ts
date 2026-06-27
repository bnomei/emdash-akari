import {
  parseAkariJsonPath,
  toSqliteJsonPath,
  type AkariParsedJsonPath,
  type AkariPathToken,
} from "./paths";
import type { AkariPathFilter, AkariScalar } from "./types";

export type AkariStructuralCompileOptions = {
  dataExpression?: string;
  joinPrefix?: string;
};

export type AkariStructuralSqlPlan = {
  joins: string[];
  where: string[];
  params: AkariScalar[];
  joinParams: AkariScalar[];
  whereParams: AkariScalar[];
  matchedPathExpressions: string[];
};

type AkariJsonSqlExpression = {
  sql: string;
  params: AkariScalar[];
};

type AkariWildcardFilterGroup = {
  eachPath: string;
  filters: Array<{
    filter: AkariPathFilter;
    suffixPath: string;
  }>;
};

const sqlIdentifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const sqlColumnReferencePattern =
  /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;

/**
 * Compile Akari path filters into a single-join SQLite/D1 structural plan.
 *
 * Each path may contain at most one `[*]` wildcard segment (compiled to one
 * `json_each` join). The schema and the discover/resolve JS evaluator accept
 * multi-wildcard paths (e.g. `$.a[*].b[*]`), but this single-join compiler
 * cannot express them and throws a descriptive error — evaluate such paths with
 * the JS engine or materialized facts. Wrap calls in try/catch if you forward
 * caller-supplied paths directly.
 */
export function compileStructuralFilters(
  filters: AkariPathFilter[] | undefined,
  options: AkariStructuralCompileOptions = {},
): AkariStructuralSqlPlan {
  const dataExpression = options.dataExpression ?? "e.data";
  assertColumnReference(dataExpression, "data expression");
  const baseJoinPrefix = options.joinPrefix ?? "akari_path";
  const plans: AkariStructuralSqlPlan[] = [];
  const wildcardGroups = new Map<string, AkariWildcardFilterGroup>();

  for (const filter of filters ?? []) {
    const parsed = parseAkariJsonPath(filter.path);
    if (!parsed.hasWildcard) {
      plans.push(compileDirectFilter(filter, dataExpression, parsed));
      continue;
    }

    const group = toWildcardFilterGroup(filter, parsed);
    const existing = wildcardGroups.get(group.eachPath);
    if (existing) {
      existing.filters.push(...group.filters);
    } else {
      wildcardGroups.set(group.eachPath, group);
    }
  }

  let wildcardIndex = 0;
  for (const group of wildcardGroups.values()) {
    plans.push(
      compileWildcardFilterGroup(group, dataExpression, `${baseJoinPrefix}_${wildcardIndex}`),
    );
    wildcardIndex += 1;
  }

  return {
    joins: plans.flatMap((plan) => plan.joins),
    where: plans.flatMap((plan) => plan.where),
    params: [
      ...plans.flatMap((plan) => plan.joinParams),
      ...plans.flatMap((plan) => plan.whereParams),
    ],
    joinParams: plans.flatMap((plan) => plan.joinParams),
    whereParams: plans.flatMap((plan) => plan.whereParams),
    matchedPathExpressions: plans.flatMap((plan) => plan.matchedPathExpressions),
  };
}

export function compileStructuralFilter(
  filter: AkariPathFilter,
  options: AkariStructuralCompileOptions = {},
): AkariStructuralSqlPlan {
  const dataExpression = options.dataExpression ?? "e.data";
  assertColumnReference(dataExpression, "data expression");
  const joinPrefix = options.joinPrefix ?? "akari_path";
  assertSqlIdentifier(joinPrefix, "join prefix");

  const parsed = parseAkariJsonPath(filter.path);
  if (!parsed.hasWildcard) {
    return compileDirectFilter(filter, dataExpression, parsed);
  }

  return compileWildcardFilterGroup(
    toWildcardFilterGroup(filter, parsed),
    dataExpression,
    joinPrefix,
  );
}

function compileDirectFilter(
  filter: AkariPathFilter,
  dataExpression: string,
  parsed: AkariParsedJsonPath,
): AkariStructuralSqlPlan {
  const path = toSqliteJsonPath(parsed);
  if (!path) throw new Error(`Expected direct SQLite JSON path for ${parsed.source}`);

  const valueExpression = { sql: `json_extract(${dataExpression}, ?)`, params: [path] };
  const typeExpression = { sql: `json_type(${dataExpression}, ?)`, params: [path] };
  const compiled = compilePathPredicate(filter, valueExpression, typeExpression);

  return {
    joins: [],
    where: [compiled.sql],
    params: compiled.params,
    joinParams: [],
    whereParams: compiled.params,
    matchedPathExpressions: [`'${parsed.source.replaceAll("'", "''")}'`],
  };
}

function toWildcardFilterGroup(
  filter: AkariPathFilter,
  parsed: AkariParsedJsonPath,
): AkariWildcardFilterGroup {
  const wildcardIndex = parsed.tokens.findIndex((token) => token.type === "wildcard");
  if (wildcardIndex === -1) throw new Error(`Expected wildcard path for ${parsed.source}`);

  // The single-join SQL compiler supports exactly one [*] per path. Reject
  // multi-wildcard paths up front with a clear, actionable error (the schema
  // permits them and the discover/resolve JS evaluator handles them, but they
  // cannot be compiled to a single json_each join).
  const wildcardCount = parsed.tokens.filter((token) => token.type === "wildcard").length;
  if (wildcardCount > 1) {
    throw new Error(
      `Structural SQL compiler supports a single [*] wildcard per path; "${parsed.source}" has ${wildcardCount}. ` +
        `Evaluate multi-wildcard paths with the discover/resolve engine or materialized facts instead.`,
    );
  }

  const beforeWildcard = parsed.tokens.slice(0, wildcardIndex);
  const afterWildcard = parsed.tokens.slice(wildcardIndex + 1);
  return {
    eachPath: tokensToSqlitePath(beforeWildcard),
    filters: [
      {
        filter,
        suffixPath: tokensToSqlitePath(afterWildcard),
      },
    ],
  };
}

function compileWildcardFilterGroup(
  group: AkariWildcardFilterGroup,
  dataExpression: string,
  joinPrefix: string,
): AkariStructuralSqlPlan {
  const alias = joinPrefix;
  assertSqlIdentifier(alias, "join prefix");

  const where: string[] = [];
  const whereParams: AkariScalar[] = [];
  const matchedPathExpressions: string[] = [];

  for (const { filter, suffixPath } of group.filters) {
    const valueExpression =
      suffixPath === "$"
        ? { sql: `${alias}.value`, params: [] }
        : { sql: `json_extract(${alias}.value, ?)`, params: [suffixPath] };
    const typeExpression =
      suffixPath === "$"
        ? { sql: `${alias}.type`, params: [] }
        : { sql: `json_type(${alias}.value, ?)`, params: [suffixPath] };
    const compiled = compilePathPredicate(filter, valueExpression, typeExpression);

    where.push(compiled.sql);
    whereParams.push(...compiled.params);
    matchedPathExpressions.push(
      suffixPath === "$"
        ? `${alias}.fullkey`
        : `(${alias}.fullkey || '${suffixPath.slice(1).replaceAll("'", "''")}')`,
    );
  }

  return {
    joins: [`JOIN json_each(${dataExpression}, ?) AS ${alias}`],
    where,
    params: [group.eachPath, ...whereParams],
    joinParams: [group.eachPath],
    whereParams,
    matchedPathExpressions,
  };
}

function compilePathPredicate(
  filter: AkariPathFilter,
  valueExpression: AkariJsonSqlExpression,
  typeExpression: AkariJsonSqlExpression,
): { sql: string; params: AkariScalar[] } {
  switch (filter.op) {
    case "exists":
      return { sql: `${typeExpression.sql} IS NOT NULL`, params: typeExpression.params };
    case "eq":
      if (filter.value === null)
        return { sql: `${typeExpression.sql} = 'null'`, params: typeExpression.params };
      return {
        sql: `${valueExpression.sql} = ?`,
        params: [...valueExpression.params, filter.value],
      };
    case "ne":
      if (filter.value === null) {
        return {
          sql: `${typeExpression.sql} IS NOT NULL AND ${typeExpression.sql} != 'null'`,
          params: [...typeExpression.params, ...typeExpression.params],
        };
      }
      // Runtime `ne` (paths.ts) requires a scalar value, so exclude object/array
      // JSON here too; otherwise SQL `!=` would match structured values the
      // in-engine evaluator rejects, diverging the two execution paths.
      return {
        sql: `${typeExpression.sql} NOT IN ('object', 'array') AND ${valueExpression.sql} != ?`,
        params: [...typeExpression.params, ...valueExpression.params, filter.value],
      };
    case "in":
      return {
        sql: `${valueExpression.sql} IN (${placeholders(filter.value.length)})`,
        params: [...valueExpression.params, ...filter.value],
      };
    case "nin":
      // Mirror runtime `nin`, which also requires a scalar value.
      return {
        sql: `${typeExpression.sql} NOT IN ('object', 'array') AND ${valueExpression.sql} NOT IN (${placeholders(filter.value.length)})`,
        params: [...typeExpression.params, ...valueExpression.params, ...filter.value],
      };
    case "contains":
      // Mirror runtime `containsValue`: substring for a text value, element
      // membership for an array, no match otherwise. The type guard keeps SQL
      // from running a JSON-text substring over a serialized array (which would
      // match separators/brackets) and ensures json_each only sees real arrays
      // (SQLite short-circuits AND/OR, so it is not evaluated for non-arrays).
      return {
        sql: `((${typeExpression.sql} = 'text' AND instr(${valueExpression.sql}, ?) > 0) OR (${typeExpression.sql} = 'array' AND EXISTS (SELECT 1 FROM json_each(${valueExpression.sql}) AS _akari_contains WHERE _akari_contains.value = ?)))`,
        params: [
          ...typeExpression.params,
          ...valueExpression.params,
          filter.value,
          ...typeExpression.params,
          ...valueExpression.params,
          filter.value,
        ],
      };
    case "match":
      // Mirror runtime `match`: a case-insensitive literal substring over string
      // values only. instr (not LIKE) keeps any `%`/`_` in the value literal
      // instead of treating them as wildcards, and the json_type guard excludes
      // numbers/booleans that the runtime evaluator rejects.
      return {
        sql: `${typeExpression.sql} = 'text' AND instr(LOWER(${valueExpression.sql}), ?) > 0`,
        params: [...typeExpression.params, ...valueExpression.params, filter.value.toLowerCase()],
      };
    case "gt":
      return {
        sql: `${valueExpression.sql} > ?`,
        params: [...valueExpression.params, filter.value],
      };
    case "gte":
      return {
        sql: `${valueExpression.sql} >= ?`,
        params: [...valueExpression.params, filter.value],
      };
    case "lt":
      return {
        sql: `${valueExpression.sql} < ?`,
        params: [...valueExpression.params, filter.value],
      };
    case "lte":
      return {
        sql: `${valueExpression.sql} <= ?`,
        params: [...valueExpression.params, filter.value],
      };
  }
}

function tokensToSqlitePath(tokens: AkariPathToken[]): string {
  return tokens.reduce((path, token) => {
    if (token.type === "property") return `${path}.${token.key}`;
    if (token.type === "index") return `${path}[${token.index}]`;
    throw new Error("Nested wildcard paths are not supported by the single-join compiler yet");
  }, "$");
}

function placeholders(length: number): string {
  return Array.from({ length }, () => "?").join(", ");
}

function assertSqlIdentifier(value: string, label: string): void {
  if (!sqlIdentifierPattern.test(value)) throw new Error(`Invalid ${label}: ${value}`);
}

function assertColumnReference(value: string, label: string): void {
  if (!sqlColumnReferencePattern.test(value)) throw new Error(`Invalid ${label}: ${value}`);
}
