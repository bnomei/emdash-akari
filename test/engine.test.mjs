import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  AKARI_FACTS_TABLE_SQL,
  buildReplaceFactsStatements,
  buildReplaceFactsStatementsFromExtraction,
  compileStructuralFilter,
  compileStructuralFilters,
  evaluatePathFilters,
  extractContentFacts,
  matchesMetadataFilters,
  normalizeQueryInput,
  normalizeResolveInput,
  parseAkariJsonPath,
  readAkariJsonPathValues,
  reciprocalRankFusion,
  resolveAkariQuery,
  runAkariQuery,
  toSqliteJsonPath,
  toIndexedMetadataFilter,
} from "../dist/index.mjs";

const fixtures = {
  pages: [
    {
      id: "home",
      type: "pages",
      slug: "home",
      status: "published",
      locale: "en",
      data: {
        title: "Workers AI Search",
        blocks: [
          { type: "hero", text: "Run AI inference globally" },
          { type: "embed", url: "https://developers.cloudflare.com/workers-ai/" },
        ],
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
      publishedAt: "2026-02-01T00:00:00.000Z",
    },
    {
      id: "about",
      type: "pages",
      slug: "about",
      status: "draft",
      locale: "en",
      data: { title: "About", blocks: [{ type: "text", text: "Company profile" }] },
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-02-02T00:00:00.000Z",
      publishedAt: null,
    },
  ],
  products: [
    {
      id: "d1-product",
      type: "products",
      slug: "d1",
      status: "published",
      locale: "en",
      data: {
        title: "D1 Product",
        summary: "D1 stores SQL data for serverless applications",
        blocks: [{ type: "text", text: "Query latency and metadata filtering checklist" }],
      },
      createdAt: "2026-01-03T00:00:00.000Z",
      updatedAt: "2026-02-03T00:00:00.000Z",
      publishedAt: "2026-02-03T00:00:00.000Z",
    },
  ],
};

const content = {
  async get(collection, id) {
    return fixtures[collection]?.find((item) => item.id === id) ?? null;
  },
  async list(collection, options = {}) {
    const where = options.where ?? {};
    const items = (fixtures[collection] ?? [])
      .filter((item) => (where.status ? item.status === where.status : true))
      .filter((item) => (where.locale ? item.locale === where.locale : true))
      .slice(0, options.limit ?? 50);

    return { items, hasMore: false };
  },
};

test("Akari JSON paths parse, evaluate, and preserve concrete wildcard evidence", () => {
  const parsed = parseAkariJsonPath("$.blocks[*].type");
  assert.equal(parsed.hasWildcard, true);
  assert.equal(toSqliteJsonPath("$.seo.title"), "$.seo.title");
  assert.equal(toSqliteJsonPath(parsed), null);

  const values = readAkariJsonPathValues(fixtures.pages[0].data, "$.blocks[*].type");
  assert.deepEqual(values, [
    { path: "$.blocks[0].type", value: "hero" },
    { path: "$.blocks[1].type", value: "embed" },
  ]);

  assert.deepEqual(
    evaluatePathFilters(fixtures.pages[0].data, [
      { path: "$.blocks[*].type", op: "eq", value: "embed" },
      { path: "$.blocks[*].url", op: "exists" },
    ]),
    { matched: true, matchedPaths: ["$.blocks[1].type", "$.blocks[1].url"] },
  );

  assert.deepEqual(
    evaluatePathFilters(
      {
        blocks: [
          { type: "embed" },
          { type: "text", url: "https://developers.cloudflare.com/workers-ai/" },
        ],
      },
      [
        { path: "$.blocks[*].type", op: "eq", value: "embed" },
        { path: "$.blocks[*].url", op: "contains", value: "developers.cloudflare.com" },
      ],
    ),
    { matched: false, matchedPaths: [] },
  );
});

test("metadata filters support nested reads and indexed subsets", () => {
  const metadata = {
    collection: "pages",
    status: "published",
    locale: "en",
    updatedAt: "2026-02-01",
    seo: { title: "Workers" },
  };

  assert.equal(
    matchesMetadataFilters(metadata, {
      collection: { $in: ["pages", "products"] },
      status: "published",
      "seo.title": "Workers",
      updatedAt: { $gte: "2026-01-01" },
    }),
    true,
  );
  assert.deepEqual(
    toIndexedMetadataFilter(
      {
        collection: { $in: ["pages"] },
        status: "published",
        "seo.title": "Workers",
      },
      ["collection", "status"],
    ),
    { collection: { $in: ["pages"] }, status: "published" },
  );
});

test("metadata $ne and $nin do not vacuously match non-scalar fields", () => {
  const metadata = { seo: { title: "Workers" }, tags: ["featured", "news"], status: "published" };

  assert.equal(matchesMetadataFilters(metadata, { seo: { $ne: "Workers" } }), false);
  assert.equal(matchesMetadataFilters(metadata, { tags: { $nin: ["featured"] } }), false);
  assert.equal(matchesMetadataFilters(metadata, { status: { $ne: "draft" } }), true);
  assert.equal(matchesMetadataFilters(metadata, { locale: { $ne: "en" } }), false);
});

test("facts extraction materializes configured structural paths", () => {
  const facts = extractContentFacts({
    collection: "pages",
    entryId: "home",
    locale: "en",
    status: "published",
    updatedAt: "2026-02-01T00:00:00.000Z",
    data: fixtures.pages[0].data,
    pathTemplates: ["$.blocks[*].type", "$.blocks[*].url"],
  });

  assert.deepEqual(
    facts.map((fact) => ({
      pathTemplate: fact.pathTemplate,
      fullPath: fact.fullPath,
      valueType: fact.valueType,
      valueText: fact.valueText,
      ordinal: fact.ordinal,
    })),
    [
      {
        pathTemplate: "$.blocks[*].type",
        fullPath: "$.blocks[0].type",
        valueType: "string",
        valueText: "hero",
        ordinal: 0,
      },
      {
        pathTemplate: "$.blocks[*].type",
        fullPath: "$.blocks[1].type",
        valueType: "string",
        valueText: "embed",
        ordinal: 1,
      },
      {
        pathTemplate: "$.blocks[*].url",
        fullPath: "$.blocks[1].url",
        valueType: "string",
        valueText: "https://developers.cloudflare.com/workers-ai/",
        ordinal: 1,
      },
    ],
  );
});

test("facts replacement statements can rebuild a sidecar fact slice", () => {
  const facts = extractContentFacts({
    collection: "pages",
    entryId: "home",
    locale: "en",
    status: "published",
    data: fixtures.pages[0].data,
    pathTemplates: ["$.blocks[*].type"],
  });
  const statements = buildReplaceFactsStatements(facts);

  assert.equal(statements.length, 3);
  assert.equal(statements[0].sql.startsWith("DELETE FROM _emdash_content_facts"), true);
  assert.deepEqual(statements[1].params.slice(0, 7), [
    "pages",
    "home",
    "en",
    "published",
    "$.blocks[*].type",
    "$.blocks[0].type",
    "string",
  ]);
  assert.match(AKARI_FACTS_TABLE_SQL, /CREATE TABLE IF NOT EXISTS _emdash_content_facts/);

  assert.deepEqual(
    buildReplaceFactsStatements([], {
      collection: "pages",
      entryId: "home",
      locale: "en",
    }),
    [
      {
        sql: "DELETE FROM _emdash_content_facts WHERE collection = ? AND entry_id = ? AND COALESCE(locale, '') = COALESCE(?, '')",
        params: ["pages", "home", "en"],
      },
    ],
  );
});

test("facts replacement deletes every scope in a mixed-entry batch", () => {
  const homeFacts = extractContentFacts({
    collection: "pages",
    entryId: "home",
    locale: "en",
    status: "published",
    data: fixtures.pages[0].data,
    pathTemplates: ["$.blocks[*].type"],
  });
  const aboutFacts = extractContentFacts({
    collection: "pages",
    entryId: "about",
    locale: "en",
    status: "draft",
    data: fixtures.pages[1].data,
    pathTemplates: ["$.blocks[*].type"],
  });

  const statements = buildReplaceFactsStatements([...homeFacts, ...aboutFacts]);

  const deletes = statements.filter((s) => s.sql.startsWith("DELETE"));
  const inserts = statements.filter((s) => s.sql.startsWith("INSERT"));

  assert.equal(deletes.length, 2);
  assert.deepEqual(
    deletes.map((s) => s.params),
    [
      ["pages", "home", "en", "$.blocks[*].type"],
      ["pages", "about", "en", "$.blocks[*].type"],
    ],
  );
  assert.equal(inserts.length, homeFacts.length + aboutFacts.length);
});

test("facts replacement from extraction clears stale rows when nothing matches", () => {
  const statements = buildReplaceFactsStatementsFromExtraction({
    collection: "pages",
    entryId: "home",
    locale: "en",
    status: "published",
    data: { title: "No blocks here" },
    pathTemplates: ["$.blocks[*].type"],
  });

  assert.equal(statements.length, 1);
  assert.equal(statements[0].sql.startsWith("DELETE"), true);
  assert.match(statements[0].sql, /path_template IN \(\?\)/);
  assert.deepEqual(statements[0].params, ["pages", "home", "en", "$.blocks[*].type"]);

  assert.deepEqual(buildReplaceFactsStatements([]), []);
});

test("facts replacement from extraction clears requested templates that now emit no facts", () => {
  const statements = buildReplaceFactsStatementsFromExtraction({
    collection: "pages",
    entryId: "home",
    locale: "en",
    status: "published",
    data: { blocks: [{ type: "hero" }] },
    pathTemplates: ["$.blocks[*].type", "$.blocks[*].url"],
  });

  const del = statements.find((s) => s.sql.startsWith("DELETE"));
  const inserts = statements.filter((s) => s.sql.startsWith("INSERT"));

  assert.match(del.sql, /path_template IN \(\?, \?\)/);
  assert.deepEqual(del.params, ["pages", "home", "en", "$.blocks[*].type", "$.blocks[*].url"]);
  assert.equal(inserts.length, 1);
  assert.deepEqual(inserts[0].params.slice(0, 7), [
    "pages",
    "home",
    "en",
    "published",
    "$.blocks[*].type",
    "$.blocks[0].type",
    "string",
  ]);
});

test("facts replace is idempotent for duplicate templates / colliding facts", () => {
  const facts = extractContentFacts({
    collection: "c",
    entryId: "e",
    data: { a: 1 },
    pathTemplates: ["$.a", "$.a"],
  });
  assert.equal(facts.length, 1);

  const fact = {
    collection: "c",
    entryId: "e",
    locale: "en",
    status: "published",
    pathTemplate: "$.a",
    fullPath: "$.a",
    valueType: "number",
    valueNumber: 1,
    valueJson: "1",
  };
  const statements = buildReplaceFactsStatements([fact, { ...fact }]);

  const db = new DatabaseSync(":memory:");
  db.exec(AKARI_FACTS_TABLE_SQL);
  const bind = (value) =>
    value === undefined ? null : typeof value === "boolean" ? (value ? 1 : 0) : value;

  assert.doesNotThrow(() => {
    for (const statement of statements)
      db.prepare(statement.sql).run(...statement.params.map(bind));
  });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM _emdash_content_facts").get().n, 1);
});

test("facts replacement only deletes the path templates in the batch", () => {
  const facts = extractContentFacts({
    collection: "pages",
    entryId: "home",
    locale: "en",
    status: "published",
    data: fixtures.pages[0].data,
    pathTemplates: ["$.blocks[*].type"],
  });

  const statements = buildReplaceFactsStatements(facts);
  const del = statements.find((s) => s.sql.startsWith("DELETE"));

  assert.match(del.sql, /path_template IN \(\?\)/);
  assert.deepEqual(del.params, ["pages", "home", "en", "$.blocks[*].type"]);

  const clear = buildReplaceFactsStatements([], {
    collection: "pages",
    entryId: "home",
    locale: "en",
  });
  assert.equal(clear.length, 1);
  assert.doesNotMatch(clear[0].sql, /path_template/);
  assert.deepEqual(clear[0].params, ["pages", "home", "en"]);
});

test("structural SQL compiler runs direct and wildcard path filters in SQLite", () => {
  const direct = compileStructuralFilter(
    { path: "$.title", op: "match", value: "workers" },
    { dataExpression: "e.data" },
  );
  assert.deepEqual(direct.joins, []);
  assert.deepEqual(direct.where, [
    "json_type(e.data, ?) = 'text' AND instr(LOWER(json_extract(e.data, ?)), ?) > 0",
  ]);
  assert.deepEqual(direct.params, ["$.title", "$.title", "workers"]);

  const wildcard = compileStructuralFilters(
    [
      { path: "$.blocks[*].type", op: "eq", value: "embed" },
      { path: "$.blocks[*].url", op: "exists" },
    ],
    { dataExpression: "e.data" },
  );

  assert.deepEqual(wildcard.joins, [
    "JOIN json_each(e.data, ?) AS akari_path_0 ON json_type(e.data, ?) = 'array'",
  ]);
  assert.deepEqual(wildcard.params, ["$.blocks", "$.blocks", "$.type", "embed", "$.url"]);

  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE entries (id TEXT PRIMARY KEY, data TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO entries (id, data) VALUES (?, ?)");
  insert.run("home", JSON.stringify(fixtures.pages[0].data));
  insert.run("about", JSON.stringify(fixtures.pages[1].data));
  insert.run(
    "split",
    JSON.stringify({
      blocks: [
        { type: "embed" },
        { type: "text", url: "https://developers.cloudflare.com/workers-ai/" },
      ],
    }),
  );

  const sql = `
    SELECT DISTINCT e.id
    FROM entries AS e
    ${wildcard.joins.join("\n")}
    WHERE ${wildcard.where.join(" AND ")}
    ORDER BY e.id
  `;
  const rows = db
    .prepare(sql)
    .all(...wildcard.params)
    .map((row) => ({ ...row }));

  assert.deepEqual(rows, [{ id: "home" }]);
});

test("structural match agrees with the runtime evaluator on wildcards and non-strings", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE entries (id TEXT PRIMARY KEY, data TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO entries (id, data) VALUES (?, ?)");
  insert.run("axb", JSON.stringify({ title: "axb", views: 1500 }));
  insert.run("literal", JSON.stringify({ title: "a_b", views: 1 }));

  const run = (path, value) => {
    const compiled = compileStructuralFilter(
      { path, op: "match", value },
      { dataExpression: "e.data" },
    );
    const sql = `SELECT e.id FROM entries AS e WHERE ${compiled.where.join(" AND ")} ORDER BY e.id`;
    return db
      .prepare(sql)
      .all(...compiled.params)
      .map((row) => row.id);
  };

  assert.deepEqual(run("$.title", "a_b"), ["literal"]);
  assert.deepEqual(run("$.views", "50"), []);

  assert.equal(
    evaluatePathFilters({ title: "axb" }, [{ path: "$.title", op: "match", value: "a_b" }]).matched,
    false,
  );
  assert.equal(
    evaluatePathFilters({ views: 1500 }, [{ path: "$.views", op: "match", value: "50" }]).matched,
    false,
  );
});

test("multi-wildcard paths: JS engine and SQL compiler agree", () => {
  const data = { a: [{ b: ["x", "y"] }, { b: ["z"] }] };

  assert.equal(parseAkariJsonPath("$.a[*].b[*]").hasWildcard, true);
  assert.equal(
    evaluatePathFilters(data, [{ path: "$.a[*].b[*]", op: "eq", value: "z" }]).matched,
    true,
  );

  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE entries (id TEXT PRIMARY KEY, data TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO entries (id, data) VALUES (?, ?)");
  insert.run("hit", JSON.stringify(data));
  insert.run("miss", JSON.stringify({ a: [{ b: ["x", "y"] }, { b: [] }] }));
  insert.run("object", JSON.stringify({ a: [{ b: { x: "z" } }] }));
  insert.run("scalar", JSON.stringify({ a: [{ b: "z" }] }));

  const compiled = compileStructuralFilters([{ path: "$.a[*].b[*]", op: "eq", value: "z" }], {
    dataExpression: "e.data",
  });
  const sql = `
    SELECT DISTINCT e.id
    FROM entries AS e
    ${compiled.joins.join("\n")}
    WHERE ${compiled.where.join(" AND ")}
    ORDER BY e.id
  `;
  const rows = db
    .prepare(sql)
    .all(...compiled.params)
    .map((row) => row.id);

  assert.deepEqual(rows, ["hit"]);
  assert.equal(
    evaluatePathFilters({ a: [{ b: { x: "z" } }] }, [{ path: "$.a[*].b[*]", op: "eq", value: "z" }])
      .matched,
    false,
  );
  assert.equal(
    evaluatePathFilters({ a: [{ b: "z" }] }, [{ path: "$.a[*].b[*]", op: "eq", value: "z" }])
      .matched,
    false,
  );

  const pathRows = db
    .prepare(
      `
        SELECT ${compiled.matchedPathExpressions[0]} AS matched_path
        FROM entries AS e
        ${compiled.joins.join("\n")}
        WHERE e.id = 'hit' AND ${compiled.where.join(" AND ")}
        ORDER BY matched_path
      `,
    )
    .all(...compiled.params)
    .map((row) => row.matched_path);

  assert.deepEqual(pathRows, ["$.a[1].b[0]"]);
});

test("multi-wildcard SQL keeps same first-wildcard grouping", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE entries (id TEXT PRIMARY KEY, data TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO entries (id, data) VALUES (?, ?)");
  insert.run("same", JSON.stringify({ a: [{ kind: "target", b: ["z"] }] }));
  insert.run(
    "split",
    JSON.stringify({
      a: [
        { kind: "target", b: [] },
        { kind: "other", b: ["z"] },
      ],
    }),
  );

  const filters = [
    { path: "$.a[*].kind", op: "eq", value: "target" },
    { path: "$.a[*].b[*]", op: "eq", value: "z" },
  ];
  const compiled = compileStructuralFilters(filters, { dataExpression: "e.data" });
  const sql = `
    SELECT DISTINCT e.id
    FROM entries AS e
    ${compiled.joins.join("\n")}
    WHERE ${compiled.where.join(" AND ")}
    ORDER BY e.id
  `;
  const rows = db
    .prepare(sql)
    .all(...compiled.params)
    .map((row) => row.id);

  assert.deepEqual(rows, ["same"]);
  assert.equal(
    evaluatePathFilters(
      {
        a: [
          { kind: "target", b: [] },
          { kind: "other", b: ["z"] },
        ],
      },
      filters,
    ).matched,
    false,
  );
});

test("consecutive multi-wildcard SQL does not traverse JSON-looking scalar strings", () => {
  const filters = [{ path: "$.a[*][*]", op: "eq", value: "z" }];
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE entries (id TEXT PRIMARY KEY, data TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO entries (id, data) VALUES (?, ?)");
  insert.run("array", JSON.stringify({ a: [["z"]] }));
  insert.run("string", JSON.stringify({ a: ['["z"]'] }));

  const compiled = compileStructuralFilters(filters, { dataExpression: "e.data" });
  const sql = `
    SELECT DISTINCT e.id
    FROM entries AS e
    ${compiled.joins.join("\n")}
    WHERE ${compiled.where.join(" AND ")}
    ORDER BY e.id
  `;
  const rows = db
    .prepare(sql)
    .all(...compiled.params)
    .map((row) => row.id);

  assert.deepEqual(rows, ["array"]);
  assert.equal(evaluatePathFilters({ a: ['["z"]'] }, filters).matched, false);
});

test("structural numeric range agrees with the runtime evaluator on mixed JSON types", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE entries (id TEXT PRIMARY KEY, data TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO entries (id, data) VALUES (?, ?)");
  insert.run("num", JSON.stringify({ price: 99 }));
  insert.run("str", JSON.stringify({ price: "99" }));

  const compiled = compileStructuralFilter(
    { path: "$.price", op: "gt", value: 50 },
    { dataExpression: "e.data" },
  );
  const sql = `SELECT e.id FROM entries AS e WHERE ${compiled.where.join(" AND ")} ORDER BY e.id`;
  const rows = db
    .prepare(sql)
    .all(...compiled.params)
    .map((row) => row.id);

  assert.deepEqual(rows, ["num"]);
  assert.equal(
    evaluatePathFilters({ price: "99" }, [{ path: "$.price", op: "gt", value: 50 }]).matched,
    false,
  );
  assert.equal(
    evaluatePathFilters({ price: 99 }, [{ path: "$.price", op: "gt", value: 50 }]).matched,
    true,
  );
});

test("structural string range agrees with the runtime evaluator across letter case", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE entries (id TEXT PRIMARY KEY, data TEXT NOT NULL)");
  db.prepare("INSERT INTO entries (id, data) VALUES (?, ?)").run(
    "lower-a",
    JSON.stringify({ name: "a" }),
  );

  const compiled = compileStructuralFilter(
    { path: "$.name", op: "gt", value: "Z" },
    { dataExpression: "e.data" },
  );
  const sql = `SELECT e.id FROM entries AS e WHERE ${compiled.where.join(" AND ")}`;
  const rows = db
    .prepare(sql)
    .all(...compiled.params)
    .map((row) => row.id);

  assert.deepEqual(rows, ["lower-a"]);
  assert.equal(
    evaluatePathFilters({ name: "a" }, [{ path: "$.name", op: "gt", value: "Z" }]).matched,
    true,
  );
});

test("structural contains agrees with the runtime evaluator on arrays", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE entries (id TEXT PRIMARY KEY, data TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO entries (id, data) VALUES (?, ?)");
  insert.run("array", JSON.stringify({ tags: ["alpha", "beta"] }));
  insert.run("string", JSON.stringify({ tags: "alphabet" }));

  const run = (value) => {
    const compiled = compileStructuralFilter(
      { path: "$.tags", op: "contains", value },
      { dataExpression: "e.data" },
    );
    const sql = `SELECT e.id FROM entries AS e WHERE ${compiled.where.join(" AND ")} ORDER BY e.id`;
    return db
      .prepare(sql)
      .all(...compiled.params)
      .map((row) => row.id);
  };

  assert.deepEqual(run("ph"), ["string"]);
  assert.deepEqual(run("alpha"), ["array", "string"]);
  assert.deepEqual(run(","), []);

  assert.equal(
    evaluatePathFilters({ tags: ["alpha", "beta"] }, [
      { path: "$.tags", op: "contains", value: "ph" },
    ]).matched,
    false,
  );
  assert.equal(
    evaluatePathFilters({ tags: ["alpha", "beta"] }, [
      { path: "$.tags", op: "contains", value: "alpha" },
    ]).matched,
    true,
  );
});

test("structural ne agrees with the runtime evaluator on non-scalar values", () => {
  const compiled = compileStructuralFilter(
    { path: "$.meta", op: "ne", value: "draft" },
    { dataExpression: "e.data" },
  );

  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE entries (id TEXT PRIMARY KEY, data TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO entries (id, data) VALUES (?, ?)");
  insert.run("object", JSON.stringify({ meta: { id: 1 } }));
  insert.run("scalar", JSON.stringify({ meta: "active" }));
  insert.run("equal", JSON.stringify({ meta: "draft" }));

  const sql = `SELECT e.id FROM entries AS e WHERE ${compiled.where.join(" AND ")} ORDER BY e.id`;
  const rows = db
    .prepare(sql)
    .all(...compiled.params)
    .map((row) => row.id);

  assert.deepEqual(rows, ["scalar"]);

  assert.equal(
    evaluatePathFilters({ meta: { id: 1 } }, [{ path: "$.meta", op: "ne", value: "draft" }])
      .matched,
    false,
  );
  assert.equal(
    evaluatePathFilters({ meta: "active" }, [{ path: "$.meta", op: "ne", value: "draft" }]).matched,
    true,
  );
});

test("content fallback executes private structural discovery without D1", async () => {
  const input = normalizeQueryInput({
    mode: "structural",
    collections: ["pages"],
    filter: { status: "published" },
    paths: [{ path: "$.blocks[*].type", op: "eq", value: "embed" }],
    facets: ["collection", "$.blocks[*].type"],
    limit: 10,
  });

  const response = await runAkariQuery(input, { content });
  assert.equal(response.items.length, 1);
  assert.equal(response.items[0].identity.id, "home");
  assert.deepEqual(response.items[0].matchedPaths, ["$.blocks[1].type"]);
  assert.deepEqual(response.facets, [
    { key: "collection", buckets: [{ value: "pages", count: 1 }] },
    {
      key: "$.blocks[*].type",
      buckets: [
        { value: "embed", count: 1 },
        { value: "hero", count: 1 },
      ],
    },
  ]);
});

test("duplicate collection names are deduped and do not inflate scores", async () => {
  const paths = [{ path: "$.blocks[*].type", op: "eq", value: "embed" }];

  const duplicated = await runAkariQuery(
    normalizeQueryInput({ mode: "structural", collections: ["pages", "pages"], paths, limit: 10 }),
    { content },
  );
  const single = await runAkariQuery(
    normalizeQueryInput({ mode: "structural", collections: ["pages"], paths, limit: 10 }),
    { content },
  );

  assert.equal(duplicated.items.length, 1);
  assert.deepEqual(
    duplicated.items.map((item) => [item.identity.id, item.score]),
    single.items.map((item) => [item.identity.id, item.score]),
  );
});

test("top-level collections override a conflicting filter.collection with a warning", async () => {
  const response = await runAkariQuery(
    normalizeQueryInput({
      mode: "structural",
      collections: ["pages"],
      filter: { collection: "products", status: "published" },
      limit: 10,
    }),
    { content },
  );

  assert.ok(response.items.length >= 1);
  assert.ok(response.items.every((item) => item.identity.collection === "pages"));
  assert.ok(response.warnings?.some((w) => w.includes("filter.collection was ignored")));
});

test("path facets do not borrow filter matchedPaths as bucket values", async () => {
  const posts = [
    {
      id: "p1",
      type: "posts",
      slug: "p1",
      status: "published",
      locale: "en",
      data: { title: "P1", blocks: [{ type: "embed" }] },
    },
  ];
  const postContent = {
    async get(_collection, id) {
      return posts.find((item) => item.id === id) ?? null;
    },
    async list() {
      return { items: posts, hasMore: false };
    },
  };

  const response = await runAkariQuery(
    normalizeQueryInput({
      mode: "structural",
      collections: ["posts"],
      paths: [{ path: "$.blocks[*].type", op: "eq", value: "embed" }],
      facets: ["$.blocks[*].url"],
      limit: 10,
    }),
    { content: postContent },
  );

  const urlFacet = response.facets?.find((facet) => facet.key === "$.blocks[*].url");
  assert.deepEqual(urlFacet?.buckets, []);
});

test("facets count non-identity data fields like category", async () => {
  const articles = [
    {
      id: "a1",
      type: "articles",
      slug: "a1",
      status: "published",
      locale: "en",
      data: { title: "A1", category: "news" },
    },
    {
      id: "a2",
      type: "articles",
      slug: "a2",
      status: "published",
      locale: "en",
      data: { title: "A2", category: "news" },
    },
    {
      id: "a3",
      type: "articles",
      slug: "a3",
      status: "published",
      locale: "en",
      data: { title: "A3", category: "opinion" },
    },
  ];
  const articleContent = {
    async get(_collection, id) {
      return articles.find((item) => item.id === id) ?? null;
    },
    async list() {
      return { items: articles, hasMore: false };
    },
  };

  const response = await runAkariQuery(
    normalizeQueryInput({
      mode: "structural",
      collections: ["articles"],
      facets: ["category"],
      limit: 20,
    }),
    { content: articleContent },
  );

  const categoryFacet = response.facets?.find((facet) => facet.key === "category");
  assert.deepEqual(categoryFacet?.buckets, [
    { value: "news", count: 2 },
    { value: "opinion", count: 1 },
  ]);
});

test("structural mode applies q as a filter and ranking signal", async () => {
  const noMatch = await runAkariQuery(
    normalizeQueryInput({ q: "zzzznonexistent", mode: "structural", collections: ["pages"] }),
    { content },
  );
  assert.equal(noMatch.items.length, 0);

  const narrowed = await runAkariQuery(
    normalizeQueryInput({ q: "workers", mode: "structural", collections: ["pages"] }),
    { content },
  );
  assert.equal(narrowed.items.length, 1);
  assert.equal(narrowed.items[0].identity.id, "home");
});

test("content scan enforces fetchLimit even when a provider over-returns a page", async () => {
  const items = Array.from({ length: 10 }, (_, index) => ({
    id: `item-${index}`,
    type: "pages",
    slug: `item-${index}`,
    status: "published",
    locale: "en",
    data: { title: `Item ${index}`, blocks: [{ type: "text", text: "body" }] },
    updatedAt: "2026-02-01T00:00:00.000Z",
    publishedAt: "2026-02-01T00:00:00.000Z",
  }));

  const overReturningContent = {
    async get(collection, id) {
      return items.find((item) => item.id === id) ?? null;
    },
    async list() {
      return { items, hasMore: false };
    },
  };

  const response = await runAkariQuery(
    normalizeQueryInput({ mode: "structural", collections: ["pages"], limit: 20 }),
    { content: overReturningContent, fetchLimit: 3 },
  );

  assert.equal(response.items.length, 3);
  assert.ok(
    response.warnings?.some((w) => w.includes("reached fetchLimit")),
    "expected a fetchLimit warning",
  );
});

test("content fallback follows content pagination during structural discovery", async () => {
  const input = normalizeQueryInput({
    mode: "structural",
    collections: ["pages"],
    filter: { status: "published" },
    paths: [{ path: "$.blocks[*].type", op: "eq", value: "embed" }],
    limit: 10,
  });
  const allItems = [
    {
      ...fixtures.pages[0],
      id: "text-only",
      slug: "text-only",
      data: { title: "Text Only", blocks: [{ type: "text", text: "No embeds" }] },
    },
    fixtures.pages[0],
  ];
  const seenCursors = [];
  const paginatedContent = {
    async get(collection, id) {
      return allItems.find((item) => item.id === id && collection === "pages") ?? null;
    },
    async list(collection, options = {}) {
      assert.equal(collection, "pages");
      seenCursors.push(options.cursor);
      const start = options.cursor ? Number(options.cursor) : 0;
      const next = start + 1;

      return {
        items: allItems.slice(start, next),
        cursor: String(next),
        hasMore: next < allItems.length,
      };
    },
  };

  const response = await runAkariQuery(input, { content: paginatedContent });

  assert.deepEqual(seenCursors, [undefined, "1"]);
  assert.equal(response.items.length, 1);
  assert.equal(response.items[0].identity.id, "home");
});

test("lexical provider and content scan fuse overlapping candidates", async () => {
  const input = normalizeQueryInput({
    q: "workers ai search",
    mode: "lexical",
    collections: ["pages", "products"],
    filter: { status: "published" },
    limit: 5,
  });

  const lexicalSearch = async () => ({
    items: [
      {
        collection: "pages",
        id: "home",
        slug: "home",
        locale: "en",
        title: "Workers AI Search",
        snippet: "<mark>Workers AI</mark> Search",
        score: 9,
      },
      {
        collection: "products",
        id: "d1-product",
        slug: "d1",
        locale: "en",
        title: "D1 Product",
        snippet: "<mark>D1</mark> Product",
        score: 5,
      },
    ],
  });

  const response = await runAkariQuery(input, {
    content,
    lexicalSearch,
  });

  assert.equal(response.items[0].identity.id, "home");
  assert.deepEqual(response.items[0].matchedFields, ["content", "fts", "title"]);
  assert.equal(response.items.length, 2);
});

test("lexical post-filter drops hits whose real metadata fails the filter", async () => {
  const input = normalizeQueryInput({
    q: "about",
    mode: "lexical",
    collections: ["pages"],
    filter: { status: "published" },
    limit: 5,
  });

  const lexicalSearch = async () => ({
    items: [
      { collection: "pages", id: "about", slug: "about", locale: "en", title: "About", score: 7 },
    ],
  });

  const response = await runAkariQuery(input, { content, lexicalSearch });

  assert.equal(response.items.length, 0);
});

test("lexical-only fallback honors equality status filters enforced by the provider", async () => {
  const input = normalizeQueryInput({
    q: "workers",
    mode: "lexical",
    collections: ["pages"],
    filter: { status: "published" },
    limit: 5,
  });
  let seenStatus;

  const lexicalSearch = async (_query, options) => {
    seenStatus = options.status;
    return {
      items: [
        {
          collection: "pages",
          id: "home",
          slug: "home",
          locale: "en",
          title: "Workers AI Search",
          score: 9,
        },
      ],
    };
  };

  const response = await runAkariQuery(input, { lexicalSearch });

  assert.equal(seenStatus, "published");
  assert.equal(response.items.length, 1);
  assert.equal(response.items[0].identity.id, "home");
});

test("lexical post-filter honors non-equality status filters via real metadata", async () => {
  const input = normalizeQueryInput({
    q: "zzzznomatch",
    mode: "lexical",
    collections: ["pages"],
    filter: { status: { $in: ["published", "draft"] } },
    limit: 5,
  });

  const lexicalSearch = async () => ({
    items: [
      { collection: "pages", id: "about", slug: "about", locale: "en", title: "About", score: 7 },
    ],
  });

  const response = await runAkariQuery(input, { content, lexicalSearch });

  assert.equal(response.items.length, 1);
  assert.equal(response.items[0].identity.id, "about");
});

test("lexical leg enforces path filters against the resolved entry body", async () => {
  const input = normalizeQueryInput({
    q: "workers",
    mode: "lexical",
    collections: ["pages"],
    paths: [{ path: "$.blocks[*].type", op: "eq", value: "text" }],
    limit: 5,
  });

  const lexicalSearch = async () => ({
    items: [
      {
        collection: "pages",
        id: "home",
        slug: "home",
        locale: "en",
        title: "Workers AI Search",
        score: 9,
      },
    ],
  });

  const response = await runAkariQuery(input, { content, lexicalSearch });

  assert.equal(response.items.length, 0);
});

test("lexical leg drops hits when paths are set but no content access is available", async () => {
  const input = normalizeQueryInput({
    q: "workers",
    mode: "lexical",
    collections: ["pages"],
    paths: [{ path: "$.blocks[*].type", op: "eq", value: "embed" }],
    limit: 5,
  });

  const lexicalSearch = async () => ({
    items: [
      { collection: "pages", id: "home", slug: "home", locale: "en", title: "Home", score: 9 },
    ],
  });

  const response = await runAkariQuery(input, { lexicalSearch });

  assert.equal(response.items.length, 0);
});

test("resolve returns ambiguity when top fused candidates are too close", async () => {
  const input = normalizeResolveInput({
    q: "workers ai search",
    mode: "lexical",
    collections: ["pages"],
    maxAlternatives: 2,
  });

  const lexicalSearch = async () => ({
    items: [
      { collection: "pages", id: "home", slug: "home", locale: "en", title: "Home", score: 10 },
      { collection: "pages", id: "about", slug: "about", locale: "en", title: "About", score: 9 },
    ],
  });

  const response = await resolveAkariQuery(input, {
    lexicalSearch,
    ambiguityMargin: 1,
  });

  assert.equal(response.status, "ambiguous");
  assert.equal(response.alternatives?.length, 2);
});

test("query applies the validated sort parameter to fused results", async () => {
  const ascending = await runAkariQuery(
    normalizeQueryInput({ mode: "structural", collections: ["pages"], sort: ["title"], limit: 10 }),
    { content },
  );
  assert.deepEqual(
    ascending.items.map((item) => item.identity.id),
    ["about", "home"],
  );

  const descending = await runAkariQuery(
    normalizeQueryInput({
      mode: "structural",
      collections: ["pages"],
      sort: ["-title"],
      limit: 10,
    }),
    { content },
  );
  assert.deepEqual(
    descending.items.map((item) => item.identity.id),
    ["home", "about"],
  );
});

test("lexical-only query surfaces the provider nextCursor for pagination", async () => {
  const lexicalSearch = async () => ({
    items: [
      { collection: "pages", id: "home", slug: "home", locale: "en", title: "Home", score: 9 },
    ],
    nextCursor: "page-2",
  });

  const lexicalOnly = await runAkariQuery(
    normalizeQueryInput({ q: "workers", mode: "lexical", collections: ["pages"], limit: 5 }),
    { lexicalSearch },
  );
  assert.equal(lexicalOnly.nextCursor, "page-2");

  const fused = await runAkariQuery(
    normalizeQueryInput({ q: "workers", mode: "lexical", collections: ["pages"], limit: 5 }),
    { content, lexicalSearch },
  );
  assert.equal(fused.nextCursor, undefined);
});

test("query projects response items to the selected fields", async () => {
  const response = await runAkariQuery(
    normalizeQueryInput({
      mode: "structural",
      collections: ["pages"],
      select: ["identity", "score"],
      limit: 10,
    }),
    { content },
  );

  for (const item of response.items) {
    assert.deepEqual(Object.keys(item).sort(), ["identity", "score"]);
    assert.ok(item.identity.collection);
  }
});

test("query projection can reduce identity to chosen subfields", async () => {
  const response = await runAkariQuery(
    normalizeQueryInput({
      mode: "structural",
      collections: ["pages"],
      select: ["title", "score"],
      limit: 10,
    }),
    { content },
  );

  const item = response.items[0];
  assert.deepEqual(Object.keys(item).sort(), ["identity", "score"]);
  assert.deepEqual(Object.keys(item.identity), ["title"]);
});

test("resolve projects item and alternatives by select without losing ambiguity", async () => {
  const input = normalizeResolveInput({
    q: "workers ai search",
    mode: "lexical",
    collections: ["pages"],
    select: ["identity", "score"],
    limit: 1,
    maxAlternatives: 2,
  });

  const lexicalSearch = async () => ({
    items: [
      { collection: "pages", id: "home", slug: "home", locale: "en", title: "Home", score: 10 },
      { collection: "pages", id: "about", slug: "about", locale: "en", title: "About", score: 9 },
    ],
  });

  const response = await resolveAkariQuery(input, { lexicalSearch, ambiguityMargin: 1 });

  assert.equal(response.status, "ambiguous");
  for (const alt of response.alternatives) {
    assert.deepEqual(Object.keys(alt).sort(), ["identity", "score"]);
  }
});

test("resolve refuses to return resolved when a collection failed to scan", async () => {
  const bItem = {
    id: "b1",
    type: "b",
    slug: "b1",
    status: "published",
    locale: "en",
    data: { title: "B One" },
  };
  const flakyContent = {
    async get(_collection, id) {
      return id === "b1" ? bItem : null;
    },
    async list(collection) {
      if (collection === "a") throw new Error("missing table");
      return { items: [bItem], hasMore: false };
    },
  };

  const response = await resolveAkariQuery(
    normalizeResolveInput({ mode: "structural", collections: ["a", "b"] }),
    { content: flakyContent },
  );

  assert.notEqual(response.status, "resolved");
  assert.equal(response.degraded, true);
  assert.ok(response.warnings?.some((w) => w.startsWith("Content scan failed for a")));
});

test("resolve detects ambiguity even when input limit is 1", async () => {
  const input = normalizeResolveInput({
    q: "workers ai search",
    mode: "lexical",
    collections: ["pages"],
    limit: 1,
    maxAlternatives: 2,
  });

  const lexicalSearch = async () => ({
    items: [
      { collection: "pages", id: "home", slug: "home", locale: "en", title: "Home", score: 10 },
      { collection: "pages", id: "about", slug: "about", locale: "en", title: "About", score: 9 },
    ],
  });

  const response = await resolveAkariQuery(input, {
    lexicalSearch,
    ambiguityMargin: 1,
  });

  assert.equal(response.status, "ambiguous");
  assert.equal(response.alternatives?.length, 2);
});

test("ambiguous resolve honors maxAlternatives below two", async () => {
  const lexicalSearch = async () => ({
    items: [
      { collection: "pages", id: "home", slug: "home", locale: "en", title: "Home", score: 10 },
      { collection: "pages", id: "about", slug: "about", locale: "en", title: "About", score: 9 },
    ],
  });

  const zero = await resolveAkariQuery(
    normalizeResolveInput({
      q: "workers ai search",
      mode: "lexical",
      collections: ["pages"],
      maxAlternatives: 0,
    }),
    { lexicalSearch, ambiguityMargin: 1 },
  );
  assert.equal(zero.status, "ambiguous");
  assert.equal(zero.alternatives.length, 0);

  const one = await resolveAkariQuery(
    normalizeResolveInput({
      q: "workers ai search",
      mode: "lexical",
      collections: ["pages"],
      maxAlternatives: 1,
    }),
    { lexicalSearch, ambiguityMargin: 1 },
  );
  assert.equal(one.status, "ambiguous");
  assert.equal(one.alternatives.length, 1);
});

test("rank fusion does not let a null content field erase an FTS identity value", () => {
  const fused = reciprocalRankFusion([
    [
      {
        key: "pages:home:en",
        source: "fts",
        result: {
          identity: {
            collection: "pages",
            id: "home",
            locale: "en",
            slug: "workers-ai",
            title: "Workers AI",
          },
        },
      },
    ],
    [
      {
        key: "pages:home:en",
        source: "content",
        result: {
          identity: {
            collection: "pages",
            id: "home",
            locale: "en",
            slug: null,
            title: "Workers AI",
          },
        },
      },
    ],
  ]);

  assert.equal(fused[0].identity.slug, "workers-ai");
  assert.equal(fused[0].identity.title, "Workers AI");
});

test("rank fusion boosts overlap deterministically", () => {
  const fused = reciprocalRankFusion([
    [
      {
        key: "pages:home:en",
        source: "fts",
        result: { identity: { collection: "pages", id: "home", locale: "en" } },
      },
      {
        key: "pages:about:en",
        source: "fts",
        result: { identity: { collection: "pages", id: "about", locale: "en" } },
      },
    ],
    [
      {
        key: "pages:home:en",
        source: "structural",
        result: { identity: { collection: "pages", id: "home", locale: "en" } },
      },
    ],
  ]);

  assert.equal(fused[0].identity.id, "home");
  assert.equal(fused[0].score, 1);
  assert.equal(fused[1].score, 0.491935);
  assert.deepEqual(fused[0].matchedFields, ["fts", "structural"]);
});
