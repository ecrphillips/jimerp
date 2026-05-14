import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type CoroastTier = Database['public']['Enums']['coroast_tier'];
export type BookingStatus = Database['public']['Enums']['coroast_booking_status'];

export interface MemberRow {
  id: string;
  business_name: string;
  tier: CoroastTier;
  is_active: boolean;
}

export interface BookingRow {
  id: string;
  member_id: string;
  account_id?: string;
  billing_period_id: string;
  booking_date: string;
  start_time: string;
  end_time: string;
  duration_hours: number | null;
  status: string;
  recurring_block_id: string | null;
  notes_internal: string | null;
  accounts: { account_name: string } | null;
}

export interface BlockRow {
  id: string;
  block_date: string;
  start_time: string;
  end_time: string;
  block_type: string;
  notes: string | null;
}

export interface AvailabilityWindow {
  id: string;
  day_of_week: string;
  open_time: string;
  close_time: string;
  is_active: boolean;
  notes: string | null;
}

// Distinct member colors — using HSL-compatible classes
const MEMBER_COLORS = [
  { bg: 'hsl(210 70% 50%)', text: '#fff', class: 'bg-[hsl(210_70%_50%)]' },
  { bg: 'hsl(145 50% 40%)', text: '#fff', class: 'bg-[hsl(145_50%_40%)]' },
  { bg: 'hsl(280 50% 50%)', text: '#fff', class: 'bg-[hsl(280_50%_50%)]' },
  { bg: 'hsl(38 80% 50%)', text: '#fff', class: 'bg-[hsl(38_80%_50%)]' },
  { bg: 'hsl(350 65% 50%)', text: '#fff', class: 'bg-[hsl(350_65%_50%)]' },
  { bg: 'hsl(180 50% 40%)', text: '#fff', class: 'bg-[hsl(180_50%_40%)]' },
  { bg: 'hsl(60 60% 40%)', text: '#fff', class: 'bg-[hsl(60_60%_40%)]' },
  { bg: 'hsl(320 50% 50%)', text: '#fff', class: 'bg-[hsl(320_50%_50%)]' },
];

