import type { z } from "zod";
import type { AkariEngineOptions, AkariLexicalSearchProvider } from "./engine";
import type { AkariFtsPlanInput, AkariFtsRow, AkariSqlPlan } from "./fts";
import type {
  akariFacetSchema,
  akariFilterSchema,
  akariMetadataFilterSchema,
  akariMetadataOperatorSchema,
  akariModeSchema,
  akariPathFilterSchema,
  akariPathOperatorSchema,
  akariQueryInputSchema,
  akariResolveInputSchema,
  akariScalarSchema,
  akariSelectFieldSchema,
} from "./schema";

export type AkariMode = z.infer<typeof akariModeSchema>;

export type AkariScalar = z.infer<typeof akariScalarSchema>;

export type AkariMetadataOperator = z.infer<typeof akariMetadataOperatorSchema>;

export type AkariMetadataFilter = z.infer<typeof akariMetadataFilterSchema>;

export type AkariFilter = z.infer<typeof akariFilterSchema>;

export type AkariPathOperator = z.infer<typeof akariPathOperatorSchema>;

export type AkariPathFilter = z.infer<typeof akariPathFilterSchema>;

export type AkariFacet = z.infer<typeof akariFacetSchema>;

export type AkariSelectField = z.infer<typeof akariSelectFieldSchema>;

export type AkariQueryInput = z.input<typeof akariQueryInputSchema>;

export type AkariValidatedQueryInput = z.output<typeof akariQueryInputSchema>;

export type AkariIdentity = {
  collection: string;
  id: string;
  slug?: string | null;
  locale?: string;
  status?: string;
  title?: string;
  url?: string;
};

export type AkariResult = {
  identity: AkariIdentity;
  score?: number;
  snippet?: string;
  matchedFields?: string[];
  matchedPaths?: string[];
  updatedAt?: string;
  publishedAt?: string | null;
};

export type AkariFacetBucket = {
  value: string;
  count: number;
};

export type AkariFacetResult = {
  key: string;
  buckets: AkariFacetBucket[];
};

export type AkariQueryResponse = {
  items: AkariResult[];
  facets?: AkariFacetResult[];
  nextCursor?: string;
  warnings?: string[];
  explain?: Record<string, unknown>;
};

export type AkariResolveInput = z.input<typeof akariResolveInputSchema>;

export type AkariValidatedResolveInput = z.output<typeof akariResolveInputSchema>;

export type AkariResolveResponse =
  | {
      status: "resolved";
      item: AkariResult;
      alternatives?: AkariResult[];
      warnings?: string[];
    }
  | {
      status: "ambiguous" | "not_found";
      item?: undefined;
      alternatives?: AkariResult[];
      warnings?: string[];
    };

export type AkariCreatePluginOptions = {
  adminEntry?: string;
  defaultCollections?: string[];
  lexicalSearch?: AkariLexicalSearchProvider;
  fetchLimit?: number;
  ambiguityMargin?: number;
};

export type AkariDescriptorOptions = {
  entrypoint?: string;
  adminEntry?: string;
};

export type {
  AkariEngineOptions,
  AkariFtsPlanInput,
  AkariFtsRow,
  AkariLexicalSearchProvider,
  AkariSqlPlan,
};
