-- Product pricing (Phase 5 of the pricing module rebuild).
--
-- Stores the full component build a product was priced with, not just the
-- resulting price. Storing only the price would make the operator's own stated
-- workflow impossible: "if the assumption is set at $50/hr and we bump it to
-- $52, we can query the database for products with <$52 in the labour part of
-- the price build and decide what to do."
--
-- That query needs the rate that was in force at pricing time to live on the
-- row. It is the reason this table exists rather than a single price column on
-- products, and the reason the pricing assumptions table is NOT effective-dated:
-- assumptions hold current values, and history lives here as a snapshot of what
-- each product was actually priced with.
--
-- One row per product, replaced on save. Sheet-level version history is
-- deliberately out of scope — those are exported to XLSX instead.

CREATE TABLE public.product_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL UNIQUE REFERENCES public.products(id) ON DELETE CASCADE,

  -- ---- configuration --------------------------------------------------
  tier TEXT NOT NULL,
  -- Which cost lines were charged. Held as a jsonb object of booleans keyed by
  -- cost line, mirroring CostStackConfig in src/lib/pricingEngine.ts.
  included_lines JSONB NOT NULL,

  -- ---- green ----------------------------------------------------------
  green_basis TEXT NOT NULL CHECK (green_basis IN ('BENCHMARK', 'MARKET')),
  -- The ceiling this product is priced against. A linked green lot reaching or
  -- exceeding it means the headroom is gone.
  green_benchmark_per_kg NUMERIC CHECK (green_benchmark_per_kg >= 0),
  -- Market value of the coffee at pricing time, for comparison.
  green_market_per_kg NUMERIC CHECK (green_market_per_kg >= 0),
  -- Whichever of the two actually priced the line, resolved at save time.
  green_used_per_kg NUMERIC CHECK (green_used_per_kg >= 0),
  blend_components JSONB,

  -- ---- product --------------------------------------------------------
  grams_per_unit NUMERIC CHECK (grams_per_unit > 0),
  packaging_material_per_unit NUMERIC CHECK (packaging_material_per_unit >= 0),
  services_per_unit NUMERIC CHECK (services_per_unit >= 0),

  -- ---- assumptions in force at pricing time ---------------------------
  -- Snapshotted so a later change to the assumptions table does not silently
  -- rewrite the history of what this product was priced on. These are the
  -- columns the "which products used the old labour rate" query reads.
  assumed_roast_throughput_green_kg_per_hr NUMERIC,
  assumed_machine_running_cost_per_hr NUMERIC,
  assumed_loaded_labour_rate_per_hr NUMERIC,
  assumed_yield_loss_pct NUMERIC,
  assumed_pack_units_per_hour NUMERIC,

  -- ---- the dial and the outcome ---------------------------------------
  margin_per_green_kg NUMERIC,
  green_kg_per_unit NUMERIC,
  cost_floor_per_unit NUMERIC,
  price_per_unit NUMERIC,

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  priced_by UUID REFERENCES auth.users(id)
);

COMMENT ON TABLE public.product_pricing IS
  'The full component build each product was priced with. Assumption columns are snapshots, so changing a rate does not rewrite what a product was priced on.';

COMMENT ON COLUMN public.product_pricing.assumed_loaded_labour_rate_per_hr IS
  'Labour rate in force when this product was priced. Query this to find products priced on a superseded rate.';

CREATE INDEX product_pricing_labour_rate_idx
  ON public.product_pricing (assumed_loaded_labour_rate_per_hr);

CREATE INDEX product_pricing_updated_at_idx
  ON public.product_pricing (updated_at DESC);

ALTER TABLE public.product_pricing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Deny anon product_pricing"
  ON public.product_pricing AS PERMISSIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);

CREATE POLICY "Admin/Ops can read product_pricing"
  ON public.product_pricing FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

CREATE POLICY "Admin can manage product_pricing"
  ON public.product_pricing FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'ADMIN'::app_role))
  WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role));

CREATE TRIGGER update_product_pricing_updated_at
  BEFORE UPDATE ON public.product_pricing
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
