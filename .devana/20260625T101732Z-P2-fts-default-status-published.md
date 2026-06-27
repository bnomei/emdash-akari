DEVANA-FINDING: v1
Priority: P2 | Confidence: high | Security-sensitive: no | Status: fixed
Location: src/fts.ts:67-72,89 | Slug: fts-default-status-published

# buildEmDashFts5Plan defaults missing status to published

## Finding

When `input.status` is omitted, `buildEmDashFts5Plan` sets `const status = input.status ?? "published"` and always binds `AND c.status = ?` with that value. Integrators passing no status filter still query only published rows. `runLexicalSearch` passes `getStringEqualityFilter` which returns `undefined` for non-equality status filters, avoiding an implicit published constraint on the EmDash search API path.

## Violated Invariant Or Contract

Absent status should mean no status constraint, consistent with optional `filter.status` in the query contract and with `runLexicalSearch` behavior when status cannot be extracted as a plain equality.

## Oracle

README Filter Syntax treats `status` as optional metadata. Engine lexical path passes `status: undefined` to search when filter uses `$in` or is absent.

## Counterexample

Integrator calls `buildEmDashFts5Plan({ collection: 'pages', query: 'workers', searchableFields: ['title'] })` without `status`. Generated SQL always includes `AND c.status = ?` with param `"published"`. Draft rows are excluded even though no status filter was requested.

## Why It Might Matter

Draft-aware admin diagnostics using the exported FTS planner silently omit draft content, skewing migration and audit queries in D1-backed workflows.

## Proof

**Contract mismatch:** Engine search path omits status when undefined; FTS plan helper substitutes `"published"`.

**Dataflow trace:** missing `input.status` → default `"published"` → bound in SQL WHERE clause.

## Counterevidence Checked

`test/fts-plan.test.mjs` always passes `status: "published"`, so default is untested. Default may be intentional for public-style queries but contradicts optional filter semantics elsewhere in the package.

## Suggested Next Step

Omit the status clause when `input.status` is undefined, matching `runLexicalSearch` behavior, or document the published-only default explicitly in README.

## Agent Handoff

After working this report, preserve the original finding body. Update line 2 `Status: ...` and the final `DEVANA-SUMMARY:` status. Use one of: `open`, `fixed`, `invalid`, `stale`, `duplicate`, `wontfix`. Add dated notes below with the evidence checked.

## Status Notes

- 2026-06-25: open by Devana. Initial report written from static source inspection.
- 2026-06-27: fixed by documentation (behavior intentionally unchanged). The report's premise — that the engine path applies no published constraint when status is absent — is incorrect: EmDash's own `search()` defaults `status` to `"published"` and binds `AND c.status = ?` (node_modules/emdash/src/search/query.ts:88,184,238), so the engine's lexical leg also resolves an absent status to published. `buildEmDashFts5Plan`'s published default is therefore CONSISTENT with EmDash's canonical FTS behavior; changing it to omit the clause would make the exported helper diverge from EmDash and the engine (showing drafts the engine hides). Resolved per the report's alternative suggestion: documented the published-only default explicitly in a JSDoc on `buildEmDashFts5Plan` and in the README lexical section, noting there is no "all statuses" shortcut by design and that callers pass an explicit status to query another. Added a test locking the default (absent status → `AND c.status = ?` bound to `published`; `status: "draft"` honored). Full suite: 43 pass.
- 2026-06-27: validation review retagged from fixed to invalid. The original counterexample is intentionally still true (`buildEmDashFts5Plan` still defaults missing status to `"published"`), so it does not satisfy Devana's fixed-state rule that the counterexample be blocked. Current source, README, and regression coverage establish that behavior as the intended EmDash-compatible contract rather than a runtime bug.
- 2026-06-27: fixed by code change. `buildEmDashFts5Plan` now omits `AND c.status = ?` unless `input.status` is provided, so the original no-status counterexample no longer excludes draft rows. README now documents the explicit-status behavior, and the regression test asserts absent status produces no published default while `status: "draft"` still binds correctly.

DEVANA-KEY: src/fts.ts:67-72,89 | P2 | fts-default-status-published
DEVANA-SUMMARY: Status=fixed | P2 high src/fts.ts:67-72,89 - buildEmDashFts5Plan now omits the status predicate when input.status is absent, while explicit statuses are still bound, so missing status no longer silently restricts results to published rows.
