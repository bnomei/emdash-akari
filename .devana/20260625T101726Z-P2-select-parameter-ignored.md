DEVANA-FINDING: v1
Priority: P2 | Confidence: high | Security-sensitive: no | Status: fixed
Location: src/schema.ts:131; src/engine.ts:82-93 | Slug: select-parameter-ignored

# Validated select parameter does not project response fields

## Finding

`akariQueryInputSchema` validates `select` with allowed field names, and README examples show reduced payloads using `select: ["identity", "score", "snippet"]`. The engine returns full `AkariResult` objects with no projection step. `input.select` is never referenced outside schema validation.

## Violated Invariant Or Contract

When callers specify `select`, response items should include only the requested fields (with `identity` expanded per selected subfields as documented).

## Oracle

README discover example uses `"select": ["identity", "score", "snippet"]` and shows a reduced item shape. `akariSelectFieldSchema` enumerates allowed fields.

## Counterexample

`{ "mode": "structural", "collections": ["pages"], "select": ["identity", "score"], "paths": [...] }` validates. Response items still include `snippet`, `matchedPaths`, `updatedAt`, and other fields.

## Why It Might Matter

Agents expecting smaller payloads or field-level privacy guarantees receive full result objects, increasing data exposure and breaking clients that assume undocumented fields are absent.

## Proof

**Contract mismatch:** Schema accepts `select`; `runAkariQuery` return object passes through full `items` from fusion without filtering keys.

## Counterevidence Checked

CLI and route handlers return engine output unchanged. No projection utility exists in `src/`. Contract tests cover input validation only.

## Suggested Next Step

Add a projection helper applied to `items` (and resolve `item`/`alternatives`) before returning, keyed on `input.select`.

## Agent Handoff

After working this report, preserve the original finding body. Update line 2 `Status: ...` and the final `DEVANA-SUMMARY:` status. Use one of: `open`, `fixed`, `invalid`, `stale`, `duplicate`, `wontfix`. Add dated notes below with the evidence checked.

## Status Notes

- 2026-06-25: open by Devana. Initial report written from static source inspection.
- 2026-06-27: fixed. Added a `projectResult` helper and applied `input.select`. In `runAkariQuery`, items are projected after fusion/sort/limit (facets are still computed from the unprojected results so projection never hides facet source values). `projectResult` treats `identity` as the whole identity object, projects a reduced identity when only identity subfields (collection/id/slug/locale/status/title/url) are selected, and copies the remaining names as top-level result keys (score/snippet/matchedFields/matchedPaths/updatedAt/publishedAt). Resolve strips `select` (and `sort`) from its internal query so the score-based ambiguity decision sees full results, then projects the returned `item`/`alternatives`. Added regression tests for discover projection (full identity + score), reduced-identity projection (`["title","score"]` → identity has only `title`), and resolve projection that still detects ambiguity. Full suite: 37 pass.

DEVANA-KEY: src/schema.ts:131; src/engine.ts:82-93 | P2 | select-parameter-ignored
DEVANA-SUMMARY: Status=fixed | P2 high src/schema.ts:131; src/engine.ts:82-93 - runAkariQuery/resolve now project response items to input.select via projectResult; resolve projects after its ambiguity decision so score is never stripped prematurely.