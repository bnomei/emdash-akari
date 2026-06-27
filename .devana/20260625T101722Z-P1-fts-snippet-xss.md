DEVANA-FINDING: v1
Priority: P1 | Confidence: high | Security-sensitive: yes | Status: fixed
Location: src/fts.ts:84,109-110; src/engine.ts:179-180 | Slug: fts-snippet-xss

# Lexical FTS snippets are returned without HTML escaping

## Finding

FTS snippets come from SQLite `snippet()` with raw indexed document text wrapped in `<mark>` tags (`fts.ts:84`). `mapFtsRows` and `runLexicalSearch` return these snippets unchanged. Content-scan snippets pass through `escapeHtml` in `buildSnippet` (`engine.ts:462-471`). Any HTML or script in indexed content is forwarded to discover/resolve consumers.

## Violated Invariant Or Contract

Snippet output should not introduce injectable markup beyond the intended `<mark>` highlight wrappers. Content and lexical paths should apply equivalent escaping before returning snippets to admin or agent clients.

## Oracle

`buildSnippet` escapes `&`, `<`, `>`, quotes before applying `<mark>` replacements. README shows snippets with `<mark>` only around matched terms.

## Counterexample

Indexed page body contains `<img src=x onerror=alert(1)>`. FTS `snippet()` returns that substring with `<mark>` wrappers. Lexical discover returns the raw snippet; a dashboard or agent UI that renders snippets as HTML executes the payload.

## Why It Might Matter

Stored XSS in admin-authenticated discover/resolve surfaces when snippets are rendered as HTML in EmDash admin UI, agent tooling, or MCP wrappers.

## Proof

**Dataflow trace:** indexed content → FTS `snippet()` → `mapFtsRows` / `runLexicalSearch` → response `items[].snippet` without `escapeHtml`.

**Cross-entry mismatch:** Content leg uses `escapeHtml`; FTS leg does not.

## Counterevidence Checked

Consumers may treat snippets as plain text; that is not enforced in the response contract. Content-scan path demonstrates the intended escaping behavior. Private route auth limits exposure to admin-scoped callers but does not neutralize stored markup.

## Suggested Next Step

Run FTS snippets through the same `escapeHtml` helper used by `buildSnippet` before returning them, preserving `<mark>` tags after escaping document text.

## Agent Handoff

After working this report, preserve the original finding body. Update line 2 `Status: ...` and the final `DEVANA-SUMMARY:` status. Use one of: `open`, `fixed`, `invalid`, `stale`, `duplicate`, `wontfix`. Add dated notes below with the evidence checked.

## Status Notes

- 2026-06-25: open by Devana. Initial report written from static source inspection.
- 2026-06-27: fixed. `mapFtsRows` (the exported path that maps rows from `buildEmDashFts5Plan`'s raw SQLite `snippet()` output) now runs each snippet through a new `escapeFtsSnippet`: it escapes all HTML metacharacters and then restores only the literal `<mark>`/`</mark>` highlight markers, mirroring the content-scan `buildSnippet` (escape-then-mark). An indexed `<img src=x onerror=alert(1)>` payload now renders as `&lt;img ...&gt;` with `<mark>` preserved. Added a regression test in fts-plan.test.mjs (payload placed in the title column, which is the column `snippet()` highlights). The other listed location, engine.ts:179-180 (`runLexicalSearch`), was deliberately NOT double-escaped: it consumes snippets from the `AkariLexicalSearchProvider`, whose EmDash `search()` implementation already HTML-escapes server-side (documented on `SearchResult.snippet`); escaping again would corrupt those snippets (`&amp;lt;`). Custom providers are expected to honor that same contract. Full suite: 31 pass.

DEVANA-KEY: src/fts.ts:84,109-110; src/engine.ts:179-180 | P1 | fts-snippet-xss
DEVANA-SUMMARY: Status=fixed | P1 high src/fts.ts:84,109-110; src/engine.ts:179-180 - mapFtsRows now HTML-escapes raw SQLite snippets while preserving <mark>; the engine path relies on the provider's existing escaping contract (EmDash search escapes server-side) to avoid double-escaping.