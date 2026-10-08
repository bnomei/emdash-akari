import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ContentRepository, FTSManager, SchemaRegistry, runWithContext } from "emdash";
import { createDialect } from "emdash/db/sqlite";
import { createPlugin, normalizeQueryInput, runAkariQuery } from "../dist/index.mjs";
import { callAkariRoute, discoverAkari, resolveAkari } from "../dist/cli.mjs";
import { sqliteSupportsFts5 } from "./sqlite-support.mjs";

// Supply only Astro's build-time config/DEV values, not mocks of EmDash APIs.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === "virtual:emdash/config"
      ? { url: "data:text/javascript,export default {}", shortCircuit: true }
      : nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url.includes("/emdash/dist/emdash-runtime-")) {
      return {
        ...result,
        source: String(result.source).replaceAll("import.meta.env.DEV", "false"),
      };
    }
    return result;
  },
});
const { EmDashRuntime, dispatchPluginApiRequest } =
  await import("emdash/internal/plugin-test-runtime");

test("Akari runs through EmDash 1.2 private routes and real SQLite content/search", async (t) => {
  t.after(() => hooks.deregister());
  const directory = await mkdtemp(path.join(tmpdir(), "akari-emdash-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runtime = await EmDashRuntime.create({
    config: {
      database: {
        entrypoint: directory,
        config: { url: path.join(directory, "content.sqlite") },
        type: "sqlite",
      },
    },
    plugins: [createPlugin()],
    createDialect,
    createStorage: null,
    sandboxEnabled: false,
    sandboxedPluginEntries: [],
    createSandboxRunner: null,
    createScheduler: null,
  });
  t.after(async () => {
    await runtime.shutdown();
    await runtime.db.destroy();
  });

  const registry = new SchemaRegistry(runtime.db);
  await registry.createCollection({ slug: "pages", label: "Pages", supports: ["search"] });
  await registry.createField("pages", {
    slug: "title",
    label: "Title",
    type: "text",
    searchable: true,
  });
  await registry.createField("pages", { slug: "blocks", label: "Blocks", type: "json" });
  const repository = new ContentRepository(runtime.db);
  for (const [id, status, blockType] of [
    ["guide", "published", "embed"],
    ["overview", "published", "text"],
    ["draft", "draft", "embed"],
  ]) {
    await repository.create({
      id,
      type: "pages",
      slug: id,
      status,
      data: { title: `Workers ${id}`, blocks: [{ type: blockType, url: "https://example.test" }] },
    });
  }
  const user = {
    id: "admin",
    email: "admin@example.test",
    name: "Admin",
    role: 50,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const dispatch = (request, caller = user, tokenScopes) =>
    runWithContext({ editMode: false, db: runtime.db, dbIsIsolated: true }, () =>
      dispatchPluginApiRequest({
        runtime,
        pluginId: "akari",
        path: new URL(request.url).pathname.split("/akari")[1],
        request,
        user: caller,
        tokenScopes,
      }),
    );
  const options = {
    baseUrl: "https://emdash.test",
    fetch: (url, init) => dispatch(new Request(url, init)),
  };

  await t.test(
    "session config GET includes CSRF and private responses are not cached",
    async () => {
      const config = await callAkariRoute("config", {}, options);
      assert.equal(config.capabilities.access, "private");
      const response = await dispatch(
        new Request(`${options.baseUrl}/_emdash/api/plugins/akari/config`, {
          headers: { "X-EmDash-Request": "1" },
        }),
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
    },
  );

  await t.test(
    "real content access preserves status filtering and nested path evidence",
    async () => {
      const input = {
        mode: "structural",
        collections: ["pages"],
        filter: { status: "published" },
        paths: [{ path: "$.blocks[*].type", op: "eq", value: "embed" }],
      };
      const discovered = await discoverAkari(input, options);
      assert.deepEqual(
        discovered.items.map((item) => item.identity.id),
        ["guide"],
      );
      assert.deepEqual(discovered.items[0].matchedPaths, ["$.blocks[0].type"]);
      assert.equal(discovered.warnings, undefined);
      const resolved = await resolveAkari(input, options);
      assert.equal(resolved.status, "resolved");
      assert.equal(resolved.item.identity.id, "guide");
    },
  );

  await t.test("production authorization and Zod validation reject invalid requests", async () => {
    const url = `${options.baseUrl}/_emdash/api/plugins/akari/config`;
    assert.equal((await dispatch(new Request(url), null)).status, 401);
    assert.equal((await dispatch(new Request(url), { ...user, role: 20 })).status, 403);
    const csrf = await dispatch(new Request(url));
    assert.equal(csrf.status, 403);
    assert.equal((await csrf.json()).error.code, "CSRF_REJECTED");
    assert.equal((await dispatch(new Request(url), user, ["content:read"])).status, 403);
    assert.equal((await dispatch(new Request(url), user, ["admin"])).status, 200);
    const invalid = await dispatch(
      new Request(`${options.baseUrl}/_emdash/api/plugins/akari/discover`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-EmDash-Request": "1" },
        body: JSON.stringify({ limit: 101 }),
      }),
    );
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, "VALIDATION_ERROR");
  });

  await t.test(
    "default lexical provider uses real EmDash FTS and opaque pagination",
    {
      skip: !sqliteSupportsFts5() && "SQLite was built without FTS5",
    },
    async () => {
      const fts = new FTSManager(runtime.db);
      await fts.createFtsTable("pages", ["title"]);
      await fts.setSearchConfig("pages", { enabled: true, titleField: "title" });
      await fts.populateFromContent("pages", ["title"]);
      const response = await discoverAkari(
        { q: "Workers", collections: ["pages"], filter: { status: "published" } },
        options,
      );
      assert.deepEqual(response.items.map((item) => item.identity.id).sort(), [
        "guide",
        "overview",
      ]);
      assert.equal(response.warnings, undefined);
      assert.ok(response.items.every((item) => item.matchedFields.includes("fts")));
      // Without content access, Akari forwards the actual EmDash continuation token.
      const query = {
        q: "Workers",
        collections: ["pages"],
        filter: { status: "published" },
        limit: 1,
      };
      const first = await runWithContext(
        { editMode: false, db: runtime.db, dbIsIsolated: true },
        () => runAkariQuery(normalizeQueryInput(query)),
      );
      assert.equal(first.items.length, 1);
      assert.equal(typeof first.nextCursor, "string");
      const second = await runWithContext(
        { editMode: false, db: runtime.db, dbIsIsolated: true },
        () => runAkariQuery(normalizeQueryInput({ ...query, after: first.nextCursor })),
      );
      assert.equal(second.items.length, 1);
      assert.notEqual(second.items[0].identity.id, first.items[0].identity.id);
      assert.equal(second.nextCursor, undefined);
    },
  );
});
