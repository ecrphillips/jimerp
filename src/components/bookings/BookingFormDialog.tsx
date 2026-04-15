import { useState, useEffect, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon } from 'lucide-react';
import { format, addDays, addWeeks, getDay, startOfMonth, endOfMonth, isBefore, startOfDay } from 'date-fns';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { DAYS_OF_WEEK, DAY_LABELS, JS_DAY_TO_STRING } from '@/components/coroast/types';
import {
  checkOverlap, TIER_RATES, timeToMinutes,
  type MemberRow, type BookingRow, type BlockRow,
} from './bookingUtils';
import { resolveAccountRates } from './resolveRates';
import { AvailabilityTimeSelect } from './AvailabilityTimeSelect';
import { PastBookingConfirmModal } from './PastBookingConfirmModal';

interface BookingFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: MemberRow[];
  bookings: BookingRow[];
  blocks: BlockRow[];
  prefillDate?: string;
  prefillTime?: string;
  onSuccess: () => void;
}

const DAY_INDEX: Record<string, number> = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};

function getFirstOccurrence(startDate: Date, dayStr: string): Date {
  const target = DAY_INDEX[dayStr];
  const current = getDay(startDate);
  const diff = (target - current + 7) % 7;
  return diff === 0 ? startDate : addDays(startDate, diff);
}

function generateRecurringDates(startDate: Date, dayStr: string, endDate: Date | null): Date[] {
  const first = getFirstOccurrence(startDate, dayStr);
  const dates: Date[] = [];
  const maxDate = endDate || addDays(first, 12 * 7);
  let current = first;
  while (current <= maxDate) {
    dates.push(new Date(current));
    current = addDays(current, 7);
  }
  return dates;
}

