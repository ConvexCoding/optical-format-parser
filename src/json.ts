import { DeclarationError } from "./errors.js";
import type { JsonObject, JsonValue } from "./types.js";

type SpecialNumber = { special: "positiveInfinity" | "negativeInfinity" };

function walk(value: unknown, path: string, tagInfinity: boolean): JsonValue {
  if (typeof value === "number") {
    if (Number.isNaN(value)) throw new DeclarationError(`${path}: NaN is not valid prescription data`);
    if (tagInfinity && !Number.isFinite(value)) {
      return { special: value > 0 ? "positiveInfinity" : "negativeInfinity" } satisfies SpecialNumber;
    }
    return value;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item, i) => walk(item, `${path}[${i}]`, tagInfinity));
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, walk(item, `${path}.${key}`, tagInfinity)]),
    );
  }
  throw new DeclarationError(`${path}: cannot serialize ${typeof value}`);
}

/** Deep-copy a plain data record, rejecting NaN and anything that is not plain data. */
export function toJsonObject(value: object, path = "$"): JsonObject {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item, `${path}.${key}`, false)]));
}

/** Replace `±Infinity`, which JSON cannot represent, with `{ special: ... }` tags; reject NaN. */
export function tagSpecialNumbers(value: unknown): JsonValue {
  return walk(value, "$", true);
}

/** Inverse of `tagSpecialNumbers`, applied to freshly parsed JSON. */
export function reviveSpecialNumbers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reviveSpecialNumbers);
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value);
  if (entries.length === 1 && entries[0]?.[0] === "special") {
    if (entries[0][1] === "positiveInfinity") return Infinity;
    if (entries[0][1] === "negativeInfinity") return -Infinity;
  }
  return Object.fromEntries(entries.map(([key, item]) => [key, reviveSpecialNumbers(item)]));
}
