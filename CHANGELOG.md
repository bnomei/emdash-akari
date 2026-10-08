# Changelog

## 0.2.0 - 2026-10-08

- Updated compatibility to EmDash 1.2 (tested against 1.2.0) and Node.js 22.16 or newer.
- Synchronized the native plugin version with the package version.
- Fixed session-authenticated config calls to send the CSRF header on GET.
- Fixed lexical-only pagination dropping hits when forwarding EmDash search cursors.
- Documented EmDash 1.2 private-route permissions and session CSRF requirements.
- Added real EmDash SQLite/runtime coverage for discovery, resolution, search pagination, and private-route validation and authorization.

## 0.1.3 - 2026-06-29

- Fixed lexical-only status-filtered searches so provider-filtered hits are not dropped when content access is unavailable.
- Fixed facts sidecar reindexing so configured path templates that now emit no facts clear stale rows.

## 0.1.2 - 2026-06-18

- Bumped plugin metadata for the next Akari patch release.

## 0.1.1

- Fixed CI coverage thresholds so the documented coverage command passes.
- Fixed the FTS lexical semantics test expectation for embedded quotes.
- Added CI coverage for the minimum supported Node.js runtime.
- Added a release preflight for already-published npm versions.
- Skipped FTS5-only SQLite smoke tests when a Node build lacks the FTS5 extension.

## 0.1.0

- Initial Akari package scaffold.
