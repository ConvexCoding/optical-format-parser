import type { Diagnostic, NormalizedPrescription } from "./types.js";

export type ParseErrorCode =
  /** `options` is missing, or the format is neither given nor inferable from the filename. */
  | "invalid_options"
  /** The input bytes are not valid text in any encoding the format supports. */
  | "decoding_failed"
  /** The file is malformed or declares values that cannot be a prescription. */
  | "invalid_prescription"
  /** `strict` was set and the import produced warnings; see `diagnostics`. */
  | "strict_violation"
  /** `parseJson` was given something that is not a serialized prescription. */
  | "invalid_json";

export interface ParseErrorDetails {
  filename?: string;
  line?: number;
  command?: string;
  diagnostics?: Diagnostic[];
  cause?: unknown;
}

/** The only error type the parsing functions throw for bad input. */
export class PrescriptionParseError extends Error {
  override readonly name = "PrescriptionParseError";
  readonly code: ParseErrorCode;
  readonly filename: string | undefined;
  /** 1-based source line, when the problem is tied to one. */
  readonly line: number | undefined;
  /** The source command being read, when the problem is tied to one. */
  readonly command: string | undefined;
  /** For `strict_violation`: every diagnostic of the rejected import. Otherwise empty. */
  readonly diagnostics: Diagnostic[];

  constructor(code: ParseErrorCode, message: string, details: ParseErrorDetails = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.code = code;
    this.filename = details.filename;
    this.line = details.line;
    this.command = details.command;
    this.diagnostics = details.diagnostics ?? [];
  }
}

/** Outcome of the non-throwing `safeParse*` functions. Narrow on `ok`. */
export type ParseResult =
  { ok: true; prescription: NormalizedPrescription } | { ok: false; error: PrescriptionParseError };

/** Internal: bad input found below the public boundary, where filename and line are not known. */
export class DeclarationError extends Error {}
