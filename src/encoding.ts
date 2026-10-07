import { DeclarationError } from "./errors.js";
import type { Format, SourceEncoding } from "./types.js";

const CP1252 = new Map([
  [0x80, 0x20ac],
  [0x82, 0x201a],
  [0x83, 0x0192],
  [0x84, 0x201e],
  [0x85, 0x2026],
  [0x86, 0x2020],
  [0x87, 0x2021],
  [0x88, 0x02c6],
  [0x89, 0x2030],
  [0x8a, 0x0160],
  [0x8b, 0x2039],
  [0x8c, 0x0152],
  [0x8e, 0x017d],
  [0x91, 0x2018],
  [0x92, 0x2019],
  [0x93, 0x201c],
  [0x94, 0x201d],
  [0x95, 0x2022],
  [0x96, 0x2013],
  [0x97, 0x2014],
  [0x98, 0x02dc],
  [0x99, 0x2122],
  [0x9a, 0x0161],
  [0x9b, 0x203a],
  [0x9c, 0x0153],
  [0x9e, 0x017e],
  [0x9f, 0x0178],
]);
const CP1252_UNDEFINED = [0x81, 0x8d, 0x8f, 0x90, 0x9d];

function decodeSingleByte(data: Uint8Array, windows: boolean): string {
  const chars: string[] = [];
  for (const byte of data) {
    if (windows && CP1252_UNDEFINED.includes(byte)) throw new DeclarationError("Undefined Windows-1252 byte");
    chars.push(String.fromCharCode(windows ? (CP1252.get(byte) ?? byte) : byte));
  }
  return chars.join("");
}

function decodeUtf16(data: Uint8Array, encoding: "utf-16-le" | "utf-16-be"): string {
  const label = encoding === "utf-16-le" ? "utf-16le" : "utf-16be";
  try {
    return new TextDecoder(label, { fatal: true, ignoreBOM: true }).decode(data);
  } catch (error) {
    throw new DeclarationError(`Input is not valid ${encoding.toUpperCase()} text`, { cause: error });
  }
}

/**
 * Zemax files are UTF-8, UTF-16 (with or without a byte-order mark) or Latin-1; OSLO files are
 * UTF-8 or Windows-1252.
 */
export function decodeBytes(data: Uint8Array, format: Format): { text: string; encoding: SourceEncoding } {
  if (format === "zemax") {
    if ((data[0] === 0xff && data[1] === 0xfe) || (data[0] === 0xfe && data[1] === 0xff)) {
      const encoding = data[0] === 0xff ? "utf-16-le" : "utf-16-be";
      return { text: decodeUtf16(data.subarray(2), encoding), encoding };
    }
    // No byte-order mark: mostly-ASCII UTF-16 text has a NUL in every other byte.
    const sample = data.subarray(0, 256);
    if (sample.length >= 4 && sample.filter((byte) => byte === 0).length > Math.floor(sample.length / 4)) {
      let even = 0;
      let odd = 0;
      sample.forEach((byte, i) => {
        if (byte !== 0) return;
        if (i % 2) odd++;
        else even++;
      });
      const encoding = odd >= even ? "utf-16-le" : "utf-16-be";
      return { text: decodeUtf16(data, encoding), encoding };
    }
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(data), encoding: "utf-8" };
  } catch {
    const windows = format === "oslo";
    return { text: decodeSingleByte(data, windows), encoding: windows ? "cp1252" : "iso-8859-1" };
  }
}
