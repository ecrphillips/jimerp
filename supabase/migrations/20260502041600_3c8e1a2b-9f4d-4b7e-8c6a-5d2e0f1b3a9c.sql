-- ============================================================
-- Fix hours_delta sign convention in member-portal booking RPCs.
--
-- Convention (matches admin UI in BookingFormDialog.tsx / BookingDetailModal.tsx):
--   BOOKING_CONFIRMED → positive delta (hours consumed)
--   BOOKING_RETURNED  → negative delta (hours credited back)
--
-- The previous migration (20260501195324_f87ebd36-*.sql) had these inverted.
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_member_booking(
  p_account_id uuid,
  p_booking_date date,
  p_start_time time,
  p_end_time time,
  p_notes text DEFAULT NULL,
  p_recurring_block_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking_id uuid;
  v_billing_period_id uuid;
  v_hours numeric;
BEGIN
  PERFORM public._assert_active_coroast_member(p_account_id);

  IF p_start_time >= p_end_time THEN
    RAISE EXCEPTION 'Invalid time range';
  END IF;

  -- Overlap check: any non-cancelled booking on same date for any account
  -- (mirrors checkOverlap() in bookingUtils.ts which excludes CANCELLED_*/NO_SHOW)
  IF EXISTS (
    SELECT 1 FROM public.coroast_bookings cb
    WHERE cb.booking_date = p_booking_date
      AND cb.status NOT IN ('CANCELLED_FREE', 'CANCELLED_CHARGED', 'CANCELLED_WAIVED', 'NO_SHOW')
      AND cb.start_time < p_end_time
      AND cb.end_time   > p_start_time
  ) THEN
    RAISE EXCEPTION 'Time slot conflicts with an existing booking';
  END IF;

  -- Conflict with internal/maintenance blocks
  IF EXISTS (
    SELECT 1 FROM public.coroast_loring_blocks lb
    WHERE lb.block_date = p_booking_date
      AND lb.start_time < p_end_time
      AND lb.end_time   > p_start_time
  ) THEN
    RAISE EXCEPTION 'Time slot conflicts with an unavailability block';
  END IF;

  v_billing_period_id := public._get_or_create_billing_period(p_account_id, p_booking_date);
  v_hours := ROUND(EXTRACT(EPOCH FROM (p_end_time - p_start_time)) / 3600.0, 2);

  INSERT INTO public.coroast_bookings (
    account_id, billing_period_id, booking_date, start_time, end_time,
    notes_member, recurring_block_id, status, created_by
  ) VALUES (
    p_account_id, v_billing_period_id, p_booking_date, p_start_time, p_end_time,
    NULLIF(TRIM(COALESCE(p_notes, '')), ''), p_recurring_block_id,
    'CONFIRMED'::coroast_booking_status, auth.uid()
  )
  RETURNING id INTO v_booking_id;

  INSERT INTO public.coroast_hour_ledger (
    account_id, billing_period_id, booking_id, entry_type, hours_delta, notes, created_by
  ) VALUES (
    p_account_id, v_billing_period_id, v_booking_id,
    'BOOKING_CONFIRMED'::coroast_ledger_entry_type,
    v_hours, -- positive: hours consumed
    'Self-serve booking on ' || to_char(p_booking_date, 'YYYY-MM-DD'),
    auth.uid()
  );

  RETURN v_booking_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_member_booking(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_billing_period_id uuid;
  v_booking_date date;
  v_status coroast_booking_status;
  v_duration numeric;
BEGIN
  SELECT account_id, billing_period_id, booking_date, status, duration_hours
    INTO v_account_id, v_billing_period_id, v_booking_date, v_status, v_duration
    FROM public.coroast_bookings
   WHERE id = p_booking_id;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  PERFORM public._assert_active_coroast_member(v_account_id);

  IF v_status IN ('CANCELLED_FREE','CANCELLED_CHARGED','CANCELLED_WAIVED','NO_SHOW','COMPLETED') THEN
    RAISE EXCEPTION 'Booking is not cancellable';
  END IF;

  -- Mirror existing UI behaviour: members can only cancel future bookings
  IF v_booking_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'Cannot cancel a past booking';
  END IF;

  UPDATE public.coroast_bookings
     SET status = 'CANCELLED_FREE'::coroast_booking_status,
         cancelled_at = now(),
         cancelled_by = auth.uid(),
         updated_at = now()
   WHERE id = p_booking_id;

  INSERT INTO public.coroast_hour_ledger (
    account_id, billing_period_id, booking_id, entry_type, hours_delta, notes, created_by
  ) VALUES (
    v_account_id, v_billing_period_id, p_booking_id,
    'BOOKING_RETURNED'::coroast_ledger_entry_type,
    -ROUND(COALESCE(v_duration, 0), 2), -- negative: hours credited back
    'Member-initiated cancellation',
    auth.uid()
  );
END;
$$;
