# @bnomei/emdash-akari

[![npm version](https://img.shields.io/npm/v/@bnomei/emdash-akari.svg)](https://www.npmjs.com/package/@bnomei/emdash-akari)
[![npm downloads](https://img.shields.io/npm/dm/@bnomei/emdash-akari.svg)](https://www.npmjs.com/package/@bnomei/emdash-akari)
[![license](https://img.shields.io/npm/l/@bnomei/emdash-akari.svg)](https://www.npmjs.com/package/@bnomei/emdash-akari)
[![types](https://img.shields.io/badge/types-included-blue.svg)](./package.json)
[![source](https://img.shields.io/badge/source-GitHub-181717.svg?logo=github)](https://github.com/bnomei/emdash-akari)

Private content discovery and identity resolution for EmDash.

Akari means light. In EmDash, Akari is the private lookup surface for finding
the canonical content entry behind a query, nested content condition, dashboard
task, or agent task. It is not the public site search endpoint and it does not
own a separate search infrastructure.

Akari's primary surface is the `akari` binary. The package also registers
private EmDash plugin routes because the binary needs a protected way to talk to
the EmDash app, but direct HTTP integration is not the main use case.

Akari complements the EmDash
[MCP server](https://docs.emdashcms.com/reference/mcp-server/). The MCP server
is a broad content administration surface with tools such as `search`,
`content_list`, `content_get`, schema, media, taxonomy, menu, revision, and
settings tools. Akari is narrower: it answers lookup and identity questions in
one request, especially when the answer depends on nested JSON structure,
evidence paths, or whether a match is clear enough to automate.

Akari is useful when you need to:

- find the canonical content entry for an intent before editing it,
- check whether a topic already exists before an agent creates another page,
- find entries that contain a block type, embed, external URL, or nested JSON
  value,
- inspect which content would be affected by a schema, layout, or block
  migration,
- resolve one target only when the top match is not ambiguous.

## Quick Start

Install the package:

```sh
npm install @bnomei/emdash-akari
```

Register the native plugin in `astro.config.mjs`:

```js
import emdash from "emdash/astro";
import { akariPlugin } from "@bnomei/emdash-akari";

export default {
  integrations: [
    emdash({
      plugins: [akariPlugin()],
    }),
  ],
};
```

The normal connection path is:

1. Register `akariPlugin()` in the EmDash Astro app.
2. Run the EmDash dev server.
3. Set the EmDash app URL and token for the binary.
4. Smoke-test the connection with `akari config`.
5. Use `akari discover` or `akari resolve`.
6. Optionally wrap the same binary in a local MCP tool.

Set the EmDash app root and token:

```sh
export EMDASH_BASE_URL=http://localhost:4321
export EMDASH_TOKEN="..."
```

`EMDASH_BASE_URL` is the Astro/EmDash app root. The CLI appends the plugin path
itself. `EMDASH_TOKEN` should be an EmDash PAT or OAuth access token with the
`admin` scope, issued to an Admin user.

Smoke-test the private route from a consuming app:

```sh
npm exec -- akari config --pretty
```

Discover candidates:

```sh
npm exec -- akari discover --pretty --data '{
  "q": "Workers AI inference guide",
  "collections": ["pages", "products"],
  "filter": { "status": "published" },
  "limit": 10
}'
```

Resolve one target before an automated edit:

```sh
npm exec -- akari resolve --pretty --data '{
  "q": "main D1 product guide",
  "collections": ["products"],
  "filter": { "status": "published" },
  "maxAlternatives": 3
}'
```

`discover` returns ranked candidates. `resolve` returns one identity when the
top candidate is clear enough. `config` returns the route capabilities.

## Akari vs MCP

EmDash MCP already has a `search` tool for indexed full-text search. That is the
right surface when an agent wants ordinary search results. Akari is for richer
lookup questions where the caller needs an identity, evidence, or structural
filtering without chaining several MCP calls and doing client-side inspection.

MCP search returns ordinary indexed hits:

```json
{
  "items": [
    {
      "collection": "pages",
      "id": "page_workers_ai",
      "slug": "workers-ai",
      "locale": "en",
      "title": "Workers AI",
      "snippet": "Build and deploy <mark>Workers AI</mark> inference...",
      "score": 0.5
    }
  ]
}
```

That is enough for search. The MCP score is the raw EmDash/FTS relevance score
for that search call. Akari keeps the lookup private and adds identity
resolution, structural path filters, facets, and ambiguity handling. Its score
is normalized per response after rank fusion, so it is useful for ordering and
ambiguity checks, not for numeric comparison with MCP search.

Find the likely canonical entry for a topic:

```sh
npm exec -- akari discover --pretty --data '{
  "q": "Workers AI inference guide",
  "collections": ["pages", "products"],
  "filter": { "status": "published" },
  "select": ["identity", "score", "snippet"],
  "limit": 3
}'
```

Shape of the answer:

```json
{
  "items": [
    {
      "identity": {
        "collection": "pages",
        "id": "page_workers_ai",
        "slug": "workers-ai",
        "title": "Workers AI"
      },
      "score": 1,
      "snippet": "Build and deploy <mark>Workers AI</mark> inference..."
    }
  ]
}
```

With MCP alone, an agent would usually call `search`, inspect results, and often
follow up with `content_get` before it knows which entry is safe to edit.

Find nested content structure:

```sh
npm exec -- akari discover --pretty --data '{
  "mode": "structural",
  "collections": ["pages"],
  "paths": [
    { "path": "$.blocks[*].type", "op": "eq", "value": "embed" },
    { "path": "$.blocks[*].url", "op": "contains", "value": "developers.cloudflare.com" }
  ],
  "facets": ["collection", "$.blocks[*].type"],
  "limit": 10
}'
```

Shape of the answer:

```json
{
  "items": [
    {
      "identity": {
        "collection": "pages",
        "id": "page_developer_platform",
        "title": "Developer Platform"
      },
      "matchedPaths": ["$.blocks[3].type", "$.blocks[3].url"]
    }
  ],
  "facets": [{ "key": "$.blocks[*].type", "buckets": [{ "value": "embed", "count": 1 }] }]
}
```

With MCP alone, this kind of question requires listing or searching candidates,
fetching their full content, walking nested block JSON, keeping track of the
matching paths, and then grouping the evidence manually.

## Command Input

`discover` returns ranked candidates, snippets, facets, and evidence.

`resolve` accepts the same search input without facets and returns one stable
identity, an ambiguous result, or a missing result.

The validated query shape is:

```json
{
  "q": "Workers AI inference guide",
  "mode": "lexical",
  "collections": ["pages", "products", "posts"],
  "filter": {
    "status": "published",
    "locale": "en"
  },
  "paths": [
    { "path": "$.blocks[*].type", "op": "eq", "value": "embed" },
    { "path": "$.blocks[*].url", "op": "exists" }
  ],
  "select": ["identity", "title", "url", "score", "snippet", "matchedPaths"],
  "facets": ["collection", "status", "$.blocks[*].type"],
  "sort": ["-score", "-updatedAt"],
  "limit": 20,
  "after": null,
  "explain": false
}
```

`resolve` adds:

```json
{
  "maxAlternatives": 3
}
```

Supported modes:

- `lexical`: full-text search through EmDash's `_emdash_fts_*` tables.
- `structural`: nested JSON/path search through Akari `paths`.

The schemas reject unknown keys, invalid operators, invalid JSON paths, empty
collection names, out-of-range limits, and unsupported filter value shapes
before the engine receives the request.

Use top-level `collections` as the normal collection selector. If `collections`
is omitted, Akari can fall back to `filter.collection`; otherwise `filter` is
best reserved for metadata such as `status`, `locale`, or `updatedAt`.

Cursor pagination (`after` / `nextCursor`) is supported only for single-layer
lexical queries. When Akari fuses the lexical and content-scan layers (the
default whenever content access is available), the merged ranking has no single
continuation token, so `nextCursor` is omitted. To paginate, run a lexical-only
query (no content scan), pass the returned `nextCursor` back as `after`, and
continue until `nextCursor` is absent.

Lexical mode does not introduce a second content index. Akari plans against the
same EmDash full-text table convention and uses SQLite
[FTS5](https://sqlite.org/fts5.html) ranking/snippets so `discover` can return
an identity-shaped answer instead of only a public search hit.

The exported `buildEmDashFts5Plan` helper omits the status predicate when
`status` is not provided, so diagnostics and admin tooling can inspect every
stored status. Pass `status: "published"` or another explicit status when the
plan should constrain rows.

Lexical queries are normalized before they reach FTS5:

- Leading and trailing whitespace is ignored.
- An empty or whitespace-only query is not executable and produces no FTS plan.
- Plain terms are split on whitespace, quoted, and treated as prefix terms. For
  example, `workers ai` becomes `"workers"* "ai"*`, matching words that start
  with `workers` and `ai`.
- A fully quoted query stays a phrase query. Internal double quotes are escaped,
  so `"workers ai"` remains a phrase search instead of becoming prefix terms.
- Queries containing explicit FTS boolean/proximity operators (`AND`, `OR`,
  `NOT`, or `NEAR`) are passed through as operator queries after double quotes
  are escaped. For example, `workers OR d1` keeps the `OR` operator.

Examples:

```json
{ "q": "workers ai", "mode": "lexical", "collections": ["pages"] }
```

Searches for prefix terms in the configured EmDash FTS table.

```json
{ "q": "workers OR d1", "mode": "lexical", "collections": ["pages"] }
```

Uses FTS5 boolean semantics for the operator query.

Akari normalizes `score` within each response after rank fusion. Treat it as a
relative ordering signal for that result set, not as a probability and not as a
number that can be compared with raw EmDash search scores from MCP.

## Filter Syntax

`filter` is intentionally a small metadata filter subset:

```json
{
  "locale": { "$in": ["en", "de"] },
  "status": "published",
  "updatedAt": { "$gte": "2026-01-01" }
}
```

Supported metadata operators:

- `$eq`, `$ne`
- `$in`, `$nin`
- `$lt`, `$lte`, `$gt`, `$gte`

Range operators accept strings or numbers only. Set operators require arrays.
The syntax borrows common API filter conventions, but it is deliberately not a
MongoDB clone: no logical nesting, no regular expressions, and no arbitrary
query operators.

## Path Syntax

`paths` uses Akari JSON-path syntax for content-shape questions:

```json
[
  { "path": "$.blocks[*].type", "op": "eq", "value": "embed" },
  { "path": "$.blocks[*].url", "op": "exists" }
]
```

This is the part that lets a caller ask "which pages contain an embed block with
an external URL?" without fetching every candidate entry and walking block JSON
client-side.

Wildcard paths are Akari syntax, not raw D1 JSON paths. Direct scalar paths can
compile to `json_extract`; wildcard paths compile to `json_each` joins or can be
served from sidecar facts. That keeps the public query shape stable while the
engine uses the SQLite JSON functions available in
[Cloudflare D1](https://developers.cloudflare.com/d1/sql-api/query-json/) and
[SQLite JSON1](https://sqlite.org/json1.html).

Supported path operators:

- `exists`
- `eq`, `ne`
- `in`, `nin`
- `contains`, `match`
- `lt`, `lte`, `gt`, `gte`

Paths may contain `[*]` wildcards. The `discover`/`resolve` engine, materialized
facts, and exported structural SQL compiler (`compileStructuralFilters`) support
multiple wildcards in one path (for example, `$.a[*].b[*]`). The SQL compiler
uses an outer `json_each` join for the first wildcard and nested array-guarded
`json_each` joins for deeper wildcards.

`ne`/`nin` only match scalar values. `contains` is a substring test for strings
and an element-membership test for arrays. `match` is a case-insensitive literal
substring over string values (any `%`/`_` are literal, not wildcards). String
range comparisons (`lt`/`lte`/`gt`/`gte`) use codepoint ordering — the same
ordering SQLite applies under its default `BINARY` collation — so results are
identical whether a filter is evaluated in JS (`discover`) or compiled to D1
SQLite. These semantics are intentionally aligned across both backends.

For paths that are queried often, Akari exports facts helpers:

```ts
import {
  AKARI_FACTS_INDEX_SQL,
  AKARI_FACTS_TABLE_SQL,
  buildReplaceFactsStatements,
  buildReplaceFactsStatementsFromExtraction,
  extractContentFacts,
} from "@bnomei/emdash-akari";
```

Those helpers materialize configured structural paths into
`_emdash_content_facts`. The table keeps both `path_template` values such as
`$.blocks[*].type` for grouping and concrete `full_path` values such as
`$.blocks[3].type` for evidence.

Prefer `buildReplaceFactsStatementsFromExtraction(options)` when re-indexing an
entry: it extracts facts and derives the replacement scope from the same
options, so it still emits a clearing DELETE when extraction returns zero facts
(for example after content changes so no configured path matches). Calling
`buildReplaceFactsStatements(facts)` with an empty `facts` array and no `target`
is a no-op, because the entry scope cannot be derived from zero rows — pass a
`target` (or use the from-extraction helper) to clear stale rows.

## Response Shapes

Candidate response:

```json
{
  "items": [
    {
      "identity": {
        "collection": "products",
        "id": "product_d1",
        "slug": "d1",
        "status": "published",
        "title": "D1",
        "url": "/products/d1"
      },
      "score": 1,
      "snippet": "A page about <mark>D1</mark> serverless SQL.",
      "matchedFields": ["title", "content"],
      "matchedPaths": []
    }
  ],
  "facets": [
    {
      "field": "collection",
      "buckets": [{ "value": "products", "count": 1 }]
    }
  ]
}
```

Resolved response:

```json
{
  "status": "resolved",
  "item": {
    "identity": {
      "collection": "products",
      "id": "product_d1",
      "slug": "d1",
      "status": "published",
      "title": "D1",
      "url": "/products/d1"
    },
    "score": 1,
    "matchedFields": ["title", "content"],
    "matchedPaths": []
  },
  "alternatives": []
}
```

Ambiguous response:

```json
{
  "status": "ambiguous",
  "alternatives": [
    {
      "identity": {
        "collection": "products",
        "id": "product_d1",
        "title": "D1"
      },
      "score": 1
    },
    {
      "identity": {
        "collection": "pages",
        "id": "page_workers-ai",
        "title": "Workers AI"
      },
      "score": 0.984
    }
  ],
  "warnings": ["Top candidates are too close to resolve automatically."]
}
```

Missing response:

```json
{
  "status": "not_found",
  "alternatives": [],
  "warnings": ["No candidate matched the requested identity constraints."]
}
```

## Local Confidence

The package includes a local test setup that does not require D1 or Cloudflare
credentials:

```sh
npm test
```

The test suite builds the package and then runs Node's test runner against:

- the native EmDash plugin descriptor and private route surface,
- package loading for the `./admin` subpath with and without the export,
- route input schemas, normalization, and syntax guards,
- lexical/content rank fusion and resolve ambiguity,
- private content fallback for structural discovery,
- structural SQL compilation against local SQLite JSON data,
- facts extraction and facts replacement SQL planning,
- local CLI requests against a fake EmDash plugin route,
- SQLite FTS5 ranking/snippets/prefix search/`fts5vocab`,
- SQLite JSON1 nested block lookup with `json_each` and `json_extract`.

This gives a fast feedback loop for the same FTS and JSON primitives Akari uses
in D1-backed EmDash apps.

## Local and D1 Expectations

Akari is designed to run inside an EmDash app that may use Cloudflare D1 in
production, but the package itself does not open a D1 binding, create a second
search service, or require Cloudflare credentials. The private plugin routes use
the EmDash content and search surfaces that the host app already exposes. In a
D1-backed app, Akari assumes the app keeps the normal EmDash content tables and
`_emdash_fts_*` FTS tables in sync and that D1 provides the same SQLite FTS5 and
JSON functions documented for those tables.

Local development has a narrower boundary:

- `npm test` uses in-memory local SQLite to smoke-test snippets, prefix queries,
  `json_extract`, and `json_each`; FTS5-only smoke tests run when the local Node
  SQLite build provides the FTS5 extension. The suite does not contact
  Cloudflare D1.
- Local smoke coverage validates Akari's generated SQL and JSON-path behavior
  against SQLite primitives that D1 also supports, but it is not a replacement
  for running the registered plugin in your deployed EmDash environment.
- The CLI talks to the configured EmDash app over `EMDASH_BASE_URL`; without a
  running app and an admin token it cannot discover or resolve real content.
- Structural discovery can scan private content through EmDash when content
  access is available. For frequently queried nested paths, use the exported
  facts helpers to materialize `_emdash_content_facts`; Akari does not maintain
  that sidecar table automatically.

Search and storage behavior therefore differs by environment:

| Environment          | Search/storage source                                                                                       | Important limits                                                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local tests          | In-memory SQLite fixtures plus fake plugin routes                                                           | Self-contained smoke coverage only; no D1 latency, auth, migration, or deployment behavior is exercised.                                               |
| Local EmDash app     | The app's local EmDash storage and private plugin route                                                     | Results reflect local fixtures/content and the configured token; production D1 data is not queried unless the app is connected to it.                  |
| D1-backed EmDash app | EmDash content tables, `_emdash_fts_*` tables, SQLite JSON functions, and optional Akari facts tables in D1 | Akari assumes EmDash owns schema/migrations/index freshness; D1-specific quotas, consistency, and deployment issues must be validated in the host app. |

If D1-like confidence is required before adoption, run the self-contained test
suite first, then smoke-test `akari config`, `akari discover`, and `akari
resolve` against the target EmDash app so authentication, table shape, FTS
freshness, JSON-path behavior, and content permissions are checked together.

The empty `./admin` export is intentionally retained. Representative package
loading imports `@bnomei/emdash-akari/admin` successfully while the export is
present, and the same package fixture fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`
when the `./admin` entry is removed.

## Private Routes

Akari exposes private plugin routes because the binary needs a protected bridge
into the EmDash app:

```txt
/_emdash/api/plugins/akari/discover
/_emdash/api/plugins/akari/resolve
/_emdash/api/plugins/akari/config
```

These routes are not the primary integration surface. Prefer the `akari` binary
for scripts, agents, and MCP wrappers.

Do not expose the routes through visitor-facing browser code, public pages,
public search UI, unauthenticated API proxies, or public MCP servers. Private
plugin routes run behind EmDash plugin/admin route authentication, so Akari can
support admin diagnostics, draft-aware lookup, agent workflows, and richer
projections without turning every lookup into a public data exposure problem.

Dashboard/session calls must be same-origin, authenticated as an EmDash user
with plugin permissions, and include `X-EmDash-Request: 1` on POST requests.
Server-side, CLI, agent, and MCP calls should use
`Authorization: Bearer <token>` with an EmDash PAT or OAuth access token that
has the `admin` scope and belongs to an Admin user.

`X-EmDash-Request` is CSRF protection for session-authenticated POST requests.
It is not authentication.

Public site search should stay on EmDash's existing public search endpoint.

If a process cannot shell out, it can import the same thin route callers:

```ts
import { discoverAkari, resolveAkari } from "@bnomei/emdash-akari/cli";
```

## License

MIT.

## Coverage

CI runs the existing Node test suite with the built-in test coverage reporter:

```sh
npm run test:coverage
```

The coverage gate is intentionally maintainable and low-noise: it only includes
built package files in `dist/*.mjs` and currently requires at least 60% line
coverage, 60% branch coverage, and 55% function coverage. Those thresholds are
set in the `test:coverage` script in `package.json` so the local command and CI
use the same expectations.

When coverage changes intentionally, update the threshold values in
`package.json` in the same pull request as the related test or implementation
change. Prefer raising thresholds after adding meaningful tests; lower them only
when the uncovered code is intentionally difficult to exercise and note the
reason in the pull request.
