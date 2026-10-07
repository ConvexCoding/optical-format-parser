import type { Format } from "./types.js";

const cp1252: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021,
  0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d,
  0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};
function singleByte(data: Uint8Array, windows: boolean): string {
  const chars = [];
  for (const byte of data) {
    if (windows && [0x81, 0x8d, 0x8f, 0x90, 0x9d].includes(byte)) throw new Error("Undefined Windows-1252 byte");
    chars.push(String.fromCharCode(windows ? cp1252[byte] ?? byte : byte));
  }
  return chars.join("");
}
export function decodeBytes(data: Uint8Array, format: Format): { text: string; encoding: string } {
  if (format !== "zemax" && format !== "oslo") throw new Error("format must be 'zemax' or 'oslo'");
  if (format === "zemax") {
    if ((data[0] === 0xff && data[1] === 0xfe) || (data[0] === 0xfe && data[1] === 0xff)) {
      const encoding = data[0] === 0xff ? "utf-16-le" : "utf-16-be";
      return { text: new TextDecoder(encoding.replace("utf-16-", "utf-16"), { fatal: true, ignoreBOM: true }).decode(data.subarray(2)), encoding };
    }
    const sample = data.subarray(0, 256);
    if (sample.length >= 4 && sample.filter(b => b === 0).length > Math.floor(sample.length / 4)) {
      let even = 0, odd = 0;
      sample.forEach((b, i) => { if (b === 0) { if (i % 2) odd++; else even++; } });
      const encoding = odd >= even ? "utf-16-le" : "utf-16-be";
      return { text: new TextDecoder(encoding.replace("utf-16-", "utf-16"), { fatal: true }).decode(data), encoding };
    }
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(data), encoding: "utf-8" };
  } catch {
    return { text: singleByte(data, format === "oslo"), encoding: format === "zemax" ? "iso-8859-1" : "cp1252" };
  }
}
