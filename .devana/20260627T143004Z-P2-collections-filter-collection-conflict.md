DEVANA-FINDING: v1
Priority: P2 | Confidence: high | Security-sensitive: no | Status: fixed
Location: src/engine.ts:265,394-399 | Slug: collections-filter-collection-conflict

# Conflicting collections and filter.collection yield silent empty results

## Finding

`resolveCollections` prefers top-level `collections` for scan scope, but `matchesMetadataFilters` still applies `filter.collection` on each row. When the two disagree, the engine scans the top-level collection and post-filters every hit out with no warning.

## Violated Invariant Or Contract

When both selectors are present, results should either honor a documented precedence rule or reject the conflicting input. Silent empty results violate caller expectations.

## Oracle

README says top-level `collections` is the normal selector and `filter.collection` is a fallback when `collections` is omitted (`README.md:262-264`). `resolveCollections` implements `input.collections ?? fromFilter ?? defaults` (`engine.ts:394-399`). `evaluateContentItem` calls `matchesMetadataFilters(metadata, input.filter)` where `metadata.collection` is the scanned collection name (`engine.ts:252-265).

## Counterexample

`{ "collections": ["pages"], "filter": { "collection": "products", "status": "published" } }` scans `pages`, sets `metadata.collection` to `"pages"`, and rejects every row because `filter.collection` expects `"products"`. Response is `{ items: [] }` without explaining the conflict.

## Why It Might Matter

Agents mixing collection scope styles can conclude content is missing when the true entries live in the scanned collection but fail the contradictory metadata filter.

## Proof

**Cross-entry mismatch:** `resolveCollections` chooses `["pages"]`; `matchesMetadataFilters` enforces `collection: "products"` on each `pages` row.

**Counterexample value:** `collections: ["pages"]` plus `filter.collection: "products"`.

## Counterevidence Checked

Using only one selector behaves correctly. `getStringSetFilter` fallback for `filter.collection` works when `collections` is omitted. No schema rule forbids both fields together.

## Suggested Next Step

Reject conflicting selectors at validation time, ignore `filter.collection` when top-level `collections` is set, or emit an explicit warning when both are present and disagree.

## Agent Handoff

After working this report, preserve the original finding body. Update line 2 `Status: ...` and the final `DEVANA-SUMMARY:` status. Use one of: `open`, `fixed`, `invalid`, `stale`, `duplicate`, `wontfix`. Add dated notes below with the evidence checked.

## Status Notes

- 2026-06-27: open by Devana. Initial report written from static source inspection during exhaustive `--all` hunt.
- 2026-06-27: fixed per README precedence (top-level `collections` is the authoritative selector; `filter.collection` is only a fallback when `collections` is omitted). Added `stripRedundantCollectionFilter`: when `input.collections` is set and `input.filter.collection` is present, `runAkariQuery` drops `collection` from the filter used downstream (lexical + content scan metadata matching) and pushes a warning ("filter.collection was ignored because top-level collections was provided; collections is the authoritative scope."). The cleaned `queryInput` is threaded into `runLexicalSearch`/`scanContent`; `resolveCollections` is unaffected (it already prefers `input.collections`). This turns the previously silent empty result into the documented behavior (collections wins) plus an explicit warning. Added a regression test: `collections: ["pages"]` + `filter: { collection: "products", status: "published" }` now returns the published page(s) (all `collection === "pages"`) with the ignored-filter warning, instead of `items: []`. Full suite: 54 pass.

DEVANA-KEY: src/engine.ts:265,394-399 | P2 | collections-filter-collection-conflict
DEVANA-SUMMARY: Status=fixed | P2 high src/engine.ts:265,394-399 - When top-level collections is set, filter.collection is now dropped from post-filtering (with a warning) so a conflicting selector no longer silently empties results; collections is authoritative per README.