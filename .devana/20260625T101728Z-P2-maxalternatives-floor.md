DEVANA-FINDING: v1
Priority: P2 | Confidence: high | Security-sensitive: no | Status: fixed
Location: src/engine.ts:114-119; src/schema.ts:142 | Slug: maxalternatives-floor

# Ambiguous resolve ignores maxAlternatives below two

## Finding

`resolveAkariQuery` uses `response.items.slice(0, Math.max(maxAlternatives, 2))` on the ambiguous branch. Schema allows `maxAlternatives` from 0 to 10. When callers pass `0` or `1`, ambiguous responses still return at least two alternatives.

## Violated Invariant Or Contract

`maxAlternatives` should cap the number of alternatives returned on ambiguous resolve responses.

## Oracle

`akariResolveInputSchema` defines `maxAlternatives: z.number().int().min(0).max(10).optional()`. Resolved branch uses `slice(1, 1 + maxAlternatives)` without a floor (line 130).

## Counterexample

`resolveAkariQuery({ maxAlternatives: 0, ... })` with top two candidates within `ambiguityMargin` returns `alternatives` length 2 instead of 0.

## Why It Might Matter

Automation that sets `maxAlternatives: 0` to suppress alternatives on ambiguity still receives multiple candidates, violating caller contracts and potentially triggering unwanted disambiguation flows.

## Proof

**Counterexample value:** `maxAlternatives: 0` → `Math.max(0, 2) === 2` → two alternatives returned.

**Control-flow trace:** Ambiguous branch only; resolved branch honors the cap.

## Counterevidence Checked

Ambiguity test in `engine.test.mjs` uses `maxAlternatives: 2`, which masks the floor. README documents `maxAlternatives: 3` as typical usage.

## Suggested Next Step

Remove the `Math.max(..., 2)` floor or document a minimum of two for ambiguous responses and tighten the schema.

## Agent Handoff

After working this report, preserve the original finding body. Update line 2 `Status: ...` and the final `DEVANA-SUMMARY:` status. Use one of: `open`, `fixed`, `invalid`, `stale`, `duplicate`, `wontfix`. Add dated notes below with the evidence checked.

## Status Notes

- 2026-06-25: open by Devana. Initial report written from static source inspection.
- 2026-06-27: fixed. The ambiguous branch used `slice(0, Math.max(maxAlternatives, 2))`, forcing at least two alternatives even when callers passed `maxAlternatives: 0` or `1`. Changed to `slice(0, maxAlternatives)` so the cap is honored exactly (the ambiguous branch still starts at index 0 since there is no single resolved item to exclude). Added a regression test: `maxAlternatives: 0` → 0 alternatives, `maxAlternatives: 1` → 1 alternative, both still `status: ambiguous`. Existing tests using `maxAlternatives: 2` still pass. Full suite: 39 pass.

DEVANA-KEY: src/engine.ts:114-119; src/schema.ts:142 | P2 | maxalternatives-floor
DEVANA-SUMMARY: Status=fixed | P2 high src/engine.ts:114-119; src/schema.ts:142 - Ambiguous resolve now slices to exactly maxAlternatives (no Math.max(...,2) floor), so 0/1 are honored.