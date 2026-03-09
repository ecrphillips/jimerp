import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Repeat, DollarSign, Lock } from 'lucide-react';
import {
  format, startOfWeek, endOfWeek, addWeeks, subWeeks, eachDayOfInterval, startOfToday, differenceInHours, parseISO,
} from 'date-fns';
import { cn } from '@/lib/utils';
import {
  getMemberColor, formatTime12, timeToMinutes, TIER_RATES,
  HOUR_START, HOUR_END, TOTAL_HOURS, ROW_HEIGHT,
  type MemberRow, type BookingRow, type BlockRow,
} from './bookingUtils';

interface BookingWeekViewProps {
  blocks: BlockRow[];
  bookings: BookingRow[];
  members: MemberRow[];
  onSlotClick: (date: string, time: string) => void;
  onBookingClick?: (booking: BookingRow) => void;
}

function minutesToPx(minutes: number): number {
  return ((minutes - HOUR_START * 60) / 60) * ROW_HEIGHT;
}

const NO_SHOW_BG = 'hsl(15 80% 45%)';
const CANCELLED_STATUSES = ['CANCELLED_FREE', 'CANCELLED_CHARGED', 'CANCELLED_WAIVED'];

type CalendarEvent = {
  id: string;
  bookingId?: string;
  dateStr: string;
  startMin: number;
  endMin: number;
  label: string;
  tooltip: string;
  bgColor: string;
  textColor: string;
  isBlock: boolean;
  isOverage: boolean;
  recurring: boolean;
  isLocked: boolean;
  isNoShow: boolean;
};