export function BookingFormDialog({
  open, onOpenChange, members, bookings, blocks,
  prefillDate, prefillTime, onSuccess,
}: BookingFormDialogProps) {
  const queryClient = useQueryClient();

  const [memberId, setMemberId] = useState('');
  const [formDate, setFormDate] = useState<Date | undefined>();
  const [formStartTime, setFormStartTime] = useState('');
  const [formEndTime, setFormEndTime] = useState('');
  const [notes, setNotes] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringDay, setRecurringDay] = useState('MON');
  const [recurringEndDate, setRecurringEndDate] = useState<Date | undefined>();
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showPastConfirm, setShowPastConfirm] = useState(false);

  const activeMembers = useMemo(() => members.filter(m => m.is_active), [members]);
  const selectedMember = useMemo(() => members.find(m => m.id === memberId), [members, memberId]);
  const isGrowth = selectedMember?.tier === 'GROWTH' || selectedMember?.tier === 'PRODUCTION';

  const dateStr = formDate ? format(formDate, 'yyyy-MM-dd') : null;

  // Check if current selections are conflicted
  const startConflicted = useMemo(() => {
    if (!dateStr || !formStartTime) return false;
    const slotMin = timeToMinutes(formStartTime);
    const slotEnd = slotMin + 30;
    for (const b of blocks) {
      if (b.block_date !== dateStr) continue;
      if (slotMin < timeToMinutes(b.end_time) && slotEnd > timeToMinutes(b.start_time)) return true;
    }
    for (const bk of bookings) {
      if (bk.booking_date !== dateStr || ['CANCELLED', 'CANCELLED_FREE', 'CANCELLED_CHARGED', 'CANCELLED_WAIVED', 'NO_SHOW'].includes(bk.status)) continue;
      if (slotMin < timeToMinutes(bk.end_time) && slotEnd > timeToMinutes(bk.start_time)) return true;
    }
    return false;
  }, [dateStr, formStartTime, blocks, bookings]);

  const endConflicted = useMemo(() => {
    if (!dateStr || !formStartTime || !formEndTime) return false;
    return !!checkOverlap(dateStr, formStartTime, formEndTime, blocks, bookings);
  }, [dateStr, formStartTime, formEndTime, blocks, bookings]);

  useEffect(() => {
    if (open) {
      setMemberId('');
      setFormDate(prefillDate ? new Date(prefillDate + 'T00:00:00') : undefined);
      setFormStartTime(prefillTime ?? '');
      setFormEndTime('');
      setNotes('');
      setIsRecurring(false);
      setRecurringDay(prefillDate ? JS_DAY_TO_STRING[getDay(new Date(prefillDate + 'T00:00:00'))] : 'MON');
      setRecurringEndDate(undefined);
      setValidationError(null);
    }
  }, [open, prefillDate, prefillTime]);

  useEffect(() => {
    if (formDate) {
      setRecurringDay(JS_DAY_TO_STRING[getDay(formDate)]);
    }
  }, [formDate]);

  // Auto-set end time to 1 hour after start time
  useEffect(() => {
    if (formStartTime) {
      const startMin = timeToMinutes(formStartTime);
      const endMin = startMin + 60;
      if (endMin <= 22 * 60) {
        const h = Math.floor(endMin / 60);
        const m = endMin % 60;
        setFormEndTime(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
      }
    }
  }, [formStartTime]);

  // Reset recurring if switching to Member tier
  useEffect(() => {
    if (!isGrowth) setIsRecurring(false);
  }, [isGrowth]);

  async function getOrCreateBillingPeriod(mId: string, bookingDate: string): Promise<string> {
    const monthStart = format(startOfMonth(new Date(bookingDate + 'T00:00:00')), 'yyyy-MM-dd');
    const monthEnd = format(endOfMonth(new Date(bookingDate + 'T00:00:00')), 'yyyy-MM-dd');

    const { data: existing } = await supabase
      .from('coroast_billing_periods')
      .select('id')
      .eq('account_id', mId)
      .lte('period_start', monthEnd)
      .gte('period_end', monthStart)
      .limit(1);

    if (existing && existing.length > 0) return existing[0].id;

    const member = members.find(m => m.id === mId);
    const tier = member?.tier ?? 'MEMBER';
    const rates = await resolveAccountRates(mId, tier);

    const { data: created, error } = await supabase
      .from('coroast_billing_periods')
      .insert({
        account_id: mId,
        period_start: monthStart,
        period_end: monthEnd,
        tier_snapshot: tier,
        included_hours: rates.includedHours,
        overage_rate_per_hr: rates.overageRate,
        base_fee: rates.base,
      })
      .select('id')
      .single();

    if (error) throw new Error('Failed to create billing period: ' + error.message);
    return created.id;
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!memberId) throw new Error('Select a member');
      if (!formDate) throw new Error('Date is required');
      if (!formStartTime || !formEndTime) throw new Error('Start and end times required');
      if (formEndTime <= formStartTime) throw new Error('End time must be after start time');

      const saveDateStr = format(formDate, 'yyyy-MM-dd');

      // Member tier: 4 week horizon (only for future dates)
      if (selectedMember?.tier === 'MEMBER' && !isBefore(formDate, startOfDay(new Date()))) {
        const maxDate = addWeeks(new Date(), 4);
        if (formDate > maxDate) {
          throw new Error('Member tier members can only book within 4 weeks from today');
        }
      }

      if (isRecurring && isGrowth) {
        const dates = generateRecurringDates(formDate, recurringDay, recurringEndDate ?? null);
        if (dates.length === 0) throw new Error('No dates generated');

        for (const d of dates) {
          const ds = format(d, 'yyyy-MM-dd');
          const overlap = checkOverlap(ds, formStartTime, formEndTime, blocks, bookings);
          if (overlap) throw new Error(`${format(d, 'MMM d')}: ${overlap}`);
        }

        const { data: recurBlock, error: rbErr } = await supabase
          .from('coroast_recurring_blocks')
          .insert({
            account_id: memberId,
            day_of_week: recurringDay as any,
            start_time: formStartTime,
            end_time: formEndTime,
            effective_from: format(dates[0], 'yyyy-MM-dd'),
            effective_until: recurringEndDate ? format(recurringEndDate, 'yyyy-MM-dd') : null,
            notes: notes.trim() || null,
          })
          .select('id')
          .single();
        if (rbErr) throw rbErr;

        for (const d of dates) {
          const ds = format(d, 'yyyy-MM-dd');
          const billingPeriodId = await getOrCreateBillingPeriod(memberId, ds);

          const { data: booking, error: bErr } = await supabase
            .from('coroast_bookings')
            .insert({
              account_id: memberId,
              billing_period_id: billingPeriodId,
              booking_date: ds,
              start_time: formStartTime,
              end_time: formEndTime,
              recurring_block_id: recurBlock.id,
              notes_internal: notes.trim() || null,
              status: 'CONFIRMED',
            })
            .select('id')
            .single();
          if (bErr) throw bErr;

          const bookingDurationHrs = (timeToMinutes(formEndTime) - timeToMinutes(formStartTime)) / 60;
          await supabase.from('coroast_hour_ledger').insert({
            account_id: memberId,
            billing_period_id: billingPeriodId,
            booking_id: booking.id,
            entry_type: 'BOOKING_CONFIRMED' as any,
            hours_delta: bookingDurationHrs,
            notes: `Booking on ${ds}`,
          });
        }

        toast.success(`Created ${dates.length} recurring bookings`);
      } else {
        const overlap = checkOverlap(saveDateStr, formStartTime, formEndTime, blocks, bookings);
        if (overlap) throw new Error(overlap);

        const billingPeriodId = await getOrCreateBillingPeriod(memberId, saveDateStr);

        const { data: booking, error } = await supabase
          .from('coroast_bookings')
          .insert({
            account_id: memberId,
            billing_period_id: billingPeriodId,
            booking_date: saveDateStr,
            start_time: formStartTime,
            end_time: formEndTime,
            notes_internal: notes.trim() || null,
            status: 'CONFIRMED',
          })
          .select('id')
          .single();
        if (error) throw error;

        const singleDurationHrs = (timeToMinutes(formEndTime) - timeToMinutes(formStartTime)) / 60;
        await supabase.from('coroast_hour_ledger').insert({
          account_id: memberId,
          billing_period_id: billingPeriodId,
          booking_id: booking.id,
          entry_type: 'BOOKING_CONFIRMED' as any,
          hours_delta: singleDurationHrs,
          notes: `Booking on ${saveDateStr}`,
        });

        toast.success('Booking created');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['booking-calendar'] });
      onSuccess();
      onOpenChange(false);
    },
    onError: (err: Error) => {
      setValidationError(err.message);
    },
  });

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Booking</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Member select */}
          <div>
            <Label>Member *</Label>
            <Select value={memberId} onValueChange={(v) => { setMemberId(v); setValidationError(null); }}>
              <SelectTrigger>
                <SelectValue placeholder="Select member" />
              </SelectTrigger>
              <SelectContent>
                {activeMembers.map(m => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.business_name} ({m.tier})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date */}
          <div>
            <Label>Date *</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn('w-full justify-start text-left font-normal', !formDate && 'text-muted-foreground')}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {formDate ? format(formDate, 'PPP') : 'Pick a date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={formDate} onSelect={setFormDate} initialFocus className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
          </div>

          {/* Times */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Start Time *</Label>
              <AvailabilityTimeSelect
                value={formStartTime}
                onValueChange={(v) => { setFormStartTime(v); setValidationError(null); }}
                placeholder="Start"
                dateStr={dateStr}
                blocks={blocks}
                bookings={bookings}
                isConflicted={startConflicted}
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
                bookings={bookings}
                startTimeForRange={formStartTime || undefined}
                isConflicted={endConflicted}
              />
            </div>
          </div>

          {/* Inline conflict hint */}
          {(startConflicted || endConflicted) && (
            <p className="text-xs text-destructive">
              Selected time conflicts with an existing block or booking. Choose a different slot.
            </p>
          )}

          {/* Recurring (Growth only) */}
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
                        <Button
                          variant="outline" size="sm"
                          className={cn('w-full justify-start text-left font-normal', !recurringEndDate && 'text-muted-foreground')}
                        >
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

          {/* Notes */}
          <div>
            <Label>Internal Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
          </div>

          {/* Backstop error (rarely shown) */}
          {validationError && (
            <p className="text-xs text-destructive font-medium">{validationError}</p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              onClick={() => {
                setValidationError(null);
                // Check if date is in the past
                if (formDate && isBefore(startOfDay(formDate), startOfDay(new Date()))) {
                  setShowPastConfirm(true);
                } else {
                  mutation.mutate();
                }
              }}
              disabled={mutation.isPending || startConflicted || endConflicted}
            >
              {mutation.isPending ? 'Saving…' : 'Create Booking'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <PastBookingConfirmModal
      open={showPastConfirm}
      onOpenChange={setShowPastConfirm}
      onConfirm={() => {
        setShowPastConfirm(false);
        mutation.mutate();
      }}
      isPending={mutation.isPending}
    />
  </>
  );
}
