import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { BookingWeekView } from '@/components/bookings/BookingWeekView';
import { BookingFormDialog } from '@/components/bookings/BookingFormDialog';
import { MemberSummaryPanel } from '@/components/bookings/MemberSummaryPanel';
import type { MemberRow, BookingRow, BlockRow } from '@/components/bookings/bookingUtils';

export default function BookingCalendar() {
  const [showBookingDialog, setShowBookingDialog] = useState(false);
  const [prefillDate, setPrefillDate] = useState<string | undefined>();
  const [prefillTime, setPrefillTime] = useState<string | undefined>();

  const currentMonth = format(new Date(), 'yyyy-MM');

  const { data: members = [] } = useQuery({
    queryKey: ['booking-calendar', 'members'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_members')
        .select('id, business_name, tier, is_active')
        .order('business_name');
      if (error) throw error;
      return (data ?? []) as MemberRow[];
    },
  });

  const { data: bookings = [] } = useQuery({
    queryKey: ['booking-calendar', 'bookings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_bookings')
        .select('id, member_id, billing_period_id, booking_date, start_time, end_time, duration_hours, status, recurring_block_id, notes_internal, coroast_members(business_name)')
        .order('booking_date');
      if (error) throw error;
      return (data ?? []) as BookingRow[];
    },
  });

  const { data: blocks = [] } = useQuery({
    queryKey: ['booking-calendar', 'blocks'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_loring_blocks')
        .select('id, block_date, start_time, end_time, block_type, notes')
        .order('block_date');
      if (error) throw error;
      return (data ?? []) as BlockRow[];
    },
  });

  const handleSlotClick = (date: string, time: string) => {
    setPrefillDate(date);
    setPrefillTime(time);
    setShowBookingDialog(true);
  };

  const openCreate = () => {
    setPrefillDate(undefined);
    setPrefillTime(undefined);
    setShowBookingDialog(true);
  };

  return (
    <div className="page-container">
      <div className="page-header flex items-center justify-between">
        <h1 className="page-title">Booking Calendar</h1>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" /> Add Booking
        </Button>
      </div>

      <MemberSummaryPanel members={members} bookings={bookings} currentMonth={currentMonth} />

      <Card>
        <CardContent className="pt-6">
          <BookingWeekView
            blocks={blocks}
            bookings={bookings}
            members={members}
            onSlotClick={handleSlotClick}
          />
        </CardContent>
      </Card>

      <BookingFormDialog
        open={showBookingDialog}
        onOpenChange={setShowBookingDialog}
        members={members}
        bookings={bookings}
        blocks={blocks}
        prefillDate={prefillDate}
        prefillTime={prefillTime}
        onSuccess={() => {}}
      />
    </div>
  );
}
