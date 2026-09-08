CREATE OR REPLACE FUNCTION public._get_or_create_billing_period(_account_id uuid, _booking_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
     AND period_start = v_period_start
   ORDER BY created_at ASC, id ASC
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  SELECT
    COALESCE(NULLIF(a.coroast_tier, '')::coroast_tier, 'MEMBER'::coroast_tier),
    COALESCE(a.coroast_custom_included_hours, tr.included_hours),
    COALESCE(a.coroast_custom_overage_rate, tr.overage_rate_per_hr),
    COALESCE(a.coroast_custom_base_fee, tr.base_fee)
    INTO v_tier, v_included_hours, v_overage_rate, v_base_fee
    FROM public.accounts a
    LEFT JOIN public.coroast_tier_rates tr
      ON tr.tier = COALESCE(NULLIF(a.coroast_tier, '')::coroast_tier, 'MEMBER'::coroast_tier)
   WHERE a.id = _account_id;

  IF v_tier IS NULL THEN
    RAISE EXCEPTION 'Account not found: %', _account_id;
  END IF;

  IF v_included_hours IS NULL OR v_overage_rate IS NULL OR v_base_fee IS NULL THEN
    RAISE EXCEPTION 'No complete tier rate configured for account % tier %', _account_id, v_tier;
  END IF;

  INSERT INTO public.coroast_billing_periods (
    account_id, period_start, period_end, tier_snapshot,
    included_hours, overage_rate_per_hr, base_fee
  ) VALUES (
    _account_id, v_period_start, v_period_end, v_tier,
    v_included_hours, v_overage_rate, v_base_fee
  )
  ON CONFLICT (account_id, period_start) WHERE account_id IS NOT NULL
  DO UPDATE SET account_id = EXCLUDED.account_id
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public._coroast_effective_booking_rules(p_account_id uuid)
 RETURNS TABLE(booking_horizon_days integer, cancellation_free_hours integer, min_booking_duration_hours numeric, max_booking_duration_hours numeric, allow_recurring_bookings boolean, allow_past_dated_bookings boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    COALESCE(a.coroast_custom_booking_horizon_days,       r.booking_horizon_days),
    COALESCE(a.coroast_custom_cancellation_free_hours,    r.cancellation_free_hours),
    COALESCE(a.coroast_custom_min_booking_duration_hours, r.min_booking_duration_hours),
    COALESCE(a.coroast_custom_max_booking_duration_hours, r.max_booking_duration_hours),
    COALESCE(a.coroast_custom_allow_recurring_bookings,   r.allow_recurring_bookings),
    r.allow_past_dated_bookings
  FROM public.accounts a
  JOIN public.coroast_tier_booking_rules r
    ON r.tier = COALESCE(NULLIF(a.coroast_tier, '')::coroast_tier, 'MEMBER'::coroast_tier)
  WHERE a.id = p_account_id;
$function$;