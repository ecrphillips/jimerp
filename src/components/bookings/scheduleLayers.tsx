import { useCallback, useState } from 'react';
import { cn } from '@/lib/utils';
import type { Database } from '@/integrations/supabase/types';
import type { BlockRow, BookingRow } from './bookingUtils';

// Bookable resources shown as toggleable layers on the co-roasting schedules.
// LORING is the billed production roaster (coroast_bookings / coroast_loring_blocks);
// the facility resources live in coroast_facility_bookings / coroast_facility_blocks,
// are free, and never conflict with each other or the Loring.
export type FacilityResource = Database['public']['Enums']['coroast_facility_resource'];
export type ScheduleLayer = 'LORING' | FacilityResource;

export const SCHEDULE_LAYERS: { key: ScheduleLayer; label: string; short: string; color: string }[] = [
  { key: 'LORING', label: 'Loring Roaster', short: 'Loring', color: 'hsl(210 70% 50%)' },
  { key: 'CUPPING_LAB', label: 'Cupping Lab', short: 'Lab', color: 'hsl(145 50% 38%)' },
  { key: 'SAMPLE_ROASTER', label: 'Sample Roaster', short: 'Sample', color: 'hsl(280 45% 50%)' },
];

export const LAYER_BY_KEY = Object.fromEntries(SCHEDULE_LAYERS.map(l => [l.key, l])) as Record<ScheduleLayer, (typeof SCHEDULE_LAYERS)[number]>;

export const FACILITY_RESOURCES: FacilityResource[] = ['CUPPING_LAB', 'SAMPLE_ROASTER'];

export const isFacility = (layer: ScheduleLayer): layer is FacilityResource => layer !== 'LORING';

export interface FacilityBookingRow {
  id: string;
  account_id: string;
  resource: FacilityResource;
  booking_date: string;
  start_time: string;
  end_time: string;
  status: string;
  notes_member: string | null;
  notes_internal?: string | null;
  accounts?: { account_name: string } | null;
}

export interface FacilityBlockRow extends BlockRow {
  resource: FacilityResource;
}

export type FacilityBusySlot = { resource: FacilityResource; booking_date: string; start_time: string; end_time: string };

/** Adapts facility bookings to the BookingRow shape used by checkOverlap / AvailabilityTimeSelect. */
export function facilityAsBookingRows(rows: FacilityBookingRow[]): BookingRow[] {
  return rows.map(r => ({
    id: r.id,
    account_id: r.account_id,
    billing_period_id: '',
    booking_date: r.booking_date,
    start_time: r.start_time,
    end_time: r.end_time,
    duration_hours: null,
    status: r.status,
    recurring_block_id: null,
    notes_internal: r.notes_internal ?? null,
    accounts: r.accounts ?? null,
  }));
}

const ALL_KEYS = SCHEDULE_LAYERS.map(l => l.key);

/** Visible layers, remembered per viewer in localStorage. At least one layer stays on. */
export function useScheduleLayers(storageKey: string) {
  const [visible, setVisible] = useState<ScheduleLayer[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
      if (Array.isArray(saved)) {
        const valid = ALL_KEYS.filter(k => saved.includes(k));
        if (valid.length > 0) return valid;
      }
    } catch { /* storage unavailable — fall back to all layers */ }
    return ALL_KEYS;
  });

  const toggle = useCallback((layer: ScheduleLayer) => {
    setVisible(prev => {
      const next = prev.includes(layer)
        ? prev.filter(l => l !== layer)
        : ALL_KEYS.filter(k => k === layer || prev.includes(k));
      if (next.length === 0) return prev;
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [storageKey]);

  return { visible, toggle };
}

export function LayerToggles({ visible, onToggle }: { visible: ScheduleLayer[]; onToggle: (l: ScheduleLayer) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Schedule layers">
      <span className="text-xs text-muted-foreground mr-1">Show:</span>
      {SCHEDULE_LAYERS.map(l => {
        const on = visible.includes(l.key);
        return (
          <button
            key={l.key}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(l.key)}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              on ? 'bg-background shadow-sm' : 'bg-muted/40 text-muted-foreground opacity-60',
            )}
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: on ? l.color : 'transparent', border: `2px solid ${l.color}` }} />
            {l.label}
          </button>
        );
      })}
    </div>
  );
}

/** Horizontal position of a layer's lane inside a day column (visible layers sit side by side). */
export function laneStyle(layer: ScheduleLayer, visible: ScheduleLayer[]): { left: string; width: string } {
  const n = Math.max(visible.length, 1);
  const i = Math.max(visible.indexOf(layer), 0);
  return { left: `calc(${(i * 100) / n}% + 1px)`, width: `calc(${100 / n}% - 2px)` };
}

/** Which visible layer a click at `x` px inside a column of width `w` px landed in. */
export function layerAtX(x: number, w: number, visible: ScheduleLayer[]): ScheduleLayer {
  const n = Math.max(visible.length, 1);
  const i = Math.min(n - 1, Math.max(0, Math.floor((x / Math.max(w, 1)) * n)));
  return visible[i] ?? 'LORING';
}

/** Small per-day lane header so it's clear which column is which resource. */
export function LaneHeader({ visible }: { visible: ScheduleLayer[] }) {
  if (visible.length < 2) return null;
  return (
    <div className="flex mt-1 px-0.5 gap-px">
      {visible.map(k => (
        <div key={k} className="flex-1 truncate rounded-sm text-[9px] leading-4 text-white" style={{ backgroundColor: LAYER_BY_KEY[k].color }}>
          {LAYER_BY_KEY[k].short}
        </div>
      ))}
    </div>
  );
}
