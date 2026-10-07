import { decodeBytes } from "./encoding.js";
import { jsonSafe, normalize } from "./normalize.js";
import { parseOslo } from "./oslo.js";
import { parseZemax } from "./zemax.js";
import type { NormalizedPrescription, ParseOptions } from "./types.js";

export type { Diagnostic, Format, JsonValue, JsonObject, MaterialRecord, NormalizedPrescription, NormalizedSurface, OpticalNumber, ParseOptions } from "./types.js";

function parseDecoded(text: string, options: ParseOptions, encoding: string): NormalizedPrescription {
  const filename = options.filename ?? "<memory>", strict = options.strict ?? false;
  text = text.replace(/^\uFEFF+/, "");
  if (options.format !== "zemax" && options.format !== "oslo") throw new Error("format must be 'zemax' or 'oslo'");
  const model = options.format === "zemax" ? parseZemax(text, filename) : parseOslo(text, filename, strict);
  return normalize(model, options.format, filename, encoding, strict);
}
export function parseText(text: string, options: ParseOptions): NormalizedPrescription {
  return parseDecoded(text, options, "text");
}
export function parseBytes(data: Uint8Array | ArrayBuffer, options: ParseOptions): NormalizedPrescription {
  const decoded = decodeBytes(data instanceof Uint8Array ? data : new Uint8Array(data), options.format);
  return parseDecoded(decoded.text, options, decoded.encoding);
}
/** Strict portable JSON; intentional infinities are tagged, NaN is rejected. */
export function stringify(data: NormalizedPrescription, indent = 2): string {
  return JSON.stringify(jsonSafe(data), null, indent) + "\n";
}
