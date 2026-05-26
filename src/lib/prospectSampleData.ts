/**
 * Hardcoded sample data for prospect preview of the member portal schedule.
 * Used ONLY when account_status === 'PROSPECT'. Never written to the DB.
 * Booking dates are anchored to the upcoming week so the calendar feels live.
 */
import { addDays, format, startOfWeek } from 'date-fns';
import type { BookingRow, BusySlot } from '@/components/bookings/bookingUtils';

const MOCK_ACCOUNT_ID = '00000000-0000-0000-0000-000000000001';
const MOCK_MEMBER_ID = '00000000-0000-0000-0000-000000000002';

function dateAt(offsetDays: number): string {
  const base = startOfWeek(new Date(), { weekStartsOn: 1 });
  return format(addDays(base, offsetDays), 'yyyy-MM-dd');
}

type SampleBooking = BookingRow & { notes_member: string | null };

export const SAMPLE_PROSPECT_BOOKINGS: SampleBooking[] = [
  {
    id: 'sample-bk-1',
    member_id: MOCK_MEMBER_ID,
    account_id: MOCK_ACCOUNT_ID,
    billing_period_id: null,
    booking_date: dateAt(1),
    start_time: '08:00',
    end_time: '11:00',
    duration_hours: 3,
    status: 'CONFIRMED',
    recurring_block_id: null,
    notes_internal: null,
    notes_member: 'Ethiopia Sidamo · 60kg',
  },
  {
    id: 'sample-bk-2',
    member_id: MOCK_MEMBER_ID,
    account_id: MOCK_ACCOUNT_ID,
    billing_period_id: null,
    booking_date: dateAt(2),
    start_time: '13:00',
    end_time: '16:00',
    duration_hours: 3,
    status: 'CONFIRMED',
    recurring_block_id: null,
    notes_internal: null,
    notes_member: 'Colombia Huila · 80kg',
  },
  {
    id: 'sample-bk-3',
    member_id: MOCK_MEMBER_ID,
    account_id: MOCK_ACCOUNT_ID,
    billing_period_id: null,
    booking_date: dateAt(4),
    start_time: '09:00',
    end_time: '12:00',
    duration_hours: 3,
    status: 'CONFIRMED',
    recurring_block_id: null,
    notes_internal: null,
    notes_member: 'Espresso blend',
  },
] as unknown as SampleBooking[];

export const SAMPLE_PROSPECT_BUSY_SLOTS: BusySlot[] = [
  { booking_date: dateAt(0), start_time: '14:00', end_time: '17:00' },
  { booking_date: dateAt(2), start_time: '08:00', end_time: '11:30' },
  { booking_date: dateAt(3), start_time: '13:00', end_time: '16:30' },
  { booking_date: dateAt(5), start_time: '08:00', end_time: '12:00' },
] as BusySlot[];
