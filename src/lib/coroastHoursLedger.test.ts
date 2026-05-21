import { describe, it, expect } from 'vitest';
import {
  HOURS_LEDGER_SIGN,
  consumedHours,
  refundedHours,
  refundedHoursFiftyPercent,
} from './coroastHoursLedger';

type LedgerEntry = {
  entry_type: 'BOOKING_CONFIRMED' | 'BOOKING_RETURNED';
  hours_delta: number;
};

const sumLedger = (entries: LedgerEntry[]) =>
  entries.reduce((acc, e) => acc + e.hours_delta, 0);

describe('coroastHoursLedger sign convention', () => {
  it('defines POSITIVE = consumed, NEGATIVE = refunded', () => {
    expect(HOURS_LEDGER_SIGN.CONSUMED).toBe(1);
    expect(HOURS_LEDGER_SIGN.REFUNDED).toBe(-1);
  });

  it('consumedHours always returns a positive delta', () => {
    expect(consumedHours(2)).toBe(2);
    expect(consumedHours(-2)).toBe(2);
    expect(consumedHours(0.5)).toBe(0.5);
  });

  it('refundedHours always returns a negative delta', () => {
    expect(refundedHours(2)).toBe(-2);
    expect(refundedHours(-2)).toBe(-2);
    expect(refundedHours(0.5)).toBe(-0.5);
  });

  it('refundedHoursFiftyPercent returns negative half of duration', () => {
    expect(refundedHoursFiftyPercent(4)).toBe(-2);
    expect(refundedHoursFiftyPercent(3)).toBe(-1.5);
  });
});

describe('billing period ledger sums', () => {
  // Simulates the four flows specified in the task. Each booking is 4 hours.
  // Net hours_delta over a billing period must equal what the member is billed for.

  const DURATION = 4;

  it('full booking with no cancellation: net = +duration (consumed)', () => {
    const ledger: LedgerEntry[] = [
      { entry_type: 'BOOKING_CONFIRMED', hours_delta: consumedHours(DURATION) },
    ];
    expect(sumLedger(ledger)).toBe(4);
  });

  it('48h-cancel (free, ≥48h notice): net = 0 hours billed', () => {
    const ledger: LedgerEntry[] = [
      { entry_type: 'BOOKING_CONFIRMED', hours_delta: consumedHours(DURATION) },
      { entry_type: 'BOOKING_RETURNED', hours_delta: refundedHours(DURATION) },
    ];
    expect(sumLedger(ledger)).toBe(0);
  });

  it('free cancellation refund equals the original consumption', () => {
    const consumed = consumedHours(DURATION);
    const refunded = refundedHours(DURATION);
    expect(consumed + refunded).toBe(0);
  });

  it('50%-cancel (24–48h notice): net = +half duration billed', () => {
    const ledger: LedgerEntry[] = [
      { entry_type: 'BOOKING_CONFIRMED', hours_delta: consumedHours(DURATION) },
      { entry_type: 'BOOKING_RETURNED', hours_delta: refundedHoursFiftyPercent(DURATION) },
    ];
    expect(sumLedger(ledger)).toBe(2);
  });

  it('100%-cancel (no-show / <24h): no refund entry, full duration billed', () => {
    const ledger: LedgerEntry[] = [
      { entry_type: 'BOOKING_CONFIRMED', hours_delta: consumedHours(DURATION) },
    ];
    expect(sumLedger(ledger)).toBe(4);
  });

  it('multiple bookings + mixed cancellations sum correctly across a period', () => {
    const ledger: LedgerEntry[] = [
      // Booking A: 4h, free-cancelled
      { entry_type: 'BOOKING_CONFIRMED', hours_delta: consumedHours(4) },
      { entry_type: 'BOOKING_RETURNED', hours_delta: refundedHours(4) },
      // Booking B: 2h, 50%-cancelled
      { entry_type: 'BOOKING_CONFIRMED', hours_delta: consumedHours(2) },
      { entry_type: 'BOOKING_RETURNED', hours_delta: refundedHoursFiftyPercent(2) },
      // Booking C: 3h, kept
      { entry_type: 'BOOKING_CONFIRMED', hours_delta: consumedHours(3) },
    ];
    // A: 0, B: 1, C: 3  => 4
    expect(sumLedger(ledger)).toBe(4);
  });
});
