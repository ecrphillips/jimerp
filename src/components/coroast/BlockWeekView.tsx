import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Repeat } from 'lucide-react';
import {
  format, startOfWeek, endOfWeek, addWeeks, subWeeks,
  eachDayOfInterval,
} from 'date-fns';
import { cn } from '@/lib/utils';
import { LoringBlock, BookingWithMember, BLOCK_TYPE_LABELS, BLOCK_TYPE_COLORS, formatTime } from './types';

interface BlockWeekViewProps {
  blocks: LoringBlock[];
  bookings: BookingWithMember[];
  onEditBlock: (block: LoringBlock) => void;
}

const HOUR_START = 5;
const HOUR_END = 22; // 10 PM
const TOTAL_HOURS = HOUR_END - HOUR_START;
const ROW_HEIGHT = 48; // px per hour

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToPx(minutes: number): number {
  const offsetMin = minutes - HOUR_START * 60;
  return (offsetMin / 60) * ROW_HEIGHT;
}

type CalendarEvent = {
  id: string;
  dateStr: string;
  startMin: number;
  endMin: number;
  label: string;
  tooltip: string;
  colorClass: string;
  isBooking: boolean;
  recurring: boolean;
  block?: LoringBlock;
};

export function BlockWeekView({ blocks, bookings, onEditBlock }: BlockWeekViewProps) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));

  const weekEnd = useMemo(() => endOfWeek(weekStart, { weekStartsOn: 1 }), [weekStart]);
  const weekDays = useMemo(() => eachDayOfInterval({ start: weekStart, end: weekEnd }), [weekStart, weekEnd]);

  const events = useMemo(() => {
    const result: CalendarEvent[] = [];

    blocks.forEach((b) => {
      result.push({
        id: b.id,
        dateStr: b.block_date,
        startMin: timeToMinutes(b.start_time),
        endMin: timeToMinutes(b.end_time),
        label: BLOCK_TYPE_LABELS[b.block_type],
        tooltip: `${BLOCK_TYPE_LABELS[b.block_type]}: ${formatTime(b.start_time)} – ${formatTime(b.end_time)}${b.notes ? ' — ' + b.notes : ''}`,
        colorClass: BLOCK_TYPE_COLORS[b.block_type],
        isBooking: false,
        recurring: !!b.recurring_series_id,
        block: b,
      });
    });

    bookings.forEach((bk) => {
      result.push({
        id: bk.id,
        dateStr: bk.booking_date,
        startMin: timeToMinutes(bk.start_time),
        endMin: timeToMinutes(bk.end_time),
        label: bk.coroast_members?.business_name ?? 'Booking',
        tooltip: `${bk.coroast_members?.business_name ?? 'Member'}: ${formatTime(bk.start_time)} – ${formatTime(bk.end_time)}`,
        colorClass: 'bg-sky-600/80 text-white',
        isBooking: true,
        recurring: false,
      });
    });

    return result;
  }, [blocks, bookings]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    events.forEach((e) => {
      if (!map.has(e.dateStr)) map.set(e.dateStr, []);
      map.get(e.dateStr)!.push(e);
    });
    return map;
  }, [events]);

  const hours = useMemo(() => {
    const arr: number[] = [];
    for (let h = HOUR_START; h < HOUR_END; h++) arr.push(h);
    return arr;
  }, []);

  return (
    <div>
      {/* Week navigation */}
      <div className="flex items-center justify-between mb-4">
        <Button variant="outline" size="sm" onClick={() => setWeekStart(w => subWeeks(w, 1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h3 className="font-semibold text-lg">
          {format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d, yyyy')}
        </h3>
        <Button variant="outline" size="sm" onClick={() => setWeekStart(w => addWeeks(w, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Grid */}
      <div className="border rounded-md overflow-auto">
        <div className="grid" style={{ gridTemplateColumns: '56px repeat(7, 1fr)', minWidth: 700 }}>
          {/* Header row */}
          <div className="border-b border-r bg-muted/50 p-1" />
          {weekDays.map((day) => {
            const isToday = format(day, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
            return (
              <div
                key={day.toISOString()}
                className={cn(
                  'border-b text-center py-2 text-sm font-medium',
                  isToday && 'bg-primary/10 text-primary font-bold',
                )}
              >
                <div>{format(day, 'EEE')}</div>
                <div className="text-xs text-muted-foreground">{format(day, 'MMM d')}</div>
              </div>
            );
          })}

          {/* Time grid body */}
          <div className="border-r relative" style={{ height: TOTAL_HOURS * ROW_HEIGHT }}>
            {hours.map((h) => (
              <div
                key={h}
                className="absolute right-2 text-[10px] text-muted-foreground leading-none"
                style={{ top: (h - HOUR_START) * ROW_HEIGHT - 6 }}
              >
                {h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`}
              </div>
            ))}
          </div>

          {weekDays.map((day) => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const dayEvents = eventsByDate.get(dateStr) || [];
            const isToday = dateStr === format(new Date(), 'yyyy-MM-dd');

            return (
              <div
                key={dateStr}
                className={cn('relative border-l', isToday && 'bg-primary/5')}
                style={{ height: TOTAL_HOURS * ROW_HEIGHT }}
              >
                {/* Hour gridlines */}
                {hours.map((h) => (
                  <div
                    key={h}
                    className="absolute w-full border-t border-border/40"
                    style={{ top: (h - HOUR_START) * ROW_HEIGHT }}
                  />
                ))}

                {/* Events */}
                {dayEvents.map((ev) => {
                  const clampedStart = Math.max(ev.startMin, HOUR_START * 60);
                  const clampedEnd = Math.min(ev.endMin, HOUR_END * 60);
                  if (clampedEnd <= clampedStart) return null;

                  const top = minutesToPx(clampedStart);
                  const height = Math.max(minutesToPx(clampedEnd) - top, 16);

                  return (
                    <button
                      key={ev.id}
                      onClick={() => {
                        if (!ev.isBooking && ev.block) onEditBlock(ev.block);
                      }}
                      className={cn(
                        'absolute left-0.5 right-0.5 rounded px-1 text-[10px] leading-tight overflow-hidden transition-opacity',
                        ev.colorClass,
                        ev.isBooking ? 'cursor-default' : 'hover:opacity-80 cursor-pointer',
                      )}
                      style={{ top, height }}
                      title={ev.tooltip}
                    >
                      <div className="flex items-center gap-0.5 truncate pt-0.5">
                        {ev.recurring && <Repeat className="h-2.5 w-2.5 flex-shrink-0" />}
                        <span className="truncate font-medium">{ev.label}</span>
                      </div>
                      {height > 24 && (
                        <div className="truncate opacity-80">
                          {formatTime(
                            `${Math.floor(ev.startMin / 60).toString().padStart(2, '0')}:${(ev.startMin % 60).toString().padStart(2, '0')}`
                          )} – {formatTime(
                            `${Math.floor(ev.endMin / 60).toString().padStart(2, '0')}:${(ev.endMin % 60).toString().padStart(2, '0')}`
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-primary" />
          <span>Unavailability Block</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-sky-600/80" />
          <span>Member Booking</span>
        </div>
      </div>
    </div>
  );
}
