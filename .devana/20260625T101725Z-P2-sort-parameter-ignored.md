DEVANA-FINDING: v1
Priority: P2 | Confidence: high | Security-sensitive: no | Status: fixed
Location: src/schema.ts:133; src/engine.ts:43-93 | Slug: sort-parameter-ignored

# Validated sort parameter is never applied to query results

## Finding

`akariQueryInputSchema` accepts and validates `sort` (for example `["-score", "-updatedAt"]`), and README documents it in the validated query shape. `runAkariQuery` never reads `input.sort`. Result ordering comes only from reciprocal rank fusion score (`ranking.ts:55`) and content-scan `orderBy: { updatedAt: "desc" }` before a score re-sort.

## Violated Invariant Or Contract

Accepted query parameters that appear in the public contract must affect runtime behavior. `sort` should order `items` after rank fusion per the documented query shape.

## Oracle

README Command Input lists `"sort": ["-score", "-updatedAt"]`. `akariSortSchema` validates allowed sort keys. No `input.sort` reference exists under `src/` outside `schema.ts`.

## Counterexample

`normalizeQueryInput({ mode: "structural", collections: ["pages"], sort: ["title"], limit: 10 })` validates successfully. Two structural hits with equal score `1` and titles `Alpha` / `Zulu` return in score/scan order, not alphabetical by `title`.

## Why It Might Matter

Clients relying on documented `sort` for deterministic ordering receive score-only ordering, breaking pagination assumptions and agent workflows that expect title or date ordering.

## Proof

**Contract mismatch:** Schema and README accept `sort`; engine execution path omits it entirely.

**Control-flow trace:** `runAkariQuery` → `reciprocalRankFusion` → returns without sort application.

## Counterevidence Checked

Internal `.sort()` calls order facets, matched paths, and snippets only. No post-fusion sort helper exists. Contract tests validate input parsing, not response ordering.

## Suggested Next Step

Implement a sort pass on fused `items` using `input.sort`, or remove `sort` from schema and README until implemented.

## Agent Handoff

After working this report, preserve the original finding body. Update line 2 `Status: ...` and the final `DEVANA-SUMMARY:` status. Use one of: `open`, `fixed`, `invalid`, `stale`, `duplicate`, `wontfix`. Add dated notes below with the evidence checked.

## Status Notes

- 2026-06-25: open by Devana. Initial report written from static source inspection.
- 2026-06-27: fixed. `runAkariQuery` now applies `input.sort`. It fuses without truncating (`reciprocalRankFusion(groups)`), then — when `sort` is present — runs a stable multi-key `applySort` over the full fused set before slicing to `input.limit`, so sort orders the whole result set rather than just the relevance top-N. `applySort` parses the leading `-` for descending, maps each documented key (score/updatedAt/publishedAt/title/collection/status/locale) via `sortValue`, compares numbers numerically and strings via `localeCompare`, and always sorts missing values last regardless of direction; ties fall back to fused relevance order (Array.sort is stable). Resolve passes `sort: undefined` into its internal query so ambiguity/alternatives still derive from fused-score order. Added a regression test (structural mode, equal scores, `["title"]` and `["-title"]`). Full suite: 34 pass.

DEVANA-KEY: src/schema.ts:133; src/engine.ts:43-93 | P2 | sort-parameter-ignored
DEVANA-SUMMARY: Status=fixed | P2 high src/schema.ts:133; src/engine.ts:43-93 - runAkariQuery now applies input.sort via a stable post-fusion applySort over the full result set before limiting; resolve strips sort to keep score-based ambiguity.