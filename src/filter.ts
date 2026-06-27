import { isRecord } from "./input";
import type { AkariFilter, AkariMetadataFilter, AkariScalar } from "./types";

export type AkariMetadata = Record<string, unknown>;

export function readMetadataField(metadata: AkariMetadata, field: string): unknown {
  const segments = field.split(".");
  let current: unknown = metadata;

  for (const segment of segments) {
    if (!isRecord(current) || !(segment in current)) return undefined;
    current = current[segment];
  }

  return current;
}

export function matchesMetadataFilters(metadata: AkariMetadata, filter?: AkariFilter): boolean {
  if (!filter) return true;

  for (const [field, expected] of Object.entries(filter)) {
    if (!matchesMetadataFilter(readMetadataField(metadata, field), expected)) {
      return false;
    }
  }

  return true;
}

export function matchesMetadataFilter(value: unknown, filter: AkariMetadataFilter): boolean {
  if (!isRecord(filter)) return sameScalar(value, filter);

  if ("$eq" in filter) return sameScalar(value, filter.$eq);
  if ("$ne" in filter) return isAkariScalar(value) && !sameScalar(value, filter.$ne);
  if ("$in" in filter) return filter.$in.some((item) => sameScalar(value, item));
  if ("$nin" in filter)
    return isAkariScalar(value) && filter.$nin.every((item) => !sameScalar(value, item));
  if ("$lt" in filter) return compare(value, filter.$lt) < 0;
  if ("$lte" in filter) return compare(value, filter.$lte) <= 0;
  if ("$gt" in filter) return compare(value, filter.$gt) > 0;
  if ("$gte" in filter) return compare(value, filter.$gte) >= 0;

  return false;
}

export function getStringEqualityFilter(
  filter: AkariFilter | undefined,
  field: string,
): string | undefined {
  const value = filter?.[field];
  if (typeof value === "string") return value;
  if (isRecord(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.$eq === "string") return record.$eq;
  }
  return undefined;
}

export function getStringSetFilter(
  filter: AkariFilter | undefined,
  field: string,
): string[] | undefined {
  const value = filter?.[field];
  if (typeof value === "string") return [value];
  if (isRecord(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.$eq === "string") return [record.$eq];
    if (Array.isArray(record.$in)) {
      const values = record.$in.filter((item): item is string => typeof item === "string");
      return values.length === record.$in.length ? values : undefined;
    }
  }
  return undefined;
}

export function toIndexedMetadataFilter(
  filter: AkariFilter | undefined,
  allowedFields: Iterable<string> = ["collection", "status", "locale", "entry_id"],
): Record<string, unknown> | undefined {
  if (!filter) return undefined;

  const allowed = new Set(allowedFields);
  const out: Record<string, unknown> = {};

  for (const [field, value] of Object.entries(filter)) {
    if (!allowed.has(field) || field.includes(".")) continue;
    out[field] = value;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function sameScalar(value: unknown, expected: AkariScalar): boolean {
  return isAkariScalar(value) && value === expected;
}

function compare(value: unknown, expected: string | number): number {
  if (typeof value === "number" && typeof expected === "number") {
    return value - expected;
  }

  if (typeof value === "string" && typeof expected === "string") {
    return value.localeCompare(expected);
  }

  return Number.NaN;
}

function isAkariScalar(value: unknown): value is AkariScalar {
  return value === null || ["boolean", "number", "string"].includes(typeof value);
}
