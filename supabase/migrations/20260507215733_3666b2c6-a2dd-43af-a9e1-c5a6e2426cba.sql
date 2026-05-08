
-- 1. Drop dependent FKs and tables that reference the old model
ALTER TABLE public.quote_line_items DROP COLUMN IF EXISTS tier_id_override;
ALTER TABLE public.accounts DROP COLUMN IF EXISTS pricing_tier_id;
DROP TABLE IF EXISTS public.locked_prices CASCADE;
DROP TABLE IF EXISTS public.pricing_tiers CASCADE;
DROP TABLE IF EXISTS public.pricing_rules CASCADE;

-- 2. Reshape pricing_rule_profiles: add the new lever columns and yield_loss_pct
ALTER TABLE public.pricing_rule_profiles
  ADD COLUMN IF NOT EXISTS yield_loss_pct numeric NOT NULL DEFAULT 16,
  ADD COLUMN IF NOT EXISTS process_per_kg_green numeric,
  ADD COLUMN IF NOT EXISTS pkg_material_per_unit numeric,
  ADD COLUMN IF NOT EXISTS pkg_labour_per_unit numeric;

-- 3. Seed/update the 5 archetype profiles
DO $$
DECLARE
  v_existing_default uuid;
BEGIN
  -- Clear current default to avoid the partial-unique conflict during upserts
  UPDATE public.pricing_rule_profiles SET is_default = false WHERE is_default = true;

  INSERT INTO public.pricing_rule_profiles (name, is_default, yield_loss_pct, process_per_kg_green, pkg_material_per_unit, pkg_labour_per_unit)
  VALUES
    ('Retail / DTC',                  true,  16, 8, 2.50, 1.50),
    ('Small Wholesale',               false, 16, 6, 2.00, 1.00),
    ('Medium Wholesale',              false, 16, 5, 1.50, 0.75),
    ('Private Label',                 false, 16, 5, 1.50, 0.75),
    ('White Glove / Manufacturing',   false, 16, 4, 1.00, 0.50)
  ON CONFLICT (name) DO UPDATE
    SET yield_loss_pct        = EXCLUDED.yield_loss_pct,
        process_per_kg_green  = EXCLUDED.process_per_kg_green,
        pkg_material_per_unit = EXCLUDED.pkg_material_per_unit,
        pkg_labour_per_unit   = EXCLUDED.pkg_labour_per_unit,
        is_default            = EXCLUDED.is_default;
END $$;

-- 4. accounts: archetype + pricing_profile_id
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS archetype text,
  ADD COLUMN IF NOT EXISTS pricing_profile_id uuid REFERENCES public.pricing_rule_profiles(id) ON DELETE SET NULL;

ALTER TABLE public.accounts DROP CONSTRAINT IF EXISTS accounts_archetype_check;
ALTER TABLE public.accounts ADD CONSTRAINT accounts_archetype_check
  CHECK (archetype IS NULL OR archetype IN ('retail_dtc','small_wholesale','medium_wholesale','private_label','white_glove'));

-- 5. products: drop legacy override columns, rename wiggle_room→adjustment, add new overrides
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_wiggle_room_note_required;

ALTER TABLE public.products
  DROP COLUMN IF EXISTS green_markup_multiplier_override,
  DROP COLUMN IF EXISTS overhead_per_kg_override,
  DROP COLUMN IF EXISTS process_rate_per_kg_override;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name='wiggle_room_per_bag') THEN
    ALTER TABLE public.products RENAME COLUMN wiggle_room_per_bag TO adjustment_per_unit;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name='wiggle_room_note') THEN
    ALTER TABLE public.products RENAME COLUMN wiggle_room_note TO adjustment_note;
  END IF;
END $$;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS process_per_kg_green_override numeric,
  ADD COLUMN IF NOT EXISTS pkg_material_per_unit_override numeric,
  ADD COLUMN IF NOT EXISTS pkg_labour_per_unit_override numeric,
  ADD COLUMN IF NOT EXISTS adjustment_per_unit numeric,
  ADD COLUMN IF NOT EXISTS adjustment_note text;

ALTER TABLE public.products ADD CONSTRAINT products_adjustment_note_required
  CHECK (
    adjustment_per_unit IS NULL
    OR adjustment_per_unit = 0
    OR (adjustment_note IS NOT NULL AND length(btrim(adjustment_note)) > 0)
  );

-- Replace the audit trigger function to use new column names
CREATE OR REPLACE FUNCTION public.stamp_pricing_overrides_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF (
    NEW.yield_loss_pct_override        IS DISTINCT FROM OLD.yield_loss_pct_override
    OR NEW.process_per_kg_green_override  IS DISTINCT FROM OLD.process_per_kg_green_override
    OR NEW.pkg_material_per_unit_override IS DISTINCT FROM OLD.pkg_material_per_unit_override
    OR NEW.pkg_labour_per_unit_override   IS DISTINCT FROM OLD.pkg_labour_per_unit_override
    OR NEW.packaging_material_override IS DISTINCT FROM OLD.packaging_material_override
    OR NEW.packaging_labour_override   IS DISTINCT FROM OLD.packaging_labour_override
    OR NEW.adjustment_per_unit IS DISTINCT FROM OLD.adjustment_per_unit
    OR NEW.adjustment_note     IS DISTINCT FROM OLD.adjustment_note
  ) THEN
    NEW.pricing_overrides_updated_by := auth.uid();
    NEW.pricing_overrides_updated_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

-- 6. offer_workspace_lines: same restructuring
ALTER TABLE public.offer_workspace_lines
  DROP COLUMN IF EXISTS green_markup_multiplier_override,
  DROP COLUMN IF EXISTS overhead_per_kg_override,
  DROP COLUMN IF EXISTS process_rate_per_kg_override;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='offer_workspace_lines' AND column_name='wiggle_room_per_bag') THEN
    ALTER TABLE public.offer_workspace_lines RENAME COLUMN wiggle_room_per_bag TO adjustment_per_unit;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='offer_workspace_lines' AND column_name='wiggle_room_note') THEN
    ALTER TABLE public.offer_workspace_lines RENAME COLUMN wiggle_room_note TO adjustment_note;
  END IF;
END $$;

ALTER TABLE public.offer_workspace_lines
  ADD COLUMN IF NOT EXISTS process_per_kg_green_override numeric,
  ADD COLUMN IF NOT EXISTS pkg_material_per_unit_override numeric,
  ADD COLUMN IF NOT EXISTS pkg_labour_per_unit_override numeric,
  ADD COLUMN IF NOT EXISTS adjustment_per_unit numeric,
  ADD COLUMN IF NOT EXISTS adjustment_note text;
