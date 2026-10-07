import { decodeBytes } from "./encoding.js";
import { DeclarationError, PrescriptionParseError } from "./errors.js";
import type { ParseResult } from "./errors.js";
import { reviveSpecialNumbers, tagSpecialNumbers } from "./json.js";
import { normalizeOslo, normalizeZemax } from "./normalize.js";
import type { NormalizeContext } from "./normalize.js";
import { parseOslo } from "./oslo.js";
import type { Format, NormalizedPrescription, ParseOptions } from "./types.js";
import { parseZemax } from "./zemax.js";

export { PrescriptionParseError } from "./errors.js";
export type { ParseErrorCode, ParseErrorDetails, ParseResult } from "./errors.js";
export type * from "./types.js";

const SCHEMA_VERSION: NormalizedPrescription["schemaVersion"] = "2.0";

/** The format implied by a file name's extension (`.zmx` or `.len`), or `null`. */
export function formatFromFilename(filename: string): Format | null {
  const name = filename.toLowerCase();
  if (name.endsWith(".zmx")) return "zemax";
  if (name.endsWith(".len")) return "oslo";
  return null;
}

function resolveOptions(options: ParseOptions): {
  format: Format;
  filename: string;
  strict: boolean;
  includeRaw: boolean;
} {
  if (options === null || typeof options !== "object") {
    throw new PrescriptionParseError("invalid_options", "options must be an object with a format or a filename");
  }
  const filename = options.filename ?? "<memory>";
  const format = options.format ?? formatFromFilename(filename);
  if (format !== "zemax" && format !== "oslo") {
    throw new PrescriptionParseError(
      "invalid_options",
      "format must be 'zemax' or 'oslo', or filename must end in .zmx or .len",
      { filename },
    );
  }
  return { format, filename, strict: options.strict ?? false, includeRaw: options.includeRaw ?? false };
}

/** Run a parsing stage, attaching the filename to bad-input errors raised without one. */
function stage<T>(code: "decoding_failed" | "invalid_prescription", filename: string, action: () => T): T {
  try {
    return action();
  } catch (error) {
    if (!(error instanceof DeclarationError)) throw error;
    throw new PrescriptionParseError(code, error.message, { filename, cause: error });
  }
}

function parseDecoded(
  text: string,
  encoding: NormalizeContext["encoding"],
  options: ReturnType<typeof resolveOptions>,
) {
  const { format, filename, strict, includeRaw } = options;
  const context: NormalizeContext = { filename, encoding, strict, includeRaw };
  const source = text.replace(/^\ufeff+/, "");
  return stage("invalid_prescription", filename, () =>
    format === "zemax"
      ? normalizeZemax(parseZemax(source, filename), context)
      : normalizeOslo(parseOslo(source, filename), context),
  );
}

/**
 * Parse an already decoded prescription.
 * @throws {PrescriptionParseError} for malformed input, or for any warning when `strict` is set.
 */
export function parseText(text: string, options: ParseOptions): NormalizedPrescription {
  return parseDecoded(text, "text", resolveOptions(options));
}

/**
 * Parse a prescription file's bytes, detecting the text encoding.
 * @throws {PrescriptionParseError} for malformed input, or for any warning when `strict` is set.
 */
export function parseBytes(data: Uint8Array | ArrayBuffer, options: ParseOptions): NormalizedPrescription {
  const resolved = resolveOptions(options);
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const decoded = stage("decoding_failed", resolved.filename, () => decodeBytes(bytes, resolved.format));
  return parseDecoded(decoded.text, decoded.encoding, resolved);
}

function safely(action: () => NormalizedPrescription): ParseResult {
  try {
    return { ok: true, prescription: action() };
  } catch (error) {
    if (error instanceof PrescriptionParseError) return { ok: false, error };
    throw error;
  }
}

/** `parseText` that returns bad-input errors instead of throwing them. */
export function safeParseText(text: string, options: ParseOptions): ParseResult {
  return safely(() => parseText(text, options));
}

/** `parseBytes` that returns bad-input errors instead of throwing them. */
export function safeParseBytes(data: Uint8Array | ArrayBuffer, options: ParseOptions): ParseResult {
  return safely(() => parseBytes(data, options));
}

/**
 * Serialize to portable JSON with a trailing newline. JSON has no infinity, so infinite radii and
 * thicknesses are written as `{ "special": "positiveInfinity" }`; read the text back with
 * `parseJson`, not `JSON.parse`, to restore them.
 */
export function stringify(prescription: NormalizedPrescription, indent = 2): string {
  return JSON.stringify(tagSpecialNumbers(prescription), null, indent) + "\n";
}

/**
 * Read back text written by `stringify`. This checks the schema version only; validate untrusted
 * JSON against the published schema first.
 * @throws {PrescriptionParseError} with code `invalid_json`.
 */
export function parseJson(json: string): NormalizedPrescription {
  let value: unknown;
  try {
    value = reviveSpecialNumbers(JSON.parse(json));
  } catch (error) {
    throw new PrescriptionParseError("invalid_json", "Input is not valid JSON", { cause: error });
  }
  if (!isPrescription(value)) {
    throw new PrescriptionParseError("invalid_json", `Input is not a schema ${SCHEMA_VERSION} prescription`);
  }
  return value;
}

function isPrescription(value: unknown): value is NormalizedPrescription {
  return (
    typeof value === "object" && value !== null && "schemaVersion" in value && value.schemaVersion === SCHEMA_VERSION
  );
}