export function BookingWeekView({ blocks, bookings, members, onSlotClick, onBookingClick }: BookingWeekViewProps) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const weekEnd = useMemo(() => endOfWeek(weekStart, { weekStartsOn: 1 }), [weekStart]);
  const weekDays = useMemo(() => eachDayOfInterval({ start: weekStart, end: weekEnd }), [weekStart, weekEnd]);
  const todayStr = format(startOfToday(), 'yyyy-MM-dd');

  const allMemberIds = useMemo(() => members.map(m => m.id), [members]);

  // Compute overage set
  const bookingOverageSet = useMemo(() => {
    const set = new Set<string>();
    const grouped = new Map<string, BookingRow[]>();
    const sorted = [...bookings]
      .filter(b => !CANCELLED_STATUSES.includes(b.status))
      .sort((a, b) => a.booking_date.localeCompare(b.booking_date) || a.start_time.localeCompare(b.start_time));
    for (const bk of sorted) {
      const key = `${bk.member_id}:${bk.booking_date.slice(0, 7)}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(bk);
    }
    for (const [key, bks] of grouped) {
      const memberId = key.split(':')[0];
      const member = members.find(m => m.id === memberId);
      const tier = member?.tier ?? 'ACCESS';
      const included = TIER_RATES[tier]?.includedHours ?? 3;
      let running = 0;
      for (const bk of bks) {
        const dur = bk.duration_hours ?? 0;
        if (running >= included || running + dur > included) set.add(bk.id);
        running += dur;
      }
    }
    return set;
  }, [bookings, members]);

  const events = useMemo(() => {
    const result: CalendarEvent[] = [];
    const now = new Date();

    for (const b of blocks) {
      result.push({
        id: `blk-${b.id}`,
        dateStr: b.block_date,
        startMin: timeToMinutes(b.start_time),
        endMin: timeToMinutes(b.end_time),
        label: b.notes || 'Unavailable',
        tooltip: `Unavailable: ${formatTime12(b.start_time)} – ${formatTime12(b.end_time)}${b.notes ? ' — ' + b.notes : ''}`,
        bgColor: 'hsl(25 45% 25%)',
        textColor: 'hsl(40 30% 96%)',
        isBlock: true, isOverage: false, recurring: false, isLocked: false, isNoShow: false,
      });
    }

    for (const bk of bookings) {
      if (CANCELLED_STATUSES.includes(bk.status)) continue;
      const isNoShow = bk.status === 'NO_SHOW';
      const color = isNoShow
        ? { bg: NO_SHOW_BG, text: '#fff' }
        : getMemberColor(bk.member_id, allMemberIds);
      const isOverage = bookingOverageSet.has(bk.id);
      const bkStart = parseISO(`${bk.booking_date}T${bk.start_time}`);
      const locked = differenceInHours(bkStart, now) < 48;

      result.push({
        id: `bk-${bk.id}`,
        bookingId: bk.id,
        dateStr: bk.booking_date,
        startMin: timeToMinutes(bk.start_time),
        endMin: timeToMinutes(bk.end_time),
        label: bk.coroast_members?.business_name ?? 'Booking',
        tooltip: `${bk.coroast_members?.business_name ?? 'Member'}: ${formatTime12(bk.start_time)} – ${formatTime12(bk.end_time)}${bk.duration_hours ? ` (${Number(bk.duration_hours).toFixed(1)}h)` : ''}${isNoShow ? ' [NO SHOW]' : ''}`,
        bgColor: color.bg,
        textColor: color.text,
        isBlock: false, isOverage, recurring: !!bk.recurring_block_id,
        isLocked: locked, isNoShow,
      });
    }

    return result;
  }, [blocks, bookings, allMemberIds, bookingOverageSet]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      if (!map.has(e.dateStr)) map.set(e.dateStr, []);
      map.get(e.dateStr)!.push(e);
    }
    return map;
  }, [events]);

  const hours = useMemo(() => {
    const arr: number[] = [];
    for (let h = HOUR_START; h < HOUR_END; h++) arr.push(h);
    return arr;
  }, []);

  const jumpToToday = () => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }));

  const handleGridClick = (day: Date, e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const totalMin = HOUR_START * 60 + (y / ROW_HEIGHT) * 60;
    const snapped = Math.floor(totalMin / 30) * 30;
    const h = Math.floor(snapped / 60);
    const m = snapped % 60;
    const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    onSlotClick(format(day, 'yyyy-MM-dd'), time);
  };

  const handleEventClick = (ev: CalendarEvent, e: React.MouseEvent) => {
    e.stopPropagation();
    if (ev.isBlock || !ev.bookingId || !onBookingClick) return;
    const bk = bookings.find(b => b.id === ev.bookingId);
    if (bk) onBookingClick(bk);
  };

  return (
    <div>
      {/* Navigation */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setWeekStart(w => subWeeks(w, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={jumpToToday}>Today</Button>
          <Button variant="outline" size="sm" onClick={() => setWeekStart(w => addWeeks(w, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <h3 className="font-semibold text-lg">
          {format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d, yyyy')}
        </h3>
      </div>

      {/* Grid */}
      <div className="border rounded-md overflow-auto">
        <div className="grid" style={{ gridTemplateColumns: '56px repeat(7, 1fr)', minWidth: 700 }}>
          {/* Header */}
          <div className="border-b border-r bg-muted/50 p-1" />
          {weekDays.map(day => {
            const isToday = format(day, 'yyyy-MM-dd') === todayStr;
            return (
              <div key={day.toISOString()} className={cn('border-b text-center py-2 text-sm font-medium', isToday && 'bg-primary/10 text-primary font-bold')}>
                <div>{format(day, 'EEE')}</div>
                <div className="text-xs text-muted-foreground">{format(day, 'MMM d')}</div>
              </div>
            );
          })}

          {/* Time labels */}
          <div className="border-r relative" style={{ height: TOTAL_HOURS * ROW_HEIGHT }}>
            {hours.map(h => (
              <div key={h} className="absolute right-2 text-[10px] text-muted-foreground leading-none" style={{ top: (h - HOUR_START) * ROW_HEIGHT - 6 }}>
                {h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {weekDays.map(day => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const dayEvents = eventsByDate.get(dateStr) || [];
            const isToday = dateStr === todayStr;

            return (
              <div
                key={dateStr}
                className={cn('relative border-l cursor-crosshair', isToday && 'bg-primary/5')}
                style={{ height: TOTAL_HOURS * ROW_HEIGHT }}
                onClick={(e) => handleGridClick(day, e)}
              >
                {hours.map(h => (
                  <div key={h} className="absolute w-full border-t border-border/40" style={{ top: (h - HOUR_START) * ROW_HEIGHT }} />
                ))}

                {dayEvents.map(ev => {
                  const clampedStart = Math.max(ev.startMin, HOUR_START * 60);
                  const clampedEnd = Math.min(ev.endMin, HOUR_END * 60);
                  if (clampedEnd <= clampedStart) return null;

                  const top = minutesToPx(clampedStart);
                  const height = Math.max(minutesToPx(clampedEnd) - top, 16);

                  return (
                    <div
                      key={ev.id}
                      className={cn(
                        'absolute left-0.5 right-0.5 rounded px-1 text-[10px] leading-tight overflow-hidden',
                        ev.isBlock ? 'cursor-not-allowed opacity-90' : 'cursor-pointer',
                        ev.isOverage && 'ring-1 ring-inset ring-white/40',
                      )}
                      style={{
                        top, height,
                        backgroundColor: ev.bgColor,
                        color: ev.textColor,
                        backgroundImage: ev.isOverage
                          ? 'repeating-linear-gradient(135deg, transparent, transparent 3px, rgba(255,255,255,0.15) 3px, rgba(255,255,255,0.15) 6px)'
                          : undefined,
                      }}
                      title={ev.tooltip}
                      onClick={(e) => handleEventClick(ev, e)}
                    >
                      <div className="flex items-center gap-0.5 truncate pt-0.5">
                        {ev.isLocked && !ev.isBlock && <Lock className="h-2.5 w-2.5 flex-shrink-0" />}
                        {ev.recurring && <Repeat className="h-2.5 w-2.5 flex-shrink-0" />}
                        {ev.isOverage && <DollarSign className="h-2.5 w-2.5 flex-shrink-0" />}
                        <span className="truncate font-medium">{ev.label}</span>
                      </div>
                      {height > 24 && (
                        <div className="truncate opacity-80">
                          {formatTime12(`${Math.floor(ev.startMin / 60).toString().padStart(2, '0')}:${(ev.startMin % 60).toString().padStart(2, '0')}`)}
                          {' – '}
                          {formatTime12(`${Math.floor(ev.endMin / 60).toString().padStart(2, '0')}:${(ev.endMin % 60).toString().padStart(2, '0')}`)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: 'hsl(25 45% 25%)' }} />
          <span>Unavailable</span>
        </div>
        {members.filter(m => m.is_active).map(m => {
          const color = getMemberColor(m.id, allMemberIds);
          return (
            <div key={m.id} className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: color.bg }} />
              <span>{m.business_name}</span>
            </div>
          );
        })}
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: NO_SHOW_BG }} />
          <span>No-Show</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded border" style={{ backgroundImage: 'repeating-linear-gradient(135deg, transparent, transparent 2px, rgba(0,0,0,0.15) 2px, rgba(0,0,0,0.15) 4px)' }} />
          <span>Overage ($)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Lock className="h-3 w-3" />
          <span>Locked (&lt;48h)</span>
        </div>
      </div>
    </div>
  );
}
