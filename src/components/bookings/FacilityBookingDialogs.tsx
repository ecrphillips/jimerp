import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { parseDateOnly } from '@/lib/dateOnly';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AvailabilityTimeSelect } from './AvailabilityTimeSelect';
import { checkOverlap, formatTime12, timeToMinutes, type MemberRow } from './bookingUtils';
import {
  FACILITY_RESOURCES, LAYER_BY_KEY, facilityAsBookingRows,
  type FacilityResource, type FacilityBookingRow, type FacilityBlockRow,
} from './scheduleLayers';

// Admin/Ops create + cancel for cupping lab / sample roaster bookings. Direct table
// writes (Admin/Ops RLS); the DB trigger rejects overlaps on the same resource.
// Like admin-created Loring bookings, these do not send notification emails.

const INVALIDATE_KEY = ['booking-calendar', 'facility-bookings'];

interface CreateProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: MemberRow[];
  facilityBookings: FacilityBookingRow[];
  facilityBlocks: FacilityBlockRow[];
  prefillResource?: FacilityResource;
  prefillDate?: string;
  prefillTime?: string;
}

function plusOneHour(time: string): string {
  const end = timeToMinutes(time) + 60;
  if (end > 22 * 60) return '';
  return `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
}

export function FacilityBookingFormDialog({
  open, onOpenChange, members, facilityBookings, facilityBlocks, prefillResource, prefillDate, prefillTime,
}: CreateProps) {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();
  const [resource, setResource] = useState<FacilityResource>('CUPPING_LAB');
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState<Date | undefined>();
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setResource(prefillResource ?? 'CUPPING_LAB');
    setAccountId('');
    setDate(prefillDate ? parseDateOnly(prefillDate)! : undefined);
    setStartTime(prefillTime ?? '');
    setEndTime(prefillTime ? plusOneHour(prefillTime) : '');
    setNotes('');
    setError(null);
  }, [open, prefillResource, prefillDate, prefillTime]);

  const dateStr = date ? format(date, 'yyyy-MM-dd') : null;
  const resourceBlocks = facilityBlocks.filter(b => b.resource === resource);
  const resourceBookings = facilityAsBookingRows(facilityBookings.filter(b => b.resource === resource));

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!accountId || !dateStr || !startTime || !endTime) throw new Error('Please fill all required fields');
      if (timeToMinutes(endTime) <= timeToMinutes(startTime)) throw new Error('End time must be after start time');
      const overlap = checkOverlap(dateStr, startTime, endTime, resourceBlocks, resourceBookings);
      if (overlap) throw new Error(overlap);

      const { error } = await supabase.from('coroast_facility_bookings').insert({
        account_id: accountId,
        resource,
        booking_date: dateStr,
        start_time: startTime,
        end_time: endTime,
        notes_internal: notes.trim() || null,
        created_by: authUser?.id ?? null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success(`${LAYER_BY_KEY[resource].label} booked`);
      queryClient.invalidateQueries({ queryKey: INVALIDATE_KEY });
      onOpenChange(false);
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Book {LAYER_BY_KEY[resource].label}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Resource *</Label>
            <Select value={resource} onValueChange={(v) => { setResource(v as FacilityResource); setError(null); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {FACILITY_RESOURCES.map(r => <SelectItem key={r} value={r}>{LAYER_BY_KEY[r].label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Member *</Label>
            <Select value={accountId} onValueChange={(v) => { setAccountId(v); setError(null); }}>
              <SelectTrigger><SelectValue placeholder="Select member" /></SelectTrigger>
              <SelectContent>
                {members.filter(m => m.is_active).map(m => <SelectItem key={m.id} value={m.id}>{m.business_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Date *</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn('w-full justify-start text-left font-normal', !date && 'text-muted-foreground')}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date ? format(date, 'PPP') : 'Pick a date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={date} onSelect={(d) => { setDate(d); setError(null); }} initialFocus className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Start Time *</Label>
              <AvailabilityTimeSelect
                value={startTime}
                onValueChange={(v) => { setStartTime(v); setEndTime(plusOneHour(v)); setError(null); }}
                placeholder="Start"
                dateStr={dateStr}
                blocks={resourceBlocks}
                bookings={resourceBookings}
              />
            </div>
            <div>
              <Label>End Time *</Label>
              <AvailabilityTimeSelect
                value={endTime}
                onValueChange={(v) => { setEndTime(v); setError(null); }}
                placeholder="End"
                dateStr={dateStr}
                blocks={resourceBlocks}
                bookings={resourceBookings}
                startTimeForRange={startTime || undefined}
              />
            </div>
          </div>
          <div>
            <Label>Internal notes (optional)</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
          </div>
          {error && <p className="text-xs text-destructive font-medium">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Booking…' : 'Book'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function FacilityBookingDetailDialog({
  booking, onOpenChange,
}: { booking: FacilityBookingRow | null; onOpenChange: (open: boolean) => void }) {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('coroast_facility_bookings')
        .update({ status: 'CANCELLED', cancelled_at: new Date().toISOString(), cancelled_by: authUser?.id ?? null })
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success('Booking cancelled');
      queryClient.invalidateQueries({ queryKey: INVALIDATE_KEY });
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to cancel booking'),
  });

  return (
    <Dialog open={!!booking} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{booking ? LAYER_BY_KEY[booking.resource].label : ''} Booking</DialogTitle>
        </DialogHeader>
        {booking && (
          <div className="space-y-4">
            <div className="space-y-2 text-sm">
              <p><strong>Member:</strong> {booking.accounts?.account_name ?? '—'}</p>
              <p><strong>Date:</strong> {format(parseDateOnly(booking.booking_date)!, 'EEEE, MMMM d, yyyy')}</p>
              <p><strong>Time:</strong> {formatTime12(booking.start_time)} – {formatTime12(booking.end_time)}</p>
              {booking.notes_member && <p><strong>Member notes:</strong> {booking.notes_member}</p>}
              {booking.notes_internal && <p><strong>Internal notes:</strong> {booking.notes_internal}</p>}
            </div>
            <Button
              variant="destructive"
              className="w-full"
              onClick={() => cancelMutation.mutate(booking.id)}
              disabled={cancelMutation.isPending}
            >
              {cancelMutation.isPending ? 'Cancelling…' : 'Cancel Booking'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
