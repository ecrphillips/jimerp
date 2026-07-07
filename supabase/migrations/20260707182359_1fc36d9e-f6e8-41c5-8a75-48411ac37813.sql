-- =====================================================================
-- Migration 1: Atomic ship-pick and cancel-with-picks RPCs
-- =====================================================================
CREATE OR REPLACE FUNCTION public.set_ship_pick(
  p_order_id uuid,
  p_order_line_item_id uuid,
  p_units_picked integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_previous_units integer := 0;
  v_delta integer;
  v_status public.order_status;
  v_order_number text;
  v_product_id uuid;
  v_requires_production boolean;
BEGIN
  PERFORM public._assert_internal_staff();

  IF p_units_picked IS NULL OR p_units_picked < 0 THEN
    RAISE EXCEPTION 'Picked units must be >= 0';
  END IF;

  SELECT status, order_number INTO v_status, v_order_number
  FROM public.orders WHERE id = p_order_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Order % not found', p_order_id USING ERRCODE = 'P0002';
  END IF;

  SELECT oli.product_id, COALESCE(p.requires_production, true)
  INTO v_product_id, v_requires_production
  FROM public.order_line_items oli
  JOIN public.products p ON p.id = oli.product_id
  WHERE oli.id = p_order_line_item_id AND oli.order_id = p_order_id;
  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Line item % not found on order %', p_order_line_item_id, p_order_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('ship_pick:' || p_order_line_item_id::text));

  SELECT units_picked INTO v_previous_units
  FROM public.ship_picks
  WHERE order_line_item_id = p_order_line_item_id
  FOR UPDATE;

  v_previous_units := COALESCE(v_previous_units, 0);
  v_delta := p_units_picked - v_previous_units;

  INSERT INTO public.ship_picks (order_id, order_line_item_id, units_picked, updated_by)
  VALUES (p_order_id, p_order_line_item_id, p_units_picked, auth.uid())
  ON CONFLICT (order_line_item_id) DO UPDATE
  SET units_picked = EXCLUDED.units_picked,
      updated_by = EXCLUDED.updated_by,
      updated_at = now();

  IF v_delta <> 0 AND v_requires_production AND v_status <> 'SHIPPED' THEN
    INSERT INTO public.inventory_transactions
      (transaction_type, product_id, order_id, quantity_units, is_system_generated, created_by, notes)
    VALUES
      ('SHIP_CONSUME_FG', v_product_id, p_order_id, -v_delta, true, auth.uid(),
       CASE WHEN v_delta > 0
         THEN 'Picked ' || v_delta || ' units for order ' || COALESCE(v_order_number, p_order_id::text)
         ELSE 'Returned ' || abs(v_delta) || ' units from order ' || COALESCE(v_order_number, p_order_id::text)
       END);
  END IF;

  RETURN p_units_picked;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_order_with_picks(
  p_order_id uuid,
  p_mode text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order_number text;
  v_pick RECORD;
BEGIN
  PERFORM public._assert_internal_staff();

  IF p_mode NOT IN ('return', 'writeoff') THEN
    RAISE EXCEPTION 'Invalid cancel mode: %', p_mode;
  END IF;

  SELECT order_number INTO v_order_number FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found', p_order_id USING ERRCODE = 'P0002';
  END IF;

  FOR v_pick IN
    SELECT sp.id, sp.units_picked, oli.product_id, COALESCE(p.requires_production, true) AS requires_production
    FROM public.ship_picks sp
    JOIN public.order_line_items oli ON oli.id = sp.order_line_item_id
    JOIN public.products p ON p.id = oli.product_id
    WHERE sp.order_id = p_order_id AND sp.units_picked > 0
    FOR UPDATE OF sp
  LOOP
    IF v_pick.requires_production THEN
      INSERT INTO public.inventory_transactions
        (transaction_type, product_id, order_id, quantity_units, is_system_generated, created_by, notes)
      VALUES
        ('SHIP_CONSUME_FG', v_pick.product_id, p_order_id, v_pick.units_picked, false, auth.uid(),
         CASE WHEN p_mode = 'return'
           THEN 'Returned ' || v_pick.units_picked || ' units to stock (order ' || COALESCE(v_order_number, p_order_id::text) || ' cancelled)'
           ELSE 'Reversed ' || v_pick.units_picked || ' picked units (order ' || COALESCE(v_order_number, p_order_id::text) || ' cancelled)'
         END);

      IF p_mode = 'writeoff' THEN
        INSERT INTO public.inventory_transactions
          (transaction_type, product_id, order_id, quantity_units, is_system_generated, created_by, notes)
        VALUES
          ('ADJUSTMENT', v_pick.product_id, p_order_id, -v_pick.units_picked, false, auth.uid(),
           'Written off as lost: ' || v_pick.units_picked || ' units (order ' || COALESCE(v_order_number, p_order_id::text) || ' cancelled)');
      END IF;
    END IF;

    UPDATE public.ship_picks
    SET units_picked = 0, updated_by = auth.uid(), updated_at = now()
    WHERE id = v_pick.id;
  END LOOP;

  PERFORM public.update_order_status(p_order_id, 'CANCELLED'::public.order_status, NULL, false, 'Cancelled with pick reversal');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_ship_pick(uuid, uuid, integer)          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_order_with_picks(uuid, text)         FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_ship_pick(uuid, uuid, integer)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_order_with_picks(uuid, text)          TO authenticated;

-- =====================================================================
-- Migration 2: Vancouver-timezone fix for member booking RPCs
-- =====================================================================
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

-- =====================================================================
-- Migration 3: Hide cancelled orders by default
-- =====================================================================
DROP POLICY IF EXISTS "Cancelled orders hidden by default" ON public.orders;
CREATE POLICY "Cancelled orders hidden by default"
  ON public.orders
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (status <> 'CANCELLED'::public.order_status);

DROP VIEW IF EXISTS public.orders_all;
CREATE VIEW public.orders_all
WITH (security_barrier = true)
AS
SELECT o.*
FROM public.orders o
WHERE public.has_role(auth.uid(), 'ADMIN'::public.app_role)
   OR public.has_role(auth.uid(), 'OPS'::public.app_role);

COMMENT ON VIEW public.orders_all IS
  'Deliberate opt-in read of orders INCLUDING cancelled. Staff (ADMIN/OPS) only — the view owner bypasses orders RLS and the WHERE re-implements the staff gate. Read-only.';

REVOKE ALL ON public.orders_all FROM PUBLIC, anon;
GRANT SELECT ON public.orders_all TO authenticated;

CREATE OR REPLACE FUNCTION public.client_cancel_own_order(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status public.order_status;
BEGIN
  SELECT o.status INTO v_status
  FROM public.orders o
  WHERE o.id = p_order_id
    AND EXISTS (
      SELECT 1 FROM public.account_users au
      WHERE au.account_id = o.account_id
        AND au.user_id = auth.uid()
        AND au.is_active = true
    )
  FOR UPDATE OF o;

  IF v_status IS NULL THEN
    RETURN false;
  END IF;

  IF v_status <> 'SUBMITTED'::public.order_status THEN
    RETURN false;
  END IF;

  UPDATE public.orders
  SET status = 'CANCELLED'::public.order_status,
      updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO public.order_status_audit_log
    (order_id, from_status, to_status, changed_by, reason)
  VALUES
    (p_order_id, v_status, 'CANCELLED'::public.order_status, auth.uid(), 'Cancelled by client');

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.client_cancel_own_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_cancel_own_order(uuid) TO authenticated;