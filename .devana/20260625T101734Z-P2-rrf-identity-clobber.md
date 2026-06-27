DEVANA-FINDING: v1
Priority: P2 | Confidence: medium | Security-sensitive: no | Status: fixed
Location: src/ranking.ts:67-69; src/engine.ts:241-245 | Slug: rrf-identity-clobber

# Rank fusion merge overwrites FTS identity fields with null content values

## Finding

`mergeResult` builds identity as `{ ...left.identity, ...right.identity }`. When FTS and content groups merge the same result key, the content leg is merged second and always sets `slug: item.slug` even when slug is null or undefined. Defined slug, title, or locale from the FTS leg can be replaced with empty values from the content record.

## Violated Invariant Or Contract

Fused identity should preserve the best available identifying fields from contributing layers, not allow later layers to clobber defined values with nulls.

## Oracle

FTS hits include `slug` and `title` from search results (`runLexicalSearch` lines 172-176). Content identity always copies `item.slug` directly (line 244).

## Counterexample

FTS returns `{ id: "home", slug: "workers-ai", title: "Workers AI" }`. Content list returns the same id with `slug: null` (missing slug in storage). After fusion, `identity.slug` becomes `null`, breaking `url` fallbacks and agent edit targeting.

## Why It Might Matter

Resolve and discover return identities with missing slug or title despite FTS providing them, causing broken URLs and wrong automation targets after rank fusion.

## Proof

**Dataflow trace:** FTS group merged first → content group merged second → `...right.identity` overwrites `slug: null` onto defined FTS slug.

**State transition mismatch:** Merge should combine evidence; instead null fields erase prior values.

## Counterevidence Checked

Fusion test uses matching identities without null slug. `mergeResult` uses `left.snippet ?? right.snippet` for snippets (preferring left), but identity spread has no null-coalescing guard.

## Suggested Next Step

Merge identity fields with null-coalescing per key, mirroring snippet merge semantics.

## Agent Handoff

After working this report, preserve the original finding body. Update line 2 `Status: ...` and the final `DEVANA-SUMMARY:` status. Use one of: `open`, `fixed`, `invalid`, `stale`, `duplicate`, `wontfix`. Add dated notes below with the evidence checked.

## Status Notes

- 2026-06-25: open by Devana. Initial report written from static source inspection.
- 2026-06-27: fixed. Replaced the blind `{ ...left.identity, ...right.identity }` spread in `mergeResult` with a per-key `mergeIdentity` that uses `right.<field> ?? left.<field>` for each identity field. Defined values from the authoritative content layer still win, but a null/undefined content `slug`/`title`/`locale`/`status` no longer erases a value the FTS layer supplied (mirrors the existing `left.snippet ?? right.snippet` merge intent). Added a `reciprocalRankFusion` regression test: an FTS hit with `slug: "workers-ai"` merged with a content hit carrying `slug: null` keeps the FTS slug. Full suite: 45 pass.

DEVANA-KEY: src/ranking.ts:67-69; src/engine.ts:241-245 | P2 | rrf-identity-clobber
DEVANA-SUMMARY: Status=fixed | P2 medium src/ranking.ts:67-69; src/engine.ts:241-245 - mergeResult now merges identity per-key (right ?? left), so a null content field can no longer clobber a defined FTS identity value.