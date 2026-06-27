DEVANA-FINDING: v1
Priority: P2 | Confidence: medium | Security-sensitive: no | Status: fixed
Location: src/structural.ts:224-228; src/paths.ts:144-145,232-235 | Slug: contains-array-substring-divergence

# `contains` on arrays diverges: runtime element-equality vs structural JSON-text substring

## Finding

The `contains` path operator is evaluated two different ways. The in-memory
evaluator used by `discover`/content-scan (`pathValueMatches` -> `containsValue`)
treats an array value as a membership test: it matches only if some array element
is strictly equal to the expected string. The structural SQL compiler
(`compilePathPredicate` case `contains`) emits
`instr(CAST(json_extract(...) AS TEXT), ?) > 0`, i.e. a substring search over the
serialized JSON text of the value. For array values these are unrelated algorithms
and produce different match sets for the same filter.

## Violated Invariant Or Contract

`src/constants.ts:8-14` declares `lexical` and `structural` as `"contract"`, and
the README ("Path Syntax") presents one path query shape regardless of whether it
is evaluated in JS or compiled to D1/SQLite JSON functions. The same `contains`
filter must therefore select the same entries on either backend.

## Oracle

- `test/engine.test.mjs:118-121`: `contains` on `$.blocks[*].url` is asserted to
  be element/substring membership, not a JSON-text scan.
- `src/paths.ts:232-235` `containsValue`: array branch uses
  `value.some(item => sameScalar(item, expected))` (exact element equality).
- Neighboring SQL implementation `src/structural.ts:224-228`.

## Counterexample

Content `{ "tags": ["alpha", "beta"] }`, filter
`{ "path": "$.tags", "op": "contains", "value": "ph" }`:

- Runtime (`discover`): no element equals `"ph"` -> **no match**.
- Structural SQL: `json_extract` of the array serializes to `["alpha","beta"]`;
  `instr('["alpha","beta"]', 'ph') > 0` is true (inside `alpha`) -> **match**.

The structural backend also matches on JSON syntax that can never be an element,
e.g. `value: ","` or `value: "["` matches the array separators/brackets.

## Why It Might Matter

A host that serves the same `contains` path filter from D1 (structural) returns
entries that the bundled JS engine (`discover`) excludes, and vice versa. Results
for "which entries contain X" silently disagree across deployments, undermining the
stated structural/lexical contract and the resolve flow that depends on it.

## Proof

Contract mismatch + counterexample value: identical filter, two backends, divergent
boolean result driven by array-element-equality (`paths.ts:234`) vs
substring-over-serialized-JSON (`structural.ts:226`).

## Counterevidence Checked

- For scalar string values both backends do substring (`paths.ts:233` `includes`
  vs `instr`) and agree, so the defect is array-specific.
- `toSqliteJsonPath`/`json_extract` returns the JSON text (not first element) for
  array values, so `instr` runs over `["..."]` — confirmed, not the element.
- No normalization upstream that coerces arrays before either evaluator.

## Suggested Next Step

Decide the intended `contains` array semantics, then align the SQL: for arrays use
`EXISTS (SELECT 1 FROM json_each(...) WHERE value = ?)` to match runtime element
equality, or change runtime to substring if substring is the intended contract.

## Agent Handoff

After working this report, preserve the original finding body. Update line 2
`Status: ...` and the final `DEVANA-SUMMARY:` status. Use one of: `open`, `fixed`,
`invalid`, `stale`, `duplicate`, `wontfix`. Add dated notes below.

## Status Notes

- 2026-06-25: open by Devana. Initial report from static source inspection.
- 2026-06-27: fixed by aligning the SQL compiler to the runtime contract (runtime element-membership semantics are the tested/documented ones). `compilePathPredicate` `contains` now emits a type-guarded predicate: `(json_type = 'text' AND instr(value, ?) > 0) OR (json_type = 'array' AND EXISTS (SELECT 1 FROM json_each(value) AS _akari_contains WHERE _akari_contains.value = ?))`. This makes text values do a case-sensitive substring (unchanged) and array values do element-equality membership, exactly like `containsValue` (string → includes, array → some element === expected, otherwise no match). Non-scalar/number/object values no longer match the way a raw JSON-text substring would. SQLite short-circuits AND/OR, so `json_each` is only evaluated for real arrays (avoiding "malformed JSON" on text values). Added a SQLite-backed test cross-checking SQL vs `evaluatePathFilters`: array `["alpha","beta"]` with `"ph"` → no match (substring of an element, not an element), `"alpha"` → match, `","` → no match; scalar string `"alphabet"` still matches `"ph"`. Full suite: 46 pass.

DEVANA-KEY: src/structural.ts:224-228; src/paths.ts:144-145,232-235 | P2 | contains-array-substring-divergence
DEVANA-SUMMARY: Status=fixed | P2 medium src/structural.ts:224-228; src/paths.ts:144-145,232-235 - SQL contains now uses instr for text and json_each element membership for arrays, matching the runtime evaluator so both backends agree.
