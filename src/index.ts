/**
 * EmDash Akari public surface: plugin registration, validated discover/resolve
 * contracts, and integrator helpers for lexical search, structural paths, and
 * content facts.
 */
import { definePlugin, type PluginDescriptor } from "emdash";
import { PACKAGE_NAME, PLUGIN_ID, PLUGIN_VERSION } from "./constants";
import { configRoute, createDiscoverRoute, createResolveRoute } from "./query";
import { akariQueryInputSchema, akariResolveInputSchema } from "./schema";
import type { AkariCreatePluginOptions, AkariDescriptorOptions } from "./types";

export type {
  AkariCreatePluginOptions,
  AkariDescriptorOptions,
  AkariFacet,
  AkariFacetBucket,
  AkariFacetResult,
  AkariFilter,
  AkariIdentity,
  AkariMetadataFilter,
  AkariMetadataOperator,
  AkariMode,
  AkariPathFilter,
  AkariPathOperator,
  AkariQueryInput,
  AkariQueryResponse,
  AkariResolveInput,
  AkariResolveResponse,
  AkariResult,
  AkariScalar,
  AkariSelectField,
  AkariValidatedQueryInput,
  AkariValidatedResolveInput,
} from "./types";
export {
  AKARI_ROUTE_CAPABILITIES,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  PACKAGE_NAME,
  PLUGIN_ID,
  PLUGIN_VERSION,
} from "./constants";
export {
  isAkariJsonPath,
  isAkariMetadataOperator,
  isAkariMode,
  isAkariPathOperator,
  normalizeQueryInput,
  normalizeResolveInput,
  type AkariNormalizedResolveInput,
  type AkariNormalizedQueryInput,
} from "./input";
export {
  resolveAkariQuery,
  runAkariQuery,
  type AkariEngineOptions,
  type AkariLexicalSearchProvider,
} from "./engine";
export {
  AKARI_FACTS_INDEX_SQL,
  AKARI_FACTS_TABLE_SQL,
  buildReplaceFactsStatements,
  buildReplaceFactsStatementsFromExtraction,
  extractContentFacts,
  getFactValueType,
  type AkariContentFact,
  type AkariFactSqlStatement,
  type AkariFactValueType,
  type AkariFactsReplacementTarget,
  type ExtractFactsOptions,
} from "./facts";
export {
  buildEmDashFts5Plan,
  escapeFts5Query,
  getEmDashContentTableName,
  getEmDashFtsTableName,
  mapFtsRows,
  type AkariFtsPlanInput,
  type AkariFtsRow,
  type AkariSqlPlan,
} from "./fts";
export {
  matchesMetadataFilter,
  matchesMetadataFilters,
  readMetadataField,
  toIndexedMetadataFilter,
} from "./filter";
export {
  evaluatePathFilters,
  parseAkariJsonPath,
  pathValueMatches,
  pathValuesMatch,
  readAkariJsonPathValues,
  toSqliteJsonPath,
  type AkariParsedJsonPath,
  type AkariPathToken,
  type AkariPathValue,
} from "./paths";
export {
  reciprocalRankFusion,
  resultKey,
  type AkariRankFusionOptions,
  type AkariRankedCandidate,
} from "./ranking";
export {
  configRoute,
  createDiscoverRoute,
  createResolveRoute,
  discoverRoute,
  resolveRoute,
} from "./query";
export {
  akariFacetSchema,
  akariFilterSchema,
  akariJsonPathSchema,
  akariMetadataFieldSchema,
  akariMetadataFilterSchema,
  akariMetadataOperatorSchema,
  akariModeSchema,
  akariPathFilterSchema,
  akariPathOperatorSchema,
  akariQueryInputSchema,
  akariResolveInputSchema,
  akariScalarSchema,
  akariSelectFieldSchema,
  akariSortSchema,
} from "./schema";
export {
  compileStructuralFilter,
  compileStructuralFilters,
  type AkariStructuralCompileOptions,
  type AkariStructuralSqlPlan,
} from "./structural";

/** Native EmDash plugin descriptor for Astro registration (`akariPlugin()`). */
export function akariPlugin(options: AkariDescriptorOptions = {}): PluginDescriptor {
  const entrypoint = options.entrypoint ?? PACKAGE_NAME;
  const adminEntry = options.adminEntry ?? `${entrypoint}/admin`;

  return {
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    format: "native",
    entrypoint,
    adminEntry,
    capabilities: ["content:read"],
    options: { adminEntry },
  };
}

/** Runtime plugin factory wiring private discover, resolve, and config routes. */
export function createPlugin(options: AkariCreatePluginOptions = {}) {
  return definePlugin({
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    capabilities: ["content:read"],
    routes: {
      discover: {
        public: false,
        input: akariQueryInputSchema,
        handler: createDiscoverRoute(options),
      },
      resolve: {
        public: false,
        input: akariResolveInputSchema,
        handler: createResolveRoute(options),
      },
      config: {
        public: false,
        handler: configRoute,
      },
    },
    admin: {
      entry: options.adminEntry ?? `${PACKAGE_NAME}/admin`,
    },
  });
}

export default akariPlugin;
