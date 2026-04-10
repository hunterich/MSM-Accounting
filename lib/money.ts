/**
 * Shared monetary arithmetic helpers.
 *
 * Use these across the entire codebase instead of defining local versions.
 * All functions assume 2-decimal-place precision (IDR / cents).
 */

/**
 * Safely coerce an unknown value to a finite number. Returns 0 for null,
 * undefined, NaN, Infinity, or non-numeric strings.
 */
export const toNumber = (value: unknown): number => {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Round a number to 2 decimal places using the epsilon trick to avoid
 * floating-point rounding errors (e.g. 1.005 → 1.01).
 */
export const asMoney = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

/** Alias used by bill-imports and other modules. */
export const roundMoney = asMoney;
