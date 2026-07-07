-- Fix timezone math in the member booking RPCs (America/Vancouver)
--
-- create_member_booking and cancel_member_booking evaluated dates and times in
-- the server's timezone (UTC on Supabase), but bookings store Vancouver
-- wall-clock times. Consequences:
--   * "today" was UTC, so after ~4-5 PM Pacific the server thinks it is tomorrow:
--     same-day bookings were rejected as "in the past", the horizon gained a day,
--     and next-morning cancellations were blocked as "past".
--   * the cancellation cutoff built the start timestamp with a bare ::timestamptz
--     cast, interpreting a 10:00 Vancouver booking as 10:00 UTC (~02:00-03:00 PT),
--     so the free-cancellation window engaged ~7-8 hours early.
--
-- Both functions now derive "today" as the Vancouver calendar date and build the
-- booking start as a Vancouver wall-clock timestamp. Only the timezone-sensitive
-- lines changed; all other logic is preserved verbatim. create_member_recurring_
-- bookings is unchanged — it delegates each date to create_member_booking and so
-- inherits the fix.

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
  v_rules RECORD;
  v_today date := (now() AT TIME ZONE 'America/Vancouver')::date;
BEGIN
  PERFORM public._assert_active_coroast_member(p_account_id);

  IF p_start_time >= p_end_time THEN
    RAISE EXCEPTION 'Invalid time range';
  END IF;

  SELECT * INTO v_rules FROM public._coroast_effective_booking_rules(p_account_id);
  IF v_rules IS NULL THEN
    RAISE EXCEPTION 'No booking rules configured for this account';
  END IF;

  IF NOT v_rules.allow_past_dated_bookings AND p_booking_date < v_today THEN
    RAISE EXCEPTION 'Cannot book a date in the past';
  END IF;

  IF p_booking_date > v_today + (v_rules.booking_horizon_days || ' days')::interval THEN
    RAISE EXCEPTION 'Booking date is beyond the % day booking horizon', v_rules.booking_horizon_days;
  END IF;

  v_hours := ROUND(EXTRACT(EPOCH FROM (p_end_time - p_start_time)) / 3600.0, 2);
  IF v_hours < v_rules.min_booking_duration_hours THEN
    RAISE EXCEPTION 'Booking is shorter than the % hour minimum', v_rules.min_booking_duration_hours;
  END IF;
  IF v_hours > v_rules.max_booking_duration_hours THEN
    RAISE EXCEPTION 'Booking exceeds the % hour maximum', v_rules.max_booking_duration_hours;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.coroast_bookings cb
    WHERE cb.booking_date = p_booking_date
      AND cb.status NOT IN ('CANCELLED_FREE', 'CANCELLED_CHARGED', 'CANCELLED_WAIVED', 'NO_SHOW')
      AND cb.start_time < p_end_time
      AND cb.end_time   > p_start_time
  ) THEN
    RAISE EXCEPTION 'Time slot conflicts with an existing booking';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.coroast_loring_blocks lb
    WHERE lb.block_date = p_booking_date
      AND lb.start_time < p_end_time
      AND lb.end_time   > p_start_time
  ) THEN
    RAISE EXCEPTION 'Time slot conflicts with an unavailability block';
  END IF;

  v_billing_period_id := public._get_or_create_billing_period(p_account_id, p_booking_date);

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
    v_hours,
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
  v_start_time time;
  v_status coroast_booking_status;
  v_duration numeric;
  v_rules RECORD;
  v_start_ts timestamptz;
  v_today date := (now() AT TIME ZONE 'America/Vancouver')::date;
BEGIN
  SELECT account_id, billing_period_id, booking_date, start_time, status, duration_hours
    INTO v_account_id, v_billing_period_id, v_booking_date, v_start_time, v_status, v_duration
    FROM public.coroast_bookings
   WHERE id = p_booking_id;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  PERFORM public._assert_active_coroast_member(v_account_id);

  IF v_status IN ('CANCELLED_FREE','CANCELLED_CHARGED','CANCELLED_WAIVED','NO_SHOW','COMPLETED') THEN
    RAISE EXCEPTION 'Booking is not cancellable';
  END IF;
  IF v_booking_date < v_today THEN
    RAISE EXCEPTION 'Cannot cancel a past booking';
  END IF;

  SELECT * INTO v_rules FROM public._coroast_effective_booking_rules(v_account_id);
  -- Interpret the stored booking date + wall-clock start as Vancouver local time.
  v_start_ts := (v_booking_date + v_start_time) AT TIME ZONE 'America/Vancouver';
  IF v_rules IS NOT NULL
     AND now() >= v_start_ts - (v_rules.cancellation_free_hours || ' hours')::interval THEN
    RAISE EXCEPTION 'Cannot cancel within % hours of the booking start; contact an administrator',
      v_rules.cancellation_free_hours;
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
    -ROUND(COALESCE(v_duration, 0), 2),
    'Member-initiated cancellation',
    auth.uid()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_member_booking(uuid, date, time, time, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_member_booking(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_member_booking(uuid, date, time, time, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_member_booking(uuid) TO authenticated;
