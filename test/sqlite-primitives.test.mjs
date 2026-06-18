import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { sqliteSupportsFts5 } from "./sqlite-support.mjs";

const hasFts5 = sqliteSupportsFts5();
const skipWithoutFts5 = hasFts5 ? false : "SQLite FTS5 extension is unavailable in this Node build";

test(
  "SQLite FTS5 supports weighted lexical ranking, snippets, prefix search, and vocabulary",
  { skip: skipWithoutFts5 },
  () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
    CREATE VIRTUAL TABLE docs USING fts5(
      id UNINDEXED,
      title,
      body,
      tokenize = 'porter unicode61'
    );

    INSERT INTO docs (id, title, body) VALUES
      ('title-hit', 'Workers AI', 'A general article about inference signals.'),
      ('body-hit', 'General platform update', 'Workers AI signals repeated workers.'),
      ('other', 'Static assets', 'No inference terms here.');

    CREATE VIRTUAL TABLE docs_vocab USING fts5vocab(docs, 'row');
  `);

    const rows = db
      .prepare(`
      SELECT
        id,
        bm25(docs, 1.0, 8.0, 1.0) AS rank,
        snippet(docs, 1, '<mark>', '</mark>', '...', 8) AS snippet
      FROM docs
      WHERE docs MATCH ?
      ORDER BY rank
      LIMIT 5
    `)
      .all("workers*")
      .map((row) => ({ ...row }));

    assert.equal(rows.length, 2);
    assert.equal(rows[0].id, "title-hit");
    assert.match(rows[0].snippet, /<mark>Workers<\/mark>/);

    const terms = db
      .prepare("SELECT term, doc, cnt FROM docs_vocab WHERE term = ?")
      .all("worker")
      .map((row) => ({ ...row }));

    assert.deepEqual(terms, [{ term: "worker", doc: 2, cnt: 3 }]);
  },
);

test("SQLite JSON1 can inspect nested block data without a Cloudflare D1 binding", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE entries (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
  `);

  const insert = db.prepare("INSERT INTO entries (id, data) VALUES (?, ?)");
  insert.run(
    "home",
    JSON.stringify({
      blocks: [
        { type: "hero", text: "Launch" },
        { type: "embed", url: "https://www.youtube.com/watch?v=demo" },
      ],
    }),
  );
  insert.run("about", JSON.stringify({ blocks: [{ type: "text", text: "About" }] }));

  const embeds = db
    .prepare(`
      SELECT e.id, json_extract(block.value, '$.url') AS url
      FROM entries AS e, json_each(e.data, '$.blocks') AS block
      WHERE json_extract(block.value, '$.type') = 'embed'
    `)
    .all()
    .map((row) => ({ ...row }));

  assert.deepEqual(embeds, [{ id: "home", url: "https://www.youtube.com/watch?v=demo" }]);

  const firstBlockType = db
    .prepare("SELECT json_extract(data, '$.blocks[0].type') AS type FROM entries WHERE id = ?")
    .get("home");

  assert.deepEqual({ ...firstBlockType }, { type: "hero" });
});
