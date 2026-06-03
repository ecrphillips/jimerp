-- Recreate the missing coroast_tier_rates table + getter RPC.
-- The original migration (20260514094701_coroast_rpc_hardening.sql) was authored but
-- never applied to this database, so the runtime errors with "relation does not exist".

CREATE TABLE IF NOT EXISTS public.coroast_tier_rates (
  tier               coroast_tier PRIMARY KEY,
  base_fee           numeric NOT NULL,
  included_hours     numeric NOT NULL,
  overage_rate_per_hr numeric NOT NULL,
  label              text NOT NULL,
  is_legacy          boolean NOT NULL DEFAULT false,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.coroast_tier_rates TO authenticated;
GRANT ALL ON public.coroast_tier_rates TO service_role;

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

-- Seed (mirrors CO_ROAST_TIER_DEFAULTS in src/components/bookings/bookingUtils.ts)
INSERT INTO public.coroast_tier_rates (tier, base_fee, included_hours, overage_rate_per_hr, label, is_legacy) VALUES
  ('MEMBER',     399,  3,  160, 'Member',          false),
  ('GROWTH',     859,  7,  145, 'Growth',          false),
  ('PRODUCTION', 1399, 12, 130, 'Production',      false),
  ('ACCESS',     300,  3,  135, 'Access (Legacy)', true)
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