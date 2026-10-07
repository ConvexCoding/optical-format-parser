import type { OsloModel } from "./models.js";
export declare function tokenize(statement: string): string[];
export declare function decodeText(value: string): string;
/** d, F and C lines: OSLO's default wavelengths, in micrometers. */
export declare const DEFAULT_WAVELENGTHS: number[];
export declare function parseOslo(text: string): OsloModel;
//# sourceMappingURL=oslo.d.ts.map