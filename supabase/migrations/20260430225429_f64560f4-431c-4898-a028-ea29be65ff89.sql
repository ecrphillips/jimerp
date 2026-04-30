-- 1) New table
CREATE TABLE public.pricing_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  profile_id uuid NOT NULL REFERENCES public.pricing_rule_profiles(id) ON DELETE RESTRICT,
  markup_adjustment_type text NOT NULL DEFAULT 'MULTIPLIER',
  markup_multiplier numeric,
  per_kg_fee numeric,
  target_margin_pct numeric,
  is_default boolean NOT NULL DEFAULT false,
  display_order integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pricing_tiers_adjustment_type_check
    CHECK (markup_adjustment_type IN ('MULTIPLIER', 'PER_KG_FEE', 'MARGIN_TARGET')),
  CONSTRAINT pricing_tiers_value_for_type_check CHECK (
    (markup_adjustment_type = 'MULTIPLIER' AND markup_multiplier IS NOT NULL)
    OR (markup_adjustment_type = 'PER_KG_FEE' AND per_kg_fee IS NOT NULL)
    OR (markup_adjustment_type = 'MARGIN_TARGET' AND target_margin_pct IS NOT NULL)
  )
);

-- Partial unique index: only one default tier
CREATE UNIQUE INDEX pricing_tiers_one_default
  ON public.pricing_tiers (is_default) WHERE is_default = true;

-- updated_at trigger
CREATE TRIGGER trg_pricing_tiers_updated_at
  BEFORE UPDATE ON public.pricing_tiers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-flip default: when a tier is set is_default=true, unset all others
CREATE OR REPLACE FUNCTION public.pricing_tiers_flip_default()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_default = true THEN
    UPDATE public.pricing_tiers
      SET is_default = false
      WHERE id <> NEW.id AND is_default = true;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pricing_tiers_flip_default
  AFTER INSERT OR UPDATE OF is_default ON public.pricing_tiers
  FOR EACH ROW
  WHEN (NEW.is_default = true)
  EXECUTE FUNCTION public.pricing_tiers_flip_default();

-- RLS
ALTER TABLE public.pricing_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/Ops can read pricing_tiers"
  ON public.pricing_tiers FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

CREATE POLICY "Admin can manage pricing_tiers"
  ON public.pricing_tiers FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'ADMIN'::app_role))
  WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role));

CREATE POLICY "Deny anon pricing_tiers"
  ON public.pricing_tiers FOR ALL
  TO anon
  USING (false) WITH CHECK (false);

-- 2) accounts.pricing_tier_id
ALTER TABLE public.accounts
  ADD COLUMN pricing_tier_id uuid REFERENCES public.pricing_tiers(id) ON DELETE SET NULL;

-- 3) Seed tiers using the default profile (Standard)
DO $$
DECLARE
  v_profile_id uuid;
BEGIN
  SELECT id INTO v_profile_id
    FROM public.pricing_rule_profiles
    WHERE is_default = true
    LIMIT 1;

  IF v_profile_id IS NULL THEN
    SELECT id INTO v_profile_id FROM public.pricing_rule_profiles LIMIT 1;
  END IF;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'No pricing_rule_profiles row found for tier seed';
  END IF;

  INSERT INTO public.pricing_tiers (name, profile_id, markup_adjustment_type, markup_multiplier, per_kg_fee, target_margin_pct, is_default, display_order)
  VALUES
    ('Retail',      v_profile_id, 'MULTIPLIER',    1.00, NULL, NULL, true,  1),
    ('Wholesale 1', v_profile_id, 'MULTIPLIER',    0.85, NULL, NULL, false, 2),
    ('Wholesale 2', v_profile_id, 'MULTIPLIER',    0.75, NULL, NULL, false, 3),
    ('Bulk',        v_profile_id, 'PER_KG_FEE',    NULL, 0,    NULL, false, 4),
    ('White Glove', v_profile_id, 'MULTIPLIER',    1.00, NULL, NULL, false, 5),
    ('Custom',      v_profile_id, 'MULTIPLIER',    1.00, NULL, NULL, false, 6);
END $$;