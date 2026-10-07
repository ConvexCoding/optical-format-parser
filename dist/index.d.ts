import type { ParseResult } from "./errors.js";
import type { NormalizedPrescription, ParseOptions } from "./types.js";
export { PrescriptionParseError } from "./errors.js";
export type { ParseErrorCode, ParseErrorDetails, ParseResult, Result } from "./errors.js";
export type * from "./types.js";
/**
 * Parse the text of a prescription. Bad input, or any warning when `strict` is set, comes back
 * as the error; this does not throw for it.
 *
 *     const [prescription, error] = parseText(contents, { format: "zemax" });
 */
export declare function parseText(text: string, options: ParseOptions): ParseResult;
/**
 * Parse the undecoded bytes of a prescription, detecting the text encoding. Bad input, or any
 * warning when `strict` is set, comes back as the error; this does not throw for it.
 */
export declare function parseBytes(data: Uint8Array | ArrayBuffer, options: ParseOptions): ParseResult;
/**
 * Serialize to portable JSON with a trailing newline. JSON has no infinity, so infinite radii and
 * thicknesses are written as `{ "special": "positiveInfinity" }`; read the text back with
 * `parseJson`, not `JSON.parse`, to restore them.
 */
export declare function stringify(prescription: NormalizedPrescription, indent?: number): string;
/**
 * Read back text written by `stringify`. This checks the schema version only; validate untrusted
 * JSON against the published schema first. Anything else comes back as an `invalid_json` error.
 */
export declare function parseJson(json: string): ParseResult;
//# sourceMappingURL=index.d.ts.map