CREATE OR REPLACE FUNCTION public.block_batches_on_post_roast_blends()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.roast_groups rg
    WHERE rg.roast_group = NEW.roast_group
      AND rg.is_blend = true
      AND COALESCE(rg.blend_type, 'POST_ROAST') = 'POST_ROAST'
  ) THEN
    RAISE EXCEPTION 'This is a post-roast blend — plan batches of its component coffees instead (use "Plan batches" on the blend).'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_batches_on_post_roast_blends ON public.roasted_batches;
CREATE TRIGGER trg_block_batches_on_post_roast_blends
BEFORE INSERT OR UPDATE OF roast_group ON public.roasted_batches
FOR EACH ROW EXECUTE FUNCTION public.block_batches_on_post_roast_blends();