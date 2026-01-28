// Shared types for production components

export type DateFilterMode = 'today' | 'tomorrow' | 'all';

export interface DateFilterConfigToday {
  mode: 'today';
  maxDate: string; // work_deadline <= this datetime (tomorrow at 13:00)
}

export interface DateFilterConfigTomorrow {
  mode: 'tomorrow';
  minDate: string; // work_deadline > this datetime (tomorrow at 13:00)
  maxDate: string; // work_deadline <= this datetime (day after tomorrow at 13:00)
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
