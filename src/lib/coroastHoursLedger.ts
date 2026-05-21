/**
 * Canonical sign convention for `coroast_hour_ledger.hours_delta`.
 *
 * POSITIVE = hours consumed (a booking debits the account's hour balance)
 * NEGATIVE = hours refunded (a cancellation credits hours back)
 *
 * Every write to `coroast_hour_ledger` — from the admin UI, member-portal
 * SECURITY DEFINER RPCs, or any future automation — must match this rule so
 * that `SUM(hours_delta)` over a billing period equals net hours consumed.
 */
export const HOURS_LEDGER_SIGN = {
  CONSUMED: 1,
  REFUNDED: -1,
} as const;

export function consumedHours(hours: number): number {
  return Math.abs(hours) * HOURS_LEDGER_SIGN.CONSUMED;
}

export function refundedHours(hours: number): number {
  return Math.abs(hours) * HOURS_LEDGER_SIGN.REFUNDED;
}

/**
 * Hours refunded on a 50% cancellation (24–48h notice): half the booking
 * duration is credited back, the other half is billed via cancellation_fee_amt.
 */
export function refundedHoursFiftyPercent(durationHours: number): number {
  return refundedHours(durationHours * 0.5);
}
