import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  akariPlugin,
  createPlugin,
  isAkariJsonPath,
  isAkariMetadataOperator,
  isAkariMode,
  isAkariPathOperator,
  normalizeQueryInput,
  normalizeResolveInput,
} from "../dist/index.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function importAdminFromPackageFixture(packageJson) {
  const fixture = await mkdtemp(path.join(tmpdir(), "akari-admin-export-"));

  try {
    const packageDir = path.join(fixture, "node_modules", "@bnomei", "emdash-akari");
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      path.join(packageDir, "package.json"),
      `${JSON.stringify(packageJson, null, 2)}\n`,
    );
    await symlink(path.join(repoRoot, "dist"), path.join(packageDir, "dist"), "dir");

    const entry = path.join(fixture, "entry.mjs");
    await writeFile(entry, 'export const admin = await import("@bnomei/emdash-akari/admin");\n');

    return await import(`${pathToFileURL(entry).href}?${Date.now()}`);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}

test("akariPlugin matches the native EmDash descriptor shape", () => {
  assert.deepEqual(akariPlugin(), {
    id: "akari",
    version: "0.1.2",
    format: "native",
    entrypoint: "@bnomei/emdash-akari",
    adminEntry: "@bnomei/emdash-akari/admin",
    capabilities: ["content:read"],
    options: { adminEntry: "@bnomei/emdash-akari/admin" },
  });
});

test("createPlugin registers the private validated route surface", () => {
  const plugin = createPlugin();

  assert.equal(plugin.id, "akari");
  assert.deepEqual(plugin.capabilities, ["content:read"]);
  assert.deepEqual(Object.keys(plugin.routes), ["discover", "resolve", "config"]);
  assert.equal(Boolean(plugin.routes.discover.input), true);
  assert.equal(Boolean(plugin.routes.resolve.input), true);
  for (const [name, route] of Object.entries(plugin.routes)) {
    assert.equal(route.public, false, `${name} must stay private`);
  }
});

test("admin subpath export is required for EmDash admin entry loading", async () => {
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));

  const withAdmin = await importAdminFromPackageFixture(packageJson);
  assert.deepEqual(withAdmin.admin.pages, {});
  assert.deepEqual(withAdmin.admin.widgets, {});

  const withoutAdmin = structuredClone(packageJson);
  delete withoutAdmin.exports["./admin"];

  await assert.rejects(
    importAdminFromPackageFixture(withoutAdmin),
    (error) => error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED",
  );
});

test("normalizeQueryInput defaults and validates the private discover contract", () => {
  assert.deepEqual(normalizeQueryInput(null), { mode: "lexical", limit: 20 });
  assert.deepEqual(normalizeQueryInput({ mode: "structural", limit: 100 }), {
    mode: "structural",
    limit: 100,
  });
  assert.deepEqual(normalizeQueryInput({ mode: "lexical", limit: 10, collections: ["pages"] }), {
    collections: ["pages"],
    mode: "lexical",
    limit: 10,
  });
  assert.deepEqual(normalizeQueryInput({ facets: ["collection", "$.blocks[*].type"] }), {
    facets: ["collection", "$.blocks[*].type"],
    mode: "lexical",
    limit: 20,
  });

  assert.throws(() => normalizeQueryInput({ mode: "invalid" }));
  assert.throws(() => normalizeQueryInput({ limit: 999 }));
  assert.throws(() => normalizeQueryInput({ collections: ["pages", ""] }));
  assert.throws(() => normalizeQueryInput({ unexpected: true }));
  assert.throws(() =>
    normalizeQueryInput({
      filter: { status: { $gt: true } },
    }),
  );
  assert.throws(() =>
    normalizeQueryInput({
      paths: [{ path: "$.blocks[*].type", op: "eq" }],
    }),
  );
  assert.throws(() =>
    normalizeQueryInput({
      facets: [{ field: "collection", path: "$.blocks[*].type" }],
    }),
  );
});

test("normalizeResolveInput rejects threshold and accepts bounded alternatives", () => {
  assert.deepEqual(normalizeResolveInput({ maxAlternatives: 3 }), {
    mode: "lexical",
    limit: 20,
    maxAlternatives: 3,
  });

  assert.throws(() => normalizeResolveInput({ threshold: 0.72 }));
  assert.throws(() => normalizeResolveInput({ facets: ["collection"] }));
});

test("syntax guards keep Akari close to the documented filter and path subsets", () => {
  assert.equal(isAkariMode("vector"), false);
  assert.equal(isAkariMetadataOperator("$in"), true);
  assert.equal(isAkariMetadataOperator("$regex"), false);
  assert.equal(isAkariPathOperator("exists"), true);
  assert.equal(isAkariPathOperator("$exists"), false);

  assert.equal(isAkariJsonPath("$.blocks[*].type"), true);
  assert.equal(isAkariJsonPath("$.blocks[2].url"), true);
  assert.equal(isAkariJsonPath("blocks[*].type"), false);
  assert.equal(isAkariJsonPath("$.blocks[*].type;drop"), false);
});
