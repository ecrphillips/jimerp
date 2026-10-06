import { CalendarClock, CalendarDays, Layers } from 'lucide-react';
import type { DateFilterMode } from './types';

interface DateFilterRailProps {
  mode: DateFilterMode;
  onChange: (mode: DateFilterMode) => void;
}

const OPTIONS: {
  value: DateFilterMode;
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { value: 'today', label: 'Today', hint: 'Due now + overdue', icon: CalendarClock },
  { value: 'tomorrow', label: 'Tomorrow', hint: 'Next run sheet', icon: CalendarDays },
  { value: 'all', label: 'All', hint: 'Everything open', icon: Layers },
];

/**
 * Vertical run-sheet date filter shown to the left of the station tabs.
 * The active card is filled with the brand navy and carries a sand edge, so the
 * applied filter reads at a glance from across the room.
 */
export function DateFilterRail({ mode, onChange }: DateFilterRailProps) {
  return (
    <div
      role="group"
      aria-label="Run sheet date filter"
      className="flex shrink-0 flex-col gap-2 sm:sticky sm:top-32 sm:w-36 lg:top-4"
    >
      <span className="hidden text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:block">
        Run sheet
      </span>
      {OPTIONS.map(({ value, label, hint, icon: Icon }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(value)}
            className={[
              'flex flex-1 flex-col items-start rounded-lg border border-l-4 px-3 py-2 text-left transition-all sm:flex-none',
              active
                ? 'border-[hsl(var(--hi-navy))] border-l-[hsl(var(--hi-sand))] bg-[hsl(var(--hi-navy))] text-[hsl(var(--hi-sand))] shadow-sm'
                : 'border-border border-l-transparent bg-card text-muted-foreground hover:border-[hsl(var(--hi-steel-blue)/0.45)] hover:text-foreground',
            ].join(' ')}
          >
            <span className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide">
              <Icon className="h-3.5 w-3.5" />
              {label}
            </span>
            <span className="mt-0.5 text-[11px] font-normal opacity-75">{hint}</span>
          </button>
        );
      })}
    </div>
  );
}
