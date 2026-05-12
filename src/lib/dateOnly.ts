/**
 * Parse a Postgres DATE column ("YYYY-MM-DD") as a local-time Date.
 * Prevents UTC-midnight rendering one day earlier in negative-offset zones.
 */
export function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
