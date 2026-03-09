import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

interface WaiverHistoryPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberId: string;
  memberName: string;
}

interface WaiverRecord {
  id: string;
  fee_amount_waived: number;
  waive_reason: string | null;
  waived_by: string | null;
  created_at: string;
  coroast_bookings: { booking_date: string } | null;
}

export function WaiverHistoryPanel({ open, onOpenChange, memberId, memberName }: WaiverHistoryPanelProps) {
  const { data: waivers = [], isLoading } = useQuery({
    queryKey: ['waiver-history', memberId],
    enabled: open && !!memberId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_waiver_log')
        .select('id, fee_amount_waived, waive_reason, waived_by, created_at, coroast_bookings:booking_id(booking_date)')
        .eq('member_id', memberId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as WaiverRecord[];
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Waiver History — {memberName}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : waivers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No waivers on record.</p>
        ) : (
          <ul className="space-y-3 max-h-[400px] overflow-auto">
            {waivers.map(w => (
              <li key={w.id} className="border-b pb-2 last:border-0 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {w.coroast_bookings?.booking_date
                      ? format(new Date(w.coroast_bookings.booking_date + 'T00:00:00'), 'MMM d, yyyy')
                      : 'Unknown date'}
                  </span>
                  <span className="text-destructive font-medium">${Number(w.fee_amount_waived).toFixed(2)}</span>
                </div>
                {w.waive_reason && (
                  <p className="text-xs text-muted-foreground mt-0.5">{w.waive_reason}</p>
                )}
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {format(new Date(w.created_at), 'MMM d, yyyy h:mm a')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
