DEVANA-FINDING: v1
Priority: P1 | Confidence: high | Security-sensitive: no | Status: fixed
Location: src/fts.ts:86-91 | Slug: fts-locale-join

# FTS SQL plan joins content and FTS rows on id only, ignoring locale

## Finding

`buildEmDashFts5Plan` joins `"${ftsTable}"` to `"${contentTable}"` with `ON f.id = c.id`. Optional `c.locale = ?` filters content rows but does not bind `f.locale`. When the same entry id exists in multiple locales (as in `test/fts-plan.test.mjs` fixtures), FTS rows can pair with content rows from a different locale, producing wrong title, slug, snippet, and BM25 score.

## Violated Invariant Or Contract

Per-locale FTS rows (`id` + `locale` UNINDEXED in EmDash FTS tables) must resolve identity and snippets from the matching locale's content row.

## Oracle

`test/fts-plan.test.mjs` inserts FTS rows with distinct locales for the same logical entries (`home`, `fr`). EmDash FTS convention stores `locale` UNINDEXED on FTS rows.

## Counterexample

Database with `ec_pages` rows `(id='page1', locale='en', title='English')` and `(id='page1', locale='de', title='Deutsch')`, and matching `_emdash_fts_pages` rows per locale. Query `buildEmDashFts5Plan({ collection: 'pages', query: 'workers', searchableFields: ['title'], locale: 'de' })` joins any `f.id = c.id` pair; SQLite may return English title with German FTS snippet.

## Why It Might Matter

Multilingual EmDash apps can return the wrong locale identity from exported FTS SQL helpers, causing agents to edit the wrong localized entry.

## Proof

**Dataflow trace:** FTS row locale → join on `f.id = c.id` only → `c.title`/`c.slug`/`snippet()` may come from mismatched locale.

**Contract mismatch:** `locale` parameter constrains `c.locale` but not the FTS side of the join.

## Counterevidence Checked

Single-locale fixtures in tests hide cross-locale pairing. `mapFtsRows` maps whatever columns the query returns; it does not correct locale skew. Engine `runLexicalSearch` uses EmDash search API, not `buildEmDashFts5Plan` directly, but exported helper is intended for D1-backed integrators per README.

## Suggested Next Step

Add `AND f.locale = c.locale` (or equivalent composite join) when locale is indexed on FTS rows, and bind locale on both sides of the join.

## Agent Handoff

After working this report, preserve the original finding body. Update line 2 `Status: ...` and the final `DEVANA-SUMMARY:` status. Use one of: `open`, `fixed`, `invalid`, `stale`, `duplicate`, `wontfix`. Add dated notes below with the evidence checked.

## Status Notes

- 2026-06-25: open by Devana. Initial report written from static source inspection.
- 2026-06-27: fixed (defense-in-depth). Added `AND f.locale IS c.locale` to the content/FTS join, using SQLite's null-safe `IS` so NULL locales still pair. Severity nuance: the report's counterexample assumes `ec_pages` holds two rows with the same `id` in different locales, but the canonical EmDash content table makes `id` a PRIMARY KEY (node_modules/emdash/src/schema/registry.ts:695) with a separate unique `(slug, locale)` constraint — so a given `id` resolves to exactly one locale and the join-on-id cannot mix locales in a real EmDash DB. The locale-filtered query path was additionally already guarded by the existing `c.locale = ?` clause. The new predicate is therefore zero-cost hardening for the exported generic helper: it prevents a stale/drifted FTS row (id matches, locale differs) from pairing across locales even without a query-locale filter. Added a regression test in fts-plan.test.mjs (content id=page1 locale en, FTS id=page1 locale de, no query locale → 0 rows). Full suite: 30 pass.

DEVANA-KEY: src/fts.ts:86-91 | P1 | fts-locale-join
DEVANA-SUMMARY: Status=fixed | P1 high src/fts.ts:86-91 - Join now constrains locale on both sides via null-safe `f.locale IS c.locale`; note that EmDash's PRIMARY KEY on ec_*.id already prevents the described same-id cross-locale mixing, so this is defense-in-depth for the exported helper.