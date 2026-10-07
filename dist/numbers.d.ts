/** The line boundaries Python's `str.splitlines` recognizes, which the upstream importers rely on. */
export declare const LINE_BREAKS: RegExp;
/** Complete-token numeric conversion; reject partially numeric strings. */
export declare function parseNumber(token: string | undefined): number;
export declare function parseInteger(token: string | undefined): number;
export declare function isNumberToken(token: string | undefined): boolean;
export declare function requireLength(tokens: readonly string[], length: number, message?: string): void;
//# sourceMappingURL=numbers.d.ts.map