-- Pricing assumptions (Phase 1 of the pricing module rebuild).
--
-- These are the rates that were previously hardcoded across the codebase
-- (ROASTER_THROUGHPUT_KG_PER_HR = 40, financing 60d @ 12%, an implied labour
-- rate). The guiding principle of the rebuild is that no pricing input is a
-- magic number: every rate lives here, is editable, and shows its derivation.
--
-- Deliberately NOT effective-dated. Historical record lives on each product as
-- a snapshot of the components it was priced with, which is also what makes
-- "find every product priced on labour under $52/hr" a single query.
--
-- All value columns are NULLABLE and seeded NULL on purpose: the operator
-- fills them in. A NULL must surface in the UI as "not set", never silently
-- coerce to zero and quietly price something at no cost.

-- ---------------------------------------------------------------------------
-- Singleton assumptions row
-- ---------------------------------------------------------------------------
CREATE TABLE public.pricing_assumptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Enforces exactly one row. See the unique index below.
  is_singleton BOOLEAN NOT NULL DEFAULT true,

  -- Roasting throughput, expressed in GREEN kg/hr.
  -- Note this differs from the legacy ROASTER_THROUGHPUT_KG_PER_HR constant in
  -- src/lib/unitEconomics.ts, which is ROASTED kg/hr. Do not conflate them.
  roast_throughput_green_kg_per_hr NUMERIC CHECK (roast_throughput_green_kg_per_hr > 0),

  -- Cost to run the roaster for an hour (gas, power, wear). Divided by the
  -- throughput above to yield $/green kg.
  machine_running_cost_per_hr NUMERIC CHECK (machine_running_cost_per_hr >= 0),

  -- Labour rate is DERIVED from these four, never entered raw, so that the
  -- resulting $/hr can always be explained on screen:
  --   base   = salary / (weeks_per_year * hours_per_week)
  --   loaded = base * (1 + oncost_pct/100)
  labour_salary_annual NUMERIC CHECK (labour_salary_annual >= 0),
  labour_weeks_per_year NUMERIC CHECK (labour_weeks_per_year > 0 AND labour_weeks_per_year <= 52),
  labour_hours_per_week NUMERIC CHECK (labour_hours_per_week > 0 AND labour_hours_per_week <= 168),
  labour_oncost_pct NUMERIC CHECK (labour_oncost_pct >= 0),

  -- Standard yield loss used to convert roasted kg to green kg consumed.
  -- Intentionally set above true measured loss; the gap absorbs batch loss and
  -- overpacking. Held as one number so that padding is a visible decision.
  standard_yield_loss_pct NUMERIC CHECK (standard_yield_loss_pct >= 0 AND standard_yield_loss_pct < 100),

  -- Green financing carry. Previously hardcoded 60d @ 12% in the
  -- useDefaultPricingFinancing stub, which falsely reported itself as coming
  -- from a pricing profile. This is that number's real home.
  green_financing_days INTEGER CHECK (green_financing_days >= 0),
  green_financing_apr_pct NUMERIC CHECK (green_financing_apr_pct >= 0),

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

CREATE UNIQUE INDEX pricing_assumptions_singleton_idx
  ON public.pricing_assumptions (is_singleton)
  WHERE is_singleton;

COMMENT ON TABLE public.pricing_assumptions IS
  'Single-row store for pricing rates. NULL means "not set" and must render as such, never as zero.';

-- ---------------------------------------------------------------------------
-- Packing speed bands
-- ---------------------------------------------------------------------------
-- Packing speed is banded by finished unit weight rather than by packaging
-- variant, so a new product weight slots into an existing band with no table
-- maintenance. A 400g bag lands in the <=454g band automatically.
CREATE TABLE public.pricing_pack_speed_bands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,

  -- Inclusive lower bound; exclusive-of-nothing upper bound. max_g NULL means
  -- open ended, which guarantees every weight matches exactly one band.
  min_g INTEGER NOT NULL CHECK (min_g >= 0),
  max_g INTEGER CHECK (max_g IS NULL OR max_g >= min_g),

  -- Finished units packed per hour in this band. NULL until the operator
  -- measures it.
  units_per_hour NUMERIC CHECK (units_per_hour > 0),

  display_order INTEGER NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

CREATE UNIQUE INDEX pricing_pack_speed_bands_min_g_idx
  ON public.pricing_pack_speed_bands (min_g);

COMMENT ON TABLE public.pricing_pack_speed_bands IS
  'Weight bands mapping finished unit size to packing throughput. Bands must tile the whole positive range without gaps or overlap.';

-- Bands seeded with boundaries but no rates; rates are the operator's to set.
INSERT INTO public.pricing_pack_speed_bands (label, min_g, max_g, units_per_hour, display_order) VALUES
  ('Up to 454g (1 lb)',        0,    454,  NULL, 1),
  ('455g - 1135g (2.5 lb)',    455,  1135, NULL, 2),
  ('1136g - 2270g (5 lb)',     1136, 2270, NULL, 3),
  ('Over 2270g',               2271, NULL, NULL, 4);

INSERT INTO public.pricing_assumptions (is_singleton) VALUES (true);

-- ---------------------------------------------------------------------------
-- RLS — mirrors the packaging_costs pattern: Admin/Ops read, Admin writes.
-- ---------------------------------------------------------------------------
ALTER TABLE public.pricing_assumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_pack_speed_bands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Deny anon pricing_assumptions"
  ON public.pricing_assumptions AS PERMISSIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);

CREATE POLICY "Admin/Ops can read pricing_assumptions"
  ON public.pricing_assumptions FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

CREATE POLICY "Admin can manage pricing_assumptions"
  ON public.pricing_assumptions FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'ADMIN'::app_role))
  WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role));

CREATE POLICY "Deny anon pricing_pack_speed_bands"
  ON public.pricing_pack_speed_bands AS PERMISSIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);

CREATE POLICY "Admin/Ops can read pricing_pack_speed_bands"
  ON public.pricing_pack_speed_bands FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

CREATE POLICY "Admin can manage pricing_pack_speed_bands"
  ON public.pricing_pack_speed_bands FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'ADMIN'::app_role))
  WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role));

CREATE TRIGGER update_pricing_assumptions_updated_at
  BEFORE UPDATE ON public.pricing_assumptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_pricing_pack_speed_bands_updated_at
  BEFORE UPDATE ON public.pricing_pack_speed_bands
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
