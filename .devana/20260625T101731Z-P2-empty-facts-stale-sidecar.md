DEVANA-FINDING: v1
Priority: P2 | Confidence: high | Security-sensitive: no | Status: fixed
Location: src/facts.ts:104-105 | Slug: empty-facts-stale-sidecar

# Empty extractContentFacts result leaves stale sidecar rows

## Finding

When `extractContentFacts` returns no rows because structural paths no longer match entry content, `buildReplaceFactsStatements(facts)` without an explicit `target` returns an empty statement list (`if (!scope) return []`). No DELETE runs and prior `_emdash_content_facts` rows remain.

## Violated Invariant Or Contract

Re-extracting facts after content changes should reflect the current document shape. When no paths match, stored facts for that entry should be cleared.

## Oracle

`buildReplaceFactsStatements([], { collection, entryId, locale })` correctly emits DELETE-only statements (tested in `engine.test.mjs`). Default call path uses `facts[0] ?? target` and bails when both are absent.

## Counterexample

Entry previously had embed blocks indexed under `$.blocks[*].type`. Content is edited to remove all embeds. `extractContentFacts` returns `[]`. Caller invokes `buildReplaceFactsStatements(facts)` without `target`. Old embed facts remain queryable via facts-backed structural SQL.

## Why It Might Matter

Stale sidecar facts cause structural queries to return entries that no longer match the live content shape, breaking migration impact analysis and agent edit targeting.

## Proof

**Control-flow trace:** `facts` empty and `target` undefined → early return `[]` at line 105 → no DELETE.

**State transition mismatch:** Content transitioned from matching to non-matching paths; persistence layer not updated.

## Counterevidence Checked

Tests demonstrate DELETE-only pattern requires explicit `target` when `facts` is empty. No guard forces callers to pass `target` on empty extraction. `extractContentFacts` itself does not emit delete statements.

## Suggested Next Step

Require `target` whenever `facts` is empty, or derive scope from `ExtractFactsOptions` and always emit DELETE when extraction returns zero rows.

## Agent Handoff

After working this report, preserve the original finding body. Update line 2 `Status: ...` and the final `DEVANA-SUMMARY:` status. Use one of: `open`, `fixed`, `invalid`, `stale`, `duplicate`, `wontfix`. Add dated notes below with the evidence checked.

## Status Notes

- 2026-06-25: open by Devana. Initial report written from static source inspection.
- 2026-06-27: fixed (per the report's "derive scope from ExtractFactsOptions" suggestion). The low-level `buildReplaceFactsStatements(facts)` genuinely cannot derive an entry scope from an empty `facts` array, so it correctly stays a no-op there (forcing a throw would break legitimate "nothing to do" callers). Added an exported `buildReplaceFactsStatementsFromExtraction(options)` that extracts facts and always passes a `target` derived from the same `ExtractFactsOptions` (collection/entryId/locale); when extraction yields zero rows it still emits the scoped clearing DELETE, so stale `_emdash_content_facts` rows never linger after content changes. Exported the helper (and `ExtractFactsOptions`) from index.ts and documented the recommended usage + the empty-no-target no-op caveat in README. Added a regression test: from-extraction with no matching path emits a single DELETE `[pages, home, en]`, while `buildReplaceFactsStatements([])` returns `[]`. Full suite: 42 pass.

DEVANA-KEY: src/facts.ts:104-105 | P2 | empty-facts-stale-sidecar
DEVANA-SUMMARY: Status=fixed | P2 high src/facts.ts:104-105 - Added buildReplaceFactsStatementsFromExtraction which derives the replacement scope from ExtractFactsOptions and always emits a clearing DELETE on empty extraction; documented the low-level no-op caveat.