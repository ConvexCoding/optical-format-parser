import type { Diagnostic, NormalizedPrescription } from "./types.js";
export type ParseErrorCode = 
/** `options` is missing or `format` is not one of the supported formats. */
"invalid_options"
/** The input bytes are not valid text in any encoding the format supports. */
 | "decoding_failed"
/** The file is malformed or declares values that cannot be a prescription. */
 | "invalid_prescription"
/** `strict` was set and the import produced warnings; see `diagnostics`. */
 | "strict_violation"
/** `parseJson` was given something that is not a serialized prescription. */
 | "invalid_json";
export interface ParseErrorDetails {
    line?: number;
    command?: string;
    diagnostics?: Diagnostic[];
    cause?: unknown;
}
/** The error the parsing functions return for bad input. They never throw it. */
export declare class PrescriptionParseError extends Error {
    readonly name = "PrescriptionParseError";
    readonly code: ParseErrorCode;
    /** 1-based source line, when the problem is tied to one. */
    readonly line: number | undefined;
    /** The source command being read, when the problem is tied to one. */
    readonly command: string | undefined;
    /** For `strict_violation`: every diagnostic of the rejected import. Otherwise empty. */
    readonly diagnostics: Diagnostic[];
    constructor(code: ParseErrorCode, message: string, details?: ParseErrorDetails);
}
/**
 * What the parsing functions return: the value and `null`, or `null` and the error. Destructure it
 * and check the error first; that narrows the value.
 *
 *     const [prescription, error] = parseText(contents, { format: "zemax" });
 *     if (error) return report(error);
 *     prescription.surfaces;
 */
export type Result<T> = [value: T, error: null] | [value: null, error: PrescriptionParseError];
export type ParseResult = Result<NormalizedPrescription>;
/** Internal: bad input found below the public boundary, where the source line is not known. */
export declare class DeclarationError extends Error {
}
//# sourceMappingURL=errors.d.ts.map