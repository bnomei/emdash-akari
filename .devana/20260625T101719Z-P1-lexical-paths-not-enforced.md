DEVANA-FINDING: v1
Priority: P1 | Confidence: high | Security-sensitive: no | Status: fixed
Location: src/engine.ts:148-185,267-268 | Slug: lexical-paths-not-enforced

# Structural paths are not enforced on the lexical FTS layer

## Finding

In lexical mode, `runLexicalSearch` maps FTS hits without calling `evaluatePathFilters`. Path constraints are only applied during `scanContent` via `evaluateContentItem`. Rank fusion merges FTS and content groups, so FTS hits that violate `paths` can appear in `discover` and `resolve` results. When `options.content` is unavailable, path filters are never applied at all.

## Violated Invariant Or Contract

README documents combined lexical queries with `paths` (validated query shape includes both `mode: "lexical"` and `paths`). Every executable layer that contributes candidates must honor the same path constraints.

## Oracle

README Command Input example combines `q`, `mode: "lexical"`, and `paths`. `evaluatePathFilters` is the authoritative path gate on the content leg (line 267).

## Counterexample

`{ "q": "workers", "mode": "lexical", "collections": ["pages"], "paths": [{ "path": "$.blocks[*].type", "op": "eq", "value": "embed" }] }` with a lexical provider returning a page whose blocks contain no embed. FTS hit is included with `matchedPaths: []` (lines 179-182). If content scan is absent, no path evaluation runs and the wrong identity is returned.

## Why It Might Matter

Agents using lexical discover with structural path guards receive entries that fail the documented path contract, causing edits against the wrong content or false-positive existence checks before page creation.

## Proof

**Control-flow trace:** `usesLexical` true → `runLexicalSearch` (no `input.paths` reference) pushes FTS group. `scanContent` calls `evaluatePathFilters` only for content items. `reciprocalRankFusion` merges both groups without re-checking paths.

**Cross-entry mismatch:** Content leg rejects non-matching paths; FTS leg never checks them.

## Counterevidence Checked

`shouldRunContentScan` is true whenever `content` exists, so dual-leg fusion is the default in hosted EmDash apps. Content-only structural mode tests always supply `paths` and do not cover lexical+paths on the FTS leg. No post-fusion path filter exists in `ranking.ts`.

## Suggested Next Step

Apply `evaluatePathFilters` to FTS hits (requires content body) or drop FTS hits when `paths` is set and content access is unavailable; alternatively document that `paths` require the content scan layer.

## Agent Handoff

After working this report, preserve the original finding body. Update line 2 `Status: ...` and the final `DEVANA-SUMMARY:` status. Use one of: `open`, `fixed`, `invalid`, `stale`, `duplicate`, `wontfix`. Add dated notes below with the evidence checked.

## Status Notes

- 2026-06-25: open by Devana. Initial report written from static source inspection.
- 2026-06-27: fixed. Building on the lexical-postfilter-metadata fix (which already resolves each FTS hit to its real entry via `content.get`), `runLexicalSearch` now also runs `evaluatePathFilters` against the resolved entry body and only keeps hits whose paths match, populating `matchedPaths` accordingly. When `input.paths` is set but the entry body is unavailable (no content access or `get` returns null/throws), the FTS hit is dropped — failing closed rather than returning an unverified identity. Refactored the helper into `fetchLexicalEntry` (returns the full item or null) + `lexicalHitMetadata` (fallback). Added two regression tests: a path-mismatched FTS hit is dropped when content is present, and all FTS hits are dropped when paths are set with no content access. Full suite: 28 pass.

DEVANA-KEY: src/engine.ts:148-185,267-268 | P1 | lexical-paths-not-enforced
DEVANA-SUMMARY: Status=fixed | P1 high src/engine.ts:148-185,267-268 - Lexical FTS leg now applies evaluatePathFilters against the resolved entry body and fails closed when paths are set but the body is unavailable.