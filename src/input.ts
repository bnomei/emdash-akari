import {
  akariJsonPathSchema,
  akariMetadataOperatorSchema,
  akariModeSchema,
  akariPathOperatorSchema,
  akariQueryInputSchema,
  akariResolveInputSchema,
} from "./schema";
import type {
  AkariMetadataOperator,
  AkariMode,
  AkariPathOperator,
  AkariValidatedQueryInput,
  AkariValidatedResolveInput,
} from "./types";

export type AkariNormalizedQueryInput = AkariValidatedQueryInput;

export type AkariNormalizedResolveInput = AkariValidatedResolveInput;

export function normalizeQueryInput(input: unknown): AkariNormalizedQueryInput {
  return akariQueryInputSchema.parse(input ?? {});
}

export function normalizeResolveInput(input: unknown): AkariNormalizedResolveInput {
  return akariResolveInputSchema.parse(input ?? {});
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isAkariMode(value: unknown): value is AkariMode {
  return akariModeSchema.safeParse(value).success;
}

export function isAkariMetadataOperator(value: unknown): value is AkariMetadataOperator {
  return akariMetadataOperatorSchema.safeParse(value).success;
}

export function isAkariPathOperator(value: unknown): value is AkariPathOperator {
  return akariPathOperatorSchema.safeParse(value).success;
}

export function isAkariJsonPath(value: unknown): value is string {
  return akariJsonPathSchema.safeParse(value).success;
}
