DEVANA-FINDING: v1
Priority: P2 | Confidence: medium | Security-sensitive: no | Status: fixed
Location: src/paths.ts:242-246; src/structural.ts:234-253 | Slug: path-range-string-collation-divergence

# Path range operators on strings diverge: runtime `localeCompare` vs SQLite `BINARY` collation

## Finding

The path range operators (`gt`, `gte`, `lt`, `lte`) on string values use two
different orderings. The in-memory evaluator (`src/paths.ts:242-246` `compare`)
ranks strings with `String.prototype.localeCompare`, which is Unicode/locale-aware
and case-insensitive at the primary level. The structural SQL compiler
(`src/structural.ts:234-253`) emits bare `<`/`>` comparisons that, under SQLite's
default `BINARY` collation, compare strings byte-by-byte (ASCII codepoint order,
uppercase < lowercase). The two orderings disagree whenever comparands cross letter
case (or involve accents), producing different match sets for the same filter.

## Violated Invariant Or Contract

`src/constants.ts:8-14` marks `structural` as `"contract"`. The README "Path
Syntax" lists `lt/lte/gt/gte` as one operator set across JS and SQLite/D1
evaluation, so a range filter must select the same entries on either backend.

## Oracle

- `src/paths.ts:244-245`: `value.localeCompare(expected)` for string range compare.
- SQLite default text collation is `BINARY` (memcmp) for `<`/`>` — neighboring SQL
  in `src/structural.ts:234-253` applies no `COLLATE`.

## Counterexample

Content `{ "name": "a" }`, filter `{ "path": "$.name", "op": "gt", "value": "Z" }`:

- Runtime: `compare("a", "Z") = "a".localeCompare("Z")` is negative (collation orders
  `a` before `Z`), so `gt` is false -> **no match**.
- Structural SQL: `'a' > 'Z'` compares bytes `0x61 > 0x5A` -> true -> **match**.

## Why It Might Matter

Range filters over textual fields (titles, slugs, ISO-ish codes, names) return
different entries depending on whether a host evaluates them in JS (`discover`) or
compiles them to D1/SQLite. Pagination/threshold semantics ("everything after Z")
silently differ across deployments, violating the structural/lexical contract.

## Proof

Contract mismatch + counterexample value: locale-aware ordering (`paths.ts:245`)
versus byte-wise `BINARY` ordering (`structural.ts:234-253`) yield opposite results
for `"a"` vs `"Z"`.

## Counterevidence Checked

- For same-case ASCII comparands (`"banana"` vs `"apple"`) both orderings agree, so
  the defect requires case-crossing or non-ASCII characters — reachable with
  ordinary mixed-case content.
- No `COLLATE` clause is attached in the emitted SQL, confirming default `BINARY`.
- Numeric range compare is unaffected (numbers compare numerically on both sides).

## Suggested Next Step

Pick one ordering as the contract. If SQLite is canonical, sort/compare runtime
strings with a matching byte/codepoint order; if locale order is intended, attach an
explicit `COLLATE` (e.g. `NOCASE` or an ICU collation) in the structural SQL.

## Agent Handoff

After working this report, preserve the original finding body. Update line 2
`Status: ...` and the final `DEVANA-SUMMARY:` status. Use one of: `open`, `fixed`,
`invalid`, `stale`, `duplicate`, `wontfix`. Add dated notes below.

## Status Notes

- 2026-06-25: open by Devana. Initial report from static source inspection.
- 2026-06-27: fixed by choosing codepoint/BINARY ordering as the contract and aligning the runtime to it (SQLite's default BINARY collation cannot easily be made locale-aware without ICU, whereas the runtime trivially can switch). The path-layer `compare` (paths.ts) now compares strings with `value < expected ? -1 : value > expected ? 1 : 0` instead of `localeCompare`, matching SQLite's `<`/`>` under BINARY. For the counterexample `$.name gt "Z"` with value `"a"`, both backends now agree (`a` = 0x61 > `Z` = 0x5A → match). Scope: only the path-range `compare` was changed (the metadata-filter `compare` in filter.ts has no SQL counterpart, so it is left as-is). Added a SQLite test cross-checking compiled `gt` SQL against `evaluatePathFilters` for the case-crossing case, and documented the codepoint/BINARY range ordering (plus the ne/contains/match semantics) in the README Path Syntax section. Full suite: 48 pass.

DEVANA-KEY: src/paths.ts:242-246; src/structural.ts:234-253 | P2 | path-range-string-collation-divergence
DEVANA-SUMMARY: Status=fixed | P2 medium src/paths.ts:242-246; src/structural.ts:234-253 - Runtime path-range string compare now uses codepoint ordering to match SQLite BINARY collation, so gt/lt/gte/lte agree across the discover and structural backends; documented as the contract.
