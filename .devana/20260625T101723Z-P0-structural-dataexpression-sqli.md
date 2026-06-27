DEVANA-FINDING: v1
Priority: P0 | Confidence: high | Security-sensitive: yes | Status: fixed
Location: src/structural.ts:42,112-113,179 | Slug: structural-dataexpression-sqli

# Structural SQL compiler interpolates dataExpression without validation

## Finding

`compileStructuralFilters` and `compileStructuralFilter` splice `options.dataExpression` directly into generated SQL for `json_extract`, `json_type`, and `json_each` calls. `joinPrefix` is validated with `assertSqlIdentifier`, but `dataExpression` has no identifier or allowlist check. The helpers are exported for integrators building D1 queries.

## Violated Invariant Or Contract

SQL plan generators must not embed untrusted fragments into query text. Only validated SQL identifiers or bound parameters should appear in generated SQL.

## Oracle

`assertSqlIdentifier` guards `joinPrefix` (line 270). Path values use `?` placeholders. Package exports `compileStructuralFilters` from `index.ts` for host-app SQL execution.

## Counterexample

`compileStructuralFilter({ path: '$.title', op: 'eq', value: 'x' }, { dataExpression: "e.data); DELETE FROM ec_pages; --" })` produces SQL containing the injected fragment inside `json_extract(e.data); DELETE FROM ec_pages; --, ?)`.

## Why It Might Matter

Host apps that forward CMS config, query parameters, or user input into `dataExpression` can expose D1/SQLite databases to arbitrary SQL execution in the integrator's database context.

## Proof

**Dataflow trace:** caller-supplied `dataExpression` → template string in `compileDirectFilter` / `compileWildcardFilterGroup` → returned `sql` executed by integrator.

**Counterexample value:** `dataExpression` containing statement-terminating SQL.

## Counterevidence Checked

Default `dataExpression` is `"e.data"`, safe for typical use. HTTP discover/resolve routes evaluate paths in memory and do not call this compiler. Risk is on the exported SQL integration path, which README documents for D1-backed apps.

## Suggested Next Step

Validate `dataExpression` against the same identifier pattern used for `joinPrefix`, or require a fixed allowlist of column references instead of free-form interpolation.

## Agent Handoff

After working this report, preserve the original finding body. Update line 2 `Status: ...` and the final `DEVANA-SUMMARY:` status. Use one of: `open`, `fixed`, `invalid`, `stale`, `duplicate`, `wontfix`. Add dated notes below with the evidence checked.

## Status Notes

- 2026-06-25: open by Devana. Initial report written from static source inspection.
- 2026-06-27: fixed. Confirmed `dataExpression` was interpolated into `json_extract`/`json_type`/`json_each` SQL with no validation, while `joinPrefix` was guarded by `assertSqlIdentifier`. Added `assertColumnReference` (allows an optional `prefix.column` qualifier, matching the default `e.data`) and call it at both exported entry points (`compileStructuralFilters`, `compileStructuralFilter`) before any interpolation. The injection counterexample `"e.data); DELETE FROM ec_pages; --"` now throws `Invalid data expression`. Full test suite (24) passes.

DEVANA-KEY: src/structural.ts:42,112-113,179 | P0 | structural-dataexpression-sqli
DEVANA-SUMMARY: Status=fixed | P0 high src/structural.ts:42,112-113,179 - Exported structural SQL compiler spliced unvalidated dataExpression into query text; now validated via assertColumnReference at both entry points before interpolation.