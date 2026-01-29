// Shared types for production components

export type DateFilterMode = 'today' | 'tomorrow' | 'all';

// Simplified filter config - actual filtering now happens client-side
// based on computed work_start_at from work_deadline_at
export interface DateFilterConfig {
  mode: DateFilterMode;
}

// Legacy interfaces kept for backward compatibility during migration
export interface DateFilterConfigToday {
  mode: 'today';
  maxDate?: string;
}

export interface DateFilterConfigTomorrow {
  mode: 'tomorrow';
  minDate?: string;
  maxDate?: string;
}

export interface DateFilterConfigAll {
  mode: 'all';
}

// Shipping preference type for client orders
export type ShipPreference = 'SOONEST' | 'SPECIFIC';
