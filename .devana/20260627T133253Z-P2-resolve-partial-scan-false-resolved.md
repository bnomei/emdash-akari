DEVANA-FINDING: v1
DEVANA-STATE: fixed | P2 | high | security=no
DEVANA-KEY: src/engine.ts:227-230,96-133 | resolve-partial-scan-false-resolved

# Partial collection-scan failure yields a falsely "resolved" result

## Finding

`scanContent` wraps each collection's `content.list` in a try/catch that, on failure,
pushes a warning and continues (`engine.ts:227-230`). The candidate set returned to
`runAkariQuery` is therefore silently incomplete when one of several collections errors.
`resolveAkariQuery` (`engine.ts:96-133`) computes `status: "resolved"` purely from
`response.items` and the top-two score margin; it never inspects `response.warnings`. So
when the collection that held the true best match fails to scan, resolve can return
`status: "resolved"` for an inferior item from a surviving collection, while the failure
is only mentioned in an advisory `warnings` entry.

## Violated Invariant Or Contract

`status: "resolved"` is the authoritative signal that a confident, unambiguous winner was
chosen over the full requested corpus. A programmatic caller branches on `status`, not on
prose warnings. Returning `resolved` over a partial corpus breaks that contract.

## Oracle

Caller/callee contract: `AkariResolveResponse` (`types.ts:82-94`) makes `status` the
discriminant. `resolveAkariQuery` chooses `resolved`/`ambiguous`/`not_found` without
reference to whether a requested data source failed.

## Counterexample

`{ "collections": ["a","b"], "mode": "structural", ... }`. `content.list("a")` throws
(missing table / transient D1 error). `scanContent` catches it, pushes
`"Content scan failed for a: ..."`, and returns only `b`'s single mediocre item.
`resolveAkariQuery`: `first = b-item`, `second = undefined`, the margin test at
`engine.ts:116` is skipped, returns `{ status: "resolved", item: <b-item> }`. The genuine
best match in `a` is gone; the caller acts on the wrong entity as if authoritatively
resolved.

## Why It Might Matter

`resolve` exists to give agents a single trustworthy target. A transient failure of one
collection silently converts an ambiguous/incomplete situation into a confident wrong
answer — a correctness bug with downstream action impact.

## Proof

Producer/consumer mismatch: partial producer (`scanContent`, swallows per-collection
errors at 227-230) feeds a consumer (`resolveAkariQuery`, 96-133) that encodes confidence
in `status` without consulting the failure warnings the producer emitted.

## Counterevidence Checked

Strongest counter: warnings are propagated (`resolveAkariQuery` returns
`response.warnings`), so a caller that reads them can detect degradation. But `status` is
the documented decision field and is unaffected; no test asserts resolve downgrades status
on scan failure, and resolve never reads warnings. So degradation is advisory only, not
reflected in the contract field. (Lexical-FTS substitution is excluded here as
design-surfaced via `explain`; this finding is specifically about content-scan collection
failures changing `resolve` confidence.)

## Suggested Next Step

When any requested collection failed to scan, `resolveAkariQuery` should refuse to return
`resolved` (e.g. downgrade to `ambiguous`/`not_found`, or add a structured `degraded`
flag) so callers can distinguish a complete-corpus resolution from a partial one.

## Agent Handoff

After working this report, preserve the original finding body. Update line 2
`DEVANA-STATE: ...` and the final `DEVANA-SUMMARY:` prefix.

## Status Notes

- 2026-06-27: open by Devana. Static producer/consumer trace, scanContent → resolveAkariQuery.
- 2026-06-27: fixed. `resolveAkariQuery` now consults scan-failure warnings before claiming confidence. The per-collection failure warning uses a shared `contentScanFailurePrefix` constant ("Content scan failed for "); resolve computes `degraded = warnings.some(w => w.startsWith(prefix))`. When degraded it refuses `resolved` and returns `ambiguous` (with the surviving candidates as alternatives and an explanatory warning), so a status-branching caller cannot act on an incomplete-corpus result as authoritative. Added an optional `degraded?: boolean` field to `AkariResolveResponse` (both variants) and set it on the not_found/ambiguous branches when a scan failed, so callers can distinguish complete vs partial resolutions. Added a regression test: collections `["a","b"]` where `content.list("a")` throws and `b` has one item → status is not `resolved`, `degraded === true`, and the scan-failure warning is present. Full suite: 52 pass.

DEVANA-KEY: src/engine.ts:227-230,96-133 | resolve-partial-scan-false-resolved
DEVANA-SUMMARY: fixed | P2 | high | resolveAkariQuery now detects content-scan failures via a stable warning prefix, refuses to return "resolved" over an incomplete corpus (downgrades to "ambiguous"), and exposes a degraded flag on the response.
