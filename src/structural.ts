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

type AkariJsonSqlSource = {
  valueSql: string;
  typeSql: string;
  pathSql: string;
};

type AkariCompiledTokenPredicate = {
  joins: string[];
  where: string;
  joinParams: AkariScalar[];
  whereParams: AkariScalar[];
  matchedPathExpression: string;
};

type AkariWildcardFilterGroup = {
  eachPath: string;
  filters: Array<{
    filter: AkariPathFilter;
    suffixTokens: AkariPathToken[];
  }>;
};

const sqlIdentifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const sqlColumnReferencePattern =
  /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;

/**
 * Compile Akari path filters into a SQLite/D1 structural plan.
 *
 * Filters that share the same first wildcard parent are compiled against the
 * same outer `json_each` join, matching the JS evaluator's same-element
 * semantics. Additional wildcards deeper in a path compile to nested
 * array-guarded `json_each` joins.
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

  const beforeWildcard = parsed.tokens.slice(0, wildcardIndex);
  const afterWildcard = parsed.tokens.slice(wildcardIndex + 1);
  return {
    eachPath: tokensToSqlitePath(beforeWildcard),
    filters: [
      {
        filter,
        suffixTokens: afterWildcard,
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

  const joins = [
    `JOIN json_each(${dataExpression}, ?) AS ${alias} ON json_type(${dataExpression}, ?) = 'array'`,
  ];
  const joinParams: AkariScalar[] = [group.eachPath, group.eachPath];
  const where: string[] = [];
  const whereParams: AkariScalar[] = [];
  const matchedPathExpressions: string[] = [];

  for (const [index, { filter, suffixTokens }] of group.filters.entries()) {
    const compiled = compileTokenPredicate(
      filter,
      {
        valueSql: `${alias}.value`,
        typeSql: `${alias}.type`,
        pathSql: `${alias}.fullkey`,
      },
      suffixTokens,
      `${alias}_nested_${index}`,
    );

    joins.push(...compiled.joins);
    joinParams.push(...compiled.joinParams);
    where.push(compiled.where);
    whereParams.push(...compiled.whereParams);
    matchedPathExpressions.push(compiled.matchedPathExpression);
  }

  return {
    joins,
    where,
    params: [...joinParams, ...whereParams],
    joinParams,
    whereParams,
    matchedPathExpressions,
  };
}

function compileTokenPredicate(
  filter: AkariPathFilter,
  source: AkariJsonSqlSource,
  tokens: AkariPathToken[],
  aliasPrefix: string,
): AkariCompiledTokenPredicate {
  const wildcardIndex = tokens.findIndex((token) => token.type === "wildcard");

  if (wildcardIndex === -1) {
    const suffixPath = tokensToSqlitePath(tokens);
    const valueExpression =
      suffixPath === "$"
        ? { sql: source.valueSql, params: [] }
        : { sql: `json_extract(${source.valueSql}, ?)`, params: [suffixPath] };
    const typeExpression =
      suffixPath === "$"
        ? { sql: source.typeSql, params: [] }
        : { sql: `json_type(${source.valueSql}, ?)`, params: [suffixPath] };
    const compiled = compilePathPredicate(filter, valueExpression, typeExpression);
    const matchedPathExpression =
      suffixPath === "$"
        ? source.pathSql
        : `(${source.pathSql} || '${suffixPath.slice(1).replaceAll("'", "''")}')`;

    return {
      joins: [],
      where: compiled.sql,
      joinParams: [],
      whereParams: compiled.params,
      matchedPathExpression,
    };
  }

  const alias = aliasPrefix;
  assertSqlIdentifier(alias, "nested join alias");
  const beforeWildcard = tokens.slice(0, wildcardIndex);
  const afterWildcard = tokens.slice(wildcardIndex + 1);
  const eachPath = tokensToSqlitePath(beforeWildcard);
  const safeSource = jsonTraversableExpression(source.valueSql, source.typeSql);
  const nested = compileTokenPredicate(
    filter,
    {
      valueSql: `${alias}.value`,
      typeSql: `${alias}.type`,
      pathSql: `(${source.pathSql} || substr(${alias}.fullkey, 2))`,
    },
    afterWildcard,
    `${alias}_0`,
  );

  return {
    joins: [
      `JOIN json_each(${safeSource}, ?) AS ${alias} ON json_type(${safeSource}, ?) = 'array'`,
      ...nested.joins,
    ],
    where: nested.where,
    joinParams: [eachPath, eachPath, ...nested.joinParams],
    whereParams: nested.whereParams,
    matchedPathExpression: nested.matchedPathExpression,
  };
}

function jsonTraversableExpression(sql: string, typeSql: string): string {
  return `(CASE WHEN ${typeSql} IN ('array', 'object') THEN ${sql} ELSE 'null' END)`;
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
      return compileRangePredicate(">", filter.value, valueExpression, typeExpression);
    case "gte":
      return compileRangePredicate(">=", filter.value, valueExpression, typeExpression);
    case "lt":
      return compileRangePredicate("<", filter.value, valueExpression, typeExpression);
    case "lte":
      return compileRangePredicate("<=", filter.value, valueExpression, typeExpression);
  }
}

function compileRangePredicate(
  operator: ">" | ">=" | "<" | "<=",
  value: string | number,
  valueExpression: AkariJsonSqlExpression,
  typeExpression: AkariJsonSqlExpression,
): { sql: string; params: AkariScalar[] } {
  // Runtime `compare` returns NaN (no match) when the stored JSON type does not
  // match the filter value's type, so guard the SQL comparison by json_type.
  // Without this, SQLite would rank a TEXT value above any numeric literal
  // (storage-class ordering), matching a string like "99" against `gt 50`.
  const typeGuard =
    typeof value === "number"
      ? `${typeExpression.sql} IN ('integer', 'real')`
      : `${typeExpression.sql} = 'text'`;
  return {
    sql: `${typeGuard} AND ${valueExpression.sql} ${operator} ?`,
    params: [...typeExpression.params, ...valueExpression.params, value],
  };
}

function tokensToSqlitePath(tokens: AkariPathToken[]): string {
  return tokens.reduce((path, token) => {
    if (token.type === "property") return `${path}.${token.key}`;
    if (token.type === "index") return `${path}[${token.index}]`;
    throw new Error("Unexpected wildcard token while building a concrete SQLite JSON path");
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
