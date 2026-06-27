DEVANA-FINDING: v1
Priority: P1 | Confidence: high | Security-sensitive: no | Status: fixed
Location: src/filter.ts:34-36 | Slug: metadata-ne-nonscalar

# Metadata $ne and $nin match non-scalar field values vacuously

## Finding

`matchesMetadataFilter` implements `$ne` as `!sameScalar(value, filter.$ne)` and `$nin` as `filter.$nin.every((item) => !sameScalar(value, item))` without requiring `isAkariScalar(value)` first. When the stored field is an object or array, `sameScalar` fails and negation returns true, so the entry is treated as matching the inequality filter.

## Violated Invariant Or Contract

`$ne` and `$nin` should mean the field's scalar value differs from the constraint. Non-scalar stored values should not satisfy inequality filters unless explicitly documented otherwise.

## Oracle

Path-layer `ne` requires `isAkariScalar(value)` before negation (`paths.ts:139`). README filter examples use scalar metadata fields (`status`, `locale`, `updatedAt`).

## Counterexample

`filter: { "seo": { "$ne": "Workers" } }` against metadata `{ seo: { title: "Workers" } }`. `sameScalar({ title: "Workers" }, "Workers")` is false; `!sameScalar` is true; entry passes and is returned despite nested title matching the excluded string semantically.

`filter: { "tags": { "$nin": ["featured"] } }` against `{ tags: ["featured", "news"] }` (array value): `sameScalar` fails for each list element comparison path; `$nin` returns true and the entry is included.

## Why It Might Matter

Metadata filters intended to exclude structured or multi-value fields can silently include entries agents assumed were filtered out, affecting migration scans and publish-status workflows.

## Proof

**Counterexample value:** Object at `seo` with `$ne: "Workers"` → `matchesMetadataFilter` returns true.

**Control-flow trace:** `$ne` branch at line 34 never checks scalar type before negating `sameScalar` result.

## Counterevidence Checked

Direct scalar equality (`!isRecord(filter)`) requires `sameScalar` success. `$eq` and `$in` require successful `sameScalar`. Path evaluator guards `ne`/`nin` with `isAkariScalar`. No test covers `$ne` on object-valued metadata fields.

## Suggested Next Step

Require `isAkariScalar(value)` for `$ne` and `$nin`, matching path-layer semantics, or document and implement explicit rules for object/array fields.

## Agent Handoff

After working this report, preserve the original finding body. Update line 2 `Status: ...` and the final `DEVANA-SUMMARY:` status. Use one of: `open`, `fixed`, `invalid`, `stale`, `duplicate`, `wontfix`. Add dated notes below with the evidence checked.

## Status Notes

- 2026-06-25: open by Devana. Initial report written from static source inspection.
- 2026-06-27: fixed. Confirmed `matchesMetadataFilter` negated `sameScalar` for `$ne`/`$nin` without a scalar guard, so object/array fields (and missing fields) vacuously satisfied inequality filters. Added the `isAkariScalar(value)` guard to both branches, exactly mirroring the path layer (`paths.ts:139,143`). Object `seo` no longer passes `{$ne:"Workers"}`; array `tags` no longer passes `{$nin:["featured"]}`; scalar inequality still works; a missing field now fails `$ne` (consistent with path semantics). Added a regression test in engine.test.mjs. Full suite: 29 pass.

DEVANA-KEY: src/filter.ts:34-36 | P1 | metadata-ne-nonscalar
DEVANA-SUMMARY: Status=fixed | P1 high src/filter.ts:34-36 - Metadata $ne/$nin now require isAkariScalar(value) before negating, matching path-layer semantics so non-scalar fields no longer match vacuously.