import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePreview } from '@/contexts/PreviewContext';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, CalendarIcon, Lock, Info, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  format, startOfWeek, endOfWeek, addWeeks, subWeeks, eachDayOfInterval,
  startOfToday, differenceInHours, parseISO, addDays, getDay,
  startOfMonth, endOfMonth, isBefore, startOfDay, isAfter,
} from 'date-fns';
import {
  checkOverlap, timeToMinutes, formatTime12, TIER_RATES,
  HOUR_START, HOUR_END, TOTAL_HOURS, ROW_HEIGHT,
  type BookingRow, type BlockRow,
} from '@/components/bookings/bookingUtils';
import { AvailabilityTimeSelect } from '@/components/bookings/AvailabilityTimeSelect';
import { DAYS_OF_WEEK, DAY_LABELS, JS_DAY_TO_STRING } from '@/components/coroast/types';

const MEMBER_COLOR = { bg: 'hsl(210 70% 50%)', text: '#fff' };
const OTHER_COLOR = { bg: 'hsl(0 0% 75%)', text: 'hsl(0 0% 30%)' };
const BLOCK_COLOR = { bg: 'hsl(25 45% 25%)', text: 'hsl(40 30% 96%)' };
const DAY_INDEX: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };

function minutesToPx(minutes: number): number {
  return ((minutes - HOUR_START * 60) / 60) * ROW_HEIGHT;
}

function generateRecurringDates(startDate: Date, dayStr: string, endDate: Date | null): Date[] {
  const target = DAY_INDEX[dayStr];
  const current = getDay(startDate);
  const diff = (target - current + 7) % 7;
  const first = diff === 0 ? startDate : addDays(startDate, diff);
  const dates: Date[] = [];
  const maxDate = endDate || addDays(first, 12 * 7);
  let cur = first;
  while (cur <= maxDate) {
    dates.push(new Date(cur));
    cur = addDays(cur, 7);
  }
  return dates;
}

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
  isMine: boolean;
};

