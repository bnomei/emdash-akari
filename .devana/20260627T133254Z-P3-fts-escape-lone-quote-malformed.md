DEVANA-FINDING: v1
DEVANA-STATE: fixed | P3 | medium | security=no
DEVANA-KEY: src/fts.ts:42-56 | fts-escape-lone-quote-malformed

# escapeFts5Query emits a malformed MATCH expression for a lone or empty double-quote query

## Finding

`escapeFts5Query` (`fts.ts:42-56`) does not produce a valid FTS5 MATCH string for inputs
that consist of unbalanced or empty quotes, yet such inputs pass the `q` schema
(`schema.ts:126`, `z.string().trim().min(1)`). The phrase branch requires
`length >= 2` (`fts.ts:46`), so a single `"` skips it; `escaped` becomes `""`, no
operators match, and the term mapping at `fts.ts:54-55` yields `""""*` (an empty/one-quote
phrase followed by the prefix operator `*`). `buildEmDashFts5Plan` only null-guards an
*empty-string* result (`fts.ts:60`), so this non-empty malformed string flows into
`MATCH ?` (`fts.ts:88`).

## Violated Invariant Or Contract

Every query that passes the `q` schema must compile to a syntactically valid FTS5 MATCH
expression (or be short-circuited to `null`). `escapeFts5Query` is the canonical escaper
exported for hosts to build FTS SQL (`index.ts:67`), so its output is expected to be safe
to bind to MATCH.

## Oracle

Schema/runtime mismatch: `q` is `trim().min(1)`, so `"` (length 1) is a valid query; the
function's own purpose (escaping arbitrary user text into a valid MATCH string) is the
contract.

## Counterexample

- `q = "` → trimmed `"`, length 1, phrase branch skipped, `escaped = ""`, terms = `['""']`,
  output `""""*` — an empty phrase with a trailing prefix operator (an FTS5 syntax error in
  most builds).
- `q = ""` → phrase branch taken, `inner = ""`, returns `""` — an empty phrase passed to
  MATCH.
- `q = " "` (after schema trim this is rejected, but a host calling `escapeFts5Query`
  directly with `" "` gets `" "`).

## Why It Might Matter

A host wiring `buildEmDashFts5Plan` to user input gets a runtime SQLite/FTS5 syntax error
(or a silently degenerate match) for a benign single-character query, with no `null`
short-circuit to fall back on. Affects availability of the search path for that request.

## Proof

Counterexample value + control-flow: input `"` → `fts.ts:46` false (length 1) →
`fts.ts:51` `escaped = '""'` → `fts.ts:52` operators absent → `fts.ts:54-55`
`['""'].map(t => '"'+t+'"*')` = `""""*` → `fts.ts:60` non-empty so not nulled → bound to
`MATCH ?` at `fts.ts:88`.

## Why It Might Matter / Confidence

Confidence medium: the exact runtime failure (hard FTS5 syntax error vs. empty match)
could not be confirmed without executing SQLite. The malformed output itself is
deterministic and source-visible; the downstream failure mode is environment-dependent.

## Counterevidence Checked

The canonical engine query path uses the injected emdash `search()` provider, not
`buildEmDashFts5Plan`/`escapeFts5Query` directly, so the live route may never hit this.
But these are public exports specifically for hosts to build FTS SQL, and the `q` schema
admits the triggering inputs, so it is reachable within the function's documented input
domain. Distinct from `fts-lowercase-operator-words` (which concerns operator-word
handling, not empty/unbalanced quotes).

## Suggested Next Step

After building the term list, drop empty phrases and treat an all-empty result the same as
the empty-query case (return `""`, letting `buildEmDashFts5Plan` return `null`). Strip
unbalanced leading/trailing quotes before tokenizing.

## Agent Handoff

After working this report, preserve the original finding body. Update line 2
`DEVANA-STATE: ...` and the final `DEVANA-SUMMARY:` prefix.

## Status Notes

- 2026-06-27: open by Devana. Static trace of escapeFts5Query for quote-edge inputs.
- 2026-06-27: fixed per the suggested next step. Two changes in `escapeFts5Query`: (1) the balanced-phrase branch now trims the inner phrase and returns `""` when it is empty/whitespace-only (so `'""'` and `'"   "'` collapse to no query instead of emitting an empty phrase); (2) the prefix-term branch now splits the raw trimmed query, drops any term with no characters other than quotes (so a lone `"` no longer becomes `""""*`), escapes internal quotes per term, and returns `""` when nothing survives. An all-empty result flows through `buildEmDashFts5Plan`'s existing `if (!ftsQuery) return null` guard. Verified existing escaping contracts are unchanged (`workers ai` → `"workers"* "ai"*`, `workers "ai"` → `"workers"* """ai"""*`, phrase/operator passthrough). Added tests: `'"'`, `'""'`, `'"   "'` → `""`, and `buildEmDashFts5Plan(query: '"')` → null. Full suite: 52 pass.

DEVANA-KEY: src/fts.ts:42-56 | fts-escape-lone-quote-malformed
DEVANA-SUMMARY: fixed | P3 | medium | escapeFts5Query now drops quote-only terms and empty phrases, returning "" (null-guarded by buildEmDashFts5Plan) instead of malformed MATCH strings like `""""*`.
