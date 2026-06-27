DEVANA-FINDING: v1
Priority: P2 | Confidence: high | Security-sensitive: no | Status: fixed
Location: src/engine.ts:378-383,332-360 | Slug: facet-path-matchedpaths-fallback

# Path facets fall back to filter matchedPaths instead of facet values

## Finding

When building path-shaped facet buckets, `buildFacetValues` substitutes `matchedPaths` from path filters if reading the facet path yields no stringifiable values. `matchedPaths` contain concrete evidence paths such as `$.blocks[1].type`, not the facet value domain callers expect in buckets.

## Violated Invariant Or Contract

Facet buckets for a `$…` path should aggregate values read at that facet path (for example `embed`, `hero`). They should not reuse path-filter evidence paths from unrelated filter clauses.

## Oracle

README facet example buckets use values like `embed` (`README.md:206`). `buildFacetValues` reads `readAkariJsonPathValues(item.data, key)` for `$…` facets (`engine.ts:378-381`). Fallback at line 382 assigns `matchedPaths` from `evaluatePathFilters(input.paths)` when the facet read is empty.

## Counterexample

`facets: ["$.blocks[*].url"]` with `paths: [{ path: "$.blocks[*].type", op: "eq", value: "embed" }]` on content where block types match but URLs are non-string JSON values or absent at the facet path. Facet buckets can show `$.blocks[1].type` instead of URL values.

## Why It Might Matter

Downstream agents grouping or counting by facet keys receive path strings that look like JSON pointers, breaking aggregation and misleading migration impact analysis.

## Proof

**Dataflow trace:** `evaluatePathFilters(input.paths)` → `matchedPaths` → `buildFacetValues` facet read returns `[]` → `out[key] = matchedPaths` → `buildFacetResults` counts path strings as bucket values.

**Counterexample value:** facet path `$.blocks[*].url` with empty stringifiable reads and non-empty filter `matchedPaths`.

## Counterevidence Checked

Content structural test populates path facets from full `readAkariJsonPathValues` reads when values exist (`test/engine.test.mjs:304-312`). Identity facets (`collection`, `status`) do not use this fallback.

## Suggested Next Step

Remove the `matchedPaths` fallback for facet bucket materialization, or restrict it to when the facet path equals a filter path and document the evidence-path semantics.

## Agent Handoff

After working this report, preserve the original finding body. Update line 2 `Status: ...` and the final `DEVANA-SUMMARY:` status. Use one of: `open`, `fixed`, `invalid`, `stale`, `duplicate`, `wontfix`. Add dated notes below with the evidence checked.

## Status Notes

- 2026-06-27: open by Devana. Initial report written from static source inspection during exhaustive `--all` hunt.
- 2026-06-27: fixed per the suggested next step. Removed the `matchedPaths` fallback in the `$…` facet branch of `buildFacetValues` (`if (out[key].length === 0 && matchedPaths.length > 0) out[key] = matchedPaths;`), which substituted path-filter evidence pointers (e.g. `$.blocks[0].type`) as facet bucket values when the facet read yielded no stringifiable values. Now an empty facet read simply contributes nothing to that facet. The `matchedPaths` parameter became unused, so it was dropped from `buildFacetValues` and its call site. Added a regression test: an entry matching a `$.blocks[*].type eq embed` path filter (non-empty matchedPaths) but with no url, faceted on `$.blocks[*].url`, now yields empty buckets instead of echoing the evidence pointer. The existing structural facet test (real values present) is unaffected. Full suite: 55 pass.

DEVANA-KEY: src/engine.ts:378-383,332-360 | P2 | facet-path-matchedpaths-fallback
DEVANA-SUMMARY: Status=fixed | P2 high src/engine.ts:378-383,332-360 - Removed the matchedPaths fallback for $-path facets so empty reads contribute no bucket instead of emitting JSON-pointer evidence strings as facet values.