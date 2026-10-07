import type { JsonObject, JsonValue } from "./types.js";
/** Deep-copy a plain data record, rejecting NaN and anything that is not plain data. */
export declare function toJsonObject(value: object, path?: string): JsonObject;
/** Replace `±Infinity`, which JSON cannot represent, with `{ special: ... }` tags; reject NaN. */
export declare function tagSpecialNumbers(value: unknown): JsonValue;
/** Inverse of `tagSpecialNumbers`, applied to freshly parsed JSON. */
export declare function reviveSpecialNumbers(value: unknown): unknown;
//# sourceMappingURL=json.d.ts.map