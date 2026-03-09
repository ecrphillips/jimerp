import { useState, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Lock, Unlock, AlertTriangle } from 'lucide-react';
import { format, differenceInHours, parseISO } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { formatTime12, timeToMinutes, TIER_RATES, type BookingRow, type MemberRow } from './bookingUtils';

interface BookingDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  booking: BookingRow | null;
  members: MemberRow[];
  allBookings: BookingRow[];
}

type CancelMode = 'free' | 'charge' | 'waive' | 'delete' | null;

export function BookingDetailModal({ open, onOpenChange, booking, members, allBookings }: BookingDetailModalProps) {
  const queryClient = useQueryClient();
  const [cancelMode, setCancelMode] = useState<CancelMode>(null);
  const [waiveReason, setWaiveReason] = useState('');

  if (!booking) return null;

  const member = members.find(m => m.id === booking.member_id);
  const durationHrs = (timeToMinutes(booking.end_time) - timeToMinutes(booking.start_time)) / 60;
  const tier = member?.tier ?? 'ACCESS';
  const rates = TIER_RATES[tier] ?? TIER_RATES.ACCESS;
  const cancellationFee = durationHrs * rates.overageRate;

  // Lock: <48h from booking start
  const bookingStart = parseISO(`${booking.booking_date}T${booking.start_time}`);
  const hoursUntil = differenceInHours(bookingStart, new Date());
  const isLocked = hoursUntil < 48;
  const isPast = bookingStart < new Date();
  const isConfirmed = booking.status === 'CONFIRMED';

  // Determine hours type (included vs overage)
  const hoursType = useMemo(() => {
    const month = booking.booking_date.slice(0, 7);
    const monthBookings = allBookings
      .filter(b => b.member_id === booking.member_id && b.booking_date.startsWith(month) && !['CANCELLED_FREE', 'CANCELLED_CHARGED', 'CANCELLED_WAIVED'].includes(b.status))
      .sort((a, b) => a.booking_date.localeCompare(b.booking_date) || a.start_time.localeCompare(b.start_time));
    let running = 0;
    for (const bk of monthBookings) {
      const dur = (timeToMinutes(bk.end_time) - timeToMinutes(bk.start_time)) / 60;
      if (bk.id === booking.id) {
        return running >= rates.includedHours ? 'Overage' : running + dur > rates.includedHours ? 'Partial overage' : 'Included';
      }
      running += dur;
    }
    return 'Included';
  }, [booking, allBookings, rates, member]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['booking-calendar'] });
  };

  // Cancel free (unlocked)
  const cancelFreeMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('coroast_bookings')
        .update({ status: 'CANCELLED_FREE' as any })
        .eq('id', booking.id);
      if (error) throw error;

      await supabase.from('coroast_hour_ledger').insert({
        member_id: booking.member_id,
        billing_period_id: booking.billing_period_id,
        booking_id: booking.id,
        entry_type: 'BOOKING_RETURNED' as any,
        hours_delta: -durationHrs,
        notes: `Free cancellation for ${booking.booking_date}`,
      });
    },
    onSuccess: () => { toast.success('Booking cancelled (free)'); invalidateAll(); onOpenChange(false); },
    onError: () => toast.error('Failed to cancel booking'),
  });

  // Delete booking entirely (locked)
  const deleteMutation = useMutation({
    mutationFn: async () => {
      // Remove ledger entries for this booking
      await supabase.from('coroast_hour_ledger').delete().eq('booking_id', booking.id);
      // Delete the booking
      const { error } = await supabase.from('coroast_bookings').delete().eq('id', booking.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Booking deleted'); invalidateAll(); onOpenChange(false); },
    onError: () => toast.error('Failed to delete booking'),
  });

  // Cancel and charge fee (locked)
  const cancelChargeMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('coroast_bookings')
        .update({
          status: 'CANCELLED_CHARGED' as any,
          cancellation_fee_amt: cancellationFee,
          cancelled_at: new Date().toISOString(),
        })
        .eq('id', booking.id);
      if (error) throw error;
      // No hours returned
    },
    onSuccess: () => { toast.success('Booking cancelled with fee charged'); invalidateAll(); onOpenChange(false); },
    onError: () => toast.error('Failed to cancel booking'),
  });

  // Cancel and waive fee (locked)
  const cancelWaiveMutation = useMutation({
    mutationFn: async () => {
      if (!waiveReason.trim()) throw new Error('Waive reason is required');

      const { error } = await supabase
        .from('coroast_bookings')
        .update({
          status: 'CANCELLED_WAIVED' as any,
          cancellation_waived: true,
          waive_reason: waiveReason.trim(),
          cancelled_at: new Date().toISOString(),
        })
        .eq('id', booking.id);
      if (error) throw error;

      // Write waiver log
      await supabase.from('coroast_waiver_log').insert({
        member_id: booking.member_id,
        booking_id: booking.id,
        fee_amount_waived: cancellationFee,
        waive_reason: waiveReason.trim(),
      });

      // Return hours
      await supabase.from('coroast_hour_ledger').insert({
        member_id: booking.member_id,
        billing_period_id: booking.billing_period_id,
        booking_id: booking.id,
        entry_type: 'BOOKING_RETURNED' as any,
        hours_delta: -durationHrs,
        notes: `Waived cancellation for ${booking.booking_date}`,
      });
    },
    onSuccess: () => { toast.success('Booking cancelled with fee waived'); invalidateAll(); onOpenChange(false); },
    onError: (err: Error) => toast.error(err.message || 'Failed to cancel booking'),
  });

  // No-show
  const noShowMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('coroast_bookings')
        .update({ status: 'NO_SHOW' as any })
        .eq('id', booking.id);
      if (error) throw error;
      // No hours returned for no-show
    },
    onSuccess: () => { toast.success('Marked as no-show'); invalidateAll(); onOpenChange(false); },
    onError: () => toast.error('Failed to mark no-show'),
  });

  const isPending = cancelFreeMutation.isPending || deleteMutation.isPending ||
    cancelChargeMutation.isPending || cancelWaiveMutation.isPending || noShowMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setCancelMode(null); onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Booking Details
            {isLocked ? <Lock className="h-4 w-4 text-muted-foreground" /> : <Unlock className="h-4 w-4 text-muted-foreground" />}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div><span className="text-muted-foreground">Member:</span></div>
            <div className="font-medium">{member?.business_name ?? 'Unknown'}</div>
            <div><span className="text-muted-foreground">Date:</span></div>
            <div>{format(parseISO(booking.booking_date), 'EEE, MMM d, yyyy')}</div>
            <div><span className="text-muted-foreground">Time:</span></div>
            <div>{formatTime12(booking.start_time)} – {formatTime12(booking.end_time)}</div>
            <div><span className="text-muted-foreground">Duration:</span></div>
            <div>{durationHrs.toFixed(1)}h</div>
            <div><span className="text-muted-foreground">Hours type:</span></div>
            <div>
              <Badge variant={hoursType === 'Included' ? 'secondary' : 'destructive'} className="text-xs">
                {hoursType}
              </Badge>
            </div>
            <div><span className="text-muted-foreground">Status:</span></div>
            <div><Badge variant="outline" className="text-xs">{booking.status}</Badge></div>
          </div>

          {booking.notes_internal && (
            <div>
              <span className="text-muted-foreground text-xs">Internal notes:</span>
              <p className="text-xs mt-0.5">{booking.notes_internal}</p>
            </div>
          )}

          {isLocked && isConfirmed && (
            <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 rounded p-2">
              <Lock className="h-3.5 w-3.5 flex-shrink-0" />
              Less than 48 hours away — late cancellation rules apply
            </div>
          )}

          {/* Action buttons for CONFIRMED bookings */}
          {isConfirmed && !cancelMode && (
            <div className="space-y-2 pt-2 border-t">
              {!isLocked ? (
                <Button
                  variant="destructive"
                  size="sm"
                  className="w-full"
                  onClick={() => cancelFreeMutation.mutate()}
                  disabled={isPending}
                >
                  Cancel Booking (Free)
                </Button>
              ) : (
                <>
                  <Button variant="outline" size="sm" className="w-full" onClick={() => setCancelMode('delete')} disabled={isPending}>
                    Delete Booking
                  </Button>
                  <Button variant="outline" size="sm" className="w-full" onClick={() => setCancelMode('charge')} disabled={isPending}>
                    Cancel &amp; Charge Fee (${cancellationFee.toFixed(0)})
                  </Button>
                  <Button variant="outline" size="sm" className="w-full" onClick={() => setCancelMode('waive')} disabled={isPending}>
                    Cancel &amp; Waive Fee
                  </Button>
                </>
              )}

              {isPast && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-orange-600 border-orange-300 hover:bg-orange-50"
                  onClick={() => noShowMutation.mutate()}
                  disabled={isPending}
                >
                  <AlertTriangle className="h-3.5 w-3.5 mr-1" /> Mark as No-Show
                </Button>
              )}
            </div>
          )}

          {/* Confirmation sub-panels */}
          {cancelMode === 'delete' && (
            <div className="space-y-2 pt-2 border-t">
              <p className="text-xs text-destructive font-medium">This will permanently delete the booking and remove all ledger entries. Are you sure?</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setCancelMode(null)}>Back</Button>
                <Button variant="destructive" size="sm" onClick={() => deleteMutation.mutate()} disabled={isPending}>
                  {deleteMutation.isPending ? 'Deleting…' : 'Confirm Delete'}
                </Button>
              </div>
            </div>
          )}

          {cancelMode === 'charge' && (
            <div className="space-y-2 pt-2 border-t">
              <p className="text-xs font-medium">Cancellation fee of <span className="text-destructive">${cancellationFee.toFixed(2)}</span> will be charged. Hours will not be returned.</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setCancelMode(null)}>Back</Button>
                <Button variant="destructive" size="sm" onClick={() => cancelChargeMutation.mutate()} disabled={isPending}>
                  {cancelChargeMutation.isPending ? 'Processing…' : 'Confirm Charge'}
                </Button>
              </div>
            </div>
          )}

          {cancelMode === 'waive' && (
            <div className="space-y-2 pt-2 border-t">
              <p className="text-xs font-medium">Fee of ${cancellationFee.toFixed(2)} will be waived. Hours will be returned.</p>
              <div>
                <Label className="text-xs">Waive reason *</Label>
                <Textarea value={waiveReason} onChange={e => setWaiveReason(e.target.value)} rows={2} placeholder="Reason for waiving the fee…" />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setCancelMode(null)}>Back</Button>
                <Button
                  size="sm"
                  onClick={() => cancelWaiveMutation.mutate()}
                  disabled={isPending || !waiveReason.trim()}
                >
                  {cancelWaiveMutation.isPending ? 'Processing…' : 'Confirm Waive'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
