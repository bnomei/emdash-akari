DEVANA-FINDING: v1
Priority: P2 | Confidence: medium | Security-sensitive: no | Status: fixed
Location: src/fts.ts:29,52 | Slug: fts-lowercase-operator-words

# Case-insensitive FTS operator regex routes ordinary words `and`/`or`/`not`/`near` into the raw-operator branch

## Finding

`escapeFts5Query` decides whether a query is a boolean/proximity expression with
`ftsOperatorsPattern = /\b(AND|OR|NOT|NEAR)\b/i` (`src/fts.ts:29`, used at `:52`).
The `/i` flag makes the test match the lowercase English words `and`, `or`, `not`,
`near` as well. FTS5 boolean operators are case-sensitive and recognized only when
uppercase, so for a natural-language query containing one of these common words the
function takes the operator branch and returns the string only double-quote-escaped
— skipping the prefix-term wrapping every other query receives.

## Violated Invariant Or Contract

The README ("Lexical queries are normalized before they reach FTS5") promises plain
terms are "split on whitespace, quoted, and treated as prefix terms" (`workers ai`
-> `"workers"* "ai"*`), and that only queries with *explicit* FTS operators (shown
uppercase) are passed through. A query of ordinary words must keep prefix-term
normalization.

## Oracle

- README lexical-normalization section and the uppercase examples (`workers OR d1`).
- `test/fts-plan.test.mjs:53,93` pin the prefix-term contract; `:95` pins the
  uppercase-operator passthrough. The lowercase-word case contradicts `:53`.

## Counterexample

`escapeFts5Query("salt and pepper")`:

- `ftsOperatorsPattern.test("salt and pepper")` is true (matches `\band\b` via `/i`).
- Returns the raw `"salt and pepper"` — no quoting, no `*` prefix wrapping.
- FTS5 reads three bare tokens `salt`, `and`, `pepper` (implicit AND), requiring an
  exact, non-prefix match on the literal token `and` and losing prefix matching the
  user gets for every other query. Intended output is `"salt"* "and"* "pepper"*`.

Any query containing `and`/`or`/`not`/`near` as a plain word (e.g. `samsung and
apple`, `notes`* would not trigger but `not done` would) is silently de-normalized.

## Why It Might Matter

A large class of natural-language lexical searches silently loses prefix matching
and is reinterpreted as a boolean expression, returning wrong or empty result sets.
The failure is silent (no error), so callers see degraded relevance, not a warning.
Reachable through the bundled engine (`engine.ts:155` -> `runLexicalSearch`) and
directly via the exported `escapeFts5Query`/`buildEmDashFts5Plan` API.

## Proof

Control-flow + contract mismatch: the `/i` flag (`fts.ts:29`) sends an operator-free
natural query down the operator branch (`fts.ts:52`), bypassing the prefix-wrapping
at `fts.ts:54-55`, contradicting the documented normalization and `test/fts-plan.test.mjs:53`.

## Counterevidence Checked

- `q` is validated only as trimmed length 1-500 (`schema.ts:126`); nothing uppercases
  or normalizes operator words upstream.
- The phrase branch (`fts.ts:46-49`) only triggers for fully `"`-quoted input, not
  here.
- Existing tests cover only uppercase `OR` and operator-free inputs, so the lowercase
  case is unguarded.

## Suggested Next Step

Drop the `/i` flag so only uppercase `AND`/`OR`/`NOT`/`NEAR` are treated as operators
(matching FTS5 and the documented examples), keeping prefix-term normalization for
ordinary words.

## Agent Handoff

After working this report, preserve the original finding body. Update line 2
`Status: ...` and the final `DEVANA-SUMMARY:` status. Use one of: `open`, `fixed`,
`invalid`, `stale`, `duplicate`, `wontfix`. Add dated notes below.

## Status Notes

- 2026-06-25: open by Devana. Initial report from static source inspection.
- 2026-06-27: fixed. Dropped the `/i` flag from `ftsOperatorsPattern` so only uppercase `AND`/`OR`/`NOT`/`NEAR` are treated as FTS5 boolean/proximity operators (FTS5 recognizes operators only in uppercase). Natural-language queries containing lowercase `and`/`or`/`not`/`near` now keep the documented prefix-term normalization instead of being routed through the raw-operator branch. Added regression tests: `escapeFts5Query("salt and pepper")` → `"salt"* "and"* "pepper"*` and `escapeFts5Query("not done")` → `"not"* "done"*`; the existing uppercase `workers OR d1` passthrough still holds. Note: EmDash's own search uses the same `/i` pattern, but this package's documented contract (uppercase examples in the README normalization section) is the authority here, and uppercase-only matches FTS5 semantics. Full suite: 48 pass.

DEVANA-KEY: src/fts.ts:29,52 | P2 | fts-lowercase-operator-words
DEVANA-SUMMARY: Status=fixed | P2 medium src/fts.ts:29,52 - Removed the /i flag so only uppercase AND/OR/NOT/NEAR are FTS operators; lowercase words keep prefix-term normalization, matching FTS5 and the documented behavior.
