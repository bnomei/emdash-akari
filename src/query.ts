/**
 * Private EmDash plugin route handlers for discover, resolve, and config.
 */
import type { RouteContext } from "emdash";
import { AKARI_ROUTE_CAPABILITIES } from "./constants";
import { resolveAkariQuery, runAkariQuery, type AkariEngineOptions } from "./engine";
import { normalizeQueryInput, normalizeResolveInput } from "./input";
import type { AkariQueryResponse, AkariResolveResponse } from "./types";

/** Factory for the private discover route handler. */
export function createDiscoverRoute(options: AkariEngineOptions = {}) {
  return async function akariDiscoverRoute(ctx: RouteContext): Promise<AkariQueryResponse> {
    return discoverRoute(ctx, options);
  };
}

/** Factory for the private resolve route handler. */
export function createResolveRoute(options: AkariEngineOptions = {}) {
  return async function akariResolveRoute(ctx: RouteContext): Promise<AkariResolveResponse> {
    return resolveRoute(ctx, options);
  };
}

/** Execute discover: validate input, run the engine, return ranked candidates. */
export async function discoverRoute(
  ctx: RouteContext,
  options: AkariEngineOptions = {},
): Promise<AkariQueryResponse> {
  const input = normalizeQueryInput(ctx.input);

  return runAkariQuery(input, {
    ...options,
    content: options.content ?? ctx.content,
    url: options.url ?? ctx.url,
  });
}

/** Execute resolve: fuse candidates and decide resolved vs ambiguous vs not_found. */
export async function resolveRoute(
  ctx: RouteContext,
  options: AkariEngineOptions = {},
): Promise<AkariResolveResponse> {
  const input = normalizeResolveInput(ctx.input);

  return resolveAkariQuery(input, {
    ...options,
    content: options.content ?? ctx.content,
    url: options.url ?? ctx.url,
  });
}

export async function configRoute() {
  return {
    capabilities: AKARI_ROUTE_CAPABILITIES,
    routes: {
      discover: "/_emdash/api/plugins/akari/discover",
      resolve: "/_emdash/api/plugins/akari/resolve",
      config: "/_emdash/api/plugins/akari/config",
    },
  };
}
