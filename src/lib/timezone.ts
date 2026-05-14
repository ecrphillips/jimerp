import { formatInTimeZone, toZonedTime } from 'date-fns-tz';
import { format as fnsFormat } from 'date-fns';

/**
 * Business timezone for Home Island Coffee Partners (BC, Canada).
 * All booking date/time math must funnel through this constant so a
 * single edit moves the whole app to another zone.
 */
export const DEFAULT_TZ = 'America/Vancouver';

/** ISO date (YYYY-MM-DD) for the given moment, in DEFAULT_TZ. */
export function isoDateInTz(d: Date | number = new Date(), tz: string = DEFAULT_TZ): string {
  return formatInTimeZone(d, tz, 'yyyy-MM-dd');
}

/** HH:mm for the given moment, in DEFAULT_TZ. */
export function isoTimeInTz(d: Date | number = new Date(), tz: string = DEFAULT_TZ): string {
  return formatInTimeZone(d, tz, 'HH:mm');
}

/**
 * Convert a YYYY-MM-DD string to a Date pinned to midnight in DEFAULT_TZ.
 * Avoids the native `new Date('YYYY-MM-DD')` UTC-parse pitfall that shifts
 * the day by one in negative-offset zones.
 */
export function dateOnlyToZonedDate(dateOnly: string, tz: string = DEFAULT_TZ): Date {
  return toZonedTime(`${dateOnly}T00:00:00`, tz);
}

/** Format a YYYY-MM-DD date-only string with a date-fns pattern, in DEFAULT_TZ. */
export function formatDateOnly(dateOnly: string, pattern: string, tz: string = DEFAULT_TZ): string {
  return formatInTimeZone(`${dateOnly}T00:00:00`, tz, pattern);
}

/** Today's date-only ISO string in DEFAULT_TZ. */
export function todayInTz(tz: string = DEFAULT_TZ): string {
  return isoDateInTz(new Date(), tz);
}

/** Day-of-week index (0=Sun..6=Sat) for a YYYY-MM-DD in DEFAULT_TZ. */
export function dowInTz(dateOnly: string, tz: string = DEFAULT_TZ): number {
  return Number(formatInTimeZone(`${dateOnly}T00:00:00`, tz, 'i')) % 7;
  // date-fns 'i' returns 1..7 (Mon..Sun); modulo to get JS-style 0..6 Sun..Sat
}

/** Re-export for callers that only need raw date-fns format (no tz). */
export { fnsFormat };