export default function MemberSchedule() {
  const { authUser } = useAuth();
  const { previewAccountId } = usePreview();
  const queryClient = useQueryClient();
  const effectiveAccountId = previewAccountId ?? authUser?.accountId;

  // Fetch account record for this member
  const { data: member } = useQuery({
    queryKey: ['my-account-schedule', effectiveAccountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts')
        .select('id, account_name, coroast_tier, is_active, coroast_joined_date')
        .eq('id', effectiveAccountId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!effectiveAccountId,
  });

  const memberId = effectiveAccountId;
  const tier = member?.coroast_tier ?? 'MEMBER';
  const isGrowth = tier === 'GROWTH' || tier === 'PRODUCTION';
  const rates = TIER_RATES[tier] ?? TIER_RATES.MEMBER;

  // Week state
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const weekEnd = useMemo(() => endOfWeek(weekStart, { weekStartsOn: 1 }), [weekStart]);
  const weekDays = useMemo(() => eachDayOfInterval({ start: weekStart, end: weekEnd }), [weekStart, weekEnd]);
  const todayStr = format(startOfToday(), 'yyyy-MM-dd');

  // Booking form state
  const [bookingOpen, setBookingOpen] = useState(false);
  const [formDate, setFormDate] = useState<Date | undefined>();
  const [formStartTime, setFormStartTime] = useState('');
  const [formEndTime, setFormEndTime] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringDay, setRecurringDay] = useState('MON');
  const [recurringEndDate, setRecurringEndDate] = useState<Date | undefined>();
  const [validationError, setValidationError] = useState<string | null>(null);

  // Booking detail state
  const [selectedBooking, setSelectedBooking] = useState<BookingRow | null>(null);

  // Confirm step
  const [showConfirm, setShowConfirm] = useState(false);

  // Data queries
  const { data: blocks = [] } = useQuery({
    queryKey: ['member-portal-blocks'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_loring_blocks')
        .select('id, block_date, start_time, end_time, block_type, notes')
        .order('block_date');
      if (error) throw error;
      return data as BlockRow[];
    },
  });

  const { data: allBookings = [] } = useQuery({
    queryKey: ['member-portal-bookings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_bookings')
        .select('id, member_id, billing_period_id, booking_date, start_time, end_time, duration_hours, status, recurring_block_id, notes_internal, notes_member')
        .in('status', ['CONFIRMED', 'COMPLETED', 'NO_SHOW']);
      if (error) throw error;
      return data as (BookingRow & { notes_member: string | null })[];
    },
  });

  // Hours used this month
  const currentMonthStr = format(new Date(), 'yyyy-MM');
  const hoursUsedThisMonth = useMemo(() => {
    if (!memberId) return 0;
    return allBookings
      .filter(b => b.member_id === memberId && b.booking_date.startsWith(currentMonthStr) && ['CONFIRMED', 'COMPLETED', 'NO_SHOW'].includes(b.status))
      .reduce((sum, b) => sum + (Number(b.duration_hours) || (timeToMinutes(b.end_time) - timeToMinutes(b.start_time)) / 60), 0);
  }, [allBookings, memberId, currentMonthStr]);

  // Build events
  const events = useMemo(() => {
    const result: CalendarEvent[] = [];

    for (const b of blocks) {
      result.push({
        id: `blk-${b.id}`,
        dateStr: b.block_date,
        startMin: timeToMinutes(b.start_time),
        endMin: timeToMinutes(b.end_time),
        label: 'Unavailable',
        tooltip: `Unavailable: ${formatTime12(b.start_time)} – ${formatTime12(b.end_time)}`,
        bgColor: BLOCK_COLOR.bg,
        textColor: BLOCK_COLOR.text,
        isBlock: true,
        isMine: false,
      });
    }

    for (const bk of allBookings) {
      const isMine = bk.member_id === memberId;
      result.push({
        id: `bk-${bk.id}`,
        bookingId: bk.id,
        dateStr: bk.booking_date,
        startMin: timeToMinutes(bk.start_time),
        endMin: timeToMinutes(bk.end_time),
        label: isMine ? 'My Booking' : 'Unavailable',
        tooltip: isMine
          ? `My Booking: ${formatTime12(bk.start_time)} – ${formatTime12(bk.end_time)}`
          : `Unavailable: ${formatTime12(bk.start_time)} – ${formatTime12(bk.end_time)}`,
        bgColor: isMine ? MEMBER_COLOR.bg : OTHER_COLOR.bg,
        textColor: isMine ? MEMBER_COLOR.text : OTHER_COLOR.text,
        isBlock: false,
        isMine,
      });
    }

    return result;
  }, [blocks, allBookings, memberId]);

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

  // Open booking form from grid click
  const handleSlotClick = useCallback((dateStr: string, time: string) => {
    setFormDate(new Date(dateStr + 'T00:00:00'));
    setFormStartTime(time);
    const startMin = timeToMinutes(time);
    const endMin = startMin + 60;
    if (endMin <= 22 * 60) {
      const h = Math.floor(endMin / 60);
      const m = endMin % 60;
      setFormEndTime(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    } else {
      setFormEndTime('');
    }
    setFormNotes('');
    setIsRecurring(false);
    setRecurringDay(JS_DAY_TO_STRING[getDay(new Date(dateStr + 'T00:00:00'))]);
    setRecurringEndDate(undefined);
    setValidationError(null);
    setShowConfirm(false);
    setBookingOpen(true);
  }, []);

  const handleEventClick = useCallback((ev: CalendarEvent) => {
    if (!ev.isMine || ev.isBlock || !ev.bookingId) return;
    const bk = allBookings.find(b => b.id === ev.bookingId);
    if (bk) setSelectedBooking(bk);
  }, [allBookings]);

  const handleGridClick = (day: Date, e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const totalMin = HOUR_START * 60 + (y / ROW_HEIGHT) * 60;
    const snapped = Math.floor(totalMin / 30) * 30;
    const h = Math.floor(snapped / 60);
    const m = snapped % 60;
    handleSlotClick(format(day, 'yyyy-MM-dd'), `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  };

  // Booking form computed values
  const dateStr = formDate ? format(formDate, 'yyyy-MM-dd') : null;
  const durationHrs = formStartTime && formEndTime ? (timeToMinutes(formEndTime) - timeToMinutes(formStartTime)) / 60 : 0;
  const remainingIncluded = Math.max(0, rates.includedHours - hoursUsedThisMonth);
  const willBeOverage = durationHrs > remainingIncluded;

  // Booking horizon check
  const horizonError = useMemo(() => {
    if (!formDate || isGrowth) return null;
    const maxDate = addWeeks(new Date(), 4);
    if (isAfter(formDate, maxDate)) {
      return 'Member tier members cannot book more than 4 weeks ahead.';
    }
    return null;
  }, [formDate, isGrowth]);

  // Auto-set end time
  const handleStartTimeChange = (v: string) => {
    setFormStartTime(v);
    setValidationError(null);
    const startMin = timeToMinutes(v);
    const endMin = startMin + 60;
    if (endMin <= 22 * 60) {
      const h = Math.floor(endMin / 60);
      const m = endMin % 60;
      setFormEndTime(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  };

  // Booking mutation
  async function getOrCreateBillingPeriod(bookingDate: string): Promise<string> {
    if (!memberId) throw new Error('No member');
    const monthStart = format(startOfMonth(new Date(bookingDate + 'T00:00:00')), 'yyyy-MM-dd');
    const monthEnd = format(endOfMonth(new Date(bookingDate + 'T00:00:00')), 'yyyy-MM-dd');

    const { data: existing } = await supabase
      .from('coroast_billing_periods')
      .select('id')
      .eq('member_id', memberId)
      .lte('period_start', monthEnd)
      .gte('period_end', monthStart)
      .limit(1);

    if (existing && existing.length > 0) return existing[0].id;

    const { data: created, error } = await supabase
      .from('coroast_billing_periods')
      .insert({
        member_id: memberId!,
        account_id: memberId,
        period_start: monthStart,
        period_end: monthEnd,
        tier_snapshot: tier as any,
        included_hours: rates.includedHours,
        overage_rate_per_hr: rates.overageRate,
        base_fee: rates.base,
      })
      .select('id')
      .single();

    if (error) throw new Error('Failed to create billing period');
    return created.id;
  }

  const createBookingMutation = useMutation({
    mutationFn: async () => {
      if (!memberId || !formDate || !formStartTime || !formEndTime) throw new Error('Missing fields');
      if (formEndTime <= formStartTime) throw new Error('End time must be after start time');
      if (horizonError) throw new Error(horizonError);

      const saveDateStr = format(formDate, 'yyyy-MM-dd');

      if (isRecurring && isGrowth) {
        const dates = generateRecurringDates(formDate, recurringDay, recurringEndDate ?? null);
        if (dates.length === 0) throw new Error('No dates generated');

        for (const d of dates) {
          const ds = format(d, 'yyyy-MM-dd');
          const overlap = checkOverlap(ds, formStartTime, formEndTime, blocks, allBookings as BookingRow[]);
          if (overlap) throw new Error(`${format(d, 'MMM d')}: ${overlap}`);
        }

        const { data: recurBlock, error: rbErr } = await supabase
          .from('coroast_recurring_blocks')
          .insert({
            member_id: memberId,
            day_of_week: recurringDay as any,
            start_time: formStartTime,
            end_time: formEndTime,
            effective_from: format(dates[0], 'yyyy-MM-dd'),
            effective_until: recurringEndDate ? format(recurringEndDate, 'yyyy-MM-dd') : null,
            notes: formNotes.trim() || null,
          })
          .select('id')
          .single();
        if (rbErr) throw rbErr;

        for (const d of dates) {
          const ds = format(d, 'yyyy-MM-dd');
          const billingPeriodId = await getOrCreateBillingPeriod(ds);
          const dur = (timeToMinutes(formEndTime) - timeToMinutes(formStartTime)) / 60;

          const { data: booking, error: bErr } = await supabase
            .from('coroast_bookings')
            .insert({
              member_id: memberId,
              billing_period_id: billingPeriodId,
              booking_date: ds,
              start_time: formStartTime,
              end_time: formEndTime,
              duration_hours: dur,
              recurring_block_id: recurBlock.id,
              notes_member: formNotes.trim() || null,
              status: 'CONFIRMED',
            })
            .select('id')
            .single();
          if (bErr) throw bErr;

          await supabase.from('coroast_hour_ledger').insert({
            member_id: memberId,
            billing_period_id: billingPeriodId,
            booking_id: booking.id,
            entry_type: 'BOOKING_CONFIRMED' as any,
            hours_delta: dur,
            notes: `Self-serve booking on ${ds}`,
          });
        }
        toast.success(`Created ${dates.length} recurring bookings`);
      } else {
        const overlap = checkOverlap(saveDateStr, formStartTime, formEndTime, blocks, allBookings as BookingRow[]);
        if (overlap) throw new Error(overlap);

        const billingPeriodId = await getOrCreateBillingPeriod(saveDateStr);
        const dur = (timeToMinutes(formEndTime) - timeToMinutes(formStartTime)) / 60;

        const { data: booking, error } = await supabase
          .from('coroast_bookings')
          .insert({
            member_id: memberId,
            billing_period_id: billingPeriodId,
            booking_date: saveDateStr,
            start_time: formStartTime,
            end_time: formEndTime,
            duration_hours: dur,
            notes_member: formNotes.trim() || null,
            status: 'CONFIRMED',
          })
          .select('id')
          .single();
        if (error) throw error;

        await supabase.from('coroast_hour_ledger').insert({
          member_id: memberId,
          billing_period_id: billingPeriodId,
          booking_id: booking.id,
          entry_type: 'BOOKING_CONFIRMED' as any,
          hours_delta: dur,
          notes: `Self-serve booking on ${saveDateStr}`,
        });

        toast.success('Booking confirmed!');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['member-portal-bookings'] });
      setBookingOpen(false);
      setShowConfirm(false);
    },
    onError: (err: Error) => setValidationError(err.message),
  });

  // Cancel booking mutation
  const cancelMutation = useMutation({
    mutationFn: async (bookingId: string) => {
      const { error } = await supabase
        .from('coroast_bookings')
        .update({ status: 'CANCELLED_FREE' as any, cancelled_at: new Date().toISOString(), cancelled_by: authUser?.id })
        .eq('id', bookingId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Booking cancelled');
      setSelectedBooking(null);
      queryClient.invalidateQueries({ queryKey: ['member-portal-bookings'] });
    },
    onError: () => toast.error('Failed to cancel booking'),
  });

  if (!member) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Loading your schedule…</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Schedule</h1>
          <p className="text-sm text-muted-foreground">
            {member.account_name} · {tier} tier · {hoursUsedThisMonth.toFixed(1)}h used of {rates.includedHours}h this month
          </p>
        </div>
      </div>

      {/* Week Navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setWeekStart(w => subWeeks(w, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>
            Today
          </Button>
          <Button variant="outline" size="sm" onClick={() => setWeekStart(w => addWeeks(w, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <h3 className="font-semibold text-lg">
          {format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d, yyyy')}
        </h3>
      </div>

      {/* Calendar Grid */}
      <div className="border rounded-md overflow-auto">
        <div className="grid" style={{ gridTemplateColumns: '56px repeat(7, 1fr)', minWidth: 700 }}>
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

          <div className="border-r relative" style={{ height: TOTAL_HOURS * ROW_HEIGHT }}>
            {hours.map(h => (
              <div key={h} className="absolute right-2 text-[10px] text-muted-foreground leading-none" style={{ top: (h - HOUR_START) * ROW_HEIGHT - 6 }}>
                {h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`}
              </div>
            ))}
          </div>

          {weekDays.map(day => {
            const ds = format(day, 'yyyy-MM-dd');
            const dayEvents = eventsByDate.get(ds) || [];
            const isToday = ds === todayStr;

            return (
              <div
                key={ds}
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
                        ev.isBlock || !ev.isMine ? 'cursor-not-allowed opacity-80' : 'cursor-pointer hover:ring-2 hover:ring-primary/50',
                      )}
                      style={{ top, height, backgroundColor: ev.bgColor, color: ev.textColor }}
                      title={ev.tooltip}
                      onClick={(e) => { e.stopPropagation(); handleEventClick(ev); }}
                    >
                      <div className="truncate pt-0.5 font-medium">{ev.label}</div>
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
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: MEMBER_COLOR.bg }} />
          <span>My Bookings</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: OTHER_COLOR.bg }} />
          <span>Unavailable</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: BLOCK_COLOR.bg }} />
          <span>Facility Unavailable</span>
        </div>
      </div>

      {/* Book Slot Dialog */}
      <Dialog open={bookingOpen} onOpenChange={setBookingOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Book a Slot</DialogTitle>
          </DialogHeader>

          {!showConfirm ? (
            <div className="space-y-4">
              <div>
                <Label>Date *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn('w-full justify-start text-left font-normal', !formDate && 'text-muted-foreground')}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {formDate ? format(formDate, 'PPP') : 'Pick a date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={formDate} onSelect={(d) => { setFormDate(d); setValidationError(null); }} initialFocus className="p-3 pointer-events-auto" />
                  </PopoverContent>
                </Popover>
              </div>

              {horizonError && (
                <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-md p-3">
                  <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{horizonError}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Start Time *</Label>
                  <AvailabilityTimeSelect
                    value={formStartTime}
                    onValueChange={handleStartTimeChange}
                    placeholder="Start"
                    dateStr={dateStr}
                    blocks={blocks}
                    bookings={allBookings as BookingRow[]}
                  />
                </div>
                <div>
                  <Label>End Time *</Label>
                  <AvailabilityTimeSelect
                    value={formEndTime}
                    onValueChange={(v) => { setFormEndTime(v); setValidationError(null); }}
                    placeholder="End"
                    dateStr={dateStr}
                    blocks={blocks}
                    bookings={allBookings as BookingRow[]}
                    startTimeForRange={formStartTime || undefined}
                  />
                </div>
              </div>

              <div>
                <Label>Notes (optional)</Label>
                <Textarea value={formNotes} onChange={e => setFormNotes(e.target.value)} rows={2} placeholder="Any context for your session…" />
              </div>

              {isGrowth && (
                <div className="space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox checked={isRecurring} onCheckedChange={(c) => setIsRecurring(!!c)} />
                    <span className="text-sm font-medium">Recurring weekly</span>
                  </label>
                  {isRecurring && (
                    <div className="space-y-3 pl-4 border-l-2 border-muted">
                      <div>
                        <Label className="text-sm">Day of week</Label>
                        <div className="flex gap-1 mt-1">
                          {DAYS_OF_WEEK.map(d => (
                            <Button
                              key={d} type="button" size="sm"
                              variant={recurringDay === d ? 'default' : 'outline'}
                              className="px-2 py-1 text-xs h-7"
                              onClick={() => setRecurringDay(d)}
                            >
                              {DAY_LABELS[d]}
                            </Button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <Label className="text-sm">End date (optional)</Label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="outline" size="sm" className={cn('w-full justify-start text-left font-normal', !recurringEndDate && 'text-muted-foreground')}>
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {recurringEndDate ? format(recurringEndDate, 'PPP') : '12 weeks (default)'}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar mode="single" selected={recurringEndDate} onSelect={setRecurringEndDate} initialFocus className="p-3 pointer-events-auto" />
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {validationError && <p className="text-xs text-destructive font-medium">{validationError}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setBookingOpen(false)}>Cancel</Button>
                <Button
                  onClick={() => {
                    setValidationError(null);
                    if (!formDate || !formStartTime || !formEndTime) {
                      setValidationError('Please fill all required fields');
                      return;
                    }
                    if (horizonError) { setValidationError(horizonError); return; }
                    setShowConfirm(true);
                  }}
                  disabled={!!horizonError}
                >
                  Continue
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <p className="font-medium">Confirm your booking</p>
                <p className="text-sm">
                  <strong>{formDate && format(formDate, 'EEEE, MMMM d, yyyy')}</strong>
                </p>
                <p className="text-sm">
                  {formStartTime && formatTime12(formStartTime)} – {formEndTime && formatTime12(formEndTime)} ({durationHrs.toFixed(1)}h)
                </p>
                {isRecurring && (
                  <Badge variant="secondary" className="text-xs">Recurring weekly</Badge>
                )}
              </div>

              <div className={cn('rounded-lg p-3 text-sm', willBeOverage ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-muted/30')}>
                <div className="flex items-start gap-2">
                  <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <div>
                    {willBeOverage ? (
                      <>
                        <p className="font-medium">Overage hours will apply</p>
                        <p>You have {remainingIncluded.toFixed(1)}h remaining of your {rates.includedHours}h included this month. The additional {(durationHrs - remainingIncluded).toFixed(1)}h will be billed at ${rates.overageRate}/hr.</p>
                      </>
                    ) : (
                      <p>This will use {durationHrs.toFixed(1)}h of your {remainingIncluded.toFixed(1)}h remaining included hours this month.</p>
                    )}
                  </div>
                </div>
              </div>

              {validationError && <p className="text-xs text-destructive font-medium">{validationError}</p>}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowConfirm(false)}>Back</Button>
                <Button onClick={() => createBookingMutation.mutate()} disabled={createBookingMutation.isPending}>
                  {createBookingMutation.isPending ? 'Booking…' : 'Confirm Booking'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Booking Detail / Cancel Dialog */}
      <Dialog open={!!selectedBooking} onOpenChange={(o) => { if (!o) setSelectedBooking(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Booking Details</DialogTitle>
          </DialogHeader>
          {selectedBooking && (() => {
            const bkDate = parseISO(selectedBooking.booking_date + 'T' + selectedBooking.start_time);
            const hrsUntil = differenceInHours(bkDate, new Date());
            const canCancel = hrsUntil > 48;
            const cancellationFee = hrsUntil <= 24
              ? rates.overageRate * (Number(selectedBooking.duration_hours) || (timeToMinutes(selectedBooking.end_time) - timeToMinutes(selectedBooking.start_time)) / 60)
              : hrsUntil <= 48
                ? rates.overageRate * (Number(selectedBooking.duration_hours) || (timeToMinutes(selectedBooking.end_time) - timeToMinutes(selectedBooking.start_time)) / 60) * 0.5
                : 0;

            return (
              <div className="space-y-4">
                <div className="space-y-2 text-sm">
                  <p><strong>Date:</strong> {format(new Date(selectedBooking.booking_date + 'T00:00:00'), 'EEEE, MMMM d, yyyy')}</p>
                  <p><strong>Time:</strong> {formatTime12(selectedBooking.start_time)} – {formatTime12(selectedBooking.end_time)}</p>
                  <p><strong>Duration:</strong> {Number(selectedBooking.duration_hours || 0).toFixed(1)}h</p>
                  {(selectedBooking as any).notes_member && (
                    <p><strong>Notes:</strong> {(selectedBooking as any).notes_member}</p>
                  )}
                </div>

                {canCancel ? (
                  <div className="space-y-2">
                    <Button
                      variant="destructive"
                      className="w-full"
                      onClick={() => cancelMutation.mutate(selectedBooking.id)}
                      disabled={cancelMutation.isPending}
                    >
                      {cancelMutation.isPending ? 'Cancelling…' : 'Cancel Booking'}
                    </Button>
                    <p className="text-xs text-muted-foreground text-center">
                      Free cancellation (more than 48 hours away)
                    </p>
                  </div>
                ) : (
                  <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Lock className="h-4 w-4" />
                      Cancellation locked
                    </div>
                    <p className="text-xs text-muted-foreground">
                      This booking is within 48 hours. A cancellation fee of <strong>${cancellationFee.toFixed(2)}</strong> would apply.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      To request a cancellation, please contact Home Island Coffee Partners directly.
                    </p>
                  </div>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
