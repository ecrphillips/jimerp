import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bell, Check } from 'lucide-react';
import { format, addDays } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ReminderBooking {
  id: string;
  booking_date: string;
  start_time: string;
  end_time: string;
  reminder_sent_at: string | null;
  coroast_members: { business_name: string } | null;
}

function formatTime(t: string): string {
  const [h, m] = t.split(':');
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${m} ${ampm}`;
}

export function PendingReminders() {
  const queryClient = useQueryClient();
  const today = format(new Date(), 'yyyy-MM-dd');
  const fourDaysOut = format(addDays(new Date(), 4), 'yyyy-MM-dd');

  const { data: reminders = [], isLoading } = useQuery({
    queryKey: ['pending-reminders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_bookings')
        .select('id, booking_date, start_time, end_time, reminder_sent_at, coroast_members:member_id(business_name)')
        .eq('status', 'CONFIRMED')
        .is('reminder_sent_at', null)
        .gte('booking_date', today)
        .lte('booking_date', fourDaysOut)
        .order('booking_date', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as ReminderBooking[];
    },
  });

  const markRemindedMutation = useMutation({
    mutationFn: async (bookingId: string) => {
      const { error } = await supabase
        .from('coroast_bookings')
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq('id', bookingId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Marked as reminded');
      queryClient.invalidateQueries({ queryKey: ['pending-reminders'] });
    },
    onError: () => toast.error('Failed to update reminder'),
  });

  if (isLoading) return null;
  if (reminders.length === 0) return null;

  return (
    <Card className="mt-6">
      <CardHeader className="flex flex-row items-center gap-2">
        <Bell className="h-4 w-4 text-amber-500" />
        <CardTitle className="text-base">Pending Reminders</CardTitle>
        <Badge variant="secondary" className="ml-auto text-xs">{reminders.length}</Badge>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {reminders.map(r => (
            <li key={r.id} className="flex items-center justify-between text-sm border-b pb-2 last:border-0">
              <div>
                <span className="font-medium">{r.coroast_members?.business_name ?? 'Unknown'}</span>
                <span className="ml-2 text-muted-foreground">
                  {format(new Date(r.booking_date + 'T00:00:00'), 'EEE, MMM d')}
                </span>
                <span className="ml-2 text-muted-foreground">
                  {formatTime(r.start_time)} – {formatTime(r.end_time)}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => markRemindedMutation.mutate(r.id)}
                disabled={markRemindedMutation.isPending}
              >
                <Check className="h-3.5 w-3.5 mr-1" /> Reminded
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