export function getMemberColor(memberId: string, allMemberIds: string[]) {
  const idx = allMemberIds.indexOf(memberId);
  if (idx < 0) return MEMBER_COLORS[0];
  return MEMBER_COLORS[idx % MEMBER_COLORS.length];
}

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function formatTime12(t: string): string {
  const [h, m] = t.split(':');
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${m} ${ampm}`;
}

const JS_DOW_TO_STRING: Record<number, string> = {
  0: 'SUN', 1: 'MON', 2: 'TUE', 3: 'WED', 4: 'THU', 5: 'FRI', 6: 'SAT',
};

/**
 * Check if a booking falls outside the defined availability window for that day.
 * Returns an error string if outside, null if OK.
 * If no windows are configured at all, returns null (fully open / legacy behaviour).
 */
export function checkAvailabilityWindow(
  date: string,
  startTime: string,
  endTime: string,
  windows: AvailabilityWindow[],
): string | null {
  // If no windows configured at all, treat as fully open (backward compat)
  if (windows.length === 0) return null;

  const dow = JS_DOW_TO_STRING[new Date(date + 'T00:00:00').getDay()];
  const window = windows.find(w => w.day_of_week === dow && w.is_active);
  if (!window) {
    return `Bookings are not available on ${dow.charAt(0) + dow.slice(1).toLowerCase()}`;
  }

  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(endTime);
  const openMin = timeToMinutes(window.open_time);
  const closeMin = timeToMinutes(window.close_time);

  if (startMin < openMin || endMin > closeMin) {
    return `Booking must be within ${formatTime12(window.open_time)} – ${formatTime12(window.close_time)}`;
  }

  return null;
}

export type BusySlot = { booking_date: string; start_time: string; end_time: string };

export function checkOverlap(
  date: string,
  startTime: string,
  endTime: string,
  blocks: BlockRow[],
  bookings: BookingRow[],
  excludeBookingId?: string,
  windows?: AvailabilityWindow[],
  busySlots?: BusySlot[],
): string | null {
  // Check availability window first
  if (windows) {
    const windowErr = checkAvailabilityWindow(date, startTime, endTime, windows);
    if (windowErr) return windowErr;
  }

  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(endTime);

  for (const b of blocks) {
    if (b.block_date !== date) continue;
    const bStart = timeToMinutes(b.start_time);
    const bEnd = timeToMinutes(b.end_time);
    if (startMin < bEnd && endMin > bStart) {
      return `Conflicts with unavailability block (${formatTime12(b.start_time)} – ${formatTime12(b.end_time)})`;
    }
  }

  for (const bk of bookings) {
    if (excludeBookingId && bk.id === excludeBookingId) continue;
    if (bk.booking_date !== date) continue;
    if (['CANCELLED', 'CANCELLED_FREE', 'CANCELLED_CHARGED', 'CANCELLED_WAIVED', 'NO_SHOW'].includes(bk.status)) continue;
    const bStart = timeToMinutes(bk.start_time);
    const bEnd = timeToMinutes(bk.end_time);
    if (startMin < bEnd && endMin > bStart) {
      return `Conflicts with existing booking for ${bk.accounts?.account_name ?? 'a member'} (${formatTime12(bk.start_time)} – ${formatTime12(bk.end_time)})`;
    }
  }

  if (busySlots) {
    for (const s of busySlots) {
      if (s.booking_date !== date) continue;
      const bStart = timeToMinutes(s.start_time);
      const bEnd = timeToMinutes(s.end_time);
      if (startMin < bEnd && endMin > bStart) {
        return `Time slot is already booked (${formatTime12(s.start_time)} – ${formatTime12(s.end_time)})`;
      }
    }
  }

  return null;
}

export type TierRate = {
  base: number;
  includedHours: number;
  overageRate: number;
  packagingBlocksIncluded: number;
  packagingBlockRate: number;
  label: string;
};

// Fallback / synchronous source for non-booking call sites
// (unitEconomics.ts, coroastPricing.ts) that cannot use React Query.
// Source of truth is the `coroast_tier_rates` table; this mirrors the seed.
// Keep in sync with migration 20260514094701_coroast_rpc_hardening.sql.
export const TIER_RATES: Record<string, TierRate> = {
  MEMBER:     { base: 399,   includedHours: 3,  overageRate: 160, packagingBlocksIncluded: 0, packagingBlockRate: 0, label: 'Member' },
  GROWTH:     { base: 859,   includedHours: 7,  overageRate: 145, packagingBlocksIncluded: 0, packagingBlockRate: 0, label: 'Growth' },
  PRODUCTION: { base: 1399,  includedHours: 12, overageRate: 130, packagingBlocksIncluded: 0, packagingBlockRate: 0, label: 'Production' },
  ACCESS:     { base: 300,   includedHours: 3,  overageRate: 135, packagingBlocksIncluded: 0, packagingBlockRate: 0, label: 'Access (Legacy)' },
};

type TierRateRow = {
  tier: CoroastTier;
  base_fee: number;
  included_hours: number;
  overage_rate_per_hr: number;
  label: string;
  is_legacy: boolean;
};

/**
 * Live tier-rate map fetched from `coroast_tier_rates` via the
 * `get_coroast_tier_rates` SECURITY DEFINER RPC. Booking components
 * should prefer this hook so an admin-level rate change propagates
 * without a deploy. Falls back to the bundled `TIER_RATES` constant
 * while the query is in flight or if the RPC errors.
 */
export function useTierRates() {
  const query = useQuery({
    queryKey: ['coroast_tier_rates'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_coroast_tier_rates');
      if (error) throw error;
      return (data ?? []) as TierRateRow[];
    },
  });

  const rates = useMemo<Record<string, TierRate>>(() => {
    if (!query.data || query.data.length === 0) return TIER_RATES;
    const map: Record<string, TierRate> = {};
    for (const r of query.data) {
      map[r.tier] = {
        base: Number(r.base_fee),
        includedHours: Number(r.included_hours),
        overageRate: Number(r.overage_rate_per_hr),
        packagingBlocksIncluded: 0,
        packagingBlockRate: 0,
        label: r.is_legacy && !r.label.includes('Legacy') ? `${r.label} (Legacy)` : r.label,
      };
    }
    return map;
  }, [query.data]);

  return { rates, isLoading: query.isLoading, error: query.error };
}

export const STORAGE_RATES: Record<string, { includedPallets: number; ratePerPallet: number }> = {
  MEMBER:     { includedPallets: 0, ratePerPallet: 175 },
  GROWTH:     { includedPallets: 1, ratePerPallet: 175 },
  PRODUCTION: { includedPallets: 2, ratePerPallet: 175 },
  ACCESS:     { includedPallets: 0, ratePerPallet: 225 }, // Legacy
};

export const HOUR_START = 5;
export const HOUR_END = 22;
export const TOTAL_HOURS = HOUR_END - HOUR_START;
export const ROW_HEIGHT = 48;
