-- Prevent duplicate co-roasting billing periods and duplicate child rows.
-- Existing duplicates were consolidated before this migration.

CREATE UNIQUE INDEX IF NOT EXISTS coroast_billing_periods_account_period_start_key
  ON public.coroast_billing_periods (account_id, period_start)
  WHERE account_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS coroast_storage_allocations_period_account_key
  ON public.coroast_storage_allocations (billing_period_id, account_id)
  WHERE account_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS coroast_invoices_period_account_key
  ON public.coroast_invoices (billing_period_id, account_id)
  WHERE account_id IS NOT NULL;

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
     AND period_start = v_period_start
   ORDER BY created_at ASC, id ASC
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  SELECT
    COALESCE(a.coroast_tier, 'MEMBER'::coroast_tier),
    COALESCE(a.coroast_custom_included_hours, tr.included_hours),
    COALESCE(a.coroast_custom_overage_rate, tr.overage_rate_per_hr),
    COALESCE(a.coroast_custom_base_fee, tr.base_fee)
    INTO v_tier, v_included_hours, v_overage_rate, v_base_fee
    FROM public.accounts a
    LEFT JOIN public.coroast_tier_rates tr
      ON tr.tier = COALESCE(a.coroast_tier, 'MEMBER'::coroast_tier)
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
$$;

REVOKE ALL ON FUNCTION public._get_or_create_billing_period(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._get_or_create_billing_period(uuid, date) TO authenticated, service_role;