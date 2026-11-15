const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SHAPE = /^(0[1-9]|[1-2][0-9]|3[0-9])[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/**
 * Checks a GSTIN's shape (state code, PAN, entity, "Z") and its check character. This proves the
 * number is well formed, not that the GST portal has it: nothing here calls the portal.
 */
export function isValidGstin(value: string): boolean {
  const g = value.trim().toUpperCase();
  if (!SHAPE.test(g)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = CHARS.indexOf(g[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36] === g[14];
}

export const normaliseGstin = (value: string) => value.trim().toUpperCase();
