DEVANA-FINDING: v1
Priority: P2 | Confidence: high | Security-sensitive: no | Status: fixed
Location: src/engine.ts:208-224 | Slug: fetchlimit-page-overshoot

# Content scan fetchLimit is not enforced within a list page

## Finding

`scanContent` computes `remaining = fetchLimit - scanned` and passes `limit: Math.min(remaining, 100)` to `content.list`, but the inner loop processes every item in `response.items` without breaking when `scanned >= fetchLimit`. If the content provider returns more rows than requested, the scan can exceed `fetchLimit` by up to one page worth of rows.

## Violated Invariant Or Contract

`fetchLimit` (default `max(input.limit * 5, 50)`) should cap how many content rows are scanned per collection per request.

## Oracle

Warning at line 226 (`Content scan reached fetchLimit`) implies `fetchLimit` is a hard scan budget. `options.fetchLimit` is documented as an engine tuning option.

## Counterexample

`fetchLimit: 5`, first `content.list` call with `limit: 5` returns 20 items (provider ignores limit). Loop increments `scanned` to 20, evaluates up to 20 items, and may push candidates beyond the intended cap before the outer loop exits.

## Why It Might Matter

Excess scanning changes which candidates enter rank fusion, increases latency against D1/content APIs, and makes the fetchLimit warning misleading when overshoot already occurred.

## Proof

**Control-flow trace:** `for (const item of response.items)` has no `if (scanned >= fetchLimit) break`. Outer `do/while` only prevents starting a new page when `scanned >= fetchLimit`.

**Counterexample value:** Provider returns 20 items when `limit: 5` was requested.

## Counterevidence Checked

Pagination test mock returns one item per page, honoring `limit`, so overshoot is not exercised. Warning fires on `cursor` presence, not on actual scan count enforcement.

## Suggested Next Step

Break the inner loop when `scanned >= fetchLimit`, and optionally stop evaluating candidates once the cap is reached.

## Agent Handoff

After working this report, preserve the original finding body. Update line 2 `Status: ...` and the final `DEVANA-SUMMARY:` status. Use one of: `open`, `fixed`, `invalid`, `stale`, `duplicate`, `wontfix`. Add dated notes below with the evidence checked.

## Status Notes

- 2026-06-25: open by Devana. Initial report written from static source inspection.
- 2026-06-27: fixed. The inner `for (const item of response.items)` loop now breaks when `scanned >= fetchLimit`, so a provider that returns more rows than the requested page limit can no longer push the scan past the budget. Added a `truncated` flag so the "Content scan reached fetchLimit" warning fires accurately — both when more pages remain (cursor set) and when the last page over-returned past the cap (previously the warning only checked `cursor`, missing the over-return-with-hasMore:false case). Added a regression test: a provider returns a 10-row page ignoring `limit`, `fetchLimit: 3`, `input.limit: 20` → exactly 3 candidates and a fetchLimit warning. Existing pagination test (one row per page) still passes. Full suite: 44 pass.

DEVANA-KEY: src/engine.ts:208-224 | P2 | fetchlimit-page-overshoot
DEVANA-SUMMARY: Status=fixed | P2 high src/engine.ts:208-224 - Content scan now breaks the inner page loop at fetchLimit (hard cap) and warns accurately via a truncated flag covering provider over-return.