import { DeclarationError } from "./errors.js";

/** The line boundaries Python's `str.splitlines` recognizes, which the upstream importers rely on. */
export const LINE_BREAKS = /\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/;

const NUMBER = /^[+-]?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|inf(?:inity)?|nan)$/i;

/** Complete-token numeric conversion; reject partially numeric strings. */
export function parseNumber(token: string | undefined): number {
  if (token === undefined || !NUMBER.test(token)) throw new DeclarationError(`Invalid numeric token: ${String(token)}`);
  if (/^[+-]?inf(?:inity)?$/i.test(token)) return token.startsWith("-") ? -Infinity : Infinity;
  if (/^[+-]?nan$/i.test(token)) return NaN;
  return Number(token);
}

export function parseInteger(token: string | undefined): number {
  if (token === undefined || !/^[+-]?\d+$/.test(token)) throw new DeclarationError(`Invalid integer: ${String(token)}`);
  const value = Number(token);
  if (!Number.isSafeInteger(value)) throw new DeclarationError(`Integer outside supported range: ${token}`);
  return value;
}

export function isNumberToken(token: string | undefined): boolean {
  return token !== undefined && NUMBER.test(token);
}

export function requireLength(tokens: readonly string[], length: number, message?: string): void {
  if (tokens.length !== length) {
    throw new DeclarationError(message ?? `${tokens[0]} requires ${length - 1} argument(s)`);
  }
}
