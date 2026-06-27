DEVANA-FINDING: v1
Priority: P2 | Confidence: medium | Security-sensitive: no | Status: fixed
Location: src/schema.ts:6,26; src/structural.ts:140,261 | Slug: nested-wildcard-structural-throw

# Schema accepts multi-wildcard JSON paths that the structural compiler rejects with an unguarded throw

## Finding

`akariJsonPathSchema` validates a path against `jsonPathPattern`
(`src/schema.ts:6`), which permits any number of `[*]` wildcard segments
(`(?:...|\[\*\])*`). The runtime evaluator handles such paths, but the exported
structural SQL compiler does not: for a path with a wildcard after the first
wildcard, `compileStructuralFilter(s)` -> `toWildcardFilterGroup`
(`src/structural.ts:133-143`) calls `tokensToSqlitePath` on the suffix tokens,
which throws `"Nested wildcard paths are not supported by the single-join compiler
yet"` (`src/structural.ts:261`). So a schema-valid, parser-valid path crashes the
compiler at runtime.

## Violated Invariant Or Contract

A path that passes `akariJsonPathSchema` validation should either compile in every
supported backend or be rejected at validation time — not validate successfully and
then throw inside the public structural compiler. The bundled JS engine accepts the
same path, so the two backends disagree on acceptance.

## Oracle

- `src/schema.ts:6` regex permits unbounded `[*]` segments.
- `src/paths.ts:84-127,200-222` `evaluatePathFilters`/`readPathValues` evaluate
  nested wildcards without throwing (the JS `tokensToAkariPath` only sees the
  pre-first-wildcard prefix, which never contains a wildcard).
- Throw site `src/structural.ts:261`, reached from `:136` and `:140`.

## Counterexample

`path = "$.a[*].b[*]"`, op `exists`:

- Passes `akariJsonPathSchema` (matches `jsonPathPattern`) and `parseAkariJsonPath`.
- `discover` (JS engine) evaluates it fine via `evaluateWildcardFilterGroup`.
- `compileStructuralFilters([{ path: "$.a[*].b[*]", op: "exists" }])` -> the
  wildcard branch slices `afterWildcard = [ .b, [*] ]` -> `tokensToSqlitePath`
  hits the wildcard token and **throws**, aborting plan compilation for an input
  the schema already accepted.

## Why It Might Matter

A host that compiles validated path filters to D1/SQLite (the documented structural
capability) gets an uncaught exception — a failed request / 500 — for an input the
validation layer green-lit and that the JS `discover` path serves successfully.
Reachable for any integrator using the exported `compileStructuralFilter(s)` with a
two-wildcard path.

## Proof

Cross-entry mismatch: schema/JS-engine accept `$.a[*].b[*]`; the exported structural
compiler throws on it. Control-flow trace: `:136/:140` -> `tokensToSqlitePath`
(`:257-263`) -> `throw` at `:261`.

## Counterevidence Checked

- The bundled `discover`/`resolve` routes use the JS evaluator (`engine.ts:267`),
  not the structural compiler, so the in-product routes do not hit the throw — the
  defect is scoped to the exported SQL-compiler API, which the README presents as a
  supported structural backend.
- The throw is an explicit "not supported yet" guard, but the schema does not forbid
  the input, so it surfaces as a runtime crash rather than a validation rejection.

## Suggested Next Step

Either constrain `jsonPathPattern` to at most one `[*]` segment (reject multi-
wildcard at validation), or have the structural compiler degrade to nested
`json_each` joins / sidecar facts for multi-wildcard paths.

## Agent Handoff

After working this report, preserve the original finding body. Update line 2
`Status: ...` and the final `DEVANA-SUMMARY:` status. Use one of: `open`, `fixed`,
`invalid`, `stale`, `duplicate`, `wontfix`. Add dated notes below.

## Status Notes

- 2026-06-25: open by Devana. Initial report from static source inspection.
- 2026-06-27: fixed by documenting the contract and making the failure explicit (not by constraining the schema). Rejected the "constrain jsonPathPattern to one wildcard" option because the JS evaluator genuinely supports nested wildcards — `readPathValues` (paths.ts:219-221) recurses through wildcard tokens and `evaluateWildcardFilterGroup` calls it with the post-first-wildcard suffix — so tightening the shared schema would remove a working `discover`/`resolve` capability. Implementing nested `json_each` joins in the single-join compiler is a sizable feature out of scope here. Instead: `toWildcardFilterGroup` now counts wildcard tokens and throws an early, descriptive, catchable error ("Structural SQL compiler supports a single [*] wildcard per path; \"<path>\" has N. Evaluate multi-wildcard paths with the discover/resolve engine or materialized facts instead.") rather than the opaque deep `tokensToSqlitePath` throw. Added a JSDoc on `compileStructuralFilters` and a README Path Syntax note stating the single-`[*]`-per-path limit of the exported SQL compiler vs. the multi-wildcard support of the engine/facts. Added a test: parser + `evaluatePathFilters` handle `$.a[*].b[*]`, while `compileStructuralFilters` throws the descriptive error. Full suite: 49 pass.

DEVANA-KEY: src/schema.ts:6,26; src/structural.ts:140,261 | P2 | nested-wildcard-structural-throw
DEVANA-SUMMARY: Status=fixed | P2 medium src/schema.ts:6,26; src/structural.ts:140,261 - Documented the exported SQL compiler's single-[*]-per-path limit and made it throw an early descriptive/catchable error; the JS engine's multi-wildcard support is preserved (schema intentionally stays permissive).
