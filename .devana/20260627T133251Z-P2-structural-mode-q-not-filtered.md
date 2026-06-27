DEVANA-FINDING: v1
DEVANA-STATE: fixed | P2 | high | security=no
DEVANA-KEY: src/engine.ts:271-273 | structural-mode-q-not-filtered

# Structural mode ignores `q` for filtering and ranking; returns the whole filter-matched set

## Finding

In `mode: "structural"`, a supplied query `q` never constrains or ranks results. The
lexical layer is skipped (`usesLexical` requires `mode === "lexical"`), and the only
place `q` filters content — the zero-score rejection at `engine.ts:271` — is disabled by
its own `input.mode !== "structural"` clause. Every content item that passes the
metadata/path filters is kept and assigned `score = 1` (`engine.ts:273`). The query text
is still used to compute `snippet`/`matchedFields` (`engine.ts:281-282`), so `q` is
half-honored for display but has no effect on which items are returned or their order.

## Violated Invariant Or Contract

When a caller supplies `q`, the result set should be constrained to entries that match
`q` (the behavior enforced in lexical mode by both `runLexicalSearch` and the content
scan's zero-score rejection). In structural mode that constraint silently vanishes.

## Oracle

Neighboring code: in lexical mode `evaluateContentItem` rejects items with
`textScore.score <= 0` (`engine.ts:271`), and `runLexicalSearch` only returns FTS hits.
The schema (`schema.ts:125-137`) accepts `q` together with any `mode` and emits no
warning, implying `q` is meant to be meaningful in both modes. The asymmetric use of
`scoreText` (snippet computed from `q` but filtering suppressed) is the tell.

## Counterexample

`{ "q": "zzzznonexistent", "mode": "structural", "collections": ["posts"] }` with no
`filter`/`paths`. `usesLexical` is false (FTS skipped). Content scan: every item passes
`matchesMetadataFilters(metadata, undefined)` and `evaluatePathFilters(data, undefined)`;
`scoreText` returns `{score: 0}`; line 271 evaluates `true && true && false` → not
rejected; line 273 sets `score = 1`. The entire `posts` collection (up to `fetchLimit`)
is returned with `score: 1`, despite the query matching nothing.

## Why It Might Matter

A structural query that also carries a text term silently degrades to "return everything
that matches the structural filters," with all scores tied at 1.0. Callers expecting `q`
to narrow results get the full collection; `resolve` then sees uniform scores and behaves
unpredictably. User-visible correctness defect.

## Proof

Control-flow trace: `runAkariQuery` (53: lexical skipped) → `scanContent` →
`evaluateContentItem` (270 `scoreText` computed, 271 guard short-circuits on
`mode !== "structural"`, 273 `score = 1`) → item returned regardless of text match.

## Counterevidence Checked

Strongest counter: structural mode may be *intended* to ignore `q` and match only on
`paths`/`filter`. Evidence against pure intent: `scoreText(q, item)` is still computed and
its `snippet`/`matchedFields` attached (281-282), i.e. `q` is honored for display but not
filtering — an asymmetry that reads as oversight, not design. The schema permits `q` with
`structural` and surfaces no warning, so the combination is reachable from validated
input. The downstream all-scores-tied consequence overlaps `resolve-rrf-margin-consecutive-ranks`,
but the novel defect here is that `q` performs no filtering at all.

## Suggested Next Step

Decide the contract: either reject/warn on `q` + `mode: "structural"`, or apply the
zero-score rejection (and real text scoring) in structural mode too. The cheapest fix is
to drop the `&& input.mode !== "structural"` condition at `engine.ts:271` when `input.q`
is present.

## Agent Handoff

After working this report, preserve the original finding body. Update line 2
`DEVANA-STATE: ...` and the final `DEVANA-SUMMARY:` prefix.

## Status Notes

- 2026-06-27: open by Devana. Static control-flow trace through engine.ts query path.
- 2026-06-27: fixed. Applied the cheapest suggested fix and ranking. In `evaluateContentItem`, the zero-score rejection now fires whenever `input.q` is present regardless of mode (dropped `&& input.mode !== "structural"`), so a structural query carrying a text term narrows to entries that actually match it. Ranking also changed from `mode === "structural" ? 1 : textScore.score` to `input.q ? textScore.score : 1`, so structural-with-q ranks by text relevance while pure structural (no q) keeps the uniform score of 1. Snippet/matchedFields were already computed from `q`, so the half-honored asymmetry is now consistent. Added a regression test: `q: "zzzznonexistent"` in structural mode returns 0 items; `q: "workers"` narrows to the single matching entry (`home`). Existing structural tests (no `q`) are unaffected. Full suite: 50 pass.

DEVANA-KEY: src/engine.ts:271-273 | structural-mode-q-not-filtered
DEVANA-SUMMARY: fixed | P2 | high | Structural mode now applies q as a filter (zero-score rejection in all modes) and ranking signal (score = textScore when q present), so a text query narrows results instead of returning the whole filter-matched set.
