/** The error the parsing functions return for bad input. They never throw it. */
export class PrescriptionParseError extends Error {
    name = "PrescriptionParseError";
    code;
    /** 1-based source line, when the problem is tied to one. */
    line;
    /** The source command being read, when the problem is tied to one. */
    command;
    /** For `strict_violation`: every diagnostic of the rejected import. Otherwise empty. */
    diagnostics;
    constructor(code, message, details = {}) {
        super(message, details.cause === undefined ? undefined : { cause: details.cause });
        this.code = code;
        this.line = details.line;
        this.command = details.command;
        this.diagnostics = details.diagnostics ?? [];
    }
}
/** Internal: bad input found below the public boundary, where the source line is not known. */
export class DeclarationError extends Error {
}
//# sourceMappingURL=errors.js.map