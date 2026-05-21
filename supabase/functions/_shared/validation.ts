// Shared input validators for edge functions.

// RFC5322-ish — not exhaustive, rejects obvious garbage and over-length.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_EMAIL_LEN = 254;

export function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_EMAIL_LEN && EMAIL_RE.test(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
