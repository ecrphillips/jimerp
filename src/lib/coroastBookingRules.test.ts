import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildResolvedBookingRules,
  type AccountBookingRulesRow,
  type TierBookingRulesRow,
  type BookingRulesAuditRow,
} from './coroastBookingRules';

const baseAccount = (overrides: Partial<AccountBookingRulesRow> = {}): AccountBookingRulesRow => ({
  id: 'acct-1',
  coroast_tier: 'MEMBER',
  coroast_custom_booking_horizon_days: null,
  coroast_custom_cancellation_free_hours: null,
  coroast_custom_min_booking_duration_hours: null,
  coroast_custom_max_booking_duration_hours: null,
  coroast_custom_allow_recurring_bookings: null,
  ...overrides,
});

const memberTierRow: TierBookingRulesRow = {
  booking_horizon_days: 28,
  cancellation_free_hours: 48,
  min_booking_duration_hours: 0.5,
  max_booking_duration_hours: 8,
  allow_recurring_bookings: false,
  allow_past_dated_bookings: false,
};

const growthTierRow: TierBookingRulesRow = {
  ...memberTierRow,
  booking_horizon_days: 365,
  allow_recurring_bookings: true,
};

describe('buildResolvedBookingRules', () => {
  it('no override → every field is TIER_DEFAULT with tier values', () => {
    const resolved = buildResolvedBookingRules(baseAccount(), memberTierRow);
    expect(resolved.bookingHorizonDays).toEqual({ value: 28, source: 'TIER_DEFAULT' });
    expect(resolved.cancellationFreeHours).toEqual({ value: 48, source: 'TIER_DEFAULT' });
    expect(resolved.minBookingDurationHours).toEqual({ value: 0.5, source: 'TIER_DEFAULT' });
    expect(resolved.maxBookingDurationHours).toEqual({ value: 8, source: 'TIER_DEFAULT' });
    expect(resolved.allowRecurringBookings).toEqual({ value: false, source: 'TIER_DEFAULT' });
    expect(resolved.allowPastDatedBookings).toEqual({ value: false, source: 'TIER_DEFAULT' });
  });

  it('partial override → overridden fields ACCOUNT_OVERRIDE, others TIER_DEFAULT', () => {
    const account = baseAccount({
      coroast_custom_booking_horizon_days: 60,
      coroast_custom_allow_recurring_bookings: true,
    });
    const audit: Record<string, BookingRulesAuditRow> = {
      booking_horizon_days: {
        id: 'a1', source: 'ACCOUNT', tier: null, account_id: 'acct-1',
        changed_field: 'booking_horizon_days', old_value: null, new_value: '60',
        changed_by: 'user-1', changed_at: '2026-05-12T10:00:00Z',
      },
    };
    const resolved = buildResolvedBookingRules(account, memberTierRow, audit);
    expect(resolved.bookingHorizonDays).toEqual({
      value: 60,
      source: 'ACCOUNT_OVERRIDE',
      updatedAt: '2026-05-12T10:00:00Z',
      updatedBy: 'user-1',
    });
    expect(resolved.allowRecurringBookings.source).toBe('ACCOUNT_OVERRIDE');
    expect(resolved.allowRecurringBookings.value).toBe(true);
    expect(resolved.cancellationFreeHours).toEqual({ value: 48, source: 'TIER_DEFAULT' });
    expect(resolved.maxBookingDurationHours).toEqual({ value: 8, source: 'TIER_DEFAULT' });
  });

  it('boolean override of false (not null) is honoured, not collapsed to tier default', () => {
    const account = baseAccount({
      coroast_tier: 'GROWTH',
      coroast_custom_allow_recurring_bookings: false,
    });
    const resolved = buildResolvedBookingRules(account, growthTierRow);
    expect(resolved.allowRecurringBookings.source).toBe('ACCOUNT_OVERRIDE');
    expect(resolved.allowRecurringBookings.value).toBe(false);
  });

  describe('defensive fallback when tier row missing', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('falls back to hardcoded MEMBER constants and warns', () => {
      const resolved = buildResolvedBookingRules(baseAccount(), null);
      expect(resolved.bookingHorizonDays.value).toBe(28);
      expect(resolved.cancellationFreeHours.value).toBe(48);
      expect(resolved.allowRecurringBookings.value).toBe(false);
      expect(warnSpy).toHaveBeenCalledOnce();
    });

    it('uses tier-specific fallback for GROWTH when tier row missing', () => {
      const resolved = buildResolvedBookingRules(baseAccount({ coroast_tier: 'GROWTH' }), null);
      expect(resolved.bookingHorizonDays.value).toBe(365);
      expect(resolved.allowRecurringBookings.value).toBe(true);
    });

    it('falls back to MEMBER when tier is unknown', () => {
      const resolved = buildResolvedBookingRules(
        baseAccount({ coroast_tier: 'FUTURE_TIER' as string }),
        null,
      );
      expect(resolved.bookingHorizonDays.value).toBe(28);
      expect(resolved.allowRecurringBookings.value).toBe(false);
    });
  });
});
