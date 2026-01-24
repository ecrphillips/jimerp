-- Update dev_test_reset to use scoped deletes with WHERE clauses
CREATE OR REPLACE FUNCTION public.dev_test_reset()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff_date DATE := CURRENT_DATE - INTERVAL '14 days';
BEGIN
  -- Verify caller has ADMIN role
  IF NOT public.has_role(auth.uid(), 'ADMIN') THEN
    RAISE EXCEPTION 'Access denied: ADMIN role required';
  END IF;

  -- ========== ORDER-RELATED (scoped to admin-created orders) ==========
  -- Delete line items for admin-created orders
  DELETE FROM public.order_line_items
  WHERE order_id IN (
    SELECT id FROM public.orders WHERE created_by_admin = true
  );

  -- Delete admin-created orders
  DELETE FROM public.orders
  WHERE created_by_admin = true;

  -- ========== PRODUCTION-RELATED (scoped to recent dates) ==========
  -- Delete production plan items for recent dates
  DELETE FROM public.production_plan_items
  WHERE target_date >= v_cutoff_date;

  -- Delete production checkmarks for recent dates
  DELETE FROM public.production_checkmarks
  WHERE target_date >= v_cutoff_date;

  -- Delete packing runs for recent dates
  DELETE FROM public.packing_runs
  WHERE target_date >= v_cutoff_date;

  -- Delete roast exception events for recent dates (must come before roasted_batches due to FK)
  DELETE FROM public.roast_exception_events
  WHERE target_date >= v_cutoff_date;

  -- Delete roasted batches for recent dates
  DELETE FROM public.roasted_batches
  WHERE target_date >= v_cutoff_date;

  -- Delete andon picks for recent dates
  DELETE FROM public.andon_picks
  WHERE target_date >= v_cutoff_date;

  -- ========== INVENTORY LEDGER (scoped to recent dates) ==========
  -- Delete WIP ledger entries for recent dates
  DELETE FROM public.wip_ledger
  WHERE target_date >= v_cutoff_date;

  -- Delete WIP adjustments created recently
  DELETE FROM public.wip_adjustments
  WHERE created_at >= v_cutoff_date;

  -- Delete FG inventory log created recently
  DELETE FROM public.fg_inventory_log
  WHERE created_at >= v_cutoff_date;

  -- Reset FG inventory to zero (update, not delete, to preserve structure)
  UPDATE public.fg_inventory
  SET units_on_hand = 0, updated_at = now()
  WHERE units_on_hand > 0;

  -- ========== EXTERNAL DEMAND (scoped to recent dates) ==========
  DELETE FROM public.external_demand
  WHERE target_date >= v_cutoff_date;

END;
$$;