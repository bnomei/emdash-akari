DEVANA-FINDING: v1
Priority: P2 | Confidence: medium | Security-sensitive: no | Status: fixed
Location: src/paths.ts:148-155,242-246; src/structural.ts:234-237 | Slug: path-gt-mixed-type-divergence

# Path gt compares mixed string and number types differently in JS vs SQL

## Finding

Runtime path range checks use `compare`, which returns `NaN` when a JSON string value is compared to a numeric filter (or vice versa), causing `gt`/`gte`/`lt`/`lte` to fail. The exported structural SQL compiler emits numeric comparisons on `json_extract` results, where SQLite affinity can coerce string numerics and match.

## Violated Invariant Or Contract

The same validated path filter should produce consistent match semantics between content-scan discovery and structural SQL plans.

## Oracle

README documents `gt`, `gte`, `lt`, `lte` for path operators (`README.md:349-353`). Runtime `compare` only handles homogenous number-number or string-string pairs (`paths.ts:242-246`). Structural `compilePathPredicate` emits `${valueExpression.sql} > ?` without type guards (`structural.ts:234-237`). Existing `path-range-string-collation-divergence` covers string-vs-string ordering, not mixed JSON types.

## Counterexample

`paths: [{ "path": "$.price", "op": "gt", "value": 50 }]` against data `{ "price": "99" }`. `pathValueMatches` calls `compare("99", 50)` → `NaN` → `gt` false in `evaluateContentItem`. Structural SQL `json_extract(e.data, '$.price') > 50` can match in SQLite.

## Why It Might Matter

Hosts using structural SQL for indexed queries and content scan for fallback can return different entry sets for the same agent query, undermining identity resolution consistency.

## Proof

**Contract mismatch:** runtime `compare` mixed-type → false; SQL numeric comparison with coerced JSON text → true.

**Counterexample value:** `price: "99"` with filter `gt: 50`.

## Counterevidence Checked

Homogeneous numeric JSON values behave consistently. Schema allows both strings and numbers in comparable scalars. Path `ne` non-scalar divergence is a separate reported issue.

## Suggested Next Step

Align runtime comparisons with SQLite coercion rules or reject mixed-type range filters when the stored JSON type does not match the filter type.

## Agent Handoff

After working this report, preserve the original finding body. Update line 2 `Status: ...` and the final `DEVANA-SUMMARY:` status. Use one of: `open`, `fixed`, `invalid`, `stale`, `duplicate`, `wontfix`. Add dated notes below with the evidence checked.

## Status Notes

- 2026-06-27: open by Devana. Initial report written from static source inspection during exhaustive `--all` hunt.
- 2026-06-27: fixed by aligning the SQL compiler to the runtime's strict same-type semantics (runtime `compare` returns NaN → no match for mixed types; that's the safer, more predictable contract). Extracted the four range cases (`gt`/`gte`/`lt`/`lte`) into `compileRangePredicate`, which prefixes the comparison with a `json_type` guard derived from the filter value's JS type: numeric filter → `json_type IN ('integer','real')`, string filter → `json_type = 'text'`. This stops SQLite's storage-class ordering (TEXT ranks above any numeric literal) from matching a string like `"99"` against `gt 50`, so SQL now returns false for mixed types exactly as the runtime does; same-type comparisons are unchanged (numeric→numeric, and string→string under BINARY per the related collation fix). Added a SQLite test cross-checking compiled `$.price gt 50` against `evaluatePathFilters`: only the numeric `price: 99` row matches, `price: "99"` does not, on both backends. Full suite: 57 pass; typecheck clean.

DEVANA-KEY: src/paths.ts:148-155,242-246; src/structural.ts:234-237 | P2 | path-gt-mixed-type-divergence
DEVANA-SUMMARY: Status=fixed | P2 medium src/paths.ts:148-155,242-246; src/structural.ts:234-237 - Structural range SQL now guards by json_type matching the filter value's type, so mixed string/number range comparisons no longer match in SQL (matching the runtime's NaN/no-match behavior).