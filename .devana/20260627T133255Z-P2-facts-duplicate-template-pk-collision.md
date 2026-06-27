DEVANA-FINDING: v1
DEVANA-STATE: fixed | P2 | medium | security=no
DEVANA-KEY: src/facts.ts:113,72-98 | facts-duplicate-template-pk-collision

# Duplicate path template causes a plain-INSERT PK collision that aborts the facts replace after the DELETE

## Finding

`extractContentFacts` (`facts.ts:72-98`) iterates `pathTemplates` without deduplication and
emits one fact per resolved value, with the template string in `pathTemplate` and the
concrete path in `fullPath`. Two identical templates produce two facts with the same
PRIMARY KEY tuple `(collection, entry_id, locale, path_template, full_path)`
(`facts.ts:53`). `buildReplaceFactsStatements` (`facts.ts:100-145`) then returns
`[DELETE, INSERT, INSERT, ...]` using a **plain** `INSERT` (`facts.ts:113`), not
`INSERT OR REPLACE`. The second colliding INSERT raises `SQLITE_CONSTRAINT_PRIMARYKEY`.
Because the DELETE for that entry's scope runs first, a non-transactional executor leaves
the entry's prior facts wiped and the replace aborted.

## Violated Invariant Or Contract

A "replace facts" operation must be idempotent: re-indexing an entry should always succeed
and never leave the sidecar with fewer facts than it started with. Plain INSERT over the
function's own (un-deduped) output breaks that.

## Oracle

Schema/implementation: the table PRIMARY KEY (`facts.ts:53`) declares uniqueness on
`(collection, entry_id, locale, path_template, full_path)`. `extractContentFacts` can
produce two rows with the same tuple; `buildReplaceFactsStatements` inserts both. The
`paths`/template list has no uniqueness constraint upstream (`schema.ts:130` caps length
only).

## Counterexample

`extractContentFacts({ collection:"c", entryId:"e", data:{a:1}, pathTemplates:["$.a","$.a"] })`
returns two facts, both with PK `("c","e",null,"$.a","$.a")`.
`buildReplaceFactsStatements(facts)` = `[DELETE, INSERT, INSERT]`. The DELETE clears `e`'s
facts; the first INSERT succeeds; the second throws a PK/UNIQUE constraint error. If the
batch is not wrapped in a transaction, `e` ends with zero facts and the error propagates;
if wrapped, `e`'s re-index fails permanently while the config still lists the duplicate.

## Why It Might Matter

A benign, schema-valid configuration mistake (the same JSON path listed twice — a typical
copy-paste error) breaks fact indexing for every affected entry, with potential data loss
(facts deleted, inserts rolled back or aborted). Data-integrity impact.

## Proof

Read/write sequence leaving partial state: `[DELETE(ok), INSERT(ok), INSERT(PK fail)]`. The
INSERT SQL at `facts.ts:113` is plain `INSERT INTO ... VALUES (...)`, never
`INSERT OR REPLACE`; `extractContentFacts` does no dedup of `pathTemplates`.

## Counterevidence Checked

Trigger requires a duplicated (or otherwise PK-colliding) template. A single template never
yields duplicate `full_path` (paths from `readPathValues`, `paths.ts:200-222`, are unique
per template), and distinct templates differ in the `path_template` PK column, so
collisions arise only from literally repeated templates. There is no `INSERT OR REPLACE`
and no upstream template dedup in this repo. Distinct from `facts-heterogeneous-batch-delete`
(mixed entries) and `empty-facts-stale-sidecar` (empty extraction): this is a PK collision
from duplicate templates. Confidence medium because the trigger is a config duplication
rather than ordinary content data.

## Suggested Next Step

Either dedupe `pathTemplates` in `extractContentFacts`, or use `INSERT OR REPLACE` in
`buildReplaceFactsStatements` so the replace is idempotent regardless of duplicate
templates.

## Agent Handoff

After working this report, preserve the original finding body. Update line 2
`DEVANA-STATE: ...` and the final `DEVANA-SUMMARY:` prefix.

## Status Notes

- 2026-06-27: open by Devana. Static trace of extractContentFacts → buildReplaceFactsStatements against the table PK.
- 2026-06-27: fixed by applying both suggested mitigations (defense in depth). (1) `extractContentFacts` now dedupes `options.pathTemplates` via `[...new Set(...)]`, so a duplicated template no longer produces two facts with the same `(collection, entry_id, locale, path_template, full_path)` PK. (2) `buildReplaceFactsStatements` now emits `INSERT OR REPLACE INTO` instead of plain `INSERT`, so the replace is idempotent and cannot abort mid-batch (leaving the post-DELETE entry wiped) even if a caller passes colliding facts directly. Added a test: duplicate templates → 1 extracted fact; and executing the statements for two manually-colliding facts (with a non-null locale — SQLite treats NULL locale as distinct in the unique index, so the collision requires a concrete locale) against an in-memory `_emdash_content_facts` does not throw and leaves exactly one row. Full suite: 53 pass.

DEVANA-KEY: src/facts.ts:113,72-98 | facts-duplicate-template-pk-collision
DEVANA-SUMMARY: fixed | P2 | medium | extractContentFacts dedupes pathTemplates and buildReplaceFactsStatements uses INSERT OR REPLACE, so a duplicated template (or any PK-colliding fact) no longer aborts the replace after the DELETE.
