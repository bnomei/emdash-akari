DEVANA-FINDING: v1
Priority: P1 | Confidence: high | Security-sensitive: no | Status: fixed
Location: src/engine.ts:402-415 | Slug: lexical-postfilter-metadata

# Lexical post-filter builds metadata from the query filter, not the FTS hit

## Finding

`searchResultMetadata` copies `status` from `getStringEqualityFilter(filter, "status")` instead of reading each search hit's real status. The lexical post-filter then calls `matchesMetadataFilters` against this fabricated metadata, so equality status filters become tautological and non-equality or range filters on `status` never see the hit's actual value. The same helper omits fields such as `updatedAt` and nested `data` that the content-scan path includes, so lexical hits are incorrectly dropped for filters the content leg would honor.

## Violated Invariant Or Contract

Post-FTS `matchesMetadataFilters` must evaluate each hit's real metadata with the same semantics as the content-scan path (`evaluateContentItem` builds metadata from `item.status`, `item.updatedAt`, `item.data`, etc.).

## Oracle

README Filter Syntax documents `$eq`, `$ne`, `$in`, `$nin`, and range operators on metadata fields including `status` and `updatedAt`. `engine.test.mjs` content-scan path uses real `item.status`; lexical path uses `searchResultMetadata`.

## Counterexample

`discover` with `{ "q": "workers", "mode": "lexical", "collections": ["pages"], "filter": { "status": "published" } }` and a `lexicalSearch` provider that returns `{ collection: "pages", id: "draft-1", title: "Workers Draft", score: 9 }` (draft row, provider ignores `SearchOptions.status`). `searchResultMetadata` sets `status: "published"` from the filter; post-filter keeps the draft.

For `{ "filter": { "status": { "$in": ["published", "draft"] } } }`, metadata `status` is `undefined`; `$in` never matches and all lexical hits are dropped.

For `{ "filter": { "updatedAt": { "$gte": "2026-02-01" } } }`, metadata has no `updatedAt`; range compare fails and valid FTS hits are excluded.

## Why It Might Matter

Draft or wrong-status content can appear in discover/resolve results when FTS indexing is stale or the provider does not enforce status. Non-equality and date filters silently return empty lexical results or leak unintended rows, breaking agent identity resolution workflows that rely on `filter.status` and `filter.updatedAt`.

## Proof

**Dataflow trace:** `runLexicalSearch` → `searchResultMetadata(item, filter)` → `matchesMetadataFilters(metadata, filter)` → mapped results. Line 412 assigns filter-derived `status`; lines 406-414 omit `updatedAt`/`publishedAt`/nested fields present at lines 252-263 on the content path.

**Contract mismatch:** Content scan metadata includes `item.status`; lexical metadata substitutes the filter constraint for `status`.

## Counterevidence Checked

`runLexicalSearch` passes `status`/`locale` equalities into `searchProvider` (lines 157-158), which can mask the bug when EmDash search strictly enforces options. Engine fusion test uses stub hits without draft status and does not assert FTS-only post-filtering. Provider enforcement does not fix `$ne`/`$in`/range operators or missing `updatedAt`.

## Suggested Next Step

Build lexical post-filter metadata from the search hit (including `status` when present) and align field coverage with `evaluateContentItem`, or fetch full entry metadata before filtering.

## Agent Handoff

After working this report, preserve the original finding body. Update line 2 `Status: ...` and the final `DEVANA-SUMMARY:` status. Use one of: `open`, `fixed`, `invalid`, `stale`, `duplicate`, `wontfix`. Add dated notes below with the evidence checked.

## Status Notes

- 2026-06-25: open by Devana. Initial report written from static source inspection.
- 2026-06-27: fixed. Confirmed `searchResultMetadata` fabricated `status` from `getStringEqualityFilter(filter, "status")` and omitted `updatedAt`/`publishedAt`/nested `data`, so equality status filters were tautological (leaking provider-returned drafts) and `$in`/`$ne`/range/`updatedAt` filters dropped all lexical hits. Replaced it: `runLexicalSearch` now receives `options.content` and resolves each FTS hit to its real entry via `content.get`, building metadata through a new shared `buildContentMetadata` helper (also used by `evaluateContentItem`, so both legs use identical semantics). When content access is unavailable, it falls back to hit-only metadata with no fabricated status (so unverifiable status filters fail closed rather than leaking). Added two regression tests in engine.test.mjs that isolate the lexical leg: a leaked draft is dropped under `status: "published"`, and a draft is kept under `status: { $in: ["published","draft"] }`. Full suite: 26 pass.

DEVANA-KEY: src/engine.ts:402-415 | P1 | lexical-postfilter-metadata
DEVANA-SUMMARY: Status=fixed | P1 high src/engine.ts:402-415 - Lexical FTS post-filter now resolves each hit's real entry via content.get (shared buildContentMetadata), so status/updatedAt/nested filters use the same semantics as the content scan; no more fabricated status.