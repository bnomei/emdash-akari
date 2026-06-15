import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";
import { promisify } from "node:util";
import { discoverAkari, resolveAkari } from "../dist/cli.mjs";

const execFileAsync = promisify(execFile);

test("caller helpers target canonical private Akari routes", async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({
      url,
      method: init.method,
      authorization: init.headers.get("authorization"),
      body: JSON.parse(init.body),
    });

    return new Response(JSON.stringify({ success: true, data: { ok: true } }), {
      headers: { "content-type": "application/json" },
    });
  };

  assert.deepEqual(
    await discoverAkari(
      { q: "workers ai", collections: ["pages"] },
      { baseUrl: "http://emdash.test", token: "dev-token", fetch },
    ),
    { ok: true },
  );
  assert.deepEqual(
    await resolveAkari(
      { q: "main d1 page", collections: ["products"] },
      { baseUrl: "http://emdash.test", token: "dev-token", fetch },
    ),
    { ok: true },
  );

  assert.deepEqual(calls, [
    {
      url: "http://emdash.test/_emdash/api/plugins/akari/discover",
      method: "POST",
      authorization: "Bearer dev-token",
      body: { q: "workers ai", collections: ["pages"] },
    },
    {
      url: "http://emdash.test/_emdash/api/plugins/akari/resolve",
      method: "POST",
      authorization: "Bearer dev-token",
      body: { q: "main d1 page", collections: ["products"] },
    },
  ]);
});

test("CLI calls the private Akari plugin route and unwraps EmDash responses", async (t) => {
  const requests = [];
  const server = createServer(async (request, response) => {
    const body = await readBody(request);
    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
      requestHeader: request.headers["x-emdash-request"],
      body: JSON.parse(body),
    });

    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        success: true,
        data: {
          items: [{ identity: { collection: "pages", id: "home" } }],
        },
      }),
    );
  });

  await listen(server);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  assert.ok(address && typeof address === "object");

  const { stdout } = await execFileAsync(process.execPath, [
    "dist/cli.mjs",
    "discover",
    "--base-url",
    `http://127.0.0.1:${address.port}`,
    "--token",
    "dev-token",
    "--data",
    '{"q":"workers ai","collections":["pages"]}',
  ]);

  assert.deepEqual(JSON.parse(stdout), {
    items: [{ identity: { collection: "pages", id: "home" } }],
  });
  assert.deepEqual(requests, [
    {
      method: "POST",
      url: "/_emdash/api/plugins/akari/discover",
      authorization: "Bearer dev-token",
      requestHeader: "1",
      body: { q: "workers ai", collections: ["pages"] },
    },
  ]);
});

test("CLI reads config route settings from environment", async (t) => {
  const requests = [];
  const server = createServer(async (request, response) => {
    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
    });

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ success: true, data: { id: "akari" } }));
  });

  await listen(server);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  assert.ok(address && typeof address === "object");

  const { stdout } = await execFileAsync(process.execPath, ["dist/cli.mjs", "config"], {
    env: {
      ...process.env,
      EMDASH_BASE_URL: `http://127.0.0.1:${address.port}`,
      EMDASH_TOKEN: "env-token",
    },
  });

  assert.deepEqual(JSON.parse(stdout), { id: "akari" });
  assert.deepEqual(requests, [
    {
      method: "GET",
      url: "/_emdash/api/plugins/akari/config",
      authorization: "Bearer env-token",
    },
  ]);
});

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
}

async function readBody(request) {
  let body = "";
  for await (const part of request) body += String(part);
  return body;
}
