import type { Format, SourceEncoding } from "./types.js";
/**
 * Zemax files are UTF-8, UTF-16 (with or without a byte-order mark) or Latin-1; OSLO files are
 * UTF-8 or Windows-1252.
 */
export declare function decodeBytes(data: Uint8Array, format: Format): {
    text: string;
    encoding: SourceEncoding;
};
//# sourceMappingURL=encoding.d.ts.map