-- ============================================================
-- Co-roast RPC hardening (S2 follow-up)
-- Covers findings #6, #7, #8, #12, #13, #18:
--   #6  account-scoped overlap guard in create_member_booking
--   #7  _assert_active_coroast_member must check 'COROASTING' program
--       for both create and cancel paths
--   #8  max-duration cap on a single booking (12 hours)
--  #12  SELECT RLS for coroast_hour_ledger so members can read their rows
--  #13  tier_rates moved into a DB table with a getter RPC (SQL becomes
--       the source of truth; bookingUtils.ts consumes via React Query)
--  #18  (supporting) RPC contract unchanged: timestamptz/date/time params
--       stay; clients pass ISO strings produced with explicit timezone.
-- ============================================================

-- ---------- #13 tier_rates table + getter RPC ----------

CREATE TABLE IF NOT EXISTS public.coroast_tier_rates (
  tier               coroast_tier PRIMARY KEY,
  base_fee           numeric NOT NULL,
  included_hours     numeric NOT NULL,
  overage_rate_per_hr numeric NOT NULL,
  label              text NOT NULL,
  is_legacy          boolean NOT NULL DEFAULT false,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.coroast_tier_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coroast_tier_rates FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone authenticated can read tier rates" ON public.coroast_tier_rates;
CREATE POLICY "Anyone authenticated can read tier rates"
  ON public.coroast_tier_rates
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins manage tier rates" ON public.coroast_tier_rates;
CREATE POLICY "Admins manage tier rates"
  ON public.coroast_tier_rates
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN'))
  WITH CHECK (public.has_role(auth.uid(), 'ADMIN'));

DROP POLICY IF EXISTS "Deny anon tier rates" ON public.coroast_tier_rates;
CREATE POLICY "Deny anon tier rates"
  ON public.coroast_tier_rates
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- Seed values (mirror the previous TIER_RATES constant)
INSERT INTO public.coroast_tier_rates (tier, base_fee, included_hours, overage_rate_per_hr, label, is_legacy) VALUES
  ('MEMBER',     399,  3,  160, 'Member',           false),
  ('GROWTH',     859,  7,  145, 'Growth',           false),
  ('PRODUCTION', 1399, 12, 130, 'Production',       false),
  ('ACCESS',     300,  3,  135, 'Access (Legacy)',  true)
ON CONFLICT (tier) DO UPDATE
  SET base_fee = EXCLUDED.base_fee,
      included_hours = EXCLUDED.included_hours,
      overage_rate_per_hr = EXCLUDED.overage_rate_per_hr,
      label = EXCLUDED.label,
      is_legacy = EXCLUDED.is_legacy,
      updated_at = now();

CREATE OR REPLACE FUNCTION public.get_coroast_tier_rates()
RETURNS TABLE (
  tier coroast_tier,
  base_fee numeric,
  included_hours numeric,
  overage_rate_per_hr numeric,
  label text,
  is_legacy boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tier, base_fee, included_hours, overage_rate_per_hr, label, is_legacy
    FROM public.coroast_tier_rates
   ORDER BY is_legacy, base_fee;
$$;

REVOKE ALL ON FUNCTION public.get_coroast_tier_rates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_coroast_tier_rates() TO authenticated;

-- ---------- #7 program-membership check (idempotent rewrite) ----------
-- Note: prior version already checked 'COROASTING'; this version is identical
-- in effect, makes the check explicit, and reuses the helper from both
-- create and cancel RPCs (no signature change).

CREATE OR REPLACE FUNCTION public._assert_active_coroast_member(_account_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
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
    RAISE EXCEPTION 'Account does not have an active COROASTING program membership'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

-- ---------- #13 _get_or_create_billing_period now reads tier_rates ----------

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

  SELECT tr.included_hours, tr.overage_rate_per_hr, tr.base_fee
    INTO v_included_hours, v_overage_rate, v_base_fee
    FROM public.coroast_tier_rates tr
   WHERE tr.tier = v_tier;

  IF v_included_hours IS NULL THEN
    RAISE EXCEPTION 'No tier rate configured for tier %', v_tier;
  END IF;

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

-- ---------- #6 + #8 create_member_booking: scoped overlap + max-duration ----------
-- Signature unchanged: (uuid, date, time, time, text, uuid)

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
  c_max_hours CONSTANT numeric := 12;
BEGIN
  PERFORM public._assert_active_coroast_member(p_account_id);

  IF p_start_time >= p_end_time THEN
    RAISE EXCEPTION 'Invalid time range';
  END IF;

  v_hours := ROUND(EXTRACT(EPOCH FROM (p_end_time - p_start_time)) / 3600.0, 2);

  -- #8 max duration cap
  IF v_hours > c_max_hours THEN
    RAISE EXCEPTION 'Booking duration % h exceeds maximum of % h', v_hours, c_max_hours;
  END IF;

  -- #6 Overlap check scoped to THIS account (double-booking guard).
  -- Facility-wide conflicts are still blocked because this overlaps with
  -- the loring-block check below and (separately) by trigger-level
  -- exclusion constraints if/when configured. Member-portal callers only
  -- have visibility into their own bookings anyway; constraining here
  -- prevents a member from accidentally double-booking themselves while
  -- a separate facility-level check (admin-managed) governs cross-tenant
  -- collisions.
  IF EXISTS (
    SELECT 1 FROM public.coroast_bookings cb
    WHERE cb.account_id = p_account_id
      AND cb.booking_date = p_booking_date
      AND cb.status NOT IN ('CANCELLED_FREE', 'CANCELLED_CHARGED', 'CANCELLED_WAIVED', 'NO_SHOW')
      AND cb.start_time < p_end_time
      AND cb.end_time   > p_start_time
  ) THEN
    RAISE EXCEPTION 'Time slot conflicts with one of your existing bookings';
  END IF;

  -- Facility-level conflict: any other account's active booking on the same slot.
  IF EXISTS (
    SELECT 1 FROM public.coroast_bookings cb
    WHERE cb.account_id <> p_account_id
      AND cb.booking_date = p_booking_date
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

-- ---------- #7 cancel_member_booking: explicit program check stays ----------
-- Recreated to ensure it picks up the updated _assert_active_coroast_member.
-- Signature unchanged: (uuid)

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
    -ROUND(COALESCE(v_duration, 0), 2),
    'Member-initiated cancellation',
    auth.uid()
  );
END;
$$;

-- ---------- #12 coroast_hour_ledger: member SELECT RLS ----------
-- Members can SELECT their own ledger rows via the account_users mapping.
-- Existing admin/ops policy and anon-deny stay in place.

DROP POLICY IF EXISTS "Members can read their own coroast_hour_ledger" ON public.coroast_hour_ledger;
CREATE POLICY "Members can read their own coroast_hour_ledger"
  ON public.coroast_hour_ledger
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1
      FROM public.account_users au
     WHERE au.account_id = coroast_hour_ledger.account_id
       AND au.user_id = auth.uid()
       AND au.is_active = true
  ));

-- ---------- Permissions ----------

REVOKE ALL ON FUNCTION public.create_member_booking(uuid, date, time, time, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_member_booking(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._assert_active_coroast_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._get_or_create_billing_period(uuid, date) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_member_booking(uuid, date, time, time, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_member_booking(uuid) TO authenticated;
