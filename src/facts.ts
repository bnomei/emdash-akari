import { readAkariJsonPathValues } from "./paths";

export type AkariFactValueType =
  | "array"
  | "boolean"
  | "missing"
  | "null"
  | "number"
  | "object"
  | "string";

export type AkariContentFact = {
  collection: string;
  entryId: string;
  locale?: string | null;
  status?: string;
  pathTemplate: string;
  fullPath: string;
  valueType: AkariFactValueType;
  valueText?: string;
  valueNumber?: number;
  valueBool?: boolean;
  valueJson?: string;
  ordinal?: number;
  updatedAt?: string;
};

export type AkariFactSqlStatement = {
  sql: string;
  params: Array<boolean | number | string | null | undefined>;
};

export type AkariFactsReplacementTarget = {
  collection: string;
  entryId: string;
  locale?: string | null;
};

export const AKARI_FACTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS _emdash_content_facts (
  collection TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  locale TEXT,
  status TEXT,
  path_template TEXT NOT NULL,
  full_path TEXT NOT NULL,
  value_type TEXT NOT NULL,
  value_text TEXT,
  value_number REAL,
  value_bool INTEGER,
  value_json TEXT,
  ordinal INTEGER,
  updated_at TEXT,
  PRIMARY KEY (collection, entry_id, locale, path_template, full_path)
)`;

export const AKARI_FACTS_INDEX_SQL = [
  "CREATE INDEX IF NOT EXISTS idx_akari_facts_template_text ON _emdash_content_facts (path_template, value_text)",
  "CREATE INDEX IF NOT EXISTS idx_akari_facts_template_number ON _emdash_content_facts (path_template, value_number)",
  "CREATE INDEX IF NOT EXISTS idx_akari_facts_entry ON _emdash_content_facts (collection, entry_id)",
];

export type ExtractFactsOptions = {
  collection: string;
  entryId: string;
  data: unknown;
  pathTemplates: string[];
  locale?: string | null;
  status?: string;
  updatedAt?: string;
};

export function extractContentFacts(options: ExtractFactsOptions): AkariContentFact[] {
  const facts: AkariContentFact[] = [];

  for (const pathTemplate of options.pathTemplates) {
    const values = readAkariJsonPathValues(options.data, pathTemplate);

    for (const item of values) {
      facts.push({
        collection: options.collection,
        entryId: options.entryId,
        locale: options.locale,
        status: options.status,
        pathTemplate,
        fullPath: item.path,
        valueType: getFactValueType(item.value),
        valueText: typeof item.value === "string" ? item.value : undefined,
        valueNumber: typeof item.value === "number" ? item.value : undefined,
        valueBool: typeof item.value === "boolean" ? item.value : undefined,
        valueJson: JSON.stringify(item.value),
        ordinal: getLastArrayOrdinal(item.path),
        updatedAt: options.updatedAt,
      });
    }
  }

  return facts;
}

export function buildReplaceFactsStatements(
  facts: AkariContentFact[],
  target?: AkariFactsReplacementTarget,
): AkariFactSqlStatement[] {
  // No facts: fall back to the explicit target as a whole-entry clear (the
  // un-templated DELETE removes every template for that entry).
  if (facts.length === 0) {
    if (!target) return [];
    return [
      {
        sql: "DELETE FROM _emdash_content_facts WHERE collection = ? AND entry_id = ? AND COALESCE(locale, '') = COALESCE(?, '')",
        params: [target.collection, target.entryId, target.locale ?? null],
      },
    ];
  }

  // Replace must delete every scope it is about to rewrite, but only the
  // path templates present in this batch — re-indexing a subset of templates
  // must not wipe an entry's facts for templates it did not touch. A batch may
  // also mix multiple (collection, entry_id, locale) tuples, so emit one DELETE
  // per distinct scope, each constrained to that scope's templates.
  const scopes = collectFactScopes(facts);

  return [
    ...scopes.map((scope) => ({
      sql: `DELETE FROM _emdash_content_facts WHERE collection = ? AND entry_id = ? AND COALESCE(locale, '') = COALESCE(?, '') AND path_template IN (${placeholders(
        scope.pathTemplates.length,
      )})`,
      params: [scope.collection, scope.entryId, scope.locale ?? null, ...scope.pathTemplates],
    })),
    ...facts.map((fact) => ({
      sql: `INSERT INTO _emdash_content_facts (
  collection,
  entry_id,
  locale,
  status,
  path_template,
  full_path,
  value_type,
  value_text,
  value_number,
  value_bool,
  value_json,
  ordinal,
  updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        fact.collection,
        fact.entryId,
        fact.locale,
        fact.status,
        fact.pathTemplate,
        fact.fullPath,
        fact.valueType,
        fact.valueText,
        fact.valueNumber,
        fact.valueBool,
        fact.valueJson,
        fact.ordinal,
        fact.updatedAt,
      ],
    })),
  ];
}

type AkariFactScope = AkariFactsReplacementTarget & { pathTemplates: string[] };

function collectFactScopes(facts: AkariContentFact[]): AkariFactScope[] {
  const scopes = new Map<string, AkariFactScope & { templateSet: Set<string> }>();

  for (const fact of facts) {
    const key = `${fact.collection}\u0000${fact.entryId}\u0000${fact.locale ?? ""}`;
    let scope = scopes.get(key);
    if (!scope) {
      scope = {
        collection: fact.collection,
        entryId: fact.entryId,
        locale: fact.locale,
        pathTemplates: [],
        templateSet: new Set<string>(),
      };
      scopes.set(key, scope);
    }
    if (!scope.templateSet.has(fact.pathTemplate)) {
      scope.templateSet.add(fact.pathTemplate);
      scope.pathTemplates.push(fact.pathTemplate);
    }
  }

  return [...scopes.values()].map(({ templateSet: _templateSet, ...scope }) => scope);
}

function placeholders(length: number): string {
  return Array.from({ length }, () => "?").join(", ");
}

export function getFactValueType(value: unknown): AkariFactValueType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";

  switch (typeof value) {
    case "boolean":
      return "boolean";
    case "number":
      return "number";
    case "object":
      return "object";
    case "string":
      return "string";
    case "undefined":
      return "missing";
    default:
      return "string";
  }
}

function getLastArrayOrdinal(path: string): number | undefined {
  const matches = [...path.matchAll(/\[(\d+)\]/g)];
  const last = matches.at(-1);
  return last ? Number(last[1]) : undefined;
}
