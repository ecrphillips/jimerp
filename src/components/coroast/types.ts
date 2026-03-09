import type { Database } from '@/integrations/supabase/types';

export type LoringBlockType = Database['public']['Enums']['coroast_loring_block_type'];

export interface LoringBlock {
  id: string;
  block_date: string;
  start_time: string;
  end_time: string;
  block_type: LoringBlockType;
  notes: string | null;
  created_at: string;
  recurring_series_id: string | null;
}

export interface BookingWithMember {
  id: string;
  booking_date: string;
  start_time: string;
  end_time: string;
  duration_hours: number | null;
  status: string;
  coroast_members: { business_name: string } | null;
}

export const BLOCK_TYPE_LABELS: Record<LoringBlockType, string> = {
  INTERNAL_PRODUCTION: 'Internal Production',
  MAINTENANCE: 'Maintenance',
  CLOSED: 'Closed',
  OTHER: 'Other',
};

export const BLOCK_TYPE_BADGE_VARIANT: Record<LoringBlockType, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  INTERNAL_PRODUCTION: 'default',
  MAINTENANCE: 'secondary',
  CLOSED: 'destructive',
  OTHER: 'outline',
};

export const BLOCK_TYPE_COLORS: Record<LoringBlockType, string> = {
  INTERNAL_PRODUCTION: 'bg-primary text-primary-foreground',
  MAINTENANCE: 'bg-secondary text-secondary-foreground',
  CLOSED: 'bg-destructive text-destructive-foreground',
  OTHER: 'bg-muted text-muted-foreground',
};

export const DAYS_OF_WEEK = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

export const DAY_LABELS: Record<string, string> = {
  MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun',
};

export const JS_DAY_TO_STRING: Record<number, string> = {
  0: 'SUN', 1: 'MON', 2: 'TUE', 3: 'WED', 4: 'THU', 5: 'FRI', 6: 'SAT',
};

export function formatTime(t: string): string {
  const [h, m] = t.split(':');
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${m} ${ampm}`;
}
