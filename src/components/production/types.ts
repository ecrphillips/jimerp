// Shared types for production components

export type DateFilterMode = 'today' | 'tomorrow' | 'all';

export interface DateFilterConfigToday {
  mode: 'today';
  maxDate: string; // work_deadline <= this date (end of next business day)
}

export interface DateFilterConfigTomorrow {
  mode: 'tomorrow';
  exactDate: string; // work_deadline == this date OR manually_deprioritized = true
}

export interface DateFilterConfigAll {
  mode: 'all';
}

export type DateFilterConfig = 
  | DateFilterConfigToday 
  | DateFilterConfigTomorrow 
  | DateFilterConfigAll;

// Shipping preference type for client orders
export type ShipPreference = 'SOONEST' | 'SPECIFIC';
