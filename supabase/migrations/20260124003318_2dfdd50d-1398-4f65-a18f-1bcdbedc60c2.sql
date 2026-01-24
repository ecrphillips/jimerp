-- Create dev_test_reset function with ADMIN role enforcement
CREATE OR REPLACE FUNCTION public.dev_test_reset()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify caller has ADMIN role
  IF NOT public.has_role(auth.uid(), 'ADMIN') THEN
    RAISE EXCEPTION 'Access denied: ADMIN role required';
  END IF;

  -- Delete in correct order to satisfy foreign keys
  -- Order-related
  DELETE FROM public.order_line_items;
  DELETE FROM public.orders;
  
  -- Production-related
  DELETE FROM public.production_plan_items;
  DELETE FROM public.production_checkmarks;
  DELETE FROM public.packing_runs;
  DELETE FROM public.roast_exception_events;
  DELETE FROM public.roasted_batches;
  DELETE FROM public.andon_picks;
  
  -- Inventory ledger (transactional, not config)
  DELETE FROM public.wip_ledger;
  DELETE FROM public.wip_adjustments;
  DELETE FROM public.fg_inventory_log;
  DELETE FROM public.fg_inventory;
  
  -- External demand (Andon quantities, not board config)
  DELETE FROM public.external_demand;
END;
$$;

-- Grant execute to authenticated users (function itself checks role)
GRANT EXECUTE ON FUNCTION public.dev_test_reset() TO authenticated;