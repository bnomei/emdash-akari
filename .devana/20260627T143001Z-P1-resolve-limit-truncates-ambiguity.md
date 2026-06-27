DEVANA-FINDING: v1
Priority: P1 | Confidence: high | Security-sensitive: no | Status: fixed
Location: src/engine.ts:79,100-125; src/schema.ts:134 | Slug: resolve-limit-truncates-ambiguity

# Resolve ambiguity check runs after limit truncation

## Finding

`resolveAkariQuery` calls `runAkariQuery`, which applies `input.limit` inside `reciprocalRankFusion` before resolve compares the top two candidates. When `limit` is 1, `response.items` contains only the first fused hit, so `second` is always `undefined` and the ambiguous branch never runs even when additional near-tie candidates exist.

## Violated Invariant Or Contract

Resolve should decide ambiguity from the true top-two fused candidates, not from a client-truncated result list. README describes resolve as returning ambiguous when the top match is not clearly separated from alternatives.

## Oracle

`resolveAkariQuery` reads `const [first, second] = response.items` (lines 100-101). `runAkariQuery` passes `{ limit: input.limit }` into `reciprocalRankFusion` (line 79). Schema allows `limit` from 1 to `MAX_LIMIT` on resolve input (`schema.ts:134`).

## Counterexample

`resolveAkariQuery({ mode: "lexical", q: "workers", collections: ["pages"], limit: 1 })` with two lexical hits whose normalized fused scores differ by at most `ambiguityMargin` (0.02). Fusion ranks both as top candidates, but only one is returned; resolve emits `status: "resolved"` instead of `status: "ambiguous"`.

## Why It Might Matter

Callers that set `limit: 1` to minimize payload size lose ambiguity detection and may auto-edit the wrong entry when the runner-up was within the configured margin.

## Proof

**Control-flow trace:** `resolveAkariQuery` → `runAkariQuery(input)` → `reciprocalRankFusion(groups, { limit: input.limit })` slices to one item → `[first, second]` where `second` is `undefined` → condition `second && firstScore - secondScore <= margin` is false → `status: "resolved"`.

**Counterexample value:** `limit: 1` with two tied top candidates.

## Counterevidence Checked

Default `limit: 20` masks the bug in tests (`test/engine.test.mjs` ambiguity test uses default limit). `maxAlternatives` does not widen the fused pool used for the top-two comparison.

## Suggested Next Step

Run ambiguity detection on an unfused or un-limited top-two slice, or document that resolve requires `limit >= 2` and enforce it in `akariResolveInputSchema`.

## Agent Handoff

After working this report, preserve the original finding body. Update line 2 `Status: ...` and the final `DEVANA-SUMMARY:` status. Use one of: `open`, `fixed`, `invalid`, `stale`, `duplicate`, `wontfix`. Add dated notes below with the evidence checked.

## Status Notes

- 2026-06-27: open by Devana. Initial report written from static source inspection during exhaustive `--all` hunt.
- 2026-06-27: fixed. `resolveAkariQuery` now runs `runAkariQuery` with `limit = max(input.limit, maxAlternatives + 1, 2)` instead of the raw client limit, so the fused pool always contains enough candidates to (a) compare the true top-two for ambiguity and (b) populate up to `maxAlternatives` alternatives. With `limit: 1` and two near-tied candidates, resolve now returns `ambiguous` rather than `resolved`. Added a regression test in engine.test.mjs (limit 1, two tied lexical hits, margin 1 → ambiguous with 2 alternatives). Full suite: 32 pass.

DEVANA-KEY: src/engine.ts:79,100-125; src/schema.ts:134 | P1 | resolve-limit-truncates-ambiguity
DEVANA-SUMMARY: Status=fixed | P1 high src/engine.ts:79,100-125; src/schema.ts:134 - resolve now widens the internal fusion limit to max(input.limit, maxAlternatives+1, 2) so client limit:1 no longer hides near-ties.