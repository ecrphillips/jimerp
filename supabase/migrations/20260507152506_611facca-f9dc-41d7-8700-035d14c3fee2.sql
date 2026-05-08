-- Stage 1: Per-product cost override columns + audit trigger
ALTER TABLE public.products
  ADD COLUMN green_markup_multiplier_override numeric,
  ADD COLUMN yield_loss_pct_override numeric,
  ADD COLUMN process_rate_per_kg_override numeric,
  ADD COLUMN overhead_per_kg_override numeric,
  ADD COLUMN wiggle_room_per_bag numeric,
  ADD COLUMN wiggle_room_note text,
  ADD COLUMN pricing_overrides_updated_by uuid REFERENCES auth.users(id),
  ADD COLUMN pricing_overrides_updated_at timestamptz;

ALTER TABLE public.products
  ADD CONSTRAINT products_wiggle_room_note_required
  CHECK (
    wiggle_room_per_bag IS NULL
    OR (wiggle_room_note IS NOT NULL AND length(btrim(wiggle_room_note)) > 0)
  );

CREATE OR REPLACE FUNCTION public.stamp_pricing_overrides_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (
    NEW.green_markup_multiplier_override IS DISTINCT FROM OLD.green_markup_multiplier_override
    OR NEW.yield_loss_pct_override IS DISTINCT FROM OLD.yield_loss_pct_override
    OR NEW.process_rate_per_kg_override IS DISTINCT FROM OLD.process_rate_per_kg_override
    OR NEW.overhead_per_kg_override IS DISTINCT FROM OLD.overhead_per_kg_override
    OR NEW.wiggle_room_per_bag IS DISTINCT FROM OLD.wiggle_room_per_bag
    OR NEW.wiggle_room_note IS DISTINCT FROM OLD.wiggle_room_note
  ) THEN
    NEW.pricing_overrides_updated_by := auth.uid();
    NEW.pricing_overrides_updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER stamp_products_pricing_overrides_audit
BEFORE UPDATE ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.stamp_pricing_overrides_audit();