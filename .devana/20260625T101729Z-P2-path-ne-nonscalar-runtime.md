DEVANA-FINDING: v1
Priority: P2 | Confidence: high | Security-sensitive: no | Status: fixed
Location: src/paths.ts:138-139; src/structural.ts:210-212 | Slug: path-ne-nonscalar-runtime

# Runtime path ne rejects non-scalar values that structural SQL would match

## Finding

`pathValueMatches` for `ne` returns `isAkariScalar(value) && !sameScalar(value, filter.value)`. Non-scalar values (objects, arrays) return false, excluding the entry from structural content scan. The exported SQL compiler emits `json_extract(...) != ?` without a scalar guard, which matches non-scalar JSON values in SQLite.

## Violated Invariant Or Contract

Runtime `evaluatePathFilters` and exported `compileStructuralFilter` SQL plans should agree on path operator semantics for the same filter and document shape.

## Oracle

`engine.test.mjs` structural SQL test executes compiled wildcard filters against SQLite. Content scan uses `evaluatePathFilters` in `evaluateContentItem`.

## Counterexample

`paths: [{ "path": "$.meta", "op": "ne", "value": "draft" }]` against `data: { meta: { id: 1 } }`. Runtime evaluator returns `matched: false`. Compiled SQL `json_extract(e.data, '$.meta') != 'draft'` matches the row in SQLite.

## Why It Might Matter

Integrators comparing facts-table SQL results with in-engine structural discovery see different inclusion sets for the same path filter, causing migration and audit tooling divergence.

## Proof

**Cross-entry mismatch:** `paths.ts` `ne` requires scalar; `structural.ts` `ne` uses SQL inequality on extracted JSON.

**Counterexample value:** Object at `$.meta` with `ne: "draft"`.

## Counterevidence Checked

Wildcard same-index grouping tests do not cover `ne` on objects. `nin` has the same `isAkariScalar` guard (line 143). Engine discover path uses runtime evaluator, not SQL compiler, for hosted routes.

## Suggested Next Step

Align runtime `ne`/`nin` with SQL semantics for non-scalars, or document intentional divergence and add tests for both paths.

## Agent Handoff

After working this report, preserve the original finding body. Update line 2 `Status: ...` and the final `DEVANA-SUMMARY:` status. Use one of: `open`, `fixed`, `invalid`, `stale`, `duplicate`, `wontfix`. Add dated notes below with the evidence checked.

## Status Notes

- 2026-06-25: open by Devana. Initial report written from static source inspection.
- 2026-06-27: fixed. Aligned the SQL compiler with the runtime evaluator (the intended, scalar-guarded semantics — see also the metadata-ne-nonscalar fix). `compilePathPredicate` now guards `ne` (non-null) and `nin` with `<typeExpr> NOT IN ('object', 'array')` before the `!=`/`NOT IN` comparison, so structured JSON values are excluded exactly as `pathValueMatches` excludes them via `isAkariScalar`. This also correctly excludes a missing path (json_type → NULL → `NULL NOT IN (...)` → row dropped), matching runtime. Added a test that runs the compiled `$.meta ne "draft"` SQL against SQLite (object/scalar/equal rows → only `scalar` survives) and asserts `evaluatePathFilters` returns the same verdicts. Residual minor edge (out of this report's non-scalar scope): a JSON `null` value still differs between runtime `ne` (matches) and SQL (`json_extract` NULL `!=` → not matched); not introduced or worsened by this change. Full suite: 40 pass.

DEVANA-KEY: src/paths.ts:138-139; src/structural.ts:210-212 | P2 | path-ne-nonscalar-runtime
DEVANA-SUMMARY: Status=fixed | P2 high src/paths.ts:138-139; src/structural.ts:210-212 - Structural SQL ne/nin now guard against object/array json types, matching the runtime evaluator's scalar requirement so the two execution paths agree on non-scalar values.