import { decodeBytes } from "./encoding.js";
import { DeclarationError, PrescriptionParseError } from "./errors.js";
import { reviveSpecialNumbers, tagSpecialNumbers } from "./json.js";
import { normalizeOslo, normalizeZemax } from "./normalize.js";
import { parseOslo } from "./oslo.js";
import { parseZemax } from "./zemax.js";
export { PrescriptionParseError } from "./errors.js";
const SCHEMA_VERSION = "2.0";
function resolveOptions(options) {
    if (options === null || typeof options !== "object") {
        throw new PrescriptionParseError("invalid_options", "options must be an object with a format");
    }
    const { format } = options;
    if (format !== "zemax" && format !== "oslo") {
        throw new PrescriptionParseError("invalid_options", "format must be 'zemax' or 'oslo'");
    }
    return { format, strict: options.strict ?? false, includeRaw: options.includeRaw ?? false };
}
/** Run a parsing stage, turning bad input found below the public boundary into the public error. */
function stage(code, action) {
    try {
        return action();
    }
    catch (error) {
        if (!(error instanceof DeclarationError))
            throw error;
        throw new PrescriptionParseError(code, error.message, { cause: error });
    }
}
function parseDecoded(text, encoding, options) {
    const { format, strict, includeRaw } = options;
    const context = { encoding, strict, includeRaw };
    const source = text.replace(/^\ufeff+/, "");
    return stage("invalid_prescription", () => format === "zemax" ? normalizeZemax(parseZemax(source), context) : normalizeOslo(parseOslo(source), context));
}
function toBytes(data) {
    if (data instanceof Uint8Array)
        return data;
    if (ArrayBuffer.isView(data))
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    // The tag check also accepts an ArrayBuffer from another realm, such as an iframe or worker.
    if (data instanceof ArrayBuffer || Object.prototype.toString.call(data) === "[object ArrayBuffer]") {
        return new Uint8Array(data);
    }
    throw new PrescriptionParseError("invalid_options", "data must be a Uint8Array or ArrayBuffer");
}
/** Return bad-input errors as values; anything else is a bug and keeps propagating. */
function attempt(action) {
    try {
        return [action(), null];
    }
    catch (error) {
        if (error instanceof PrescriptionParseError)
            return [null, error];
        throw error;
    }
}
/**
 * Parse the text of a prescription. Bad input, or any warning when `strict` is set, comes back
 * as the error; this does not throw for it.
 *
 *     const [prescription, error] = parseText(contents, { format: "zemax" });
 */
export function parseText(text, options) {
    return attempt(() => {
        if (typeof text !== "string")
            throw new PrescriptionParseError("invalid_options", "text must be a string");
        return parseDecoded(text, "text", resolveOptions(options));
    });
}
/**
 * Parse the undecoded bytes of a prescription, detecting the text encoding. Bad input, or any
 * warning when `strict` is set, comes back as the error; this does not throw for it.
 */
export function parseBytes(data, options) {
    return attempt(() => {
        const resolved = resolveOptions(options);
        const bytes = toBytes(data);
        const decoded = stage("decoding_failed", () => decodeBytes(bytes, resolved.format));
        return parseDecoded(decoded.text, decoded.encoding, resolved);
    });
}
/**
 * Serialize to portable JSON with a trailing newline. JSON has no infinity, so infinite radii and
 * thicknesses are written as `{ "special": "positiveInfinity" }`; read the text back with
 * `parseJson`, not `JSON.parse`, to restore them.
 */
export function stringify(prescription, indent = 2) {
    return JSON.stringify(tagSpecialNumbers(prescription), null, indent) + "\n";
}
/**
 * Read back text written by `stringify`. This checks the schema version only; validate untrusted
 * JSON against the published schema first. Anything else comes back as an `invalid_json` error.
 */
export function parseJson(json) {
    return attempt(() => {
        let value;
        try {
            value = reviveSpecialNumbers(JSON.parse(json));
        }
        catch (error) {
            throw new PrescriptionParseError("invalid_json", "Input is not valid JSON", { cause: error });
        }
        if (!isPrescription(value)) {
            throw new PrescriptionParseError("invalid_json", `Input is not a schema ${SCHEMA_VERSION} prescription`);
        }
        return value;
    });
}
function isPrescription(value) {
    return (typeof value === "object" && value !== null && "schemaVersion" in value && value.schemaVersion === SCHEMA_VERSION);
}
//# sourceMappingURL=index.js.map