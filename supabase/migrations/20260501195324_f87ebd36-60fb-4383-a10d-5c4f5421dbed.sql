-- ============================================================
-- Member-portal SECURITY DEFINER booking RPCs
-- Members cannot write directly to coroast_bookings / coroast_hour_ledger /
-- coroast_recurring_blocks / coroast_billing_periods (RLS deny). These RPCs
-- run elevated, verify membership, and write atomically.
-- ============================================================

-- Helper: assert auth.uid() is an active member of an account with COROASTING program
CREATE OR REPLACE FUNCTION public._assert_active_coroast_member(_account_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.account_users au
    JOIN public.accounts a ON a.id = au.account_id
    WHERE au.account_id = _account_id
      AND au.user_id = auth.uid()
      AND au.is_active = true
      AND 'COROASTING' = ANY (a.programs)
  ) THEN
    RAISE EXCEPTION 'Not an active member of this account';
  END IF;
END;
$$;

-- Helper: get-or-create billing period for an account+date (month-based)
CREATE OR REPLACE FUNCTION public._get_or_create_billing_period(_account_id uuid, _booking_date date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_start date := date_trunc('month', _booking_date)::date;
  v_period_end   date := (date_trunc('month', _booking_date) + interval '1 month - 1 day')::date;
  v_id uuid;
  v_tier coroast_tier;
  v_included_hours numeric;
  v_overage_rate numeric;
  v_base_fee numeric;
BEGIN
  SELECT id INTO v_id
    FROM public.coroast_billing_periods
   WHERE account_id = _account_id
     AND period_start <= _booking_date
     AND period_end   >= _booking_date
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  SELECT COALESCE(coroast_tier, 'MEMBER'::coroast_tier) INTO v_tier
    FROM public.accounts WHERE id = _account_id;

  -- Mirror tier rates from src/components/bookings/bookingUtils.ts TIER_RATES
  CASE v_tier
    WHEN 'GROWTH'     THEN v_included_hours := 7;  v_overage_rate := 145; v_base_fee := 859;
    WHEN 'PRODUCTION' THEN v_included_hours := 12; v_overage_rate := 130; v_base_fee := 1399;
    WHEN 'ACCESS'     THEN v_included_hours := 3;  v_overage_rate := 135; v_base_fee := 300;
    ELSE                   v_included_hours := 3;  v_overage_rate := 160; v_base_fee := 399;
  END CASE;

  INSERT INTO public.coroast_billing_periods (
    account_id, period_start, period_end, tier_snapshot,
    included_hours, overage_rate_per_hr, base_fee
  ) VALUES (
    _account_id, v_period_start, v_period_end, v_tier,
    v_included_hours, v_overage_rate, v_base_fee
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ============================================================
-- 1) create_member_booking
-- Note: deviates from the spec by NOT taking p_billing_period_id; the RPC
-- looks up / creates the billing period internally because members lack RLS
-- to insert into coroast_billing_periods.
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
    -v_hours, -- bookings consume hours (negative delta)
    'Self-serve booking on ' || to_char(p_booking_date, 'YYYY-MM-DD'),
    auth.uid()
  );

  RETURN v_booking_id;
END;
$$;

-- ============================================================
-- 2) create_member_recurring_bookings
-- Accepts day_of_week as int (0=Sun..6=Sat) per spec; maps to enum.
-- ============================================================
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

  v_dow := (ARRAY['SUN','MON','TUE','WED','THU','FRI','SAT']::coroast_recurring_day[])[p_day_of_week + 1];

  INSERT INTO public.coroast_recurring_blocks (
    member_id, day_of_week, start_time, end_time,
    effective_from, effective_until, notes, created_by
  ) VALUES (
    p_account_id, v_dow, p_start_time, p_end_time,
    p_pattern_start_date, p_pattern_end_date,
    NULLIF(TRIM(COALESCE(p_notes, '')), ''), auth.uid()
  )
  RETURNING id INTO v_block_id;

  -- Iterate dates within range matching the day of week
  v_d := p_pattern_start_date;
  WHILE v_d <= p_pattern_end_date LOOP
    -- Postgres EXTRACT(DOW) returns 0=Sun..6=Sat (matches spec)
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

-- ============================================================
-- 3) cancel_member_booking
-- Mirrors the existing member-portal cancel flow: soft-cancel via
-- status='CANCELLED_FREE'. Refunds hours via positive ledger delta.
-- ============================================================
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
    ROUND(COALESCE(v_duration, 0), 2), -- positive: refunds the hours
    'Member-initiated cancellation',
    auth.uid()
  );
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION public.create_member_booking(uuid, date, time, time, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_member_recurring_bookings(uuid, date, date, int, time, time, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_member_booking(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._assert_active_coroast_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._get_or_create_billing_period(uuid, date) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_member_booking(uuid, date, time, time, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_member_recurring_bookings(uuid, date, date, int, time, time, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_member_booking(uuid) TO authenticated;
