DEVANA-FINDING: v1
DEVANA-STATE: fixed | P2 | high | security=no
DEVANA-KEY: src/engine.ts:372-392 | metadata-facet-empty-buckets

# Facets on non-identity metadata/data fields always return empty buckets

# Finding

`akariFacetSchema` accepts a facet as a bare `metadataFieldSchema` string or a
`{ field }` object, where `metadataFieldSchema` (`schema.ts:5`) matches any data field
name (e.g. `"category"`, `"author"`). At runtime, faceting on such a field produces no
buckets. `buildFacetValues` (`engine.ts:372-383`) only writes values for the literal keys
`collection`, `status`, `locale`, and `$`-prefixed JSON paths; any other key falls through
the `if/else if` chain and is never added. `buildFacetResults` (`engine.ts:347`) then
falls back to `fallbackFacetValues`, which reads only `item.identity[key]`
(`engine.ts:389-392`). `AkariIdentity` has only `collection/id/slug/locale/status/title/url`,
so a data field like `category` resolves to nothing and the bucket list is empty.

## Violated Invariant Or Contract

A facet over a field whose values live in `item.data` must produce counts for those
values, exactly as `collection`/`status` facets do. The schema admits these facets; the
runtime silently drops them.

## Oracle

Schema/runtime mismatch: `akariFacetSchema` (`schema.ts:93-104`) admits any
`metadataFieldSchema`; the `collection`/`status`/`locale` branches of `buildFacetValues`
show faceting is meant to count field values across the result set.

## Counterexample

`{ "q": "post", "collections": ["articles"], "facets": ["category"] }` with items whose
`data.category` is `"news"`, `"news"`, `"opinion"`. Expected:
`buckets: [{value:"news",count:2},{value:"opinion",count:1}]`. Actual:
`buckets: []`. (`category` matches no branch in `buildFacetValues`; `fallbackFacetValues`
finds no `identity.category`.)

## Why It Might Matter

A documented, schema-valid feature returns silently wrong (empty) results rather than an
error. Faceted-navigation callers see no buckets and conclude the field has no values.

## Proof

Dataflow trace: `category` facet → `buildFacetValues` writes nothing (no matching branch,
372-383) → per-item `facetValues` lacks `category` → `buildFacetResults` `?? fallbackFacetValues`
→ `item.identity["category"]` is `undefined` → `[]` → zero buckets counted.

## Counterevidence Checked

Strongest counter: the content scan might populate `valuesByKey` for all keys, making
`fallbackFacetValues` a true last resort. Checked: `facetsByResult`/`valuesByKey` is
populated only from `scanContent` candidates' `candidate.facetValues` (`engine.ts:66-68`),
which is exactly the output of `buildFacetValues` — so no other producer fills arbitrary
keys, and FTS candidates contribute none. Note identity-named facets (`title`, `slug`, `id`)
*do* work via `fallbackFacetValues`; the gap is specifically non-identity data fields.
Distinct from `facet-path-matchedpaths-fallback` (which concerns `$`-path facets falling
back to matchedPaths).

## Suggested Next Step

Add a default branch in `buildFacetValues` that reads the field from `item.data` (via
`readMetadataField`) and stringifies its scalar value(s), mirroring the `$`-path branch.

## Agent Handoff

After working this report, preserve the original finding body. Update line 2
`DEVANA-STATE: ...` and the final `DEVANA-SUMMARY:` prefix.

## Status Notes

- 2026-06-27: open by Devana. Confirmed by two independent trail passes (invariants, dataflow).
- 2026-06-27: fixed per the suggested next step. Added an `else` branch in `buildFacetValues` that, for any facet key not handled by the `collection`/`status`/`locale`/`$`-path branches, reads the field from the entry metadata via `readMetadataField(buildContentMetadata(collection, item), key)` and stringifies it through a new `toFacetValueStrings` helper (handles scalar and array-of-scalar values, reusing `stringifyFacetValue`). This also supports dotted keys like `seo.title`. Now `facets: ["category"]` produces value counts from `item.data.category`. Added a regression test with a custom `articles` content provider (category news/news/opinion → buckets `news:2, opinion:1`). Full suite: 51 pass.

DEVANA-KEY: src/engine.ts:372-392 | metadata-facet-empty-buckets
DEVANA-SUMMARY: fixed | P2 | high | buildFacetValues now reads non-identity facet keys from entry metadata (item.data + standard fields) via readMetadataField, so facets on data fields like category produce correct buckets instead of empty.
