DEVANA-FINDING: v1
Priority: P0 | Confidence: high | Security-sensitive: yes | Status: fixed
Location: src/fts.ts:69-71,116-118 | Slug: fts-weights-sqli

# FTS BM25 weight values are concatenated into SQL without validation

## Finding

`buildEmDashFts5Plan` builds the `bm25()` call by joining weight numbers from `buildBm25Weights` directly into the SQL string. `collection` and `searchableFields` pass `assertIdentifier`, but `weights` values are not validated as finite numbers at runtime. Non-numeric or crafted values become raw SQL fragments.

## Violated Invariant Or Contract

All dynamic portions of generated SQL must be either bound parameters or strictly validated literals. BM25 weight arguments must be numeric literals safe to embed.

## Oracle

`assertIdentifier` guards table and field names. `params` array binds query, status, locale, and limit only; BM25 weights are not parameterized.

## Counterexample

`buildEmDashFts5Plan({ collection: 'pages', query: 'workers', searchableFields: ['title'], weights: { title: '1) OR 1=1 --' as unknown as number } })` at runtime (JavaScript object from JSON/API) produces `bm25("_emdash_fts_pages", 0, 0, 1) OR 1=1 --)` in the SQL text.

## Why It Might Matter

Integrators loading BM25 weights from CMS settings or environment without numeric validation can open SQL injection in D1-backed lexical queries.

## Proof

**Dataflow trace:** `input.weights[field]` → `buildBm25Weights` → `weights.join(", ")` embedded in `sql` string.

**Counterexample value:** Non-numeric weight string injected via configuration payload.

## Counterevidence Checked

TypeScript types declare `Record<string, number>` but runtime JSON parsing bypasses types. Tests always pass numeric literals. Route handlers do not call `buildEmDashFts5Plan`; export path is integrator-facing per README.

## Suggested Next Step

Validate each weight with `Number.isFinite` and reject invalid values, or bind weights via parameters if the SQL dialect allows.

## Agent Handoff

After working this report, preserve the original finding body. Update line 2 `Status: ...` and the final `DEVANA-SUMMARY:` status. Use one of: `open`, `fixed`, `invalid`, `stale`, `duplicate`, `wontfix`. Add dated notes below with the evidence checked.

## Status Notes

- 2026-06-25: open by Devana. Initial report written from static source inspection.
- 2026-06-27: fixed. Confirmed BM25 weights from `input.weights` were `join(", ")`-ed straight into the `bm25(...)` SQL with only a `?? 1` nullish guard — a non-numeric runtime value (e.g. `'1) OR 1=1 --'` from parsed JSON) became raw SQL. `buildBm25Weights` now rejects any weight that is not a finite number, throwing `Invalid BM25 weight for field <field>`. Full test suite (24) passes.

DEVANA-KEY: src/fts.ts:69-71,116-118 | P0 | fts-weights-sqli
DEVANA-SUMMARY: Status=fixed | P0 high src/fts.ts:69-71,116-118 - BM25 weights were embedded in FTS SQL without numeric validation; buildBm25Weights now rejects non-finite weights before they reach the SQL string.