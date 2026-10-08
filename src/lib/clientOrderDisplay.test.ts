import { describe, it, expect } from 'vitest';
import {
  plannedShipDate,
  clientDeliveryLabel,
  stripSoonestPrefix,
  withSoonestPrefix,
  SOONEST_NOTE_PREFIX,
} from './clientOrderDisplay';

describe('plannedShipDate', () => {
  // 2026-10-07 is a Wednesday. Vancouver is UTC-7 (PDT) in October.
  it('AM deadline ships the same day', () => {
    expect(plannedShipDate('2026-10-07T15:00:00Z')).toBe('2026-10-07'); // 08:00
  });

  it('Noon deadline ships the same day', () => {
    expect(plannedShipDate('2026-10-07T19:00:00Z')).toBe('2026-10-07'); // 12:00
  });

  it('PM deadline ships the next day', () => {
    expect(plannedShipDate('2026-10-07T23:00:00Z')).toBe('2026-10-08'); // 16:00
  });

  it('Friday PM deadline ships Monday', () => {
    expect(plannedShipDate('2026-10-09T23:00:00Z')).toBe('2026-10-12');
  });

  it('uses the Vancouver calendar day, not UTC', () => {
    // 2026-10-08 02:00 UTC = 2026-10-07 19:00 Vancouver (PM) → Thursday.
    expect(plannedShipDate('2026-10-08T02:00:00Z')).toBe('2026-10-08');
  });

  it('returns null without a deadline', () => {
    expect(plannedShipDate(null)).toBeNull();
    expect(plannedShipDate('not a date')).toBeNull();
  });
});

describe('clientDeliveryLabel', () => {
  it('collapses courier and delivery to Delivered', () => {
    expect(clientDeliveryLabel('PICKUP')).toBe('Pickup');
    expect(clientDeliveryLabel('DELIVERY')).toBe('Delivered');
    expect(clientDeliveryLabel('COURIER')).toBe('Delivered');
  });
});

describe('soonest prefix', () => {
  it('round-trips', () => {
    expect(stripSoonestPrefix(`${SOONEST_NOTE_PREFIX} side door`)).toBe('side door');
    expect(stripSoonestPrefix('plain note')).toBe('plain note');
    expect(withSoonestPrefix('side door')).toBe(`${SOONEST_NOTE_PREFIX} side door`);
    expect(withSoonestPrefix('  ')).toBe(SOONEST_NOTE_PREFIX);
  });
});
