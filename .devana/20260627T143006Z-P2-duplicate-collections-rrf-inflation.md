DEVANA-FINDING: v1
Priority: P2 | Confidence: high | Security-sensitive: no | Status: fixed
Location: src/schema.ts:128; src/engine.ts:203-224; src/ranking.ts:34-52 | Slug: duplicate-collections-rrf-inflation

# Duplicate collection names double-scan and inflate fused scores

## Finding

`akariQueryInputSchema` allows duplicate strings in `collections`. `scanContent` iterates the array verbatim, scanning the same collection multiple times and appending duplicate candidates to one content group. `reciprocalRankFusion` adds fusion weight again for the same `resultKey`, inflating normalized scores for duplicated entries.

## Violated Invariant Or Contract

Each configured collection should contribute at most once to discovery and rank fusion. Duplicate names should not amplify scores for identical identities.

## Oracle

Schema uses `z.array(z.string().regex(identifierPattern).max(128)).min(1).max(50)` without `.unique()` (`schema.ts:128`). `scanContent` loops `for (const collection of collections)` (`engine.ts:203`). RRF accumulates `existing.score += score` per duplicate rank hit (`ranking.ts:41-42`).

## Counterexample

`{ "collections": ["pages", "pages"], "mode": "structural", "paths": [{ "path": "$.blocks[*].type", "op": "eq", value: "embed" }] }` scans `pages` twice, emits two rank entries for the same `pages:home:` key in one group, and doubles that item's fused contribution before normalization.

## Why It Might Matter

Accidental duplicate collection names in generated agent queries can reorder results and push marginal duplicates ahead of genuinely stronger matches from other collections.

## Proof

**Control-flow trace:** duplicate `collections` → two `scanContent` passes → duplicate `EngineCandidate` rows in one group → RRF merges same `key` twice with separate ranks → higher fused score.

**Counterexample value:** `collections: ["pages", "pages"]`.

## Counterevidence Checked

`resolveCollections` from `filter.collection` builds arrays from `$in` without deduplication, but duplicate top-level literals are the direct trigger. Lexical search passes the duplicate array to the provider, which may dedupe internally; content scan does not.

## Suggested Next Step

Deduplicate `collections` during normalization or reject duplicates in `akariQueryInputSchema`.

## Agent Handoff

After working this report, preserve the original finding body. Update line 2 `Status: ...` and the final `DEVANA-SUMMARY:` status. Use one of: `open`, `fixed`, `invalid`, `stale`, `duplicate`, `wontfix`. Add dated notes below with the evidence checked.

## Status Notes

- 2026-06-27: open by Devana. Initial report written from static source inspection during exhaustive `--all` hunt.
- 2026-06-27: fixed. Deduplicated the collection list in `resolveCollections` (`return [...new Set(selected)]`), which is the single point feeding both the content scan and lexical search. This handles duplicate top-level `collections` literals and also duplicate values coming from a `filter.collection` `$in` set (the counterevidence's secondary trigger), so each collection is scanned and contributes to rank fusion at most once. Set preserves first-seen order. Chose normalization over a schema `.unique()` rejection so accidental duplicates degrade gracefully (deduped) rather than erroring. Added a regression test: `collections: ["pages","pages"]` yields exactly the same single item and score as `collections: ["pages"]` (no doubled scan/RRF inflation). Full suite: 56 pass.

DEVANA-KEY: src/schema.ts:128; src/engine.ts:203-224; src/ranking.ts:34-52 | P2 | duplicate-collections-rrf-inflation
DEVANA-SUMMARY: Status=fixed | P2 high src/schema.ts:128; src/engine.ts:203-224; src/ranking.ts:34-52 - resolveCollections now dedupes the collection list, so duplicate names (top-level or via filter.collection $in) no longer double-scan or inflate fused scores.