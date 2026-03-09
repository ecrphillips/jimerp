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
  billing_period_id: string;
  booking_date: string;
  start_time: string;
  end_time: string;
  duration_hours: number | null;
  status: string;
  recurring_block_id: string | null;
  notes_internal: string | null;
  coroast_members: { business_name: string } | null;
}

export interface BlockRow {
  id: string;
  block_date: string;
  start_time: string;
  end_time: string;
  block_type: string;
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

export function checkOverlap(
  date: string,
  startTime: string,
  endTime: string,
  blocks: BlockRow[],
  bookings: BookingRow[],
  excludeBookingId?: string,
): string | null {
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
    if (bk.status === 'CANCELLED') continue;
    const bStart = timeToMinutes(bk.start_time);
    const bEnd = timeToMinutes(bk.end_time);
    if (startMin < bEnd && endMin > bStart) {
      return `Conflicts with existing booking for ${bk.coroast_members?.business_name ?? 'a member'} (${formatTime12(bk.start_time)} – ${formatTime12(bk.end_time)})`;
    }
  }

  return null;
}

export const TIER_RATES: Record<string, { base: number; includedHours: number; overageRate: number }> = {
  ACCESS: { base: 300, includedHours: 3, overageRate: 135 },
  GROWTH: { base: 1000, includedHours: 10, overageRate: 115 },
};

export const HOUR_START = 5;
export const HOUR_END = 22;
export const TOTAL_HOURS = HOUR_END - HOUR_START;
export const ROW_HEIGHT = 48;
