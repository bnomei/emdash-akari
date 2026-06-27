DEVANA-FINDING: v1
Priority: P1 | Confidence: high | Security-sensitive: no | Status: wontfix
Location: src/engine.ts:41,111-116; src/ranking.ts:27-64 | Slug: resolve-rrf-margin-consecutive-ranks

# Default ambiguity margin treats consecutive RRF ranks as ties

## Finding

`resolveAkariQuery` compares normalized reciprocal-rank-fusion scores with default `ambiguityMargin` 0.02. For a single fused group, consecutive ranks 1 and 2 normalize to scores 1 and `61/62 ≈ 0.98387`, giving a gap of `≈ 0.01613`, which is below the default margin. Any resolve request whose top two items come from the same group with consecutive ranks is reported ambiguous regardless of how far apart their raw lexical or content scores were.

## Violated Invariant Or Contract

Resolve should return `status: "resolved"` when the top candidate is clearly better than the runner-up. The margin should reflect relevance separation, not an artifact of rank positions within one search layer.

## Oracle

Default `ambiguityMargin` is `0.02` (`engine.ts:41`). RRF uses `score = weight / (k + rank)` with `k = 60` (`ranking.ts:31,38`), then normalizes by the top fused score (`ranking.ts:55-61`). README resolved example shows a single clear winner; ambiguous example shows scores `1` and `0.984`, matching consecutive-rank normalization rather than raw relevance.

## Counterexample

Lexical-only resolve with two FTS hits where raw scores are `100` and `1`. After fusion, normalized scores are `1` and `≈ 0.98387`; `firstScore - secondScore ≈ 0.01613 <= 0.02` triggers `status: "ambiguous"` with warning "Top candidates are too close to resolve automatically."

## Why It Might Matter

Agents calling `akari resolve` on ordinary two-hit searches will get ambiguous results by default unless rank fusion boosts the winner through a second layer overlap, blocking automated edits in the common single-layer case.

## Proof

**Counterexample value:** One RRF group with ranks 1 and 2, default `ambiguityMargin`, no cross-layer overlap.

**Control-flow trace:** `runLexicalSearch` → `toRankedGroup` assigns ranks 1 and 2 → `reciprocalRankFusion` normalizes → `resolveAkariQuery` compares `firstScore - secondScore` against `0.02` → ambiguous branch taken.

## Counterevidence Checked

When the top item appears in both FTS and content groups, its fused score doubles and the gap to a single-layer runner-up can exceed 0.02 (`test/engine.test.mjs` fusion test). Tests force ambiguity with `ambiguityMargin: 1`, not the default. README ambiguous example may document this rank-gap behavior rather than raw-score closeness.

## Suggested Next Step

Compare raw layer scores before normalization, increase the default margin below the consecutive-rank gap, or require a larger minimum score delta for single-group resolves.

## Agent Handoff

After working this report, preserve the original finding body. Update line 2 `Status: ...` and the final `DEVANA-SUMMARY:` status. Use one of: `open`, `fixed`, `invalid`, `stale`, `duplicate`, `wontfix`. Add dated notes below with the evidence checked.

## Status Notes

- 2026-06-27: open by Devana. Initial report written from static source inspection during exhaustive `--all` hunt.
- 2026-06-27: wontfix (intended, documented behavior). The mechanics in the report are accurate: a single fused group's ranks 1 and 2 normalize to 1 and 61/62 ≈ 0.98387 (gap ≈ 0.01613 < default margin 0.02), so two single-layer hits with consecutive ranks resolve as `ambiguous`. But this is the documented contract, not a defect: README's "Ambiguous response" example (lines 426-448) shows exactly two different single-layer candidates at scores `1` and `0.984` being flagged ambiguous. RRF is deliberately rank-based and discards raw lexical/content score magnitude (which is not comparable across providers), so resolve only auto-resolves with strong signal — a unique top hit, or cross-layer overlap that lifts the winner's fused score past the margin (covered by the fusion test in engine.test.mjs). Reporting a lone search layer's close top-two as ambiguous is the conservative, safety-favoring design (avoid auto-editing the wrong entry on one layer's call). Changing the default margin or switching to raw-score comparison would break the documented example and the cross-layer fusion semantics, so no code change. If different UX is desired, callers can pass a smaller `ambiguityMargin` via engine options to make single-layer consecutive ranks resolve; that knob already exists.

DEVANA-KEY: src/engine.ts:41,111-116; src/ranking.ts:27-64 | P1 | resolve-rrf-margin-consecutive-ranks
DEVANA-SUMMARY: Status=wontfix | P1 high src/engine.ts:41,111-116; src/ranking.ts:27-64 - Consecutive-rank single-layer ties resolving as ambiguous is intended and documented (README ambiguous example shows 1 / 0.984); RRF discards raw magnitude by design and the ambiguityMargin option already lets callers tune it.