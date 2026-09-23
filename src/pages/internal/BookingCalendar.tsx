import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { BookingWeekView } from '@/components/bookings/BookingWeekView';
import { BookingFormDialog } from '@/components/bookings/BookingFormDialog';
import { BookingDetailModal } from '@/components/bookings/BookingDetailModal';
import { MemberSummaryPanel } from '@/components/bookings/MemberSummaryPanel';
import type { MemberRow, BookingRow, BlockRow, AvailabilityWindow } from '@/components/bookings/bookingUtils';
import { FacilityBookingFormDialog, FacilityBookingDetailDialog } from '@/components/bookings/FacilityBookingDialogs';
import {
  useScheduleLayers, LayerToggles, isFacility,
  type ScheduleLayer, type FacilityResource, type FacilityBookingRow, type FacilityBlockRow,
} from '@/components/bookings/scheduleLayers';

export default function BookingCalendar() {
  const [showBookingDialog, setShowBookingDialog] = useState(false);
  const [prefillDate, setPrefillDate] = useState<string | undefined>();
  const [prefillTime, setPrefillTime] = useState<string | undefined>();
  const [detailBooking, setDetailBooking] = useState<BookingRow | null>(null);
  const { visible: visibleLayers, toggle: toggleLayer } = useScheduleLayers('jim.bookingCalendar.layers');
  const [facilityDialogResource, setFacilityDialogResource] = useState<FacilityResource | null>(null);
  const [detailFacilityBooking, setDetailFacilityBooking] = useState<FacilityBookingRow | null>(null);

  const currentMonth = format(new Date(), 'yyyy-MM');

  const { data: members = [] } = useQuery({
    queryKey: ['booking-calendar', 'members'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts')
        .select('id, account_name, coroast_tier, is_active')
        .contains('programs', ['COROASTING'])
        .eq('is_active', true)
        .order('account_name');
      if (error) throw error;
      return (data ?? []).map(a => ({
        id: a.id,
        business_name: a.account_name,
        tier: (a.coroast_tier ?? 'MEMBER') as any,
        is_active: a.is_active,
      })) as MemberRow[];
    },
  });

  const { data: bookings = [] } = useQuery({
    queryKey: ['booking-calendar', 'bookings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_bookings')
        .select('id, account_id, billing_period_id, booking_date, start_time, end_time, duration_hours, status, recurring_block_id, notes_internal, accounts(account_name)')
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

  const { data: windows = [] } = useQuery({
    queryKey: ['booking-calendar', 'availability-windows'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_availability_windows')
        .select('id, day_of_week, open_time, close_time, is_active, notes');
      if (error) throw error;
      return (data ?? []) as AvailabilityWindow[];
    },
  });

  const { data: facilityBookings = [] } = useQuery({
    queryKey: ['booking-calendar', 'facility-bookings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_facility_bookings')
        .select('id, account_id, resource, booking_date, start_time, end_time, status, notes_member, notes_internal, accounts(account_name)')
        .eq('status', 'CONFIRMED')
        .order('booking_date');
      if (error) throw error;
      return (data ?? []) as FacilityBookingRow[];
    },
  });

  const { data: facilityBlocks = [] } = useQuery({
    queryKey: ['booking-calendar', 'facility-blocks'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_facility_blocks')
        .select('id, resource, block_date, start_time, end_time, block_type, notes')
        .order('block_date');
      if (error) throw error;
      return (data ?? []) as FacilityBlockRow[];
    },
  });

  const handleSlotClick = (date: string, time: string, layer: ScheduleLayer) => {
    setPrefillDate(date);
    setPrefillTime(time);
    if (isFacility(layer)) {
      setFacilityDialogResource(layer);
    } else {
      setShowBookingDialog(true);
    }
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
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => { setPrefillDate(undefined); setPrefillTime(undefined); setFacilityDialogResource('CUPPING_LAB'); }}
          >
            <Plus className="h-4 w-4 mr-2" /> Lab / Sample Roaster
          </Button>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" /> Add Booking
          </Button>
        </div>
      </div>

      <MemberSummaryPanel members={members} bookings={bookings} currentMonth={currentMonth} />

      <Card>
        <CardContent className="pt-6 space-y-4">
          <LayerToggles visible={visibleLayers} onToggle={toggleLayer} />
          <BookingWeekView
            blocks={blocks}
            bookings={bookings}
            members={members}
            windows={windows}
            onSlotClick={handleSlotClick}
            onBookingClick={(bk) => setDetailBooking(bk)}
            facilityBookings={facilityBookings}
            facilityBlocks={facilityBlocks}
            visibleLayers={visibleLayers}
            onFacilityBookingClick={setDetailFacilityBooking}
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

      <BookingDetailModal
        open={!!detailBooking}
        onOpenChange={(o) => { if (!o) setDetailBooking(null); }}
        booking={detailBooking}
        members={members}
        allBookings={bookings}
        blocks={blocks}
      />

      <FacilityBookingFormDialog
        open={!!facilityDialogResource}
        onOpenChange={(o) => { if (!o) setFacilityDialogResource(null); }}
        members={members}
        facilityBookings={facilityBookings}
        facilityBlocks={facilityBlocks}
        prefillResource={facilityDialogResource ?? undefined}
        prefillDate={prefillDate}
        prefillTime={prefillTime}
      />

      <FacilityBookingDetailDialog
        booking={detailFacilityBooking}
        onOpenChange={(o) => { if (!o) setDetailFacilityBooking(null); }}
      />
    </div>
  );
}
