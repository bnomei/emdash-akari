DEVANA-FINDING: v1
Priority: P2 | Confidence: medium | Security-sensitive: no | Status: fixed
Location: src/structural.ts:229-233; src/paths.ts:146-147 | Slug: match-like-wildcard-divergence

# `match` diverges: runtime literal string-substring vs SQL `LIKE` with unescaped wildcards and CAST

# Finding

The `match` path operator is evaluated two ways that disagree on two axes.

1. Type gate: runtime (`pathValueMatches` case `match`, `src/paths.ts:146-147`)
   only matches when `typeof value === "string"`. The structural compiler
   (`src/structural.ts:229-233`) does `LOWER(CAST(value AS TEXT)) LIKE ?`, which
   applies to numbers/booleans too.
2. Wildcards: runtime does a literal `String.includes`. The SQL side interpolates
   the user value into a `LIKE` pattern as `%<value>%` with no `ESCAPE` clause, so
   `%` and `_` in the value act as SQL `LIKE` wildcards.

## Violated Invariant Or Contract

`src/constants.ts:8-14` marks `structural` as `"contract"`; the README "Path
Syntax" presents a single path query shape across JS and SQLite/D1 evaluation. The
same `match` filter must select the same entries on either backend, and `match` is
documented as a substring-style text operator, not a wildcard pattern language.

## Oracle

- `src/paths.ts:147`: `typeof value === "string" && value.toLowerCase().includes(filter.value.toLowerCase())` — literal substring, string-only.
- `test/engine.test.mjs:242`: `match` is exercised as a plain text contains.
- Neighboring SQL implementation `src/structural.ts:231-232`.

## Counterexample

Wildcard over-match (FALSE POSITIVE in SQL):
- Content `{ "title": "axb" }`, filter `{ "path": "$.title", "op": "match", "value": "a_b" }`.
- Runtime: `"axb".includes("a_b")` -> false -> **no match**.
- SQL: `'axb' LIKE '%a_b%'` -> `_` matches any single char -> **match**.
- Same with `value: "a%b"` against `"afoob"`.

Non-string over-match (FALSE POSITIVE in SQL):
- Content `{ "views": 1500 }`, filter `{ "path": "$.views", "op": "match", "value": "50" }`.
- Runtime: value is a number -> **no match**.
- SQL: `LOWER(CAST(1500 AS TEXT)) LIKE '%50%'` -> `'1500' LIKE '%50%'` -> **match**.

## Why It Might Matter

Hosts serving `match` from D1 return entries that `discover` excludes. A value such
as `100%` or `a_b` (legitimate user text) silently turns into a wildcard pattern in
SQL, broadening results and scans. Results disagree across deployments and violate
the structural/lexical contract.

## Proof

Contract mismatch + counterexample values: one literal-substring/string-only
implementation (`paths.ts:147`) versus a CAST + unescaped-`LIKE` implementation
(`structural.ts:231-232`).

## Counterevidence Checked

- Schema (`akariJsonPathSchema`, `pathTextFilterSchema`) does not strip or escape
  `%`/`_` from the value; min(1)/max(500) string only.
- `LIKE` has no `ESCAPE` clause in the emitted SQL, confirming wildcards are live.
- Reverse case (literal `_` in data and value) still matches on both, so the bug is
  over-matching, not under-matching.

## Suggested Next Step

Escape `%`, `_`, and the escape char in the SQL `LIKE` pattern (add `ESCAPE '\\'`),
and CAST/guard so non-string values do not match — or switch SQL to `instr(...)` to
mirror the runtime literal-substring, string-only semantics.

## Agent Handoff

After working this report, preserve the original finding body. Update line 2
`Status: ...` and the final `DEVANA-SUMMARY:` status. Use one of: `open`, `fixed`,
`invalid`, `stale`, `duplicate`, `wontfix`. Add dated notes below.

## Status Notes

- 2026-06-25: open by Devana. Initial report from static source inspection.
- 2026-06-27: fixed by aligning the SQL compiler to runtime `match` semantics (literal, case-insensitive, string-only). Replaced `LOWER(CAST(value AS TEXT)) LIKE ?` with `<json_type> = 'text' AND instr(LOWER(value), ?) > 0` (param lowercased once). `instr` keeps any `%`/`_` in the value literal (no longer SQL wildcards), and the `json_type = 'text'` guard excludes numbers/booleans the runtime rejects. Case-folding still uses SQL `LOWER` on one side and a JS-lowercased param, identical to the previous behavior (pre-existing ASCII-vs-Unicode folding nuance unchanged, out of scope). Updated the existing structural-SQL test's pinned `match` SQL/params and added a SQLite test: `$.title match "a_b"` matches only the literal `a_b` row (not `axb`), and `$.views match "50"` (number 1500) matches nothing — both cross-checked against `evaluatePathFilters`. Full suite: 47 pass.

DEVANA-KEY: src/structural.ts:229-233; src/paths.ts:146-147 | P2 | match-like-wildcard-divergence
DEVANA-SUMMARY: Status=fixed | P2 medium src/structural.ts:229-233; src/paths.ts:146-147 - SQL match now uses a json_type='text' guard + instr(LOWER(...)) literal substring, matching the runtime string-only literal semantics so %/_ are no longer wildcards and non-strings no longer match.
