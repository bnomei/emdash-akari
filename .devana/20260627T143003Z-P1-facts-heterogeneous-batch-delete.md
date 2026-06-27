DEVANA-FINDING: v1
Priority: P1 | Confidence: high | Security-sensitive: no | Status: fixed
Location: src/facts.ts:100-144 | Slug: facts-heterogeneous-batch-delete

# Facts replace deletes only the first entry scope in mixed batches

## Finding

`buildReplaceFactsStatements` derives DELETE scope from `facts[0] ?? target` but INSERTs every row in the `facts` array. A batch containing facts for multiple `(collection, entry_id, locale)` tuples deletes only the first entry's rows while inserting rows for all entries, leaving stale facts for the other entries and partial replacement for the first.

## Violated Invariant Or Contract

A replace batch should delete exactly the scopes it is about to rewrite. Mixed-entry batches must not corrupt `_emdash_content_facts` for non-first entries.

## Oracle

`buildReplaceFactsStatements` returns one DELETE using `scope.collection`, `scope.entryId`, `scope.locale` from `facts[0]` (lines 104-110) followed by INSERT statements for each fact (lines 112-143). Tests cover single-entry extraction and empty-facts delete-with-target (`test/engine.test.mjs:201-237`) but not heterogeneous batches.

## Counterexample

`facts = [...extractContentFacts({ entryId: "home", ... }), ...extractContentFacts({ entryId: "about", ... })]` followed by `buildReplaceFactsStatements(facts)`. DELETE targets only `home`; INSERT writes rows for both `home` and `about`; prior `about` facts remain while `home` facts are wiped and rebuilt.

## Why It Might Matter

Integrators batching sidecar materialization for multiple entries in one migration or job can leave stale structural facts that structural SQL or downstream discover logic still trust.

## Proof

**Dataflow trace:** batched `facts[]` → `scope = facts[0]` → DELETE `WHERE collection = ? AND entry_id = ? AND COALESCE(locale,'') = COALESCE(?,'')` for first entry only → INSERT all rows → non-first entries retain old facts plus new inserts (PK collisions may also fail depending on overlap).

**Counterexample value:** two-entry `facts` array with different `entryId` values.

## Counterevidence Checked

Separate per-entry calls are safe. `target` is ignored when `facts` is non-empty (related but distinct from empty-facts stale sidecar). `facts-delete-whole-entry` covers single-entry multi-template wipes, not cross-entry batch scope.

## Suggested Next Step

Reject mixed-entry batches, emit one DELETE per distinct scope, or document that callers must pass one entry per `buildReplaceFactsStatements` call.

## Agent Handoff

After working this report, preserve the original finding body. Update line 2 `Status: ...` and the final `DEVANA-SUMMARY:` status. Use one of: `open`, `fixed`, `invalid`, `stale`, `duplicate`, `wontfix`. Add dated notes below with the evidence checked.

## Status Notes

- 2026-06-27: open by Devana. Initial report written from static source inspection during exhaustive `--all` hunt.
- 2026-06-27: fixed. `buildReplaceFactsStatements` derived its single DELETE scope from `facts[0]` only, so a mixed-entry batch wiped just the first entry's rows while inserting rows for all entries (stale facts for the others, partial rewrite for the first). Now it collects the distinct `(collection, entry_id, locale)` scopes from the batch via a new `collectFactScopes` helper and emits one DELETE per scope before the INSERTs; the empty-facts path still falls back to the explicit `target`. Added a regression test in engine.test.mjs (home+about batch → two DELETEs `[pages,home,en]` and `[pages,about,en]`, all facts inserted). Existing single-entry and empty-facts-with-target tests still pass. Full suite: 33 pass.

DEVANA-KEY: src/facts.ts:100-144 | P1 | facts-heterogeneous-batch-delete
DEVANA-SUMMARY: Status=fixed | P1 high src/facts.ts:100-144 - buildReplaceFactsStatements now emits one DELETE per distinct (collection, entry_id, locale) scope in the batch, so mixed-entry replacements no longer leave stale facts.