/** Normalise a header string for fuzzy matching.
 *  Lowercases, strips all non-alphanumeric characters (punctuation, whitespace,
 *  parentheses), so e.g. "No. Pesanan", "no pesanan", "NO-PESANAN" all collapse
 *  to "nopesanan". Uses Unicode-aware regex to preserve non-ASCII letters. */
export function normalizeHeader(s: string): string {
    return String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}
