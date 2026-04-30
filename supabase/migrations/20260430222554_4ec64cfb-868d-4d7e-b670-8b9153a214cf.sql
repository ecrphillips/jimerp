-- ===== Layer 1A Pricing Engine: schema =====

-- 1) pricing_rule_profiles
CREATE TABLE public.pricing_rule_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  is_default BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one default profile at any time
CREATE UNIQUE INDEX pricing_rule_profiles_only_one_default
  ON public.pricing_rule_profiles ((is_default))
  WHERE is_default = true;

ALTER TABLE public.pricing_rule_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/Ops can read pricing_rule_profiles"
  ON public.pricing_rule_profiles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN'::app_role) OR public.has_role(auth.uid(), 'OPS'::app_role));

CREATE POLICY "Admin can insert pricing_rule_profiles"
  ON public.pricing_rule_profiles FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'ADMIN'::app_role));

CREATE POLICY "Admin can update pricing_rule_profiles"
  ON public.pricing_rule_profiles FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'ADMIN'::app_role));

CREATE POLICY "Admin can delete pricing_rule_profiles"
  ON public.pricing_rule_profiles FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN'::app_role));

CREATE POLICY "Deny anon pricing_rule_profiles"
  ON public.pricing_rule_profiles FOR ALL
  TO anon
  USING (false) WITH CHECK (false);

CREATE TRIGGER trg_pricing_rule_profiles_updated_at
  BEFORE UPDATE ON public.pricing_rule_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger: when a profile is set as default, unset any other default
CREATE OR REPLACE FUNCTION public.enforce_single_default_pricing_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_default IS TRUE THEN
    UPDATE public.pricing_rule_profiles
      SET is_default = false, updated_at = now()
      WHERE id <> NEW.id AND is_default = true;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pricing_rule_profiles_single_default
  AFTER INSERT OR UPDATE OF is_default ON public.pricing_rule_profiles
  FOR EACH ROW
  WHEN (NEW.is_default = true)
  EXECUTE FUNCTION public.enforce_single_default_pricing_profile();

-- 2) pricing_rules (one-to-one with profile)
CREATE TABLE public.pricing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL UNIQUE REFERENCES public.pricing_rule_profiles(id) ON DELETE CASCADE,
  green_markup_multiplier NUMERIC NOT NULL DEFAULT 1.0,
  yield_loss_pct NUMERIC NOT NULL DEFAULT 15.0,
  process_rate_per_kg NUMERIC NOT NULL DEFAULT 0,
  overhead_per_kg NUMERIC NOT NULL DEFAULT 0,
  target_margin_pct NUMERIC NOT NULL DEFAULT 35.0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

ALTER TABLE public.pricing_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/Ops can read pricing_rules"
  ON public.pricing_rules FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN'::app_role) OR public.has_role(auth.uid(), 'OPS'::app_role));

CREATE POLICY "Admin can insert pricing_rules"
  ON public.pricing_rules FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'ADMIN'::app_role));

CREATE POLICY "Admin can update pricing_rules"
  ON public.pricing_rules FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'ADMIN'::app_role));

CREATE POLICY "Admin can delete pricing_rules"
  ON public.pricing_rules FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN'::app_role));

CREATE POLICY "Deny anon pricing_rules"
  ON public.pricing_rules FOR ALL
  TO anon
  USING (false) WITH CHECK (false);

CREATE TRIGGER trg_pricing_rules_updated_at
  BEFORE UPDATE ON public.pricing_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) packaging_costs
CREATE TABLE public.packaging_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bag_size_g INTEGER NOT NULL UNIQUE,
  cost_per_bag NUMERIC NOT NULL,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

ALTER TABLE public.packaging_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/Ops can read packaging_costs"
  ON public.packaging_costs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN'::app_role) OR public.has_role(auth.uid(), 'OPS'::app_role));

CREATE POLICY "Admin can insert packaging_costs"
  ON public.packaging_costs FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'ADMIN'::app_role));

CREATE POLICY "Admin can update packaging_costs"
  ON public.packaging_costs FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'ADMIN'::app_role));

CREATE POLICY "Admin can delete packaging_costs"
  ON public.packaging_costs FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN'::app_role));

CREATE POLICY "Deny anon packaging_costs"
  ON public.packaging_costs FOR ALL
  TO anon
  USING (false) WITH CHECK (false);

CREATE TRIGGER trg_packaging_costs_updated_at
  BEFORE UPDATE ON public.packaging_costs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4) products: add packaging_cost_override
ALTER TABLE public.products
  ADD COLUMN packaging_cost_override NUMERIC;

-- 5) Seed: Standard profile + matching rules row with defaults
INSERT INTO public.pricing_rule_profiles (name, is_default, notes)
VALUES ('Standard', true, NULL);

INSERT INTO public.pricing_rules (profile_id)
SELECT id FROM public.pricing_rule_profiles WHERE name = 'Standard';
