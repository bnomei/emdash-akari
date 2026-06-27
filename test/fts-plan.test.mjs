import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  buildEmDashFts5Plan,
  escapeFts5Query,
  getEmDashContentTableName,
  getEmDashFtsTableName,
  mapFtsRows,
} from "../dist/index.mjs";
import { sqliteSupportsFts5 } from "./sqlite-support.mjs";

const hasFts5 = sqliteSupportsFts5();
const skipWithoutFts5 = hasFts5 ? false : "SQLite FTS5 extension is unavailable in this Node build";

test(
  "FTS plan uses EmDash table conventions and runs against local SQLite",
  { skip: skipWithoutFts5 },
  () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
    CREATE TABLE ec_pages (
      id TEXT PRIMARY KEY,
      slug TEXT,
      locale TEXT,
      status TEXT,
      title TEXT,
      body TEXT,
      deleted_at TEXT
    );

    CREATE VIRTUAL TABLE _emdash_fts_pages USING fts5(
      id UNINDEXED,
      locale UNINDEXED,
      title,
      body,
      tokenize = 'porter unicode61'
    );

    INSERT INTO ec_pages (id, slug, locale, status, title, body, deleted_at) VALUES
      ('home', 'workers-ai', 'en', 'published', 'Workers AI Search', 'A page about inference guides and D1 examples.', NULL),
      ('draft', 'draft', 'en', 'draft', 'Workers AI Draft', 'Hidden agent draft.', NULL),
      ('fr', 'workers-ai-fr', 'fr', 'published', 'Recherche Workers AI', 'Workers AI translated.', NULL);

    INSERT INTO _emdash_fts_pages (id, locale, title, body) VALUES
      ('home', 'en', 'Workers AI Search', 'A page about inference guides and D1 examples.'),
      ('draft', 'en', 'Workers AI Draft', 'Hidden agent draft.'),
      ('fr', 'fr', 'Recherche Workers AI', 'Workers AI translated.');
  `);

    assert.equal(getEmDashFtsTableName("pages"), "_emdash_fts_pages");
    assert.equal(getEmDashContentTableName("pages"), "ec_pages");
    assert.equal(escapeFts5Query("workers ai"), '"workers"* "ai"*');

    const plan = buildEmDashFts5Plan({
      collection: "pages",
      query: "workers ai",
      searchableFields: ["title", "body"],
      weights: { title: 8, body: 1 },
      status: "published",
      locale: "en",
      limit: 5,
    });

    assert.ok(plan);
    const rows = db
      .prepare(plan.sql)
      .all(...plan.params)
      .map((row) => ({ ...row }));

    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "home");

    assert.deepEqual(mapFtsRows("pages", rows)[0], {
      identity: {
        collection: "pages",
        id: "home",
        slug: "workers-ai",
        locale: "en",
        status: undefined,
        title: "Workers AI Search",
        url: "/pages/workers-ai",
      },
      score: Math.abs(rows[0].score),
      snippet: rows[0].snippet,
      matchedFields: ["fts"],
      matchedPaths: [],
    });
  },
);

test(
  "FTS plan join is locale-safe and does not mix a stale cross-locale FTS row",
  { skip: skipWithoutFts5 },
  () => {
    // ec_*.id is a PRIMARY KEY in EmDash, so a single id resolves to one locale.
    // The `AND f.locale IS c.locale` predicate is defense-in-depth: a stale FTS
    // row whose locale drifted from its content row must not pair across locale.
    const db = new DatabaseSync(":memory:");
    db.exec(`
    CREATE TABLE ec_pages (
      id TEXT PRIMARY KEY,
      slug TEXT,
      locale TEXT,
      status TEXT,
      title TEXT,
      body TEXT,
      deleted_at TEXT
    );

    CREATE VIRTUAL TABLE _emdash_fts_pages USING fts5(
      id UNINDEXED,
      locale UNINDEXED,
      title,
      body,
      tokenize = 'porter unicode61'
    );

    INSERT INTO ec_pages (id, slug, locale, status, title, body, deleted_at) VALUES
      ('page1', 'english', 'en', 'published', 'English Title', 'Workers content in English.', NULL);

    INSERT INTO _emdash_fts_pages (id, locale, title, body) VALUES
      ('page1', 'de', 'English Title', 'Workers content in English.');
  `);

    // Query without a locale filter so only the join predicate guards locale.
    const plan = buildEmDashFts5Plan({
      collection: "pages",
      query: "workers",
      searchableFields: ["title", "body"],
      limit: 5,
    });

    assert.ok(plan);
    const rows = db
      .prepare(plan.sql)
      .all(...plan.params)
      .map((row) => ({ ...row }));

    // The FTS row (locale 'de') must not join the content row (locale 'en').
    assert.equal(rows.length, 0);
  },
);

test(
  "mapFtsRows escapes snippet HTML while preserving mark highlights",
  { skip: skipWithoutFts5 },
  () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
    CREATE TABLE ec_pages (
      id TEXT PRIMARY KEY,
      slug TEXT,
      locale TEXT,
      status TEXT,
      title TEXT,
      body TEXT,
      deleted_at TEXT
    );

    CREATE VIRTUAL TABLE _emdash_fts_pages USING fts5(
      id UNINDEXED,
      locale UNINDEXED,
      title,
      body,
      tokenize = 'porter unicode61'
    );

    INSERT INTO ec_pages (id, slug, locale, status, title, body, deleted_at) VALUES
      ('xss', 'xss', 'en', 'published', 'Workers <img src=x onerror=alert(1)> Page', 'body text', NULL);

    INSERT INTO _emdash_fts_pages (id, locale, title, body) VALUES
      ('xss', 'en', 'Workers <img src=x onerror=alert(1)> Page', 'body text');
  `);

    const plan = buildEmDashFts5Plan({
      collection: "pages",
      query: "workers",
      searchableFields: ["title", "body"],
      status: "published",
      limit: 5,
    });

    assert.ok(plan);
    const rows = db
      .prepare(plan.sql)
      .all(...plan.params)
      .map((row) => ({ ...row }));

    const mapped = mapFtsRows("pages", rows);
    const snippet = mapped[0].snippet;

    // The injected tag must be neutralized...
    assert.ok(!/<img/i.test(snippet), `snippet still contains raw <img>: ${snippet}`);
    assert.ok(snippet.includes("&lt;img"), `snippet should escape the tag: ${snippet}`);
    // ...while the intended highlight markers survive.
    assert.ok(snippet.includes("<mark>"), `snippet should keep <mark>: ${snippet}`);
  },
);

