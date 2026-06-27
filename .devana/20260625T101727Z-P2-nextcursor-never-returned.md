DEVANA-FINDING: v1
Priority: P2 | Confidence: high | Security-sensitive: no | Status: fixed
Location: src/types.ts:73; src/engine.ts:82-93,160 | Slug: nextcursor-never-returned

# Pagination after is accepted but nextCursor is never returned

## Finding

`akariQueryInputSchema` accepts `after` for cursor pagination and README documents it in the query shape. `AkariQueryResponse` defines optional `nextCursor`. `runLexicalSearch` forwards `input.after` to the search provider as `cursor`, but `runAkariQuery` never sets `nextCursor` on the response. Content scan uses internal `content.list` cursors only and ignores `input.after`.

## Violated Invariant Or Contract

Cursor pagination requires the response to expose a continuation cursor when more results exist, and `after` should advance both executable layers consistently.

## Oracle

README validated query shape includes `"after": null`. `AkariQueryResponse.nextCursor` in `types.ts`. `after` appears once in engine at lexical `cursor` assignment.

## Counterexample

Lexical discover with `{ "after": "cursor-1", "limit": 10 }` may return page-two FTS hits, but `response.nextCursor` is always `undefined`. Clients cannot continue pagination using the documented contract.

## Why It Might Matter

Agent and script clients cannot implement reliable pagination against discover, causing duplicate processing or truncated result sets in large collections.

## Proof

**Control-flow trace:** `input.after` → `runLexicalSearch` `cursor` only; `runAkariQuery` return omits `nextCursor`.

**Contract mismatch:** Response type defines `nextCursor`; engine never assigns it.

## Counterevidence Checked

`nextCursor` appears only in `types.ts`, not assigned anywhere in `src/`. Content-scan pagination test exercises internal list cursors, not user-facing `after`/`nextCursor`.

## Suggested Next Step

Propagate provider continuation tokens into `nextCursor`, and wire `after` into content scan or document single-layer pagination only.

## Agent Handoff

After working this report, preserve the original finding body. Update line 2 `Status: ...` and the final `DEVANA-SUMMARY:` status. Use one of: `open`, `fixed`, `invalid`, `stale`, `duplicate`, `wontfix`. Add dated notes below with the evidence checked.

## Status Notes

- 2026-06-25: open by Devana. Initial report written from static source inspection.
- 2026-06-27: fixed (single-layer scope, per maintainer decision). RRF fusion of the lexical + content layers has no single coherent continuation token, and content scan runs by default whenever content access exists, so full fused pagination is out of scope. Implemented the documented single-layer path: `runLexicalSearch` now returns `{ candidates, nextCursor }` (propagating the provider's `SearchResponse.nextCursor`), and `runAkariQuery` sets `response.nextCursor` only when the content scan did NOT run (lexical is the sole executed layer); otherwise it stays `undefined`. README updated to document that `after`/`nextCursor` pagination is lexical-only and omitted for fused queries. Added a regression test: lexical-only query surfaces `nextCursor: "page-2"`; the same query with content access returns `nextCursor: undefined`. Full suite: 38 pass.

DEVANA-KEY: src/types.ts:73; src/engine.ts:82-93,160 | P2 | nextcursor-never-returned
DEVANA-SUMMARY: Status=fixed | P2 high src/types.ts:73; src/engine.ts:82-93,160 - nextCursor is now propagated from the lexical provider when lexical is the sole layer, and documented as lexical-only (omitted for fused queries) since RRF fusion has no coherent cross-layer cursor.