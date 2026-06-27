import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  AKARI_FACTS_TABLE_SQL,
  buildReplaceFactsStatements,
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

  // Object-valued field must not satisfy an inequality just because it is not the scalar.
  assert.equal(matchesMetadataFilters(metadata, { seo: { $ne: "Workers" } }), false);
  // Array-valued field must not satisfy $nin vacuously.
  assert.equal(matchesMetadataFilters(metadata, { tags: { $nin: ["featured"] } }), false);
  // Scalar inequality still works as expected.
  assert.equal(matchesMetadataFilters(metadata, { status: { $ne: "draft" } }), true);
  // Missing field is not scalar, so it fails $ne (mirrors the path-layer semantics).
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

  // One DELETE per distinct (collection, entry_id, locale) scope, not just the first.
  assert.equal(deletes.length, 2);
  assert.deepEqual(
    deletes.map((s) => s.params),
    [
      ["pages", "home", "en"],
      ["pages", "about", "en"],
    ],
  );
  // Every fact is still inserted.
  assert.equal(inserts.length, homeFacts.length + aboutFacts.length);
});

test("structural SQL compiler runs direct and wildcard path filters in SQLite", () => {
  const direct = compileStructuralFilter(
    { path: "$.title", op: "match", value: "workers" },
    { dataExpression: "e.data" },
  );
  assert.deepEqual(direct.joins, []);
  assert.deepEqual(direct.where, ["LOWER(CAST(json_extract(e.data, ?) AS TEXT)) LIKE ?"]);
  assert.deepEqual(direct.params, ["$.title", "%workers%"]);

  const wildcard = compileStructuralFilters(
    [
      { path: "$.blocks[*].type", op: "eq", value: "embed" },
      { path: "$.blocks[*].url", op: "exists" },
    ],
    { dataExpression: "e.data" },
  );

  assert.deepEqual(wildcard.joins, ["JOIN json_each(e.data, ?) AS akari_path_0"]);
  assert.deepEqual(wildcard.params, ["$.blocks", "$.type", "embed", "$.url"]);

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

  // Compiled SQL excludes the non-scalar object (and the equal value), matching runtime.
  assert.deepEqual(rows, ["scalar"]);

  // Runtime evaluator: object value is rejected by ne, scalar differing value matches.
  assert.equal(
    evaluatePathFilters({ meta: { id: 1 } }, [{ path: "$.meta", op: "ne", value: "draft" }]).matched,
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
  // Provider leaks a draft hit (ignores the requested status). The post-filter
  // must resolve the hit's real status via content.get and drop it, instead of
  // trusting a status fabricated from the filter constraint.
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

test("lexical post-filter honors non-equality status filters via real metadata", async () => {
  // $in is not a plain equality, so status cannot be fabricated from the filter.
  // The draft hit must be resolved and kept because its real status is in the set.
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
  // The provider returns the published `home` page, but the path filter requires
  // a block of type "text" which home does not have. The FTS hit must be dropped.
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

  // home has hero/embed blocks only; content scan also rejects it, so no candidate survives.
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

  // No content provider: path constraints cannot be verified, so the FTS hit fails closed.
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
  // Structural mode gives every matching entry score 1, so ordering is decided
  // by the sort parameter rather than relevance.
  const ascending = await runAkariQuery(
    normalizeQueryInput({ mode: "structural", collections: ["pages"], sort: ["title"], limit: 10 }),
    { content },
  );
  assert.deepEqual(
    ascending.items.map((item) => item.identity.id),
    ["about", "home"],
  );

  const descending = await runAkariQuery(
    normalizeQueryInput({ mode: "structural", collections: ["pages"], sort: ["-title"], limit: 10 }),
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

  // No content access → lexical is the sole layer → pagination is coherent.
  const lexicalOnly = await runAkariQuery(
    normalizeQueryInput({ q: "workers", mode: "lexical", collections: ["pages"], limit: 5 }),
    { lexicalSearch },
  );
  assert.equal(lexicalOnly.nextCursor, "page-2");

  // With content scan running too, the fused order has no single cursor.
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
    // Full identity object is preserved when `identity` is selected.
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

  // Ambiguity is still detected (score was not stripped before the decision)...
  assert.equal(response.status, "ambiguous");
  // ...and the returned alternatives are projected to the selected fields.
  for (const alt of response.alternatives) {
    assert.deepEqual(Object.keys(alt).sort(), ["identity", "score"]);
  }
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
