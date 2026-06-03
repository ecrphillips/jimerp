CREATE OR REPLACE FUNCTION public._coroast_effective_booking_rules(p_account_id uuid)
RETURNS TABLE (
  booking_horizon_days       integer,
  cancellation_free_hours    integer,
  min_booking_duration_hours numeric,
  max_booking_duration_hours numeric,
  allow_recurring_bookings   boolean,
  allow_past_dated_bookings  boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(a.coroast_custom_booking_horizon_days,       r.booking_horizon_days),
    COALESCE(a.coroast_custom_cancellation_free_hours,    r.cancellation_free_hours),
    COALESCE(a.coroast_custom_min_booking_duration_hours, r.min_booking_duration_hours),
    COALESCE(a.coroast_custom_max_booking_duration_hours, r.max_booking_duration_hours),
    COALESCE(a.coroast_custom_allow_recurring_bookings,   r.allow_recurring_bookings),
    r.allow_past_dated_bookings
  FROM public.accounts a
  JOIN public.coroast_tier_booking_rules r
    ON r.tier = COALESCE(a.coroast_tier::coroast_tier, 'MEMBER'::coroast_tier)
  WHERE a.id = p_account_id;
$$;

REVOKE ALL ON FUNCTION public._coroast_effective_booking_rules(uuid) FROM PUBLIC, anon;

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
BEGIN
  PERFORM public._assert_active_coroast_member(p_account_id);

  IF p_start_time >= p_end_time THEN
    RAISE EXCEPTION 'Invalid time range';
  END IF;

  SELECT * INTO v_rules FROM public._coroast_effective_booking_rules(p_account_id);
  IF v_rules IS NULL THEN
    RAISE EXCEPTION 'No booking rules configured for this account';
  END IF;

  IF NOT v_rules.allow_past_dated_bookings AND p_booking_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'Cannot book a date in the past';
  END IF;

  IF p_booking_date > CURRENT_DATE + (v_rules.booking_horizon_days || ' days')::interval THEN
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

CREATE OR REPLACE FUNCTION public.create_member_recurring_bookings(
  p_account_id uuid,
  p_pattern_start_date date,
  p_pattern_end_date date,
  p_day_of_week int,
  p_start_time time,
  p_end_time time,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_block_id uuid;
  v_dow coroast_recurring_day;
  v_d date;
  v_target_dow int;
  v_skipped jsonb := '[]'::jsonb;
  v_created int := 0;
  v_booking_id uuid;
  v_err text;
  v_rules RECORD;
BEGIN
  PERFORM public._assert_active_coroast_member(p_account_id);

  IF p_start_time >= p_end_time THEN
    RAISE EXCEPTION 'Invalid time range';
  END IF;
  IF p_day_of_week < 0 OR p_day_of_week > 6 THEN
    RAISE EXCEPTION 'Invalid day_of_week (must be 0-6)';
  END IF;
  IF p_pattern_end_date < p_pattern_start_date THEN
    RAISE EXCEPTION 'pattern_end_date must be on or after pattern_start_date';
  END IF;

  SELECT * INTO v_rules FROM public._coroast_effective_booking_rules(p_account_id);
  IF v_rules IS NULL THEN
    RAISE EXCEPTION 'No booking rules configured for this account';
  END IF;
  IF NOT v_rules.allow_recurring_bookings THEN
    RAISE EXCEPTION 'Recurring bookings are not permitted for this account tier';
  END IF;

  v_dow := (ARRAY['SUN','MON','TUE','WED','THU','FRI','SAT']::coroast_recurring_day[])[p_day_of_week + 1];

  INSERT INTO public.coroast_recurring_blocks (
    account_id, member_id, day_of_week, start_time, end_time,
    effective_from, effective_until, notes, created_by
  ) VALUES (
    p_account_id, p_account_id, v_dow, p_start_time, p_end_time,
    p_pattern_start_date, p_pattern_end_date,
    NULLIF(TRIM(COALESCE(p_notes, '')), ''), auth.uid()
  )
  RETURNING id INTO v_block_id;

  v_d := p_pattern_start_date;
  WHILE v_d <= p_pattern_end_date LOOP
    v_target_dow := EXTRACT(DOW FROM v_d)::int;
    IF v_target_dow = p_day_of_week THEN
      BEGIN
        v_booking_id := public.create_member_booking(
          p_account_id, v_d, p_start_time, p_end_time, p_notes, v_block_id
        );
        v_created := v_created + 1;
      EXCEPTION WHEN OTHERS THEN
        v_err := SQLERRM;
        v_skipped := v_skipped || jsonb_build_object('date', v_d, 'reason', v_err);
      END;
    END IF;
    v_d := v_d + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'recurring_block_id', v_block_id,
    'bookings_created', v_created,
    'bookings_skipped', v_skipped
  );
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
  IF v_booking_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'Cannot cancel a past booking';
  END IF;

  SELECT * INTO v_rules FROM public._coroast_effective_booking_rules(v_account_id);
  v_start_ts := (v_booking_date + v_start_time)::timestamptz;
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
REVOKE ALL ON FUNCTION public.create_member_recurring_bookings(uuid, date, date, int, time, time, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_member_booking(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_member_booking(uuid, date, time, time, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_member_recurring_bookings(uuid, date, date, int, time, time, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_member_booking(uuid) TO authenticated;