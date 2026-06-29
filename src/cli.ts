#!/usr/bin/env node
/**
 * `akari` CLI and HTTP client for private EmDash discover/resolve/config routes.
 */
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import process from "node:process";
import type {
  AkariQueryInput,
  AkariQueryResponse,
  AkariResolveInput,
  AkariResolveResponse,
} from "./types";

export type AkariRouteName = "discover" | "resolve" | "config";

export type AkariLocalCallOptions = {
  baseUrl?: string;
  token?: string;
  fetch?: typeof fetch;
  headers?: HeadersInit;
};

type CliOptions = {
  route?: AkariRouteName;
  baseUrl?: string;
  token?: string;
  data?: string;
  input?: string;
  pretty?: boolean;
  help?: boolean;
};

type WritableLike = {
  write(value: string): unknown;
};

const routeNames = new Set<AkariRouteName>(["discover", "resolve", "config"]);

/** HTTP or EmDash API envelope failure from a private Akari route call. */
export class AkariRouteError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AkariRouteError";
  }
}

export function buildAkariRouteUrl(baseUrl: string, route: AkariRouteName): string {
  return `${baseUrl.replace(/\/+$/, "")}/_emdash/api/plugins/akari/${route}`;
}

/** Call a private Akari plugin route; unwraps EmDash `{ success, data }` envelopes. */
export async function callAkariRoute(
  route: AkariRouteName,
  input: unknown = {},
  options: AkariLocalCallOptions = {},
): Promise<unknown> {
  const baseUrl = options.baseUrl ?? "http://localhost:4321";
  const requestFetch = options.fetch ?? fetch;
  const method = route === "config" ? "GET" : "POST";
  const headers = new Headers(options.headers);

  headers.set("Accept", "application/json");
  if (options.token) headers.set("Authorization", `Bearer ${options.token}`);

  const requestInit: RequestInit = { method, headers };

  if (method === "POST") {
    headers.set("Content-Type", "application/json");
    headers.set("X-EmDash-Request", "1");
    requestInit.body = JSON.stringify(input ?? {});
  }

  const response = await requestFetch(buildAkariRouteUrl(baseUrl, route), requestInit);
  return readAkariResponse(response);
}

/** Typed discover helper over the private plugin route. */
export async function discoverAkari(
  input: AkariQueryInput,
  options: AkariLocalCallOptions = {},
): Promise<AkariQueryResponse> {
  return callAkariRoute("discover", input, options) as Promise<AkariQueryResponse>;
}

/** Typed resolve helper over the private plugin route. */
export async function resolveAkari(
  input: AkariResolveInput,
  options: AkariLocalCallOptions = {},
): Promise<AkariResolveResponse> {
  return callAkariRoute("resolve", input, options) as Promise<AkariResolveResponse>;
}

/** Parse argv, call the requested route, and write JSON to stdout. */
export async function runAkariCli(
  argv = process.argv.slice(2),
  env: Record<string, string | undefined> = process.env,
  io: { stdout: WritableLike; stderr: WritableLike } = process,
): Promise<number> {
  const options = parseCliOptions(argv);

  if (options.help || !options.route) {
    io.stdout.write(helpText());
    return 0;
  }

  const input = await readInput(options);
  const result = await callAkariRoute(options.route, input, {
    baseUrl: options.baseUrl ?? env.EMDASH_BASE_URL,
    token: options.token ?? env.EMDASH_TOKEN,
  });
  const spacing = options.pretty ? 2 : 0;
  io.stdout.write(`${JSON.stringify(result, null, spacing)}\n`);
  return 0;
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (index === 0 && isAkariRouteName(arg)) {
      options.route = arg;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--pretty") {
      options.pretty = true;
      continue;
    }

    const inline = readInlineOption(arg);
    if (inline) {
      setCliOption(options, inline.key, inline.value);
      continue;
    }

    if (isValueOption(arg)) {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`Missing value for ${arg}.`);
      setCliOption(options, arg, value);
      index += 1;
      continue;
    }

    if (!options.route && isAkariRouteName(arg)) {
      options.route = arg;
      continue;
    }

    throw new Error(`Unknown Akari CLI option: ${arg}`);
  }

  if (!options.help && !options.route) {
    throw new Error("Missing route. Use discover, resolve, or config.");
  }
  if (options.data !== undefined && options.input !== undefined) {
    throw new Error("Use either --data or --input, not both.");
  }

  return options;
}

function readInlineOption(arg: string): { key: string; value: string } | undefined {
  const separator = arg.indexOf("=");
  if (!arg.startsWith("--") || separator === -1) return undefined;
  return {
    key: arg.slice(0, separator),
    value: arg.slice(separator + 1),
  };
}

function isValueOption(arg: string): boolean {
  return ["--base-url", "--token", "--data", "--input"].includes(arg);
}

function setCliOption(options: CliOptions, key: string, value: string): void {
  if (key === "--base-url") options.baseUrl = value;
  else if (key === "--token") options.token = value;
  else if (key === "--data") options.data = value;
  else if (key === "--input") options.input = value;
  else throw new Error(`Unknown Akari CLI option: ${key}`);
}

async function readInput(options: CliOptions): Promise<unknown> {
  if (options.route === "config" && !options.data && !options.input) return undefined;

  const raw =
    options.data ??
    (options.input === "-"
      ? await readStdin()
      : options.input
        ? await readFile(options.input, "utf8")
        : "{}");

  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Akari CLI input must be valid JSON: ${getErrorMessage(error)}`);
  }
}

async function readStdin(): Promise<string> {
  let out = "";
  for await (const part of process.stdin) out += String(part);
  return out;
}

async function readAkariResponse(response: Response): Promise<unknown> {
  const payload = await readPayload(response);

  if (!response.ok) {
    throw new AkariRouteError(
      `Akari route failed with HTTP ${response.status} ${response.statusText}`.trim(),
      response.status,
      payload,
    );
  }

  if (isRecord(payload) && payload.success === true && "data" in payload) {
    return payload.data;
  }

  if (isRecord(payload) && payload.success === false) {
    throw new AkariRouteError(readApiErrorMessage(payload), response.status, payload);
  }

  return payload;
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) return text;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function readApiErrorMessage(payload: Record<string, unknown>): string {
  const error = payload.error;
  if (typeof error === "string") return error;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  if (typeof payload.message === "string") return payload.message;
  return "Akari route returned an error.";
}

function isAkariRouteName(value: string): value is AkariRouteName {
  return routeNames.has(value as AkariRouteName);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function helpText(): string {
  return `Usage: akari <discover|resolve|config> [options]

Options:
  --base-url <url>  EmDash app URL. Defaults to EMDASH_BASE_URL or http://localhost:4321.
  --token <token>   EmDash admin API token. Defaults to EMDASH_TOKEN.
  --data <json>     JSON request body for discover or resolve.
  --input <file|-> Read JSON request body from a file or stdin.
  --pretty          Pretty-print JSON output.
  --help            Show this help.
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAkariCli().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`${getErrorMessage(error)}\n`);
      process.exitCode = 1;
    },
  );
}