test("FTS query escaping documents lexical filter semantics", () => {
  assert.equal(escapeFts5Query("  workers ai  "), '"workers"* "ai"*');
  assert.equal(escapeFts5Query('"workers ai"'), '"workers ai"');
  assert.equal(escapeFts5Query("workers OR d1"), "workers OR d1");
  // Lowercase operator words are ordinary terms: keep prefix-term normalization
  // instead of routing them through the raw-operator branch.
  assert.equal(escapeFts5Query("salt and pepper"), '"salt"* "and"* "pepper"*');
  assert.equal(escapeFts5Query("not done"), '"not"* "done"*');
  assert.equal(escapeFts5Query('workers "ai"'), '"workers"* """ai"""*');
  assert.equal(escapeFts5Query("   "), "");
  // Lone/empty/unbalanced quotes must not produce a malformed MATCH string;
  // they collapse to "" so buildEmDashFts5Plan returns null.
  assert.equal(escapeFts5Query('"'), "");
  assert.equal(escapeFts5Query('""'), "");
  assert.equal(escapeFts5Query('"   "'), "");
  assert.equal(
    buildEmDashFts5Plan({ collection: "pages", query: '"', searchableFields: ["title"] }),
    null,
  );
  assert.equal(
    buildEmDashFts5Plan({
      collection: "pages",
      query: "   ",
      searchableFields: ["title"],
    }),
    null,
  );
});

test("FTS plan defaults missing status to published, matching EmDash search", () => {
  const plan = buildEmDashFts5Plan({
    collection: "pages",
    query: "workers",
    searchableFields: ["title"],
  });

  assert.ok(plan);
  // The status clause is always present and defaults to published.
  assert.match(plan.sql, /AND c\.status = \?/);
  assert.ok(plan.params.includes("published"));

  // An explicit status is honored.
  const draftPlan = buildEmDashFts5Plan({
    collection: "pages",
    query: "workers",
    searchableFields: ["title"],
    status: "draft",
  });
  assert.ok(draftPlan);
  assert.ok(draftPlan.params.includes("draft"));
  assert.ok(!draftPlan.params.includes("published"));
});

test("FTS plan validates identifiers before raw SQL interpolation", () => {
  assert.throws(() =>
    buildEmDashFts5Plan({
      collection: "pages;drop",
      query: "workers",
      searchableFields: ["title"],
    }),
  );
});
