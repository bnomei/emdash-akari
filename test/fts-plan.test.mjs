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

test("FTS plan uses EmDash table conventions and runs against local SQLite", () => {
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
