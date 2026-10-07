/** Python-compatible complete-token numeric conversion, not parseFloat prefixes. */
export function number(token: string | undefined): number {
  if (token === undefined || !/^[+-]?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|inf(?:inity)?|nan)$/i.test(token)) {
    throw new Error(`Invalid numeric token: ${String(token)}`);
  }
  if (/^[+-]?inf(?:inity)?$/i.test(token)) return token.startsWith("-") ? -Infinity : Infinity;
  if (/^[+-]?nan$/i.test(token)) return NaN;
  return Number(token);
}
export function integer(token: string | undefined): number {
  if (token === undefined || !/^[+-]?\d+$/.test(token)) throw new Error(`Invalid integer: ${String(token)}`);
  const value = Number(token);
  if (!Number.isSafeInteger(value)) throw new Error(`Integer outside supported range: ${token}`);
  return value;
}
export function requireLength(tokens: string[], length: number, message?: string): void {
  if (tokens.length !== length) throw new Error(message ?? `${tokens[0]} requires ${length - 1} argument(s)`);
}
