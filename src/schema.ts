import { z } from "zod";
import { DEFAULT_LIMIT, MAX_LIMIT } from "./constants";

const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const metadataFieldPattern = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const jsonPathPattern = /^\$(?:(?:\.[A-Za-z_][A-Za-z0-9_]*)|(?:\[(?:\d+|\*)\]))*$/;
const sortPattern = /^-?(?:score|updatedAt|publishedAt|title|collection|status|locale)$/;

export const akariModeSchema = z.enum(["lexical", "structural"]);

export const akariScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const akariComparableScalarSchema = z.union([z.string(), z.number()]);

export const akariMetadataOperatorSchema = z.enum([
  "$eq",
  "$ne",
  "$in",
  "$nin",
  "$lt",
  "$lte",
  "$gt",
  "$gte",
]);

export const akariMetadataFieldSchema = z.string().regex(metadataFieldPattern).max(128);
export const akariJsonPathSchema = z.string().regex(jsonPathPattern).max(256);

export const akariMetadataFilterSchema = z.union([
  akariScalarSchema,
  z.strictObject({ $eq: akariScalarSchema }),
  z.strictObject({ $ne: akariScalarSchema }),
  z.strictObject({ $in: z.array(akariScalarSchema).min(1).max(50) }),
  z.strictObject({ $nin: z.array(akariScalarSchema).min(1).max(50) }),
  z.strictObject({ $lt: akariComparableScalarSchema }),
  z.strictObject({ $lte: akariComparableScalarSchema }),
  z.strictObject({ $gt: akariComparableScalarSchema }),
  z.strictObject({ $gte: akariComparableScalarSchema }),
]);

export const akariFilterSchema = z.record(akariMetadataFieldSchema, akariMetadataFilterSchema);

const pathValueFilterSchema = z.strictObject({
  path: akariJsonPathSchema,
  op: z.enum(["eq", "ne"]),
  value: akariScalarSchema,
});

const pathSetFilterSchema = z.strictObject({
  path: akariJsonPathSchema,
  op: z.enum(["in", "nin"]),
  value: z.array(akariScalarSchema).min(1).max(50),
});

const pathTextFilterSchema = z.strictObject({
  path: akariJsonPathSchema,
  op: z.enum(["contains", "match"]),
  value: z.string().min(1).max(500),
});

const pathRangeFilterSchema = z.strictObject({
  path: akariJsonPathSchema,
  op: z.enum(["gt", "gte", "lt", "lte"]),
  value: akariComparableScalarSchema,
});

const pathExistsFilterSchema = z.strictObject({
  path: akariJsonPathSchema,
  op: z.literal("exists"),
});

export const akariPathOperatorSchema = z.enum([
  "eq",
  "ne",
  "in",
  "nin",
  "contains",
  "exists",
  "gt",
  "gte",
  "lt",
  "lte",
  "match",
]);

export const akariPathFilterSchema = z.union([
  pathValueFilterSchema,
  pathSetFilterSchema,
  pathTextFilterSchema,
  pathRangeFilterSchema,
  pathExistsFilterSchema,
]);

export const akariFacetSchema = z.union([
  akariMetadataFieldSchema,
  akariJsonPathSchema,
  z.strictObject({
    field: akariMetadataFieldSchema,
    limit: z.number().int().min(1).max(100).optional(),
  }),
  z.strictObject({
    path: akariJsonPathSchema,
    limit: z.number().int().min(1).max(100).optional(),
  }),
]);

export const akariSelectFieldSchema = z.enum([
  "identity",
  "collection",
  "id",
  "slug",
  "locale",
  "status",
  "title",
  "url",
  "score",
  "snippet",
  "matchedFields",
  "matchedPaths",
  "updatedAt",
  "publishedAt",
]);

export const akariSortSchema = z.string().regex(sortPattern);

export const akariQueryInputSchema = z.strictObject({
  q: z.string().trim().min(1).max(500).optional(),
  mode: akariModeSchema.default("lexical"),
  collections: z.array(z.string().regex(identifierPattern).max(128)).min(1).max(50).optional(),
  filter: akariFilterSchema.optional(),
  paths: z.array(akariPathFilterSchema).max(25).optional(),
  select: z.array(akariSelectFieldSchema).min(1).max(25).optional(),
  facets: z.array(akariFacetSchema).max(25).optional(),
  sort: z.array(akariSortSchema).max(5).optional(),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  after: z.string().min(1).max(500).nullable().optional(),
  explain: z.boolean().optional(),
});

export const akariResolveInputSchema = akariQueryInputSchema
  .omit({ facets: true })
  .extend({
    maxAlternatives: z.number().int().min(0).max(10).optional(),
  })
  .strict();
