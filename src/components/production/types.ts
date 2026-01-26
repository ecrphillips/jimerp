// Shared types for production components

export type DateFilterMode = 'today' | 'tomorrow' | 'all';

export interface DateFilterConfigToday {
  mode: 'today';
  maxDate: string; // requested_ship_date <= this date
}

export interface DateFilterConfigTomorrow {
  mode: 'tomorrow';
  exactDate: string; // requested_ship_date == this date OR manually_deprioritized = true
}

export interface DateFilterConfigAll {
  mode: 'all';
}

export type DateFilterConfig = 
  | DateFilterConfigToday 
  | DateFilterConfigTomorrow 
  | DateFilterConfigAll;
