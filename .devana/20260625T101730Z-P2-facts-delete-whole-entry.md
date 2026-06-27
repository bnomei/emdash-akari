DEVANA-FINDING: v1
Priority: P2 | Confidence: high | Security-sensitive: no | Status: fixed
Location: src/facts.ts:100-144 | Slug: facts-delete-whole-entry

# Facts replacement deletes all templates for an entry, not just supplied paths

## Finding

`buildReplaceFactsStatements` always emits a DELETE scoped to `(collection, entry_id, locale)` without a `path_template` predicate, then INSERTs only the facts passed in the current call. Re-indexing a subset of `pathTemplates` removes facts for other templates on the same entry.

## Violated Invariant Or Contract

Replacing facts for selected path templates should update only those templates' rows in `_emdash_content_facts`, leaving unrelated templates intact for the same entry.

## Oracle

README describes facts helpers for materializing configured structural paths into `_emdash_content_facts`. Table PRIMARY KEY includes `path_template` and `full_path`, implying per-template rows.

## Counterexample

Entry `home` has facts for `$.blocks[*].type` and `$.blocks[*].url`. Caller runs `extractContentFacts({ pathTemplates: ["$.blocks[*].type"], ... })` then `buildReplaceFactsStatements(facts)`. DELETE removes all facts for `home`; INSERT restores only type facts. URL facts are lost.

## Why It Might Matter

Incremental fact indexing after partial schema changes corrupts the sidecar index, causing structural SQL queries to miss paths that were not part of the current extraction batch.

## Proof

**Dataflow trace:** `facts[0]` scope → DELETE without `path_template` → INSERT only current `facts` array entries.

**Control-flow trace:** Partial `pathTemplates` input still triggers full-entry DELETE (lines 109-110).

## Counterevidence Checked

`engine.test.mjs` facts test uses a single template, exercising full replace only. Empty-facts-with-target test shows explicit `target` pattern for delete-only; non-empty facts path has no template scoping.

## Suggested Next Step

Scope DELETE to `path_template IN (...)` derived from the facts batch, or require callers to merge all templates before replace and document the whole-entry contract explicitly.

## Agent Handoff

After working this report, preserve the original finding body. Update line 2 `Status: ...` and the final `DEVANA-SUMMARY:` status. Use one of: `open`, `fixed`, `invalid`, `stale`, `duplicate`, `wontfix`. Add dated notes below with the evidence checked.

## Status Notes

- 2026-06-25: open by Devana. Initial report written from static source inspection.
- 2026-06-27: fixed. When facts are present, each per-scope DELETE is now constrained to the distinct `path_template`s in that batch (`... AND path_template IN (?, ...)`), so re-indexing a subset of templates only replaces those templates' rows and leaves an entry's other templates' facts intact. `collectFactScopes` now collects the template set per scope (insertion-ordered, deduped). The empty-facts + `target` path is preserved as a deliberate whole-entry clear (un-templated DELETE), which is the explicit escape hatch for removing an entry's entire sidecar (and the subject of the separate empty-facts-stale-sidecar report). Updated the mixed-entry test (DELETE params now include the scope's templates) and added a test asserting a single-template re-index emits `path_template IN (?)` scoped to that template while the empty+target clear stays un-templated. Full suite: 41 pass.

DEVANA-KEY: src/facts.ts:100-144 | P2 | facts-delete-whole-entry
DEVANA-SUMMARY: Status=fixed | P2 high src/facts.ts:100-144 - buildReplaceFactsStatements now scopes each DELETE to the path templates in the batch, so partial re-indexing no longer wipes unrelated templates; empty-facts+target remains an explicit whole-entry clear.