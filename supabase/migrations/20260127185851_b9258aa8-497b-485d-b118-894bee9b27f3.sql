-- Create a dev-only function to reset test day with row counts
CREATE OR REPLACE FUNCTION public.dev_reset_test_day()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inventory_count INTEGER := 0;
  v_packing_count INTEGER := 0;
  v_batches_count INTEGER := 0;
  v_line_items_count INTEGER := 0;
  v_orders_count INTEGER := 0;
  v_ship_picks_count INTEGER := 0;
  v_checkmarks_count INTEGER := 0;
  v_plan_items_count INTEGER := 0;
  v_wip_ledger_count INTEGER := 0;
  v_exception_count INTEGER := 0;
  v_andon_count INTEGER := 0;
  v_external_demand_count INTEGER := 0;
BEGIN
  -- Verify caller has ADMIN role
  IF NOT public.has_role(auth.uid(), 'ADMIN') THEN
    RAISE EXCEPTION 'Access denied: ADMIN role required';
  END IF;

  -- ========== DELETE IN FK-SAFE ORDER ==========

  -- 1. Delete ship_picks (references order_line_items and orders)
  DELETE FROM public.ship_picks;
  GET DIAGNOSTICS v_ship_picks_count = ROW_COUNT;

  -- 2. Delete inventory_transactions (references orders and products)
  DELETE FROM public.inventory_transactions;
  GET DIAGNOSTICS v_inventory_count = ROW_COUNT;

  -- 3. Delete production checkmarks
  DELETE FROM public.production_checkmarks;
  GET DIAGNOSTICS v_checkmarks_count = ROW_COUNT;

  -- 4. Delete production plan items (references orders)
  DELETE FROM public.production_plan_items;
  GET DIAGNOSTICS v_plan_items_count = ROW_COUNT;

  -- 5. Delete packing runs
  DELETE FROM public.packing_runs;
  GET DIAGNOSTICS v_packing_count = ROW_COUNT;

  -- 6. Delete roast exception events (references roasted_batches)
  DELETE FROM public.roast_exception_events;
  GET DIAGNOSTICS v_exception_count = ROW_COUNT;

  -- 7. Delete WIP ledger entries (references roasted_batches)
  DELETE FROM public.wip_ledger;
  GET DIAGNOSTICS v_wip_ledger_count = ROW_COUNT;

  -- 8. Delete roasted batches
  DELETE FROM public.roasted_batches;
  GET DIAGNOSTICS v_batches_count = ROW_COUNT;

  -- 9. Delete order line items (references orders)
  DELETE FROM public.order_line_items;
  GET DIAGNOSTICS v_line_items_count = ROW_COUNT;

  -- 10. Delete orders (admin-created only to preserve any system templates)
  DELETE FROM public.orders WHERE created_by_admin = true;
  GET DIAGNOSTICS v_orders_count = ROW_COUNT;

  -- 11. Delete andon picks
  DELETE FROM public.andon_picks;
  GET DIAGNOSTICS v_andon_count = ROW_COUNT;

  -- 12. Delete external demand
  DELETE FROM public.external_demand;
  GET DIAGNOSTICS v_external_demand_count = ROW_COUNT;

  -- 13. Delete WIP adjustments
  DELETE FROM public.wip_adjustments;

  -- 14. Delete FG inventory log
  DELETE FROM public.fg_inventory_log;

  -- 15. Reset FG inventory to zero
  UPDATE public.fg_inventory SET units_on_hand = 0, updated_at = now();

  -- 16. Reset roast group inventory levels to zero
  UPDATE public.roast_group_inventory_levels SET wip_kg = 0, fg_kg = 0, updated_at = now();

  -- Return counts
  RETURN jsonb_build_object(
    'inventory_transactions', v_inventory_count,
    'ship_picks', v_ship_picks_count,
    'packing_runs', v_packing_count,
    'roasted_batches', v_batches_count,
    'order_line_items', v_line_items_count,
    'orders', v_orders_count,
    'production_checkmarks', v_checkmarks_count,
    'production_plan_items', v_plan_items_count,
    'wip_ledger', v_wip_ledger_count,
    'roast_exceptions', v_exception_count,
    'andon_picks', v_andon_count,
    'external_demand', v_external_demand_count
  );
END;
$function$;