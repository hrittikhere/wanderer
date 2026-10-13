// Identifier ordering shared by the helpers and the plugin registry.

/**
 * Compares two ids by Unicode code point, never by locale and never by UTF-16
 * code unit: an astral id (a surrogate pair) sorts after every BMP character,
 * which is the order a code-point comparator in another runtime produces.
 */
export function compareIds(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  let index = 0;
  while (index < length) {
    const left = a.codePointAt(index) as number;
    const right = b.codePointAt(index) as number;
    if (left !== right) return left < right ? -1 : 1;
    index += left > 0xffff ? 2 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}
